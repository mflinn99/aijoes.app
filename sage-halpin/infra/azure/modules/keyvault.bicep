// Key Vault: RBAC only, soft delete + purge protection, no public network
// access, reachable from the VNet through a private endpoint.
//
// Secrets are written through Azure Resource Manager (control plane) by this
// template, so the deploy runner never needs data-plane network access to the
// vault. Each secret is written only when its value is passed in: on routine
// deploys the parameters are empty and the existing secrets are kept.

param location string
param name string
param tags object
param privateEndpointsSubnetId string
param privateDnsZoneId string
param workspaceId string
param runtimePrincipalId string
param lockResources bool

@secure()
param sessionSecret string
@secure()
param postgresAdminPassword string
@secure()
param databaseUrl string
@secure()
param anthropicApiKey string

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
  }
}

resource sessionSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(sessionSecret)) {
  parent: vault
  name: 'session-secret'
  properties: { value: sessionSecret, contentType: 'text/plain' }
}

resource pgPasswordValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(postgresAdminPassword)) {
  parent: vault
  name: 'postgres-admin-password'
  properties: { value: postgresAdminPassword, contentType: 'text/plain' }
}

resource databaseUrlValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(databaseUrl)) {
  parent: vault
  name: 'database-url'
  properties: { value: databaseUrl, contentType: 'text/plain' }
}

resource anthropicKeyValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(anthropicApiKey)) {
  parent: vault
  name: 'anthropic-api-key'
  properties: { value: anthropicApiKey, contentType: 'text/plain' }
}

// Runtime identity: read secret values only (Key Vault Secrets User). No
// management, key or certificate permissions.
resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, runtimePrincipalId, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: runtimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointsSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: {
          privateLinkServiceId: vault.id
          groupIds: ['vault']
        }
      }
    ]
  }
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'vault', properties: { privateDnsZoneId: privateDnsZoneId } }
    ]
  }
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: vault
  properties: {
    workspaceId: workspaceId
    logs: [
      { categoryGroup: 'allLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource lock 'Microsoft.Authorization/locks@2020-05-01' = if (lockResources) {
  name: 'lock-${name}'
  scope: vault
  properties: {
    level: 'CanNotDelete'
    notes: 'Production secrets. Remove deliberately (see docs/security/RECOVERY.md) before deleting.'
  }
}

output id string = vault.id
output name string = vault.name
output uri string = vault.properties.vaultUri
