# ADR-001: Production hosting of Sentinel8 on Azure

- **Status:** Proposed. Awaiting a budget ceiling and an Azure tenant (see Consequences).
- **Date:** 7 October 2026
- **Supersedes:** the Container Apps + Table Storage design in `infra/main.bicep`. That design stays in the repository but is no longer authoritative.
- **Implementation:** `infra/azure/` (Bicep, the single infrastructure-as-code approach).

## Context

Sentinel8 is a single Node.js container: a web app and a JSON API holding personal and commercially sensitive data. It calls Claude, reads public feeds, and sometimes sends email. It runs today on Replit in an account the customer does not control (R-01), with no defined recovery objectives (R-09).

Targets (they are targets, not guarantees): 99.9% monthly availability, RPO 15 minutes, RTO 4 hours, OWASP ASVS 4.0.3 Level 2, Azure Well-Architected Framework. The team is small, so services should be managed and generally available, with the fewest moving parts that meet the targets.

## Decision

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Edge, TLS, WAF | **Azure Front Door Premium** with a WAF policy in Prevention mode: Microsoft Default Rule Set 2.1, Bot Manager, and a rate-limit rule on `/api/auth/*` | Global anycast edge, managed certificates, managed WAF rules (Premium only), and Private Link to the origin | Application Gateway WAF v2: regional, more to operate, not cheaper. Front Door Standard: no managed WAF rules and no Private Link (priced as Alternative A) |
| Compute | **App Service (Linux, Web App for Containers)**, Premium v3. P0v3 in nonprod; P0v3 × 3 zone-redundant in prod | Managed patching, deployment slots, health checks, zone redundancy, Private Link inbound | Container Apps (the previous design): Front Door Private Link to it needs a workload-profiles environment with an internal load balancer, which is more parts. AKS: not justified for one container |
| Inbound privacy | **Private endpoint** for the web app (Front Door Private Link origin) with `publicNetworkAccess = Disabled`. Defence in depth: access restrictions allow only the `AzureFrontDoor.Backend` tag with this profile's `X-Azure-FDID` | The origin is not reachable from the Internet | — |
| Outbound | **Regional VNet integration** (outbound only), route all through the VNet. NSGs on subnets | Reaches PostgreSQL, Key Vault and Storage over private IPs. VNet integration does **not** make the app private inbound; the private endpoint does | Azure Firewall: about $900 a month and not justified now. Revisit if an outbound allow-list becomes a requirement. **NAT Gateway: included** (about $33 a month). The integration subnet has no default outbound access, and the app must reach the AI provider and email. The app subnet's NSG allows outbound 443 only |
| Database | **Azure Database for PostgreSQL Flexible Server 16**, injected into the VNet, no public access, TLS required. Prod: General Purpose D2ds_v5, zone-redundant HA, 35-day PITR, geo-redundant backup. Nonprod: Burstable B1ms, 7 days | The app already has a PostgreSQL store. PITR gives an RPO of minutes (WAL archived about every 5 minutes) | Azure Table Storage (the previous choice): no point-in-time restore, so it can't meet the RPO |
| Secrets | **Key Vault** (RBAC, soft delete, purge protection, private endpoint, public access disabled). App Service Key Vault references through a user-assigned managed identity | No secrets in app settings or pipelines | — |
| Uploads | **Blob Storage**: shared-key access disabled, private endpoint, versioning and soft delete, Entra-only access through the managed identity | Ready for file uploads (the app keeps CV text in the encrypted workspace today and has no file uploads yet) | — |
| Images | **Azure Container Registry**. Premium with a private endpoint in prod (`acrPrivate=true`). Basic with admin disabled in nonprod. Pulled with the managed identity (AcrPull) | No registry passwords | — |
| Identity | Managed identities only at runtime. GitHub OIDC federated credentials for deploys (no client secrets). Separate identities for people, deploys and runtime (`IDENTITY.md`) | — | Service principal secrets |
| Observability | **Log Analytics + workspace-based Application Insights** (local auth off). Diagnostic settings on every resource. Alerts route to an action group, and each alert names its runbook | — | — |
| Governance | Tags, `CanNotDelete` locks on prod data resources, a resource-group budget with alerts. Defender for Cloud plans: App Service, Key Vault, Storage, open-source databases | — | Customer-managed keys: not justified yet, because Microsoft-managed keys meet the requirement and CMK adds key-loss risk; revisit if a contract demands it. DDoS Network Protection (about $2,944 a month): Front Door already absorbs L3/4 attacks at the edge. Reassess after a DDoS risk assessment |

