# Recovery runbooks

Targets (targets, not guarantees): **RPO 15 minutes, RTO 4 hours** (prod),
99.9% monthly availability. Region loss has an RPO of ≤ 1 hour (geo-backup;
see ADR-001 Consequences).

**None of these runbooks has been rehearsed.** Nothing is deployed on Azure
yet. Each one becomes "verified" only after a drill, recorded in the drill
log below.

## Backups and immutability

| Data | Backup | Retention | Immutability | Restore test |
| --- | --- | --- | --- | --- |
| PostgreSQL (all app data) | Automatic, with PITR (WAL about every 5 min); geo-redundant in prod | 35 days prod, 7 days nonprod | Platform backups can't be deleted by users. Server deletion is protected by a `CanNotDelete` lock. A deleted server can be restored within 7 days (Azure feature, **unverified for the chosen SKU**) | Quarterly |
| Monthly logical export | `pg_dump` to a Blob container with a **time-based immutability policy (WORM, 90 days, locked)** | 12 months | Yes | Quarterly |
| Key Vault secrets | Soft delete 90 days + purge protection | — | Purge protection | Annual |
| Blob uploads | Versioning + soft delete (14 days) | — | Optional WORM | Annual |
| Infrastructure | Bicep in git | — | — | Each deploy (what-if) |
| Container images | ACR, by digest | Keep 30 days | — | — |

Logical exports are not encrypted with a key separate from Azure's. They
are only as safe as the storage account. Access is limited to PIM-activated
operators.

## Drill schedule (quarterly)

| Quarter | Drill | Pass criteria |
| --- | --- | --- |
| Q1 | PITR to a new server, then app smoke tests against it | Restored within 1 h; row counts match the chosen point |
| Q2 | Zone failover (forced HA failover) | App recovers within 5 min; no data loss |
| Q3 | Compromise tabletop + secret rotation | All secrets rotated within 4 h |
| Q4 | Region restore (geo-backup into UK West, Bicep to a new resource group) | Service in UK West within 4 h |

Drill log: (none yet)

---

## <a id="deletion"></a>Data deletion or corruption

1. Stop further damage: scale the app to 0, or set maintenance, if corruption is ongoing.
2. Pick the restore point (before the event; check App Insights and the PostgreSQL logs).
3. `az postgres flexible-server restore --source-server <prod> --name <prod>-restore-<ts> --restore-time <UTC>` into the same VNet subnet.
4. Compare the affected rows against the restored copy. Either repoint the app (Key Vault `database-url` secret, then restart) or copy the rows back.
5. Record the RPO achieved and the cause. Write a post-incident review.

## <a id="compromise"></a>Security compromise (credential, host or supply chain)

1. **Contain:** turn on the WAF block-all custom rule (or disable the Front Door route); revoke the pipeline federated credentials; disable the suspected identities.
2. **Preserve evidence:** export the Log Analytics tables (AzureDiagnostics, AppServiceHTTPLogs, SigninLogs, AzureActivity). Snapshot by PITR.
3. **Eradicate:**
   - Rotate `SESSION_SECRET`. This signs everyone out and makes saved workspaces unreadable, so restore them from backup only if the secret was not the leak.
   - Rotate the database password, the AI keys and the ACS keys.
   - Redeploy from a known-good digest.
4. **Notify:** the data owner decides on regulatory notification (UK GDPR: 72 hours to the ICO if there is a risk to individuals).
5. **Recover:** restore service, then watch closely for 14 days.

## <a id="zone-failure"></a>Availability zone failure

Automatic. App Service spreads instances across zones, and PostgreSQL HA fails over. Check: the origin health alert clears; the PostgreSQL `is_db_alive` metric. If HA failover does not happen within 5 minutes, force it: `az postgres flexible-server restart --failover Forced`.

## <a id="region-failure"></a>Region failure (UK South)

1. Declare the incident; the customer approver agrees to fail over.
2. Geo-restore PostgreSQL into UK West: `az postgres flexible-server geo-restore …`.
3. Deploy `infra/azure` to a new resource group in UK West, with the same parameters except location (Front Door is global; add the new origin).
4. Recreate the Key Vault secrets from the escrowed copies (the `SESSION_SECRET` escrow is held by two named people offline). **Without the same `SESSION_SECRET`, saved workspaces cannot be decrypted.**
5. Switch the Front Door origin group to the UK West origin. Test.
6. Fail back after UK South recovers, using the same steps in reverse.

## <a id="origin-down"></a>Alert: Front Door origin health below 100%

Check App Service health and instance count, and recent deployments (roll back by redeploying the previous digest). Check that the private endpoint connection state is still Approved.

## <a id="error-spike"></a>Alert: 5xx or failed-request spike

App Insights failures blade. Is it the AI provider (502s from AI routes; not our outage) or the app? If it started with a deploy, roll back to the previous digest.

## <a id="waf-spike"></a>Alert: WAF block spike

Look at the top rule IDs and client IPs in the WAF logs. If it is an attack, keep blocking, and add a custom rule if needed. If it is a false positive after a release, add a scoped exclusion for that rule and path, never turn the rule set off.

## <a id="db-pressure"></a>Alert: PostgreSQL CPU, storage or connections

Storage grows automatically. For CPU, find the slow queries (Query Store). If it is sustained, scale the SKU, which needs a short restart; HA reduces the impact.

## <a id="kv-failure"></a>Alert: Key Vault availability

Running instances keep their resolved secrets. Do not restart the app until Key Vault recovers. Check the private endpoint and DNS.

## <a id="cost-overrun"></a>Alert: budget 50/80/100%

Find the meter in Cost Management. Check AI usage (the provider dashboard and the `AI_DAILY_CALL_LIMIT` hits in the logs), App Service instance count and Log Analytics ingestion. Lower the caps if needed.
