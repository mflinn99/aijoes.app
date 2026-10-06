// Hijojo on Azure: one Container App (UI, API, Copilot API and the background
// worker) that calls Claude on Microsoft Foundry with its managed identity.
//
// Data: SQLite on an Azure Files share mounted at /data. A network share is not
// safe for SQLite's WAL mode or for more than one writer, so the app runs
// exactly one replica with HIJOJO_SQLITE_JOURNAL=DELETE. Move to Azure Database
// for PostgreSQL before scaling out.
//
// Sending: starts in simulation. Live sending also needs Outlook configured
// and an administrator to switch it on in the app.
//
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.parameters.json

targetScope = 'resourceGroup'

@description('Short environment name, lowercase letters and digits, e.g. prod.')
@minLength(2)
@maxLength(10)
param environmentName string

@description('Azure region. UK South keeps the app, its data and its logs in the UK.')
param location string = resourceGroup().location

@description('Container image. The first deployment can use the placeholder; deploy.sh then rolls out the built image.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Microsoft Foundry (Azure AI Services) resource hosting the Claude deployment.')
param foundryResourceName string

@description('Claude model or deployment name.')
param aiModel string = 'claude-opus-5-5'

@description('Grant the app identity data-plane access to the Foundry resource (it must be in this resource group).')
param assignFoundryRole bool = true

@description('Role for Entra ID access to Foundry. Defaults to Cognitive Services User; confirm against the Foundry documentation for Claude.')
param foundryRoleDefinitionId string = 'a97b65f3-24c7-4388-baec-2e87135dc908'

@description('simulate (default) records email instead of sending it. live also needs Outlook and an administrator to switch sending on.')
@allowed(['simulate', 'live'])
param sendMode string = 'simulate'

@description('Where engaged replies are handed off.')
param handoffTo string = 'mark@aigogo.ai'

@description('Name used to sign introductions.')
param senderName string = 'AIGoGo'

@description('Outlook mailbox Hijojo sends from and reads replies in. Empty leaves Outlook unconfigured.')
param senderMailbox string = ''

@description('Use the app identity for Microsoft Graph (no client secret). The identity needs Mail.Send and Mail.ReadWrite application permissions, restricted to the sender mailbox; see docs/AZURE.md.')
param graphUseManagedIdentity bool = true

@description('Alternative to the managed identity: app registration for Graph, with its secret in Key Vault under graphClientSecretName.')
param graphTenantId string = ''
param graphClientId string = ''
param graphClientSecretName string = ''

@description('Entra tenant for Microsoft 365 Copilot access. Empty disables the Copilot API.')
param entraTenantId string = ''

@description('Accepted token audiences for the Copilot API, comma-separated: the API app ID URI and the SSO auth config Application ID URI.')
param entraAudiences string = ''

@description('Delegated scope Copilot tokens must carry.')
param entraScope string = 'access_as_user'

@description('Daily cap on introductions plus follow-ups.')
param dailySendCap int = 20

var suffix = uniqueString(resourceGroup().id, environmentName)
var tags = {
  application: 'hijojo'
  environment: environmentName
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-hijojo-${environmentName}-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-hijojo-${environmentName}'
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crhijojo${environmentName}${suffix}'
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
  name: 'kv-hj-${environmentName}-${take(suffix, 6)}'
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

// Azure Files share for the SQLite database. Container Apps mounts Azure Files
// with the account key, so shared-key access stays on for this account only.
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sthj${environmentName}${take(suffix, 8)}'
  location: location
  tags: tags
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Enabled'
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    shareDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'hijojo-data'
  properties: { shareQuota: 5 }
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
  name: 'cae-hijojo-${environmentName}'
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

resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: 'hijojodata'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: share.name
      accessMode: 'ReadWrite'
    }
  }
}

var useGraphSecret = !graphUseManagedIdentity && !empty(graphClientSecretName)
var appName = 'ca-hijojo-${environmentName}'

var baseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '8080' }
  { name: 'TRUST_PROXY_HOPS', value: '1' }
  { name: 'HIJOJO_DB_PATH', value: '/data/hijojo.db' }
  { name: 'HIJOJO_SQLITE_JOURNAL', value: 'DELETE' }
  { name: 'HIJOJO_AI_PROVIDER', value: 'foundry' }
  { name: 'HIJOJO_MODEL', value: aiModel }
  { name: 'ANTHROPIC_FOUNDRY_RESOURCE', value: foundryResourceName }
  // DefaultAzureCredential needs the client id to pick the user-assigned identity.
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'HIJOJO_SEND_MODE', value: sendMode }
  { name: 'HIJOJO_HANDOFF_TO', value: handoffTo }
  { name: 'HIJOJO_SENDER_NAME', value: senderName }
  { name: 'HIJOJO_SENDER_MAILBOX', value: senderMailbox }
  { name: 'HIJOJO_GRAPH_MANAGED_IDENTITY', value: graphUseManagedIdentity ? '1' : '0' }
  { name: 'HIJOJO_GRAPH_TENANT_ID', value: graphTenantId }
  { name: 'HIJOJO_GRAPH_CLIENT_ID', value: graphClientId }
  { name: 'HIJOJO_DAILY_SEND_CAP', value: string(dailySendCap) }
  { name: 'HIJOJO_ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'HIJOJO_ENTRA_AUDIENCES', value: entraAudiences }
  { name: 'HIJOJO_ENTRA_SCOPE', value: entraScope }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull, vaultSecretsUser]
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
      secrets: useGraphSecret
        ? [
            {
              name: 'graph-client-secret'
              keyVaultUrl: '${vault.properties.vaultUri}secrets/${graphClientSecretName}'
              identity: identity.id
            }
          ]
        : []
    }
    template: {
      containers: [
        {
          name: 'hijojo'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: useGraphSecret ? concat(baseEnv, [{ name: 'HIJOJO_GRAPH_CLIENT_SECRET', secretRef: 'graph-client-secret' }]) : baseEnv
          volumeMounts: [
            { volumeName: 'data', mountPath: '/data' }
          ]
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
      volumes: [
        {
          name: 'data'
          storageType: 'AzureFile'
          storageName: envStorage.name
          // nobrl: SQLite's byte-range locks are not supported over SMB; one replica is the only writer.
          mountOptions: 'uid=1000,gid=1000,dir_mode=0750,file_mode=0640,nobrl,mfsymlinks,cache=none'
        }
      ]
      // Exactly one replica: it runs the background worker (five-day follow-ups,
      // inbox polling) and is the database's only writer.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
output keyVaultName string = vault.name
