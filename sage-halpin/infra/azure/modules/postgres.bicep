// PostgreSQL Flexible Server 16, VNet-injected into the delegated 'postgres'
// subnet with a private DNS zone. No public access. Entra ID authentication is
// enabled; password authentication stays enabled ONLY because the app today
// connects with a DATABASE_URL that carries a password (pg.Pool connection
// string). Follow-up: switch the app to Entra token auth (DefaultAzureCredential
// -> token as password, scope https://ossrdbms-aad.database.windows.net/.default)
// and then set passwordAuth to 'Disabled'.

param location string
param name string
param tags object
param delegatedSubnetId string
param privateDnsZoneId string
param workspaceId string
param lockResources bool

@description('Administrator login name (password auth).')
param administratorLogin string

@secure()
@description('Administrator password. Pass only on first deploy or rotation; empty keeps the current password.')
param administratorLoginPassword string

@description('SKU name, e.g. Standard_B1ms (Burstable) or Standard_D2ds_v5 (GeneralPurpose).')
param skuName string

@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param skuTier string

@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param highAvailabilityMode string

@minValue(7)
@maxValue(35)
param backupRetentionDays int

@allowed(['Enabled', 'Disabled'])
param geoRedundantBackup string

param storageSizeGB int

@description('Database the app uses.')
param databaseName string

@description('Optional Entra ID administrator (object id). Empty = none configured by this template.')
param entraAdminObjectId string
param entraAdminPrincipalName string
@allowed(['User', 'Group', 'ServicePrincipal'])
param entraAdminPrincipalType string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: empty(administratorLoginPassword) ? null : administratorLoginPassword
    // DECISION: passwordAuth stays Enabled because the app needs it today (README Deviations #4).
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
    highAvailability: { mode: highAvailabilityMode }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
  }
}

// Server parameters must be applied one at a time.
var settings = [
  { name: 'require_secure_transport', value: 'on' }
  { name: 'ssl_min_protocol_version', value: 'TLSv1.2' }
  { name: 'log_connections', value: 'on' }
  { name: 'log_disconnections', value: 'on' }
  { name: 'log_checkpoints', value: 'on' }
  { name: 'log_lock_waits', value: 'on' }
  { name: 'connection_throttle.enable', value: 'on' }
  { name: 'log_min_duration_statement', value: '2000' }
]

@batchSize(1)
resource config 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = [
  for s in settings: {
    parent: server
    name: s.name
    properties: {
      value: s.value
      source: 'user-override'
    }
  }
]

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource entraAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = if (!empty(entraAdminObjectId)) {
  parent: server
  name: empty(entraAdminObjectId) ? 'none' : entraAdminObjectId
  dependsOn: [config]
  properties: {
    principalName: entraAdminPrincipalName
    principalType: entraAdminPrincipalType
    tenantId: subscription().tenantId
  }
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: server
  properties: {
    workspaceId: workspaceId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource lock 'Microsoft.Authorization/locks@2020-05-01' = if (lockResources) {
  name: 'lock-${name}'
  scope: server
  properties: {
    level: 'CanNotDelete'
    notes: 'Production database. Remove deliberately (see docs/security/RECOVERY.md) before deleting.'
  }
}

output id string = server.id
output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = db.name
