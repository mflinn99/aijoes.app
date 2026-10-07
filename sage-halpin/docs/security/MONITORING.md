# Monitoring and alert catalogue

Defined in `infra/azure/modules/alerts.bicep` and `budget.bicep`. Each alert
goes to the environment's action group (`ALERT_EMAILS`) and names its
runbook. **None of these alerts has been deployed or test-fired.** Owners
are roles until the customer names people.

| Alert | Signal | Threshold (5-min window) | Severity | Owner | Runbook |
| --- | --- | --- | --- | --- | --- |
| Origin health | Front Door `OriginHealthPercentage` | < 100% | 1 | On-call engineer | `RECOVERY.md#origin-down` |
| Edge 5xx | Front Door `Percentage5XX` | > 5% | 2 | On-call engineer | `#error-spike` |
| WAF blocks | Front Door `WebApplicationFirewallRequestCount`, Action=Block | > `wafBlockThreshold` | 2 | Security lead | `#waf-spike` |
| App 5xx | App Service `Http5xx` | > 10 | 2 | On-call engineer | `#error-spike` |
| App CPU | Plan `CpuPercentage` | > 80% | 3 | On-call engineer | `#error-spike` |
| App memory | Plan `MemoryPercentage` | > 85% | 3 | On-call engineer | `#error-spike` |
| DB CPU | PostgreSQL `cpu_percent` | > 80% | 2 | On-call engineer | `#db-pressure` |
| DB storage | PostgreSQL `storage_percent` | > 80% | 2 | On-call engineer | `#db-pressure` |
| DB connections | PostgreSQL `active_connections` | near the limit | 2 | On-call engineer | `#db-pressure` |
| Key Vault availability | Key Vault `Availability` | < 99.9% | 1 | On-call engineer | `#kv-failure` |
| Failed requests | App Insights `requests/failed` | > 10 | 2 | On-call engineer | `#error-spike` |
| Budget | Consumption budget | 50% / 80% / 100% | — | Finance + engineering lead | `#cost-overrun` |

## Logs

Diagnostic settings send to Log Analytics:

- Front Door access and WAF logs
- App Service HTTP, console and audit logs
- PostgreSQL logs
- Key Vault audit events
- Storage reads, writes and deletes

Retention: 90 days in the workspace. Archive for 1 year is a follow-up.

## Known gaps

1. **The app sends no telemetry to Application Insights yet.** There is no
   SDK, and local auth is off, so ingestion must use Entra. The
   failed-requests alert stays silent until the
   `@azure/monitor-opentelemetry` SDK is added and configured with the
   managed identity. Until then, App Service 5xx and Front Door metrics
   cover errors.
2. **Security events (sign-in failures, lockouts, password changes) are not
   emitted as structured events** (`REMEDIATION-PLAN.md` #15). The lockout
   rate can't be alerted on until they are.
3. **Defender for Cloud plans are subscription-scoped and not in the
   Bicep.** Enable App Service, Key Vault, Storage and open-source
   relational databases in the portal, or with
   `az security pricing create`, and route its alerts to the action group.
4. **Entra sign-in risk alerts and PIM activation alerts** for operators
   need an Entra ID P2 licence. Whether the customer has one is unverified.
5. **No synthetic availability test.** Add an App Insights standard test
   against `https://<custom domain>/api/healthz` from 3 or more locations.
