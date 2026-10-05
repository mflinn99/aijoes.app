# Runbook

## What runs where

One Azure Container App (`ca-sagehalpin-<env>`) serves the web app and the
boardroom API on port 8080. It pulls its image from Azure Container Registry
with a user-assigned managed identity, and uses the same identity (Microsoft
Entra ID) to call Claude on Microsoft Foundry and to reach Azure Table Storage.
Logs go to Log Analytics. Workspace data stays in each visitor's browser; board
questions (the question, the people asked and their answers) are kept in the
`consultations` table of the storage account (`stsh…`), whose shared keys are
turned off.

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
   optionally `SAGE_HALPIN_ENV`, `AI_MODEL`, `VITE_ENQUIRY_EMAIL`,
   `PUBLIC_BASE_URL`, `EMAIL_ENDPOINT`, `EMAIL_SENDER`.

No Azure secrets are stored in GitHub; sign-in uses OIDC.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| `AI_MODEL` | template parameter `aiModel` | `claude-opus-5-5` |
| Replicas | `minReplicas`, `maxReplicas` | 1–3 |
| AI endpoint limits (per client IP, per 10 minutes, per replica) | `rateLimitChat`, `rateLimitAnalysis` | 20 and 10 |
| Waitlist address | build argument `VITE_ENQUIRY_EMAIL` | none, so the link is hidden |

Each full board session makes six model calls, and each scenario analysis makes
eight. On a board question, drafting the questionnaire makes one, convening the
shadow board makes one per seated agent, and each summary makes one. Watch Foundry usage when you change limits or replicas.

## Board questions: storage, email and retention

- **Storage.** The template creates the storage account, the `consultations`
  table and a *Storage Table Data Contributor* role for the app's identity. With
  `STORE=table` the app fails at start-up unless `TABLE_ENDPOINT` is set.
- **Retention.** Questions and answers are deleted after
  `consultationRetentionDays` (default 90): checked when a question is opened,
  and swept every six hours. The lead can delete one at any time.
- **Email.** Without email settings the lead is given each person's link and a
  ready-written email to send from their own mailbox. To have the app email
  people itself:
  1. Create an *Email Communication Services* resource, add and verify a sending
     domain (for example `mail.sentinel8.ai`; DNS records for SPF, DKIM and
     domain verification), and connect it to an *Azure Communication Services*
     resource.
  2. Grant the app's managed identity (`identityPrincipalId` output) a role on
     the Communication Services resource that can send email (Contributor works;
     a custom role with only the email send action is narrower).
  3. Redeploy with `EMAIL_ENDPOINT=https://<acs-name>.<region>.communication.azure.com`
     and `EMAIL_SENDER=DoNotReply@mail.sentinel8.ai`, and
     `PUBLIC_BASE_URL=https://app.sentinel8.ai` once that address works (it
     defaults to the Container App's own address).
- **Limits.** AI steps (drafting a questionnaire, the shadow board, the
  summaries) share `RATE_LIMIT_CONSULT_AI_PER_10_MIN` (20); answering a
  questionnaire is limited to 60 requests per client per 10 minutes.

## Accounts

People create an account at `/signup` (linked from the website's **Sign in** and
**Create account** buttons) and sign in at `/signin`. Their workspace (organisation,
people, question links, decision log) is kept in the browser and saved to the
account every few seconds, so it follows them to another device.

- **Session secret.** `SESSION_SECRET` signs session cookies and encrypts each
  account's saved workspace. `deploy.sh` creates it in Key Vault
  (`session-secret`) on the first deploy and keeps it afterwards; the Container
  App reads it by Key Vault reference. Without it in production, accounts are
  switched off (the account endpoints answer 503) and the rest of the app works.
- **Storage.** Accounts and their saved workspaces live in the `consultations`
  table, partition `accounts`. Each saved workspace is encrypted with AES-256-GCM;
  passwords are stored as scrypt hashes. A saved workspace is limited to 1 MB.
- **Sessions** last 14 days in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
  Signing out clears the account's copy from that browser.
- **Limits.** Sign-in and sign-up share `RATE_LIMIT_AUTH_PER_10_MIN` (10 per
  client per 10 minutes); saving the workspace is limited to 240 requests.
- **Forgotten passwords** are handled by hand for now: the sign-in page asks
  people to email customer@sentinel8.ai. To reset one, delete the account's rows
  (partition `accounts`, row `a-<sha256 of the lower-cased email>` and its
  `data-<id>` row) and ask the person to sign up again; this also deletes their
  saved workspace.

## Agent learning and horizon scanning

- **Workspace.** Each organisation has a workspace in the same `consultations`
  table (partition `w-<id>`): profile, agent lessons, decisions and outcomes,
  signals and the landscape briefing. People's details and CVs are not stored
  there. Workspaces have no automatic expiry; the lead deletes one by clearing
  the board.
- **Scanner.** The server checks every 30 minutes for workspaces due a scan
  (each sets its own interval) and scans them. `HORIZON_SCANNER=off` stops it.
  With several replicas a scan is claimed before it runs, so duplicates are
  rare and harmless (signals are de-duplicated).
- **Feeds** must be public `https` addresses; the fetcher refuses private,
  loopback, link-local and metadata addresses (checked at connection time),
  caps each response at 1.5 MB and 10 seconds, and follows at most 3 redirects.
- **Web search** uses Claude's server-side web search tool. Foundry deployments
  hosted on Azure support only `web_search_20250305` (the default); set
  `WEB_SEARCH_TOOL=web_search_20260209` for deployments hosted on Anthropic.
  `WEB_SEARCH=off` turns web search off everywhere. Web search is billed per
  search on top of tokens; each scan allows up to 5 searches.
- **Cost.** A scan makes one triage call per 20 new feed items, one web search
  call and one landscape call. Studying material, reviewing an outcome and the
  collaborative challenge round each make one call per agent involved (the
  challenge round) or one call (the others).

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
- **Session secret**: redeploy with `ROTATE_SESSION_SECRET=1`. This signs
  everyone out and makes saved workspaces unreadable: people can still sign in,
  but start with an empty board. Rotate only if the secret may have leaked.

## Custom domain

When the domain is confirmed: `az containerapp hostname add` and `bind` (managed
certificate), or put Azure Front Door with WAF in front for a global rate limit
and edge protection.
