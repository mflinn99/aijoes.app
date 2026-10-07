# Migration runbook: Replit to Azure

**Status: BLOCKED.** Steps marked ⛔ depend on unresolved ownership or data access and must not start until the blocker is cleared:

- **B1:** the Replit app and database are in an account the customer does not control (R-01).
- **B2:** no customer Azure tenant or subscription.
- **B3:** DNS control of `sentinel8.ai` is unconfirmed.
- **B4:** no approved budget ceiling.
- **B5:** the exposed Anthropic key has not been confirmed revoked.

## Roles

| Role | Responsibility |
| --- | --- |
| Migration lead | Runs the steps, holds the go/no-go |
| Customer approver | Approves the switch point and rollback |
| Data owner | Signs off data reconciliation |
| Comms | Notifies users |

## Steps

| # | Step | Detail | Exit check |
| --- | --- | --- | --- |
| 1 | ⛔ **Establish custody (B1)** | Either (a) the Replit account holder transfers the app to the customer's Replit workspace, or (b) the customer imports the repository into their own workspace (`docs/REPLIT.md`) and the data is exported from the current database under a written instruction. Record who held the data and when | The customer can open the app, its database and its secrets |
| 2 | ⛔ **Freeze scope and inventory (B1)** | Count rows per partition in `sentinel8_documents`: `SELECT split_part(partition_key,'-',1) AS kind, count(*), max(updated_at) FROM sentinel8_documents GROUP BY 1`. Record the app commit SHA | Baseline counts recorded |
| 3 | ⛔ **Provision Azure nonprod (B2, B4)** | `infra/azure` with `params/nonprod.bicepparam`: what-if, then deploy. Approve the Front Door private endpoint connection | `infra/azure/README.md` post-deploy checks pass |
| 4 | **Deploy the app to nonprod** | The pipeline builds once and deploys by digest | `/api/healthz` through Front Door returns `accounts: true`; the origin direct URL is refused |
| 5 | ⛔ **Rehearsal migration (B1)** | `pg_dump --format=custom --no-owner --table=sentinel8_documents` from Replit, then `pg_restore` into nonprod PostgreSQL through a private path (an Azure Cloud Shell in the VNet, or a temporary jump container). The **same `SESSION_SECRET`** must go into nonprod Key Vault, or saved workspaces become unreadable and sessions end. Transfer the secret by a secure channel, never chat or email | Row counts match step 2; the reconciliation script (below) shows 0 differences; sign-in with a test account works; saved workspace readable |
| 6 | **Acceptance testing on nonprod** | The browser suites (sign-up, onboarding, consultations, horizon) against the nonprod URL; a restore test; alert test-fire | All pass; evidence saved |
| 7 | ⛔ **Provision prod (B2, B4)** | `params/prod.bicepparam`; locks on | Post-deploy checks pass |
| 8 | ⛔ **DNS preparation (B3)** | Lower the TTL of `app.sentinel8.ai` to 300 s 48 h ahead. Add the Front Door custom domain and validate it (TXT `_dnsauth`) | Front Door certificate issued |
| 9 | **Announce maintenance** | Tell users when, and that they will need to sign in again | Notice sent ≥ 72 h before |
| 10 | ⛔ **Freeze writes on Replit** | Set Replit to maintenance (stop the deployment, or set an env flag that answers 503 for writes) **and confirm no writes for 5 minutes**, using `SELECT max(updated_at), count(*) FROM sentinel8_documents` | The write count is stable |
| 11 | ⛔ **Final copy: the SYSTEM-OF-RECORD SWITCH POINT** | Final `pg_dump` and `pg_restore` into prod; reconcile. **From the moment prod accepts its first write, Azure is the system of record** | Reconciliation 0 differences; data owner signs off |
| 12 | ⛔ **Cut over (B3)** | Point `app.sentinel8.ai` CNAME at the Front Door endpoint. Set `APP_URL` in `site/app-links.js` to `https://app.sentinel8.ai` and publish the website | Health check through the custom domain; smoke tests pass |
| 13 | **Hypercare and decommission** | 14 days of monitoring. After customer acceptance, take a final export of the Replit database into customer storage, delete the Replit deployment and database, and rotate any secrets that existed there | Written acceptance; deletion confirmed |

## Rollback

- **Before step 11 (no writes in Azure):** roll back by reversing DNS and the website `APP_URL`, then re-enabling Replit writes. No data reconciliation is needed.
- **After step 11:** **DNS reversal is not enough**, because writes made in Azure would be lost. Roll back only within the **rollback limit of 2 hours after cut-over**, and only by: freezing Azure writes, `pg_dump` from Azure, restoring into the Replit database, reconciling, then reversing DNS. After 2 hours, or once any write cannot be reconciled, **fix forward** on Azure.
- Rollback decisions belong to the customer approver.

## Reconciliation

For each partition kind (`accounts`, `sessions-*`, `c-*`, `w-*`, `throttle`), compare the row count and `md5(string_agg(partition_key||row_key||json, '' ORDER BY partition_key,row_key))` between source and target. Any difference stops the migration. "Zero unexplained data loss" means every difference is explained and signed off by the data owner. Rows in `sessions-*` and `throttle` may be excluded on purpose, because users sign in again.
