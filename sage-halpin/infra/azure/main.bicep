// Sage Halpin / Sentinel8 on Azure - target architecture (authoritative).
// Supersedes ../main.bicep (Container Apps design), which is kept for history.
//
//   Internet -> Azure Front Door Premium + WAF (Prevention)
//            -> Private Link (Microsoft-managed private endpoint, groupId 'sites')
//            -> App Service (Linux, Web App for Containers, publicNetworkAccess Disabled)
//            -> VNet integration (OUTBOUND ONLY) -> PostgreSQL Flexible Server (VNet-injected),
//               Key Vault / Storage / ACR (private endpoints), internet via NAT gateway
//
// Deploy: see README.md (what-if first, then az deployment group create with
// a federated deploy identity). Nothing here has been deployed or verified
// against Azure yet.
//
// Not included by decision (assessed later): AKS, Azure Firewall, DDoS Network
// Protection plan.

targetScope = 'resourceGroup'

// ============================================================== types
@description('Tags required on every resource.')
type requiredTags = {
  owner: string
  environment: string
  costCentre: string
  dataClassification: string
  *: string
}

// ============================================================== core
@description('Short environment name, lowercase letters and digits (e.g. prod, nonprod).')
@minLength(2)
@maxLength(10)
param environmentName string

@description('Azure region for regional resources.')
param location string = resourceGroup().location

@description('Tags applied to every resource (owner, environment, costCentre, dataClassification required).')
param tags requiredTags

@description('Apply CanNotDelete locks to the data resources (Postgres, Key Vault, Storage). On for prod.')
param lockDataResources bool = false

// ============================================================== network
param vnetAddressPrefix string = '10.40.0.0/16'
param appIntegrationSubnetPrefix string = '10.40.1.0/24'
param privateEndpointsSubnetPrefix string = '10.40.2.0/24'
param postgresSubnetPrefix string = '10.40.3.0/24'

@description('NAT gateway (static egress IP) on the app-integration subnet. Needed for outbound internet (Claude) because subnets are created without default outbound access.')
param deployNatGateway bool = true

// ============================================================== registry
@description('Private registry: Premium SKU + private endpoint + public access disabled. false = Basic with public endpoint (admin user still disabled).')
param acrPrivate bool = true

@description('Image repository:tag in the registry. Routine deploys pass the currently running tag so infrastructure changes never roll the app back.')
param containerImage string = 'sage-halpin:bootstrap'

// ============================================================== app service
@description('App Service plan SKU (Linux).')
param appServicePlanSku string = 'P0v3'

@description('Plan instances. Zone redundancy requires >= 3; each instance is billed.')
@minValue(1)
param appServicePlanCapacity int = 1

@description('Zone-redundant App Service plan (prod). Requires capacity >= 3, roughly triples the plan cost.')
param appServiceZoneRedundant bool = false

@description('Also create a private endpoint for the web app inside the VNet (in-VNet diagnostics only; Front Door has its own).')
param deployWebAppPrivateEndpoint bool = false

@description('Public base URL of the app (used in emailed links). Empty = https://<custom domain> or the Front Door endpoint hostname.')
param publicBaseUrl string = ''

// ============================================================== front door
@description('Optional custom domain served by Front Door, e.g. app.sentinel8.ai.')
param customDomainHostName string = ''

@allowed(['Prevention', 'Detection'])
@description('WAF mode. Start in Detection for the first week only if agreed, then switch to Prevention.')
param wafMode string = 'Prevention'

@description('Requests per minute per client IP to /api/auth/* before the WAF blocks.')
@minValue(1)
param authRateLimitPerMinute int = 30

// ============================================================== AI
@allowed(['foundry', 'anthropic'])
param aiProvider string = 'foundry'

param aiModel string = 'claude-opus-5-5'

@description('Microsoft Foundry (Azure AI Services) resource hosting the Claude deployment (AI_PROVIDER=foundry).')
param foundryResourceName string = ''

@description('Grant the runtime identity a data-plane role on the Foundry resource. Requires the Foundry resource to be in this resource group.')
param assignFoundryRole bool = false

