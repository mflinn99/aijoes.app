// Sentinel8 on Azure: one Container App (web + boardroom API) that calls
// Claude on Microsoft Foundry with its managed identity. The workspace data
// lives in each visitor's browser, as it did in Sixonic; board questions put to
// people by questionnaire live in Azure Table Storage, reached with the same
// managed identity (no storage keys).
//
// Deploy into a resource group in UK South:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.parameters.json

targetScope = 'resourceGroup'

@description('Short environment name, lowercase letters and digits only (it becomes part of the registry name), for example dev, staging, prod.')
@minLength(2)
@maxLength(10)
param environmentName string

@description('Azure region. UK South keeps the app and its logs in the UK.')
param location string = resourceGroup().location

@description('Container image to run. The first deployment can use the placeholder; the pipeline then deploys the real image from the registry.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Name of the Microsoft Foundry (Azure AI Services) resource that hosts the Claude deployment.')
param foundryResourceName string

@description('Claude model or deployment name to call.')
param aiModel string = 'claude-opus-5-5'

@description('Grant the app identity access to the Foundry resource. Requires the Foundry resource to be in this resource group; otherwise assign the role there yourself.')
param assignFoundryRole bool = true

@description('Role granted on the Foundry resource for Entra ID data-plane access. Defaults to Cognitive Services User; confirm against the Foundry documentation for Claude deployments.')
param foundryRoleDefinitionId string = 'a97b65f3-24c7-4388-baec-2e87135dc908'

@description('Optional: name of a Key Vault secret holding a Foundry API key. Leave empty to authenticate with the managed identity (recommended).')
param foundryApiKeySecretName string = ''

@description('Minimum replicas. 1 avoids cold starts; 0 scales to zero when idle.')
@minValue(0)
param minReplicas int = 1

@maxValue(10)
param maxReplicas int = 3

@description('Per-client limits on the public AI endpoints, per 10 minutes, per replica.')
param rateLimitChat int = 20
param rateLimitAnalysis int = 10

@description('Public address used in emailed questionnaire links, for example https://app.sentinel8.ai. Defaults to the Container App\'s own address.')
param publicBaseUrl string = ''

@description('Optional: Azure Communication Services endpoint (https://<name>.<region>.communication.azure.com) for emailing questionnaires. Leave empty and the lead sends each link from their own mailbox.')
param emailEndpoint string = ''

@description('Sender address on a verified Azure Communication Services email domain, for example DoNotReply@mail.sentinel8.ai. Required with emailEndpoint.')
param emailSender string = ''

@description('Days a board question and its answers are kept before automatic deletion.')
@minValue(1)
@maxValue(730)
param consultationRetentionDays int = 90

var suffix = uniqueString(resourceGroup().id, environmentName)
var tags = {
  application: 'sage-halpin'
  environment: environmentName
}

// Built-in role definitions.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-sagehalpin-${environmentName}-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-sagehalpin-${environmentName}'
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crsagehalpin${environmentName}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-sh-${environmentName}-${take(suffix, 6)}' // Key Vault names are at most 24 characters
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource vaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

// Board questions, invitations and answers. Entra ID only: shared keys are off.
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stsh${environmentName}${take(suffix, 8)}' // at most 24 lowercase letters and digits
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource consultationsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'consultations'
}

resource tableAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
  }
}

resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (assignFoundryRole) {
  name: foundryResourceName
}

resource foundryAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignFoundryRole) {
  name: guid(resourceGroup().id, foundryResourceName, identity.id, foundryRoleDefinitionId)
  scope: foundry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryRoleDefinitionId)
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-sagehalpin-${environmentName}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var useApiKey = !empty(foundryApiKeySecretName)
var appName = 'ca-sagehalpin-${environmentName}'
var appBaseUrl = empty(publicBaseUrl) ? 'https://${appName}.${environment.properties.defaultDomain}' : publicBaseUrl
var useEmail = !empty(emailEndpoint)

var baseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '8080' }
  { name: 'TRUST_PROXY_HOPS', value: '1' }
  { name: 'AI_PROVIDER', value: 'foundry' }
  { name: 'AI_MODEL', value: aiModel }
  { name: 'ANTHROPIC_FOUNDRY_RESOURCE', value: foundryResourceName }
  // DefaultAzureCredential needs the client id to pick the user-assigned identity.
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'RATE_LIMIT_CHAT_PER_10_MIN', value: string(rateLimitChat) }
  { name: 'RATE_LIMIT_ANALYSIS_PER_10_MIN', value: string(rateLimitAnalysis) }
  { name: 'STORE', value: 'table' }
  { name: 'TABLE_ENDPOINT', value: storage.properties.primaryEndpoints.table }
  { name: 'TABLE_NAME', value: consultationsTable.name }
  { name: 'CONSULTATION_RETENTION_DAYS', value: string(consultationRetentionDays) }
  { name: 'PUBLIC_BASE_URL', value: appBaseUrl }
  { name: 'EMAIL_PROVIDER', value: useEmail ? 'acs' : 'manual' }
  { name: 'ACS_ENDPOINT', value: emailEndpoint }
  { name: 'EMAIL_SENDER', value: emailSender }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull, vaultSecretsUser, tableAccess]
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: useApiKey
        ? [
            {
              name: 'foundry-api-key'
              keyVaultUrl: '${vault.properties.vaultUri}secrets/${foundryApiKeySecretName}'
              identity: identity.id
            }
          ]
        : []
    }
    template: {
      containers: [
        {
          name: 'sage-halpin'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: useApiKey ? concat(baseEnv, [{ name: 'ANTHROPIC_FOUNDRY_API_KEY', secretRef: 'foundry-api-key' }]) : baseEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/healthz', port: 8080 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/readyz', port: 8080 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output identityClientId string = identity.properties.clientId
output keyVaultName string = vault.name
output storageAccountName string = storage.name
output identityPrincipalId string = identity.properties.principalId
