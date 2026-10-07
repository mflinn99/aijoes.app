// Production. Values that must not have a default (budget, alert recipients)
// and all secrets come from environment variables at deploy time, so the
// build fails loudly if they are missing:
//   BUDGET_AMOUNT       monthly budget, whole currency units (required)
//   ALERT_EMAILS        comma-separated alert/budget recipients (required)
//   FOUNDRY_RESOURCE_NAME  Foundry resource with the Claude deployment (required)
//   TAG_OWNER           accountable owner (email or team) for the owner tag (required)
//   CUSTOM_DOMAIN       e.g. app.sentinel8.ai (optional)
//   CONTAINER_IMAGE     repository:tag currently running (deploy.sh sets it)
//   SESSION_SECRET / PG_ADMIN_PASSWORD  only on first deploy or rotation
using '../main.bicep'

param environmentName = 'prod'
param location = 'uksouth'

param tags = {
  owner: readEnvironmentVariable('TAG_OWNER')
  environment: 'prod'
  costCentre: 'sentinel8-prod'
  dataClassification: 'confidential'
}

param lockDataResources = true

// Registry: private (Premium + private endpoint).
param acrPrivate = true
param containerImage = readEnvironmentVariable('CONTAINER_IMAGE', 'sage-halpin:bootstrap')

// App Service: zone redundant needs >= 3 instances. COST: 3 x P0v3 is roughly
// three times the single-instance price; agreed for prod availability.
param appServicePlanSku = 'P0v3'
param appServicePlanCapacity = 3
param appServiceZoneRedundant = true

// Front Door / WAF.
param customDomainHostName = readEnvironmentVariable('CUSTOM_DOMAIN', '')
param wafMode = readEnvironmentVariable('WAF_MODE', 'Prevention')
param authRateLimitPerMinute = 30

// AI.
param aiProvider = 'foundry'
param aiModel = 'claude-opus-5-5'
param foundryResourceName = readEnvironmentVariable('FOUNDRY_RESOURCE_NAME')
param assignFoundryRole = true

// PostgreSQL: General Purpose, zone-redundant HA, 35-day geo-redundant backups.
param postgresSkuName = 'Standard_D2ds_v5'
param postgresSkuTier = 'GeneralPurpose'
param postgresHaMode = 'ZoneRedundant'
param postgresBackupRetentionDays = 35
param postgresGeoRedundantBackup = 'Enabled'
param postgresStorageSizeGB = 64
param postgresConnectionsAlertThreshold = 700
param postgresEntraAdminObjectId = readEnvironmentVariable('PG_ENTRA_ADMIN_OBJECT_ID', '')
param postgresEntraAdminName = readEnvironmentVariable('PG_ENTRA_ADMIN_NAME', '')

// Storage.
param storageSku = 'Standard_ZRS'
param blobSoftDeleteDays = 30
param uploadsImmutabilityDays = 0

// Monitoring.
param logRetentionDays = 90
param alertEmails = split(readEnvironmentVariable('ALERT_EMAILS'), ',')
param budgetAmount = int(readEnvironmentVariable('BUDGET_AMOUNT'))

// Secrets: empty = keep what is in Key Vault.
param sessionSecret = readEnvironmentVariable('SESSION_SECRET', '')
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD', '')
