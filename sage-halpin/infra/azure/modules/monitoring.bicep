// Log Analytics workspace, workspace-based Application Insights and the action
// group every alert and the budget notify.

param location string
param namePrefix string
param tags object

@description('Log Analytics retention in days.')
param logRetentionDays int

@description('Email addresses that receive alerts.')
param alertEmails string[]

@description('Disable Application Insights local (instrumentation-key) auth so only Entra ID authenticated telemetry is accepted.')
param appInsightsDisableLocalAuth bool

@description('Principal id of the runtime identity (gets Monitoring Metrics Publisher on Application Insights for Entra ID ingestion).')
param runtimePrincipalId string

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namePrefix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    features: { disableLocalAuth: true }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// DECISION: local auth disabled per spec; see README Deviations #3.
// NOTE: with DisableLocalAuth = true the ingestion endpoint rejects telemetry
// that only carries the connection string's instrumentation key. The SDK must
// authenticate with Entra ID (the runtime identity holds Monitoring Metrics
// Publisher on this component, and APPLICATIONINSIGHTS_AUTHENTICATION_STRING is
// set on the web app). The app does not ship an Application Insights / OTel SDK
// yet, so today this component receives nothing from the app itself.
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: appInsightsDisableLocalAuth
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource ingestRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, runtimePrincipalId, monitoringMetricsPublisherRoleId)
  scope: appInsights
  properties: {
    principalId: runtimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${namePrefix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take('sh-ops', 12)
    enabled: true
    emailReceivers: [
      for (email, i) in alertEmails: {
        name: 'email-${i}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
  }
}

output workspaceId string = logs.id
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
output actionGroupId string = actionGroup.id
