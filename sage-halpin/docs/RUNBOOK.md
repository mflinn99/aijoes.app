# Runbook

## What runs where

One Azure Container App (`ca-sagehalpin-<env>`) serves the web app and the
boardroom API on port 8080. It pulls its image from Azure Container Registry
with a user-assigned managed identity, and uses the same identity (Microsoft
Entra ID) to call Claude on Microsoft Foundry. Logs go to Log Analytics. There
is no database: workspace data stays in each visitor's browser.

`infra/main.bicep` defines all of it. Region: UK South.

## First deployment

1. **Foundry.** In the Azure portal (Microsoft Foundry), create or choose a
   resource in UK South and deploy a Claude model (default `claude-opus-5-5`).
   Note the resource name. For the default role assignment to work, it must be
   in the same resource group as the app; otherwise set `assignFoundryRole=false`
   and assign the role on the Foundry resource yourself.
2. **Deploy.**

   ```bash
   az login
   az account set --subscription <subscription-id>
   RESOURCE_GROUP=rg-sagehalpin-prod FOUNDRY_RESOURCE_NAME=<foundry-resource> ./infra/deploy.sh
   ```

   The script applies the Bicep template (keeping the running image), builds the
   image in Container Registry (`az acr build`, so Docker is not needed locally),
   rolls out the new revision and waits for `/api/readyz`. It prints the URL.
3. **Smoke test.** Open the URL, convene the board on one question and run one
   scenario analysis. `/api/readyz` should report `"ai":"foundry"`.

## Continuous deployment (GitHub Actions)

`.github/workflows/sage-halpin.yml` runs the checks on every pull request that
touches `sage-halpin/`, and on merge to the default branch deploys with `infra/deploy.sh`.
The public website is separate; see `HOSTING.md`.

One-time setup:
1. Create an Entra app registration (or user-assigned identity) for GitHub.
   Add a federated credential for this repository, entity type *Environment*,
   name `production`.
2. Grant it **Contributor** and **User Access Administrator** on the resource
   group. The template creates role assignments, which needs the second role;
   you can narrow it with a condition limiting it to the roles in the template.
3. Create the `production` environment in the repository settings, with
   required reviewers if you want a manual approval before each deploy.
4. Set these repository variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `FOUNDRY_RESOURCE_NAME`, and
   optionally `SAGE_HALPIN_ENV`, `AI_MODEL`, `VITE_ENQUIRY_EMAIL`.

No Azure secrets are stored in GitHub; sign-in uses OIDC.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| `AI_MODEL` | template parameter `aiModel` | `claude-opus-5-5` |
| Replicas | `minReplicas`, `maxReplicas` | 1–3 |
| AI endpoint limits (per client IP, per 10 minutes, per replica) | `rateLimitChat`, `rateLimitAnalysis` | 20 and 10 |
| Waitlist address | build argument `VITE_ENQUIRY_EMAIL` | none, so the link is hidden |

Each full board session makes six model calls, and each scenario analysis makes
eight. Watch Foundry usage when you change limits or replicas.

## Using a Foundry API key instead of managed identity

Not recommended. If needed: store the key in the deployed Key Vault
(`kv-sh-…`), then redeploy with `foundryApiKeySecretName=<secret-name>`. The
Container App reads it by Key Vault reference; it never appears in the template
or the pipeline.

## Roll back

```bash
az containerapp revision list -g <rg> -n ca-sagehalpin-<env> -o table
az containerapp update -g <rg> -n ca-sagehalpin-<env> --image <registry>.azurecr.io/sage-halpin:<previous-tag>
```

Image tags are git commit hashes.

## Observe

```bash
az containerapp logs show -g <rg> -n ca-sagehalpin-<env> --follow
```

Request logs record the method, URL and status only. Board questions are never
logged. Model refusals are logged as warnings with their category.

## Rotate

- **Managed identity**: nothing to rotate.
- **Foundry key** (if used): add a new secret version in Key Vault, then restart
  the revision (`az containerapp revision restart`).

## Custom domain

When the domain is confirmed: `az containerapp hostname add` and `bind` (managed
certificate), or put Azure Front Door with WAF in front for a global rate limit
and edge protection.