@description('Role granted on the Foundry resource (default Cognitive Services User).')
param foundryRoleDefinitionId string = 'a97b65f3-24c7-4388-baec-2e87135dc908'

@secure()
@description('Anthropic API key (AI_PROVIDER=anthropic). Pass only to create/rotate the secret; empty keeps the one in Key Vault.')
param anthropicApiKey string = ''

// ============================================================== app behaviour
param rateLimitChat int = 20
param rateLimitAnalysis int = 10
@minValue(1)
@maxValue(730)
param consultationRetentionDays int = 90
param emailEndpoint string = ''
param emailSender string = ''

// ============================================================== secrets
@secure()
@description('Session signing secret (>= 32 chars). Pass only on first deploy or rotation (signs everyone out); empty keeps the Key Vault secret.')
param sessionSecret string = ''

@secure()
@description('PostgreSQL admin password. deploy.sh generates it on first deploy (or ROTATE_PG_PASSWORD=1); empty keeps the current password and Key Vault secrets.')
param postgresAdminPassword string = ''

// ============================================================== postgres
param postgresAdminLogin string = 'sentinel8admin'
param postgresSkuName string = 'Standard_B1ms'
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'Burstable'
@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param postgresHaMode string = 'Disabled'
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 7
@allowed(['Enabled', 'Disabled'])
param postgresGeoRedundantBackup string = 'Disabled'
param postgresStorageSizeGB int = 32
param postgresDatabaseName string = 'sentinel8'
@description('Optional Entra ID admin for Postgres (object id of a group is recommended).')
param postgresEntraAdminObjectId string = ''
param postgresEntraAdminName string = ''
@allowed(['User', 'Group', 'ServicePrincipal'])
param postgresEntraAdminType string = 'Group'

// ============================================================== storage
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GZRS'])
param storageSku string = 'Standard_LRS'
@minValue(1)
@maxValue(365)
param blobSoftDeleteDays int = 14
@description('Time-based immutability on the uploads container in days (0 = off).')
param uploadsImmutabilityDays int = 0

// ============================================================== monitoring
@minValue(30)
param logRetentionDays int = 30
param appInsightsDisableLocalAuth bool = true

@minLength(1)
@description('Email addresses for alerts and budget notifications.')
param alertEmails string[]

param wafBlockAlertThreshold int = 200
param postgresConnectionsAlertThreshold int = 40

// ============================================================== budget
@description('Monthly budget for this resource group in the billing currency. No default: must be supplied.')
@minValue(1)
param budgetAmount int

// DECISION: defaults to the deployment month; pin it if Azure rejects a
// changed start date on an existing budget (README Deviations #10).
@description('First day of the first budget month (yyyy-MM-01).')
param budgetStartDate string = '${utcNow('yyyy-MM')}-01'

// ============================================================== names
var suffix = uniqueString(resourceGroup().id, environmentName)
var namePrefix = 'sagehalpin-${environmentName}'
var allTags = union(tags, { application: 'sage-halpin' })
var keyVaultName = 'kv-sh-${environmentName}-${take(suffix, 6)}'
var storageName = 'stshup${environmentName}${take(suffix, 8)}'
var registryName = 'crsagehalpin${environmentName}${suffix}'
var postgresName = 'psql-${namePrefix}-${take(suffix, 6)}'
var webAppName = 'app-${namePrefix}-${take(suffix, 6)}'

// node-postgres: sslmode=verify-full checks the server certificate against
// Node's built-in CA store and the hostname (Azure Postgres certificates chain
// to DigiCert Global Root G2 / Microsoft RSA Root CA 2017, both in that store).
var databaseUrl = empty(postgresAdminPassword)
  ? ''
  : 'postgres://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgresName}.postgres.database.azure.com:5432/${postgresDatabaseName}?sslmode=verify-full'

