// Monthly cost budget for the resource group, notifying at 50/80/100% of
// actual spend. Runbook for a breach: docs/security/RECOVERY.md#cost-overrun

param name string
@description('Monthly budget amount in the billing currency. No default: must be supplied.')
param amount int
@description('First day of the first budget month, yyyy-MM-01.')
param startDate string
param contactEmails string[]
param actionGroupId string

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: contactEmails
        contactGroups: [actionGroupId]
        locale: 'en-gb'
      }
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: contactEmails
        contactGroups: [actionGroupId]
        locale: 'en-gb'
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: contactEmails
        contactGroups: [actionGroupId]
        locale: 'en-gb'
      }
    }
  }
}

output id string = budget.id
