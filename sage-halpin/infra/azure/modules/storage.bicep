// Blob storage for future uploads. The app does NOT use uploads yet; this
// account exists so the network, identity and retention controls are in place
// before the feature lands. Entra ID only (no shared keys), no public network
// access, reachable through a blob private endpoint.

param location string
param name string
param tags object
param skuName string
param privateEndpointsSubnetId string
param privateDnsZoneId string
param workspaceId string
param runtimePrincipalId string
param lockResources bool

@description('Soft-delete retention for blobs and containers, in days.')
param softDeleteDays int

@description('Optional time-based immutability (WORM) retention on the uploads container, in days. 0 = no immutability policy. The policy is created unlocked; lock it deliberately once agreed, because a locked policy cannot be shortened or removed.')
param uploadsImmutabilityDays int

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: skuName }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
    encryption: {
      requireInfrastructureEncryption: true
      keySource: 'Microsoft.Storage'
      services: {
        blob: { enabled: true, keyType: 'Account' }
        file: { enabled: true, keyType: 'Account' }
      }
    }
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: softDeleteDays }
    containerDeleteRetentionPolicy: { enabled: true, days: softDeleteDays }
    // Point-in-time restore deliberately not enabled (versioning + soft
    // delete cover accidental overwrite/delete for this use).
    restorePolicy: { enabled: false }
  }
}

resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'uploads'
  properties: {
    publicAccess: 'None'
  }
}

resource immutability 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2023-05-01' = if (uploadsImmutabilityDays > 0) {
  parent: uploads
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: uploadsImmutabilityDays
    allowProtectedAppendWrites: false
  }
}

// Scoped to the uploads container only, not the whole account.
resource uploadsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uploads.id, runtimePrincipalId, storageBlobDataContributorRoleId)
  scope: uploads
  properties: {
    principalId: runtimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${name}-blob'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointsSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: account.id
          groupIds: ['blob']
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
      { name: 'blob', properties: { privateDnsZoneId: privateDnsZoneId } }
    ]
  }
}

resource accountDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: account
  properties: {
    workspaceId: workspaceId
    metrics: [{ category: 'Transaction', enabled: true }]
  }
}

resource blobDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: blob
  properties: {
    workspaceId: workspaceId
    logs: [
      { category: 'StorageRead', enabled: true }
      { category: 'StorageWrite', enabled: true }
      { category: 'StorageDelete', enabled: true }
    ]
    metrics: [{ category: 'Transaction', enabled: true }]
  }
}

resource lock 'Microsoft.Authorization/locks@2020-05-01' = if (lockResources) {
  name: 'lock-${name}'
  scope: account
  properties: {
    level: 'CanNotDelete'
    notes: 'Production uploads. Remove deliberately before deleting.'
  }
}

output id string = account.id
output name string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
output uploadsContainerId string = uploads.id