// ============================================================== identity
// Runtime identity of the web app: AcrPull, Key Vault Secrets User, Storage
// Blob Data Contributor (uploads container only), Monitoring Metrics Publisher
// (App Insights), and optionally a Foundry data-plane role. Nothing else.
resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${namePrefix}-runtime'
  location: location
  tags: allTags
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    logRetentionDays: logRetentionDays
    alertEmails: alertEmails
    appInsightsDisableLocalAuth: appInsightsDisableLocalAuth
    runtimePrincipalId: runtimeIdentity.properties.principalId
  }
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    addressPrefix: vnetAddressPrefix
    appIntegrationSubnetPrefix: appIntegrationSubnetPrefix
    privateEndpointsSubnetPrefix: privateEndpointsSubnetPrefix
    postgresSubnetPrefix: postgresSubnetPrefix
    deployNatGateway: deployNatGateway
    acrPrivate: acrPrivate
    postgresServerName: postgresName
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    name: keyVaultName
    tags: allTags
    privateEndpointsSubnetId: network.outputs.privateEndpointsSubnetId
    privateDnsZoneId: network.outputs.keyVaultZoneId
    workspaceId: monitoring.outputs.workspaceId
    runtimePrincipalId: runtimeIdentity.properties.principalId
    lockResources: lockDataResources
    sessionSecret: sessionSecret
    postgresAdminPassword: postgresAdminPassword
    databaseUrl: databaseUrl
    anthropicApiKey: anthropicApiKey
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    name: storageName
    tags: allTags
    skuName: storageSku
    privateEndpointsSubnetId: network.outputs.privateEndpointsSubnetId
    privateDnsZoneId: network.outputs.blobZoneId
    workspaceId: monitoring.outputs.workspaceId
    runtimePrincipalId: runtimeIdentity.properties.principalId
    lockResources: lockDataResources
    softDeleteDays: blobSoftDeleteDays
    uploadsImmutabilityDays: uploadsImmutabilityDays
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    name: registryName
    tags: allTags
    acrPrivate: acrPrivate
    privateEndpointsSubnetId: network.outputs.privateEndpointsSubnetId
    privateDnsZoneId: network.outputs.acrZoneId
    workspaceId: monitoring.outputs.workspaceId
    runtimePrincipalId: runtimeIdentity.properties.principalId
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    name: postgresName
    tags: allTags
    delegatedSubnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.postgresZoneId
    workspaceId: monitoring.outputs.workspaceId
    lockResources: lockDataResources
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    highAvailabilityMode: postgresHaMode
    backupRetentionDays: postgresBackupRetentionDays
    geoRedundantBackup: postgresGeoRedundantBackup
    storageSizeGB: postgresStorageSizeGB
    databaseName: postgresDatabaseName
    entraAdminObjectId: postgresEntraAdminObjectId
    entraAdminPrincipalName: postgresEntraAdminName
    entraAdminPrincipalType: postgresEntraAdminType
  }
}

module frontDoor 'modules/frontdoor.bicep' = {
  name: 'frontdoor'
  params: {
    namePrefix: namePrefix
    tags: allTags
    workspaceId: monitoring.outputs.workspaceId
    endpointName: 'fde-${namePrefix}'
    customDomainHostName: customDomainHostName
    wafMode: wafMode
    authRateLimitPerMinute: authRateLimitPerMinute
  }
}

var effectiveBaseUrl = !empty(publicBaseUrl)
  ? publicBaseUrl
  : (!empty(customDomainHostName)
      ? 'https://${customDomainHostName}'
      : 'https://${frontDoor.outputs.endpointHostName}')

