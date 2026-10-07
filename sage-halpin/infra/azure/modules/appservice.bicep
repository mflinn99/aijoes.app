// Linux App Service plan + Web App for Containers.
//
// Trust boundaries:
//  * Inbound: publicNetworkAccess = 'Disabled'. The only way in is Front Door's
//    Microsoft-managed private endpoint (Private Link, groupId 'sites'), and
//    optionally our own private endpoint in the VNet (deployPrivateEndpoint).
//    The default hostname <app>.azurewebsites.net answers 403 from the internet.
//  * Outbound: VNet integration into the 'app-integration' subnet with
//    vnetRouteAllEnabled, so ALL egress (Postgres, Key Vault, ACR image pulls,
//    the internet via the NAT gateway) goes through the VNet and its NSG.
//    VNet integration is OUTBOUND ONLY; it gives no inbound privacy by itself.
//  * Kudu/SCM: denied for everyone; basic (FTP/SCM) publishing credentials
//    disabled. Deployments change the image through Azure Resource Manager.

param location string
param namePrefix string
param appName string
param tags object
param workspaceId string

@description('Plan SKU, e.g. P0v3.')
param skuName string
@description('Plan instance count. Zone redundancy needs at least 3 (each instance is billed).')
@minValue(1)
param capacity int
param zoneRedundant bool

@description('Resource id of the runtime user-assigned identity.')
param runtimeIdentityId string
@description('Client id of the runtime user-assigned identity.')
param runtimeIdentityClientId string

param appIntegrationSubnetId string
param privateEndpointsSubnetId string
param webAppPrivateDnsZoneId string
@description('Also create a private endpoint for the web app inside the VNet (for in-VNet diagnostics). Front Door does not need it.')
param deployPrivateEndpoint bool

@description('Front Door profile frontDoorId (X-Azure-FDID header value).')
param frontDoorId string

param acrLoginServer string
@description('Image repository:tag inside the registry, e.g. sage-halpin:abc1234.')
param containerImage string

param appInsightsName string
param keyVaultUri string
param publicBaseUrl string

@allowed(['foundry', 'anthropic'])
param aiProvider string
param aiModel string
param foundryResourceName string

param rateLimitChat int
param rateLimitAnalysis int
param consultationRetentionDays int
param emailEndpoint string
param emailSender string

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-${namePrefix}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    reserved: true // Linux
    zoneRedundant: zoneRedundant
  }
}

var kvRef = '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/'

var baseSettings = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'WEBSITES_PORT', value: '8080' }
  { name: 'PORT', value: '8080' }
  { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
  // Request path: client -> Front Door (appends the client IP to
  // X-Forwarded-For) -> App Service front end (appends the Front Door edge IP)
  // -> container. Express must trust exactly those 2 hops so req.ip is the
  // real client (used by the per-IP rate limiter). A larger value would let
  // clients spoof their IP through X-Forwarded-For; a smaller one would rate
  // limit Front Door edges instead of clients. VERIFY after first deploy by
  // logging req.ip once (README "Post-deploy checks").
  { name: 'TRUST_PROXY_HOPS', value: '2' }
  // The app itself refuses requests without this profile's X-Azure-FDID
  // (server/app.ts), which also covers the Private Link path.
  { name: 'FRONT_DOOR_ID', value: frontDoorId }
  { name: 'PUBLIC_BASE_URL', value: publicBaseUrl }
  { name: 'STORE', value: 'postgres' }
  { name: 'DATABASE_URL', value: '${kvRef}database-url/)' }
  { name: 'SESSION_SECRET', value: '${kvRef}session-secret/)' }
  { name: 'AI_PROVIDER', value: aiProvider }
  { name: 'AI_MODEL', value: aiModel }
  // DefaultAzureCredential picks the user-assigned identity by client id.
  { name: 'AZURE_CLIENT_ID', value: runtimeIdentityClientId }
  { name: 'RATE_LIMIT_CHAT_PER_10_MIN', value: string(rateLimitChat) }
  { name: 'RATE_LIMIT_ANALYSIS_PER_10_MIN', value: string(rateLimitAnalysis) }
  { name: 'CONSULTATION_RETENTION_DAYS', value: string(consultationRetentionDays) }
  { name: 'EMAIL_PROVIDER', value: empty(emailEndpoint) ? 'manual' : 'acs' }
  { name: 'ACS_ENDPOINT', value: emailEndpoint }
  { name: 'EMAIL_SENDER', value: emailSender }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  // Entra ID authenticated ingestion (local auth is disabled on the component).
  { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD;ClientId=${runtimeIdentityClientId}' }
]

var aiSettings = aiProvider == 'foundry'
  ? [{ name: 'ANTHROPIC_FOUNDRY_RESOURCE', value: foundryResourceName }]
  : [{ name: 'ANTHROPIC_API_KEY', value: '${kvRef}anthropic-api-key/)' }]

resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  kind: 'app,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${runtimeIdentityId}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    clientAffinityEnabled: false
    clientCertEnabled: false
    keyVaultReferenceIdentity: runtimeIdentityId
    virtualNetworkSubnetId: appIntegrationSubnetId
    vnetRouteAllEnabled: true
    vnetImagePullEnabled: true // pull from the private registry through the VNet
    vnetContentShareEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acrLoginServer}/${containerImage}'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: runtimeIdentityClientId
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/healthz'
      httpLoggingEnabled: true
      detailedErrorLoggingEnabled: false
      remoteDebuggingEnabled: false
      webSocketsEnabled: false
      vnetRouteAllEnabled: true
      appSettings: concat(baseSettings, aiSettings)
      // Defence in depth only. While publicNetworkAccess is 'Disabled' these
      // rules are not what keeps the internet out (see DECISION below); they
      // take over if public access is ever re-enabled by mistake: then only
      // Front Door backends presenting THIS profile's X-Azure-FDID get in.
      // DECISION: App Service does not evaluate access restrictions for traffic
      // arriving through a private endpoint, so the X-Azure-FDID check does not
      // apply to the Private Link path. Front Door's Private Link connection is
      // bound to this profile, which gives the equivalent guarantee there, and the
      // app checks the header itself (FRONT_DOOR_ID app setting).
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [
        {
          name: 'AllowThisFrontDoor'
          description: 'Only this Front Door profile'
          priority: 100
          action: 'Allow'
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: {
            'x-azure-fdid': [frontDoorId]
          }
        }
      ]
      scmIpSecurityRestrictionsUseMain: false
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictions: [
        {
          name: 'DenyAll'
          description: 'Kudu/SCM closed to everyone'
          priority: 100
          action: 'Deny'
          ipAddress: '0.0.0.0/0'
        }
      ]
    }
  }
}

resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'ftp'
  properties: { allow: false }
}

resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'scm'
  properties: { allow: false }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployPrivateEndpoint) {
  name: 'pe-${appName}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointsSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'sites'
        properties: {
          privateLinkServiceId: site.id
          groupIds: ['sites']
        }
      }
    ]
  }
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployPrivateEndpoint) {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'sites', properties: { privateDnsZoneId: webAppPrivateDnsZoneId } }
    ]
  }
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: site
  properties: {
    workspaceId: workspaceId
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
      { category: 'AppServiceAuditLogs', enabled: true }
      { category: 'AppServiceIPSecAuditLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource planDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: plan
  properties: {
    workspaceId: workspaceId
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output planId string = plan.id
output siteId string = site.id
output siteName string = site.name
output defaultHostName string = site.properties.defaultHostName
