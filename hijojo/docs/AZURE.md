# Running Hijojo on Azure

Hijojo runs as one Azure Container App in your subscription, calling Claude on
**Microsoft Foundry** with the app's managed identity. Nothing below has been
deployed yet; the template compiles (Bicep 0.48) and the production bundle has
been run locally, but no Azure resources exist.

## What gets created (`infra/main.bicep`)

| Resource | Purpose |
| --- | --- |
| Container App `ca-hijojo-<env>` | UI, API, Copilot API and the background worker. **Exactly one replica**, always on: it runs the five-day follow-up timers and inbox polling, and is the database's only writer. |
| User-assigned managed identity | Pulls the image, reads Key Vault, calls Claude on Foundry and (optionally) Microsoft Graph. No keys in config. |
| Azure Files share `hijojo-data` (ZRS) | The SQLite database at `/data/hijojo.db`. |
| Container Registry, Key Vault, Log Analytics | Image, secrets (only if you use a Graph client secret), logs. |
| Role assignment on your Foundry resource | Entra ID data-plane access for the identity. |

**About the database.** SQLite on an SMB share is safe only with one writer and
without WAL, so the app runs one replica with `HIJOJO_SQLITE_JOURNAL=DELETE` and
`nobrl` on the mount. That suits this workload (tens of messages a day). Before
running more than one replica, move to Azure Database for PostgreSQL. The safety
rules (one introduction and one follow-up per prospect, one handoff per reply)
are database constraints and must move with it.

## 1. Claude on Microsoft Foundry

1. In Microsoft Foundry, deploy Claude (default `claude-opus-5-5`) in a Foundry resource, ideally in the same resource group.
2. Note the resource name. The template grants the app identity *Cognitive Services User* on it; confirm the right role for Claude in the Foundry docs and change `foundryRoleDefinitionId` if needed.
3. Azure-hosted Claude deployments offer only the basic web search tool (`web_search_20250305`) and no server-side model fallbacks; Hijojo handles both. Prospect discovery uses web search, so it must be enabled for the deployment.

## 2. Deploy

```bash
az login
RESOURCE_GROUP=rg-hijojo-prod FOUNDRY_RESOURCE_NAME=<foundry-resource> ./infra/deploy.sh
```

This applies the template, builds the image in ACR (the Dockerfile runs the
typecheck and all tests first), rolls it out and waits for `/api/readyz`. Then
create the first users; passwords print once:

```bash
az containerapp exec -g rg-hijojo-prod -n ca-hijojo-prod --command "node dist/seed.mjs"
```

It starts in **simulation**: everything runs, nothing is sent.

## 3. Outlook (optional until you go live)

Preferred: the app's managed identity, so there is no secret to rotate.

1. Grant the managed identity's service principal the Microsoft Graph application permissions `Mail.Send` and `Mail.ReadWrite` (with Microsoft Graph PowerShell: `New-MgServicePrincipalAppRoleAssignment` for each role).
2. Restrict them to the sender mailbox with Exchange RBAC for Applications, exactly as in `docs/OUTLOOK.md` step 2, using the identity's client ID.
3. Redeploy with `SENDER_MAILBOX=outreach@aigogo.ai`.

Alternatively use an app registration: put its secret in Key Vault and set
`graphUseManagedIdentity=false`, `graphTenantId`, `graphClientId` and
`graphClientSecretName`.

## 4. Go live

Only when the checks in `README.md` (Status) are satisfied:

1. Redeploy with `SEND_MODE=live`.
2. An administrator switches live sending on in **Settings**.

Until both are done, and Outlook is configured, nothing is sent.

## 5. Copilot

See `docs/COPILOT.md`. It needs `ENTRA_TENANT_ID` and `ENTRA_AUDIENCES` on the
deployment.

## Operating

- Logs: `az containerapp logs show -g <rg> -n ca-hijojo-<env> --follow`.
- Emergency stop: **Halt sending** in the app, or `haltSending` from Copilot. Only an administrator can resume.
- Backups: enable Azure Backup for the file share, or snapshot it before upgrades.
