# Sage Halpin on Azure: target architecture (Bicep)

This folder is the **authoritative** infrastructure-as-code for Sage Halpin /
Sentinel8 on Azure. It **supersedes** the Container Apps design in
`../main.bicep`, `../main.parameters.json` and `../deploy.sh`. Those files are
kept for reference only. Do not deploy them alongside this folder.

> **Status: nothing here has been deployed or checked against Azure.** The
> templates compile and lint cleanly with Bicep CLI 0.47.16 (see
> [Validation](#validation)). That is the only verification done so far. Every
> behaviour described below is the design intent. It becomes fact only once
> the [post-deploy checks](#post-deploy-verification) pass in a real
> subscription.

## Layout

| File | Purpose |
|---|---|
| `main.bicep` | Entry point (resource-group scope). Wires the modules together, creates the runtime identity and the optional Foundry role, and defines the outputs. |
| `modules/network.bicep` | VNet, three subnets, NSGs, NAT gateway, private DNS zones and VNet links. |
| `modules/monitoring.bicep` | Log Analytics workspace, workspace-based Application Insights and the alert action group. |
| `modules/keyvault.bicep` | Key Vault, its secrets (written through ARM), private endpoint, RBAC, diagnostics and lock. |
| `modules/storage.bicep` | Blob storage for uploads, with private endpoint, versioning and soft delete, an optional immutability policy, container-scoped RBAC, diagnostics and lock. |
| `modules/registry.bicep` | Azure Container Registry: Premium and private, or Basic and public. AcrPull for the runtime identity. |
| `modules/postgres.bicep` | PostgreSQL Flexible Server 16, VNet-injected, with server parameters, database, optional Entra admin, diagnostics and lock. |
| `modules/frontdoor.bicep` | Front Door Premium profile, endpoint, optional custom domain, WAF policy, security policy and diagnostics. |
| `modules/frontdoor-origin.bicep` | Origin group with health probe, App Service origin over Private Link, and the route. |
| `modules/appservice.bicep` | Linux plan, Web App for Containers, access restrictions, publishing-credential policies, optional in-VNet private endpoint and diagnostics. |
| `modules/alerts.bicep` | Metric alerts. Each one names its runbook anchor. |
| `modules/budget.bicep` | Monthly resource-group budget with 50/80/100% notifications. |
| `params/prod.bicepparam`, `params/nonprod.bicepparam` | Environment parameters. Required values and secrets come from environment variables. |
| `deploy.sh` | What-if, then apply. Generates secrets on first deploy or rotation. |
| `validate.sh` | Offline `bicep build`, `lint` and `build-params` for both param files. Exits non-zero on error. |

## What each resource is for

- **Front Door Premium + WAF**: the only public entry point. It terminates TLS
  (1.2 minimum) and serves HTTPS only. The WAF runs Microsoft_DefaultRuleSet 2.1
  and Microsoft_BotManagerRuleSet 1.1, plus a custom rule that rate-limits
  `/api/auth/*` per client IP (`authRateLimitPerMinute`, default 30/min). The
  WAF is in **Prevention** mode by default. Detection mode is available for a
  first-week tuning period (`WAF_MODE=Detection`). Front Door reaches the app
  over **Private Link** (groupId `sites`, `privateLinkLocation` = app region).
  It sends the app's default hostname as the host header, probes
  `/api/healthz` over HTTPS, and does no caching.
- **App Service plan (Linux, P0v3) + Web App for Containers**: runs the single
  Node 22 container (Express API + built SPA) on port 8080. It pulls from ACR
  using the runtime user-assigned identity (`acrUseManagedIdentityCreds`) and
  reads secrets as Key Vault references through the same identity
  (`keyVaultReferenceIdentity`). Prod runs 3 instances, zone redundant.
  **Cost: roughly 3x a single P0v3.** Nonprod runs 1 instance.
- **Runtime user-assigned identity**: has AcrPull on the registry, Key Vault
  Secrets User on the vault, Storage Blob Data Contributor on the `uploads`
  **container** only, and Monitoring Metrics Publisher on Application
  Insights. It optionally gets Cognitive Services User on the Foundry resource
  (`assignFoundryRole`). It has no other roles.
- **VNet** (`10.40.0.0/16`):
  - `app-integration` (delegated `Microsoft.Web/serverFarms`): the app's
    **outbound** VNet integration, with `vnetRouteAllEnabled` and image pull
    over the VNet. It has an NSG and a NAT gateway.
  - `private-endpoints`: private endpoints for Key Vault, Blob, ACR (when
    private) and, optionally, the web app. Its NSG allows 443 from the VNet
    only, and endpoint network policies are enabled so the NSG applies.
  - `postgres` (delegated `Microsoft.DBforPostgreSQL/flexibleServers`): its
    NSG allows 5432 from `app-integration` and traffic within the subnet (for
    HA replication), and denies other VNet traffic.
  - Private DNS zones linked to the VNet: `privatelink.vaultcore.azure.net`,
    `privatelink.blob.core.windows.net`, `privatelink.azurewebsites.net`,
    `privatelink.azurecr.io` (only when `acrPrivate`), and
    `<server>.private.postgres.database.azure.com` for the VNet-injected
    server.
- **NAT gateway + static public IP**: egress for Claude (Foundry or the
  Anthropic API) and ACS email. New subnets have no default outbound access.
  See [Deviations](#deviations).
- **PostgreSQL Flexible Server 16**: the app's store (`STORE=postgres`, one
  table `sentinel8_documents`, created by the app on first use). It is
  VNet-injected with public access disabled. `require_secure_transport=on`,
  TLS 1.2 minimum, and connection, disconnection, checkpoint and lock-wait
  logging are on. Connection throttling is on, and statements over 2 s are
  logged. Storage autogrows.
  - Prod: GeneralPurpose `Standard_D2ds_v5`, zone-redundant HA, 35-day
    geo-redundant backups.
  - Nonprod: Burstable `Standard_B1ms`, no HA, 7-day backups.
  - Entra authentication is enabled. Password authentication is also enabled
    because the app connects with a password-bearing `DATABASE_URL`. See
    [follow-ups](#follow-ups).
- **Key Vault**: holds `session-secret`, `database-url`,
  `postgres-admin-password` and, if used, `anthropic-api-key`. RBAC only, soft
  delete (90 days), **purge protection on**, public network access disabled,
  private endpoint, all logs to Log Analytics.
- **Storage account (blob)**: for future uploads. **The app does not use
  uploads yet.** The account exists so the controls are in place first:
  - no shared keys, no public network access, no anonymous blob access, TLS 1.2
  - infrastructure encryption
  - versioning, plus blob and container soft delete (no point-in-time restore)
  - an optional unlocked immutability policy on `uploads`
    (`uploadsImmutabilityDays`)
- **ACR**:
  - `acrPrivate=true` (prod default): Premium, public network access disabled,
    private endpoint, export disabled, 30-day untagged-manifest retention.
  - `acrPrivate=false` (nonprod default): Basic with a public endpoint.
  - In both cases the admin user is disabled and pulls are Entra-only.
- **Log Analytics + Application Insights**: workspace-based, with local
  (instrumentation-key) auth disabled. Diagnostic settings send logs here from:
  - Front Door: access, health probe and WAF logs
  - Web app: HTTP, console, app, audit, IPSec audit and platform logs
  - App Service plan
  - Postgres (all logs), Key Vault (all logs), Storage (blob read, write and
    delete) and ACR
- **Alerts + action group** (email, `ALERT_EMAILS`). Each alert's description
  names its runbook in `docs/security/RECOVERY.md`:

  | Alert | Runbook anchor |
  |---|---|
  | Front Door origin health < 100% | `#origin-down` |
  | Front Door 5xx % > 5 | `#error-spike` |
  | WAF blocks > threshold / 5 min | `#waf-spike` |
  | App Service HTTP 5xx > 10 / 5 min | `#error-spike` |
  | Plan CPU > 80%, memory > 85% | `#error-spike` |
  | Postgres CPU > 80%, storage > 80%, active connections > threshold | `#db-pressure` |
  | Key Vault availability < 99.9% | `#kv-failure` |
  | App Insights failed requests > 10 / 5 min | `#error-spike` |
  | Budget 50/80/100% | `#cost-overrun` |

  `docs/security/RECOVERY.md` has to exist with these anchors. This template
  only references it.
- **Budget**: monthly, at resource-group scope. `budgetAmount` has **no
  default** and must be supplied (`BUDGET_AMOUNT`). Notifications go to the
  alert emails and the action group at 50%, 80% and 100% of actual spend.
- **Resource locks**: `CanNotDelete` on Postgres, Key Vault and Storage when
  `lockDataResources=true` (prod).
- **Tags**: `owner`, `environment`, `costCentre` and `dataClassification` are
  enforced by a Bicep type and applied to every resource, plus
  `application=sage-halpin`.
- **Not included, by decision** (assessed later): AKS, Azure Firewall, and a
  DDoS Network Protection plan. Front Door's built-in L3/L4 protection applies
  at the edge.

## Trust boundaries

```
 Internet ──TLS1.2+──▶ [Front Door Premium + WAF]  (public; the only way in)
                               │ Private Link (Microsoft-managed PE, approved once)
                               ▼
                 [Web App]  publicNetworkAccess=Disabled, SCM denied, FTP/basic auth off
                               │ VNet integration = OUTBOUND ONLY (route all)
          ┌────────────────────┼─────────────────────┬──────────────────────┐
          ▼                    ▼                     ▼                      ▼
  [Postgres] (VNet-     [Key Vault] PE        [Blob] PE / [ACR] PE    NAT ▶ Internet:443
   injected, 5432 from   (Secrets User         (uploads container /   (Claude: Foundry or
   app subnet only)       only)                 AcrPull only)          Anthropic; ACS email)
```

1. **Internet → Front Door.** Untrusted. WAF in Prevention mode, HTTPS only,
   TLS 1.2+, and a rate limit on auth endpoints. Front Door Premium is the
   only internet-facing listener.
2. **Front Door → App Service.** Private Link only.
   - **Inbound privacy comes from `publicNetworkAccess: Disabled` plus the
     private endpoint, not from VNet integration.** VNet integration is
     outbound only.
   - The `AzureFrontDoor.Backend` + `X-Azure-FDID` access restriction is
     defence in depth. It takes effect only if public access is ever
     re-enabled. See [Deviations](#deviations).
   - Kudu/SCM is denied for everyone, and FTP and SCM basic publishing
     credentials are disabled. Deployments go through Azure Resource Manager
     only.
3. **App Service → data.**
   - All egress goes through the VNet (`vnetRouteAllEnabled`) and the
     `app-integration` NSG. Allowed: 5432 to Postgres, 443 to private
     endpoints, and 443 to the internet via NAT. All other internet egress is
     denied.
   - Data services have public network access disabled and accept only
     Entra-authenticated (or Postgres password) traffic from inside the VNet.
4. **Control plane.** A federated (OIDC) deploy identity uses ARM. Secrets
   are written to Key Vault through ARM, so the deploy runner never needs
   data-plane access to the vault. Configuring the deploy identity is out of
   scope for this Bicep. The `deployIdentityScopes` output lists the resource
   IDs that identity needs role assignments on.

## Deploy

Prerequisites:

- A resource group in UK South.
- A Microsoft Foundry resource with the Claude deployment.
- The federated deploy identity, signed in with
  `azure/login@v2` (OIDC: `client-id`, `tenant-id`, `subscription-id`; no
  client secret). In prod it needs:
  - Contributor on the resource group
  - Role Based Access Control Administrator on the resource group, so the
    template can create its role assignments (constrain it to the four roles
    listed above if your policy allows)
  - Cost Management Contributor, for the budget
  - Lock rights (`Microsoft.Authorization/locks/*`, which Owner or User
    Access Administrator include), to create the locks

Required environment variables: `BUDGET_AMOUNT`, `ALERT_EMAILS`
(comma-separated), `TAG_OWNER` and `FOUNDRY_RESOURCE_NAME`. Optional:
`CUSTOM_DOMAIN`, `WAF_MODE`, `CONTAINER_IMAGE`, `PG_ENTRA_ADMIN_OBJECT_ID`,
`PG_ENTRA_ADMIN_NAME`, and `ACR_PRIVATE` (nonprod only).

```bash
# 0. Offline checks
./infra/azure/validate.sh

# 1. What-if ALWAYS first (review the diff, especially deletes/replacements)
RESOURCE_GROUP=rg-sagehalpin-prod ENVIRONMENT=prod WHAT_IF_ONLY=1 \
  BUDGET_AMOUNT=... ALERT_EMAILS=... TAG_OWNER=... FOUNDRY_RESOURCE_NAME=... \
  ./infra/azure/deploy.sh

# 2. Apply (deploy.sh re-runs what-if, then prompts; ASSUME_YES=1 in CI after review)
RESOURCE_GROUP=rg-sagehalpin-prod ENVIRONMENT=prod \
  BUDGET_AMOUNT=... ALERT_EMAILS=... TAG_OWNER=... FOUNDRY_RESOURCE_NAME=... \
  ./infra/azure/deploy.sh
```

The equivalent raw commands (deploy.sh adds secret generation and keeps the
running image):

```bash
az deployment group what-if -g rg-sagehalpin-prod \
  --template-file infra/azure/main.bicep --parameters infra/azure/params/prod.bicepparam
az deployment group create  -g rg-sagehalpin-prod \
  --template-file infra/azure/main.bicep --parameters infra/azure/params/prod.bicepparam
```

Secrets:

- On the first deploy, `deploy.sh` generates `SESSION_SECRET` and the Postgres
  admin password (`secrets.token_urlsafe(48)`). The template writes
  `session-secret`, `postgres-admin-password` and `database-url` into Key
  Vault.
- On later deploys these are empty, and the existing values are kept.
- To rotate, set `ROTATE_SESSION_SECRET=1` (this signs everyone out) or
  `ROTATE_PG_PASSWORD=1`. The script then restarts the app, because Key Vault
  references are otherwise cached for up to 24 hours.
- With `aiProvider='anthropic'`, also pass the `anthropicApiKey` parameter
  once.

### Custom domain

With `CUSTOM_DOMAIN` set:

1. Create the TXT record `_dnsauth.<host>` with the value of the
   `customDomainValidationToken` output.
2. Create a CNAME from `<host>` to `frontDoorEndpointHostName`.

Front Door then issues a managed certificate.

### Approve the Front Door private endpoint (first deploy, and after any re-creation of the origin)

Front Door's Private Link connection arrives on the web app as **Pending**.
Front Door returns errors until it is approved, and the origin-health alert
fires.

```bash
RG=rg-sagehalpin-prod
APP=$(az deployment group show -g $RG -n <deployment-name> --query properties.outputs.webAppName.value -o tsv)
APP_ID=$(az webapp show -g $RG -n $APP --query id -o tsv)

# List connections; the Front Door one has the requestMessage
# "Azure Front Door afd-sagehalpin-<env> -> web app (approve once)".
az network private-endpoint-connection list --id "$APP_ID" \
  --query "[].{id:id, state:properties.privateLinkServiceConnectionState.status, msg:properties.privateLinkServiceConnectionState.description}" -o table

# Approve it (only the one with that message and state Pending).
az network private-endpoint-connection approve --id <connection-id> \
  --description "Approved: Front Door afd-sagehalpin-<env>"
```

Allow a few minutes for the origin to turn healthy. In the portal, the same
action is under Web App → Networking → Private endpoints → Approve.

### Images

The web app runs `<registry>/<containerImage>`. On the first deploy the
default `sage-halpin:bootstrap` does not exist, so the app shows as unhealthy
until an image is pushed and rolled out:

```bash
az acr build -r <registryName> -t sage-halpin:$(git rev-parse --short HEAD) sage-halpin   # public ACR only, see below
az webapp config container set -g $RG -n $APP \
  --container-image-name <registryLoginServer>/sage-halpin:<tag>
```

When `acrPrivate=true`, the registry has **no public endpoint**. `az acr build`
from a hosted runner and `docker push` from the internet will both fail. Pick
one of these (see [Deviations](#deviations)):

- **(a)** A self-hosted GitHub runner inside the VNet, or a peered VNet, that
  pushes through the private endpoint.
- **(b)** An ACR Tasks dedicated agent pool in the VNet
  (`az acr agentpool create --subnet-id …`, then `az acr build --agent-pool …`).
- **(c)** Build in a public nonprod registry, then
  `az acr import --source …` into the prod registry. Import runs on the
  Azure side; confirm it works with public access disabled before relying on
  it.

## Post-deploy verification

Run all of these after the first deploy and after any network change.
**None of them has been run yet.**

```bash
FD=$(… outputs.frontDoorEndpointHostName)      # e.g. fde-sagehalpin-prod-xxxx.z01.azurefd.net
APPHOST=$(… outputs.webAppDefaultHostName)     # <app>.azurewebsites.net

# 1. Front Door path works
curl -sS -o /dev/null -w '%{http_code}\n' https://$FD/api/healthz          # expect 200
curl -sS -o /dev/null -w '%{http_code}\n' https://$FD/api/readyz           # expect 200 (store reachable)

# 2. Direct origin is closed, even with a forged Front Door header
curl -sS -o /dev/null -w '%{http_code}\n' https://$APPHOST/api/healthz     # expect 403 (public access disabled)
curl -sS -o /dev/null -w '%{http_code}\n' -H "X-Azure-FDID: $(az afd profile show -g $RG --profile-name afd-sagehalpin-prod --query frontDoorId -o tsv)" https://$APPHOST/   # expect 403

# 3. Kudu/SCM closed
curl -sS -o /dev/null -w '%{http_code}\n' https://${APPHOST/.azurewebsites.net/.scm.azurewebsites.net}/   # expect 403

# 4. FTP and basic publishing credentials off
az webapp config show -g $RG -n $APP --query ftpsState -o tsv              # expect Disabled
az resource show --ids "$APP_ID/basicPublishingCredentialsPolicies/ftp" --query properties.allow   # expect false
az resource show --ids "$APP_ID/basicPublishingCredentialsPolicies/scm" --query properties.allow   # expect false

# 5. HTTPS only / TLS floor at the edge
curl -sS -o /dev/null -w '%{http_code}\n' http://$FD/                      # expect no content served (route is HTTPS-only)
curl -sS --tls-max 1.1 https://$FD/ ; echo "rc=$?"                         # expect TLS handshake failure

# 6. WAF in Prevention
curl -sS -o /dev/null -w '%{http_code}\n' "https://$FD/?q=%3Cscript%3Ealert(1)%3C/script%3E"   # expect 403

# 7. Auth rate limit (stops after ~30/min from one IP; run from a throwaway IP)
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://$FD/api/auth/signin -H 'content-type: application/json' -d '{}'; done; echo   # expect 403s at the end

# 8. TRUST_PROXY_HOPS=2 is right (client IP, not a Front Door edge, drives the app's rate limiter):
#    trip the app's own limiter on an endpoint (e.g. /api/account) from one IP,
#    then repeat with a forged "X-Forwarded-For: 203.0.113.9" header: it must stay limited.
#    If unrelated users get limited together, the hop count is too low; if the forged header resets the limit, it is too high.

# 9. Data plane is private from outside the VNet
az keyvault secret list --vault-name <keyVaultName>                        # expect Forbidden (public network access disabled)
az storage blob list --account-name <storageAccountName> -c uploads --auth-mode login   # expect AuthorizationFailure / public access disabled
az postgres flexible-server show -g $RG -n <postgresServerName> --query network.publicNetworkAccess -o tsv   # expect Disabled
az acr show -n <registryName> --query publicNetworkAccess -o tsv           # prod: expect Disabled

# 10. Logs flowing (Log Analytics, after ~15 min)
#   AzureDiagnostics | where Category == "FrontDoorAccessLog" | take 5
#   AzureDiagnostics | where Category == "FrontDoorWebApplicationFirewallLog" | take 5
#   AppServiceHTTPLogs | take 5 ; AppServiceConsoleLogs | take 5
# 11. Alert wiring: Azure Monitor → Alerts → test the action group once.
# 12. Locks (prod): az lock list -g $RG -o table   # expect lock-<postgres>, lock-<kv>, lock-<storage>
```

## Validation

`./validate.sh` (Bicep CLI 0.47.16) runs:

```
bicep build main.bicep
bicep lint main.bicep
bicep build-params params/prod.bicepparam
bicep lint params/prod.bicepparam
bicep build-params params/nonprod.bicepparam
bicep lint params/nonprod.bicepparam
```

All of these currently pass with **0 errors and 0 warnings**, including no
BCP081 (unknown API version) warnings. Remaining warnings: none.

This proves the templates compile against the Bicep type library. It does not
prove that Azure accepts them: there has been no what-if and no deployment.

## Deviations

Each item below is marked `// DECISION:` in the code, or is an explicit
limitation.

1. **NAT gateway added.** It is not in the approved list. Without it, the
   app-integration subnet (created with `defaultOutboundAccess: false`) has
   no route to Claude or ACS. Cost is about £30/month plus data processed.
   Set `deployNatGateway=false` only if another egress path exists.
2. **The `X-Azure-FDID` access restriction does not protect the Private Link
   path.** App Service does not evaluate access restrictions for traffic that
   arrives through a private endpoint. The rule (AzureFrontDoor.Backend + this
   profile's FDID, default deny) is defence in depth for the case where public
   access is re-enabled. On the Private Link path, the guarantee comes from
   the connection being approved for this profile only. *Follow-up:* have the
   app reject requests whose `X-Azure-FDID` is not the expected value.
3. **Application Insights has local auth disabled, and the app ships no
   telemetry SDK.**
   - Connection-string-only ingestion would be rejected. Entra ingestion is
     prepared: the identity has Monitoring Metrics Publisher, and
     `APPLICATIONINSIGHTS_AUTHENTICATION_STRING` is set.
   - Until an SDK (for example `@azure/monitor-opentelemetry`) is added, the
     *App Insights failed requests* alert has no data. Front Door, App Service
     and Postgres alerts cover the gap.
   - To accept connection-string ingestion instead, set
     `appInsightsDisableLocalAuth=false`. That is weaker.
4. **Postgres password auth stays enabled.** The app connects with a password
   `DATABASE_URL` (`sslmode=verify-full`). Entra auth is also enabled.
   Migrating to Entra token auth is a follow-up.
5. **Pushing images to a private ACR is not provisioned.** See
   [Images](#images) for options a, b and c. Nonprod defaults to
   `acrPrivate=false` (Basic, public endpoint, admin user disabled).
6. **Postgres DNS zone.** The server uses
   `<server>.private.postgres.database.azure.com`, as Microsoft recommends for
   VNet-injected Flexible Server, instead of
   `privatelink.postgres.database.azure.com`, which belongs to the
   private-endpoint networking mode.
7. **The route is HTTPS only, with no HTTP→HTTPS redirect.** Plain-HTTP
   requests are not served. To allow a redirect, add `Http` to
   `supportedProtocols` and set `httpsRedirect: 'Enabled'` in
   `frontdoor-origin.bicep`.
8. **The web app's own in-VNet private endpoint is optional and off by
   default** (`deployWebAppPrivateEndpoint`). Front Door uses its own
   Microsoft-managed endpoint. The `privatelink.azurewebsites.net` zone is
   still created and linked.
9. **Bot Manager rule set version 1.1** (the spec named the rule set, not a
   version).
10. **Budget start date** defaults to the first day of the deployment month
    (`utcNow`). Redeploying in a later month changes `startDate`. If Azure
    rejects that for an existing budget, pin `budgetStartDate` in the
    parameter file.
11. **App-integration NSG denies non-443 internet egress.** Anything the app
    needs on other ports (none known) would be blocked. Watch
    `AppServiceConsoleLogs` after the first deploy.
12. **Unverified platform assumptions**, to confirm with the post-deploy
    checks:
    - Key Vault secrets can be written through ARM while the vault's public
      network access is disabled.
    - Key Vault references and image pulls resolve over VNet integration
      (`vnetRouteAllEnabled`, `vnetImagePullEnabled`).
    - `TRUST_PROXY_HOPS=2` matches the Front Door → App Service hop count.
13. **Claude is reached over the public internet**, via NAT, with Entra auth.
    A Foundry private endpoint is a follow-up.
14. **The ACR is not locked**, and nonprod data resources are not locked
    (`lockDataResources=false`). Only the prod data resources named in the
    spec are locked.

## Follow-ups

- App: Entra token auth for Postgres, then set `passwordAuth: 'Disabled'`.
- App: check `X-Azure-FDID`.
- App: add Application Insights / OpenTelemetry with Entra ingestion.
- Image push path for the private ACR (option a, b or c).
- Foundry private endpoint, and removal of internet egress if Anthropic
  web search is not needed.
- Configure the federated deploy identity and its role assignments, using the
  `deployIdentityScopes` output.
- Write `docs/security/RECOVERY.md` with the anchors `origin-down`,
  `error-spike`, `waf-spike`, `db-pressure`, `kv-failure` and `cost-overrun`.
- Revisit DDoS Network Protection, Azure Firewall and the WAF exclusions after
  the first week of WAF logs.
