// Container registry. acrPrivate = true: Premium SKU, public network access
// disabled, private endpoint. acrPrivate = false: Basic SKU, public endpoint
// (Entra ID auth only - admin user disabled; anonymous pull is off by default
// and is a Standard/Premium-only feature).

param location string
param name string
param tags object
param acrPrivate bool
param privateEndpointsSubnetId string
param privateDnsZoneId string
param workspaceId string
param runtimePrincipalId string

// DECISION: with acrPrivate the push path (self-hosted runner in VNet, ACR
// Tasks agent pool, or az acr import) is not provisioned here (README
// Deviations #5).

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: acrPrivate ? 'Premium' : 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: acrPrivate ? 'Disabled' : 'Enabled'
    networkRuleBypassOptions: acrPrivate ? 'None' : 'AzureServices'
    dataEndpointEnabled: false
    zoneRedundancy: 'Disabled'
    policies: acrPrivate
      ? {
          exportPolicy: { status: 'disabled' }
          retentionPolicy: { status: 'enabled', days: 30 }
        }
      : null
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, runtimePrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    principalId: runtimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = if (acrPrivate) {
  name: 'pe-${name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointsSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'registry'
        properties: {
          privateLinkServiceId: registry.id
          groupIds: ['registry']
        }
      }
    ]
  }
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (acrPrivate) {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'registry', properties: { privateDnsZoneId: privateDnsZoneId } }
    ]
  }
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: registry
  properties: {
    workspaceId: workspaceId
    logs: [
      { category: 'ContainerRegistryLoginEvents', enabled: true }
      { category: 'ContainerRegistryRepositoryEvents', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output id string = registry.id
output name string = registry.name
output loginServer string = registry.properties.loginServer