Region: **UK South**, with zone redundancy in prod. The paired region (UK West) is used only for geo-redundant backup restore (the region-failure runbook). No active-active.

## Trust boundaries

1. **Internet → Front Door.** Everything is untrusted: WAF, TLS 1.2+, rate limits.
2. **Front Door → origin.** Private Link only. The app also checks the `X-Azure-FDID` header and trusts exactly the Front Door and App Service front-end hops for the client IP (`TRUST_PROXY_HOPS`).
3. **App → data plane** (PostgreSQL, Key Vault, Storage): private endpoints and VNet injection; managed identity for Key Vault and Storage; PostgreSQL by password from Key Vault (follow-up: Entra token authentication).
4. **App → AI provider.** Data leaves the tenant. Foundry in the same tenant is preferred. Model output is untrusted input.
5. **App → public feeds.** SSRF guard. Content is untrusted.
6. **Pipeline → Azure:** OIDC, environment-scoped federated credentials. Prod needs a reviewer.
7. **Operators → Azure:** Entra ID, phishing-resistant MFA, PIM just-in-time roles. No standing Owner.

## Failure modes

| Failure | Effect | Detection | Recovery |
| --- | --- | --- | --- |
| One App Service instance fails | None. Front Door and the plan route around it | Health check, origin health alert | Automatic |
| An availability zone fails (prod) | App: the remaining zones serve. DB: HA fails over (60–120 s, in-flight requests fail) | Alerts | Automatic. `RECOVERY.md#zone-failure` |
| Region fails | Outage | Front Door origin health at 0 | Restore the geo-redundant backup into UK West, redeploy Bicep there, repoint the Front Door origin. RTO 4 h is a target; RPO ≤ 1 h for geo-backup (**exceeds the 15-minute RPO; accepted gap**, see Consequences). `RECOVERY.md#region-failure` |
| Data deleted or corrupted (bug or person) | Data loss | Error spike, user report | PITR to a new server, then repoint. `RECOVERY.md#deletion` |
| Key Vault unreachable | App can't resolve secrets on restart; running instances keep cached values | KV availability alert | `RECOVERY.md#kv-failure` |
| AI provider down or limited | AI features fail with a clear error; accounts and data still work | Error rate on AI routes | Wait, or switch `AI_PROVIDER` |
| Credential or host compromise | Possible data exposure | Defender alerts, sign-in anomalies | `RECOVERY.md#compromise` |
| Spend runaway | Budget exceeded | Budget alert at 50/80/100% | `RECOVERY.md#cost-overrun` |

## Consequences

- **Cost:** see `COST-MODEL.md`. The recommended production configuration costs about $995–1,035 a month for prod alone, or $1,170–1,300 with a lean nonprod (unverified estimates), most of it Front Door Premium, zone-redundant compute and HA PostgreSQL. **Alternative A** (Front Door Standard with a service-tag + FDID-restricted public origin, and custom WAF rules only) saves about $295 a month, at the price of a publicly addressable origin and no managed OWASP rules. It is offered only if the Premium design exceeds the approved budget. Choosing it must be a recorded decision, not a silent downgrade.
- **RPO for region loss:** geo-redundant backup is asynchronous, so the RPO is up to 1 hour. Meeting 15 minutes across regions would need a cross-region read replica (about +$130–290 a month). This is listed as an option.
- **Blocked until:** a customer-owned Azure tenant and subscription; a stated budget ceiling; DNS control of `sentinel8.ai` (or a chosen subdomain); and the Replit data ownership issue resolved (R-01).
- The app needs `STORE=postgres` (already supported). Table Storage is retired for production.
- App Service does not apply access restrictions to Private Link traffic, so the app checks `X-Azure-FDID` itself (`FRONT_DOOR_ID`; tested in `api.test.ts`).
- Implementation deviations from this ADR are listed in `infra/azure/README.md` ("Deviations").
- **Uploads (added 7 October 2026) are stored in PostgreSQL in chunks**, not in Blob Storage as this ADR intends, so they work the same on every host, including Replit. The file store sits behind one module (`server/files.ts`), so moving the bytes to Blob is contained. Do it before uploads grow large, and turn on Defender for Storage malware scanning when it happens. Front Door WAF request-body inspection limits for 20 MB uploads must be checked during the nonprod deployment.
