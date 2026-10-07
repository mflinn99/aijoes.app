// Metric alerts. Every alert names its runbook section in
// docs/security/RECOVERY.md so whoever is paged knows where to start.

param namePrefix string
param tags object
param actionGroupId string

param frontDoorProfileId string
param webAppId string
param planId string
param postgresId string
param keyVaultId string
param appInsightsId string

@description('WAF blocked requests in 5 minutes that count as a spike.')
param wafBlockThreshold int
@description('Postgres active connections threshold (B1ms allows ~50, D2ds_v5 ~850).')
param postgresConnectionsThreshold int

var runbook = 'docs/security/RECOVERY.md#'

var alerts = [
  {
    key: 'afd-origin-health'
    description: 'Front Door origin health below 100% (App Service unreachable through Private Link). Runbook: ${runbook}origin-down'
    severity: 1
    scope: frontDoorProfileId
    namespace: 'Microsoft.Cdn/profiles'
    metric: 'OriginHealthPercentage'
    aggregation: 'Average'
    operator: 'LessThan'
    threshold: 100
    dimensions: []
  }
  {
    key: 'afd-5xx-rate'
    description: 'Front Door 5xx response percentage above 5%. Runbook: ${runbook}error-spike'
    severity: 2
    scope: frontDoorProfileId
    namespace: 'Microsoft.Cdn/profiles'
    metric: 'Percentage5XX'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 5
    dimensions: []
  }
  {
    key: 'afd-waf-blocks'
    description: 'WAF blocked requests spiking (attack or false positives after a release). Runbook: ${runbook}waf-spike'
    severity: 2
    scope: frontDoorProfileId
    namespace: 'Microsoft.Cdn/profiles'
    metric: 'WebApplicationFirewallRequestCount'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: wafBlockThreshold
    dimensions: [{ name: 'Action', operator: 'Include', values: ['Block'] }]
  }
  {
    key: 'app-http5xx'
    description: 'App Service returned more than 10 HTTP 5xx in 5 minutes. Runbook: ${runbook}error-spike'
    severity: 2
    scope: webAppId
    namespace: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: 10
    dimensions: []
  }
  {
    key: 'plan-cpu'
    description: 'App Service plan CPU above 80%. Runbook: ${runbook}error-spike'
    severity: 3
    scope: planId
    namespace: 'Microsoft.Web/serverfarms'
    metric: 'CpuPercentage'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 80
    dimensions: []
  }
  {
    key: 'plan-memory'
    description: 'App Service plan memory above 85%. Runbook: ${runbook}error-spike'
    severity: 3
    scope: planId
    namespace: 'Microsoft.Web/serverfarms'
    metric: 'MemoryPercentage'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 85
    dimensions: []
  }
  {
    key: 'pg-cpu'
    description: 'PostgreSQL CPU above 80%. Runbook: ${runbook}db-pressure'
    severity: 2
    scope: postgresId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'cpu_percent'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 80
    dimensions: []
  }
  {
    key: 'pg-storage'
    description: 'PostgreSQL storage above 80% (autogrow is on; check growth and cost). Runbook: ${runbook}db-pressure'
    severity: 2
    scope: postgresId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'storage_percent'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 80
    dimensions: []
  }
  {
    key: 'pg-connections'
    description: 'PostgreSQL active connections near the server limit. Runbook: ${runbook}db-pressure'
    severity: 2
    scope: postgresId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'active_connections'
    aggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: postgresConnectionsThreshold
    dimensions: []
  }
  {
    key: 'kv-availability'
    description: 'Key Vault availability below 99.9% (app secrets / Key Vault references may fail). Runbook: ${runbook}kv-failure'
    severity: 1
    scope: keyVaultId
    namespace: 'Microsoft.KeyVault/vaults'
    metric: 'Availability'
    aggregation: 'Average'
    operator: 'LessThan'
    threshold: json('99.9')
    dimensions: []
  }
  {
    key: 'appi-failed-requests'
    description: 'Application Insights failed requests above 10 in 5 minutes (needs the app to send telemetry). Runbook: ${runbook}error-spike'
    severity: 2
    scope: appInsightsId
    namespace: 'Microsoft.Insights/components'
    metric: 'requests/failed'
    aggregation: 'Count'
    operator: 'GreaterThan'
    threshold: 10
    dimensions: []
  }
]

resource metricAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for a in alerts: {
    name: 'alert-${namePrefix}-${a.key}'
    location: 'global'
    tags: tags
    properties: {
      description: a.description
      severity: a.severity
      enabled: true
      scopes: [a.scope]
      evaluationFrequency: 'PT1M'
      windowSize: 'PT5M'
      targetResourceType: a.namespace
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: 'c1'
            metricNamespace: a.namespace
            metricName: a.metric
            timeAggregation: a.aggregation
            operator: a.operator
            threshold: a.threshold
            dimensions: a.dimensions
          }
        ]
      }
      actions: [{ actionGroupId: actionGroupId }]
    }
  }
]
