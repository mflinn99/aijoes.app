// Non-production. Same security controls as prod (private origin, WAF, private
// data plane); smaller, non-zone-redundant SKUs and shorter retention.
// Required environment variables: BUDGET_AMOUNT, ALERT_EMAILS,
// FOUNDRY_RESOURCE_NAME, TAG_OWNER (see prod.bicepparam for the full list).
using '../main.bicep'

param environmentName = 'nonprod'
param location = 'uksouth'

param tags = {
  owner: readEnvironmentVariable('TAG_OWNER')
  environment: 'nonprod'
  costCentre: 'sentinel8-nonprod'
  dataClassification: 'internal'
}

param lockDataResources = false

// Basic registry with a public endpoint (admin user disabled) keeps nonprod
// cheap; set ACR_PRIVATE=true to mirror prod.
param acrPrivate = bool(readEnvironmentVariable('ACR_PRIVATE', 'false'))
param containerImage = readEnvironmentVariable('CONTAINER_IMAGE', 'sage-halpin:bootstrap')

param appServicePlanSku = 'P0v3'
param appServicePlanCapacity = 1
param appServiceZoneRedundant = false

param customDomainHostName = readEnvironmentVariable('CUSTOM_DOMAIN', '')
param wafMode = readEnvironmentVariable('WAF_MODE', 'Prevention')
param authRateLimitPerMinute = 30

param aiProvider = 'foundry'
param aiModel = 'claude-opus-5-5'
param foundryResourceName = readEnvironmentVariable('FOUNDRY_RESOURCE_NAME')
param assignFoundryRole = true

param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresHaMode = 'Disabled'
param postgresBackupRetentionDays = 7
param postgresGeoRedundantBackup = 'Disabled'
param postgresStorageSizeGB = 32
param postgresConnectionsAlertThreshold = 40

param storageSku = 'Standard_LRS'
param blobSoftDeleteDays = 7

param logRetentionDays = 30
param alertEmails = split(readEnvironmentVariable('ALERT_EMAILS'), ',')
param budgetAmount = int(readEnvironmentVariable('BUDGET_AMOUNT'))

param sessionSecret = readEnvironmentVariable('SESSION_SECRET', '')
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD', '')