module appService 'modules/appservice.bicep' = {
  name: 'appservice'
  // Role assignments must exist before the app pulls its image and resolves
  // its Key Vault references. keyVault and registry are already implicit
  // dependencies through their outputs; storage is not.
  dependsOn: [storage]
  params: {
    location: location
    namePrefix: namePrefix
    appName: webAppName
    tags: allTags
    workspaceId: monitoring.outputs.workspaceId
    skuName: appServicePlanSku
    capacity: appServicePlanCapacity
    zoneRedundant: appServiceZoneRedundant
    runtimeIdentityId: runtimeIdentity.id
    runtimeIdentityClientId: runtimeIdentity.properties.clientId
    appIntegrationSubnetId: network.outputs.appIntegrationSubnetId
    privateEndpointsSubnetId: network.outputs.privateEndpointsSubnetId
    webAppPrivateDnsZoneId: network.outputs.webAppZoneId
    deployPrivateEndpoint: deployWebAppPrivateEndpoint
    frontDoorId: frontDoor.outputs.frontDoorId
    acrLoginServer: registry.outputs.loginServer
    containerImage: containerImage
    appInsightsName: monitoring.outputs.appInsightsName
    keyVaultUri: keyVault.outputs.uri
    publicBaseUrl: effectiveBaseUrl
    aiProvider: aiProvider
    aiModel: aiModel
    foundryResourceName: foundryResourceName
    rateLimitChat: rateLimitChat
    rateLimitAnalysis: rateLimitAnalysis
    consultationRetentionDays: consultationRetentionDays
    emailEndpoint: emailEndpoint
    emailSender: emailSender
  }
}

module frontDoorOrigin 'modules/frontdoor-origin.bicep' = {
  name: 'frontdoor-origin'
  params: {
    profileName: frontDoor.outputs.profileName
    endpointName: frontDoor.outputs.endpointName
    customDomainName: frontDoor.outputs.customDomainName
    location: location
    webAppId: appService.outputs.siteId
    webAppHostName: appService.outputs.defaultHostName
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    namePrefix: namePrefix
    tags: allTags
    actionGroupId: monitoring.outputs.actionGroupId
    frontDoorProfileId: frontDoor.outputs.profileId
    webAppId: appService.outputs.siteId
    planId: appService.outputs.planId
    postgresId: postgres.outputs.id
    keyVaultId: keyVault.outputs.id
    appInsightsId: monitoring.outputs.appInsightsId
    wafBlockThreshold: wafBlockAlertThreshold
    postgresConnectionsThreshold: postgresConnectionsAlertThreshold
  }
}

module budget 'modules/budget.bicep' = {
  name: 'budget'
  params: {
    name: 'budget-${namePrefix}'
    amount: budgetAmount
    startDate: budgetStartDate
    contactEmails: alertEmails
    actionGroupId: monitoring.outputs.actionGroupId
  }
}

// Optional: Foundry data-plane role for the runtime identity.
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (assignFoundryRole) {
  name: foundryResourceName
}

resource foundryAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignFoundryRole) {
  name: guid(resourceGroup().id, foundryResourceName, runtimeIdentity.id, foundryRoleDefinitionId)
  scope: foundry
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryRoleDefinitionId)
  }
}

// ============================================================== outputs
output frontDoorEndpointHostName string = frontDoor.outputs.endpointHostName
output customDomainValidationToken string = frontDoor.outputs.customDomainValidationToken
output publicBaseUrl string = effectiveBaseUrl
output webAppName string = appService.outputs.siteName
output webAppDefaultHostName string = appService.outputs.defaultHostName
output registryName string = registry.outputs.name
output registryLoginServer string = registry.outputs.loginServer
output keyVaultName string = keyVault.outputs.name
output postgresServerName string = postgres.outputs.name
output storageAccountName string = storage.outputs.name
output runtimeIdentityClientId string = runtimeIdentity.properties.clientId
output runtimeIdentityPrincipalId string = runtimeIdentity.properties.principalId
output natEgressIp string = network.outputs.natPublicIp

@description('Resource IDs the federated deploy identity needs role assignments on (configured outside Bicep, see README / docs).')
output deployIdentityScopes object = {
  resourceGroup: resourceGroup().id
  webApp: appService.outputs.siteId
  appServicePlan: appService.outputs.planId
  containerRegistry: registry.outputs.id
  keyVault: keyVault.outputs.id
  postgres: postgres.outputs.id
  storageAccount: storage.outputs.id
  frontDoorProfile: frontDoor.outputs.profileId
  wafPolicy: frontDoor.outputs.wafPolicyId
  runtimeIdentity: runtimeIdentity.id
  logAnalytics: monitoring.outputs.workspaceId
}
