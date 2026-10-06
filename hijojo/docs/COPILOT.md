# Hijojo in Microsoft 365 Copilot

People use Hijojo from Copilot (and Teams) through a **declarative agent** with
an **API plugin**. It calls Hijojo's Copilot API as the signed-in user via
Microsoft Entra single sign-on; their Hijojo role applies.

What it can do: list OpCos and stage counts, show a prospecting profile, list
prospects by stage, explain a prospect (who, why them, why now, score, evidence
with links, every email with its QA verdict), report outcomes, add an OpCo,
record feedback and handoff verdicts, and halt sending. Every write asks for
confirmation.

What it cannot do, by design: send or draft outreach, resume sending, switch
live sending on, or change the threshold. Those stay in the Hijojo app with an
administrator.

Files: `copilot/appPackage/` (app manifest v1.24, declarative agent v1.8, plugin
v2.4, OpenAPI 3.0, icons), `copilot/instructions.txt` (the agent's instructions,
the reviewed source), `server/copilot.ts` (the API), `server/entra.ts` (token
validation). Nothing has been registered in a tenant yet.

## 1. Secure the API with Entra ID

1. Entra admin centre → App registrations → New: `Hijojo API`, single tenant.
2. **Expose an API**: set the Application ID URI (e.g. `api://<hijojo host>/<client-id>`) and add a delegated scope `access_as_user` (admins and users can consent).
3. Note the tenant ID and the Application ID URI.

## 2. Create the Entra SSO auth config

Teams developer portal → Tools → **Microsoft Entra SSO client ID registration** → Register:

- Base URL: `https://<hijojo host>/api/copilot` (the OpenAPI `servers` URL)
- Client ID: the `Hijojo API` client ID; Scope: `api://…/access_as_user`
- Restrict usage by org: your tenant

Note the **auth config ID** (Microsoft Entra SSO registration ID) and the **Application ID URI** it generates.

Then, back on the `Hijojo API` registration:

- Add the generated Application ID URI to `identifierUris` (manifest editor; the UI shows only the first).
- Authentication → Web → redirect URI `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`.
- Expose an API → Add a client application `ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b` (the Microsoft Enterprise token store).

## 3. Tell Hijojo to accept those tokens

Redeploy with:

```bash
ENTRA_TENANT_ID=<tenant id> \
ENTRA_AUDIENCES="<API Application ID URI>,<client id>,<SSO Application ID URI>" \
./infra/deploy.sh
```

Hijojo checks the signature (tenant keys), issuer and tenant, audience, that the
token came through the Enterprise token store, and the `access_as_user` scope.
The person's `preferred_username` must match a Hijojo user; add users in
Hijojo first.

## 4. Build and install the app package

```bash
cp copilot/env/.env.example copilot/env/.env.prod   # fill in: a new GUID, the URL, the auth config ID
npm run copilot:package prod                         # → dist/copilot/hijojo-copilot-prod.zip
```

Validate it in Microsoft 365 Agents Toolkit (the official schemas were not
reachable from the build environment), then sideload it in Teams for testing or
upload it in the Teams admin centre (Manage apps → Upload). Users find
**Hijojo** in Copilot's agent list.

## 5. Try it

- "Show me every OpCo and how many prospects are at each stage"
- "Why did Hijojo choose Northbridge Freight, and what evidence supports it?"
- "Which emails did QA reject this week, and why?"
- "Is sending live or simulated?"
