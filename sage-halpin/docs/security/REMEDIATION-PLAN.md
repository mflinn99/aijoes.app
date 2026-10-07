# Prioritised remediation plan

Ordered by risk (`RISK-REGISTER.md`). **Done** items were verified in this
review, by tests or a browser check. "Customer" items need a person with
authority over an account; no code change can resolve them.

## P0: now, before inviting real users' data

| # | Action | Risk | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | Revoke the Anthropic key that was pasted in chat. Create a new key with a spend limit | R-02 | Customer | **Open** (unverified) |
| 2 | Take custody of the live app and its database: import into the customer's own Replit workspace (`docs/REPLIT.md`), or migrate. Export the data | R-01 | Customer | **Open**, blocks migration |
| 3 | State the budget ceiling | R-03 | Customer | **Open**, blocks Azure |
| 4 | Confirm the `sentinel8.ai` registrar owner; turn on registrar lock and MFA | R-12 | Customer | **Open** |
| 5 | GitHub: branch protection on the default branch, required checks, `production` environment reviewers (`PIPELINE.md`) | R-13 | Repository owner | **Open** |
| 6 | Server-side sessions with revocation; sign out everywhere; password change with re-authentication; per-account lockout; common-password denylist; `__Host-` cookie | T1/T2 | Engineering | **Done**: `auth.test.ts`, browser 13/13 |
| 7 | SSRF bypass through IPv6 forms (F-01) | R-16 | Engineering | **Done**: `net.test.ts` |
| 8 | Daily AI call cap | R-04 | Engineering | **Done**: `ai-budget.test.ts` |
| 9 | CI: pinned actions, gitleaks, CodeQL, npm audit, dependency review, SBOM, build once and promote | R-18 | Engineering | **Done**: green on the default branch (`01ae562`); dependency review waits for the dependency graph setting |
| 10 | Republish the Replit app from this commit, so the live app gets fixes 6–8 | R-16 | Engineering | **Done** (7 Oct 2026, commit `01ae562`). It is still in the account the customer can't access (item 2) |

## P1: before general availability

| # | Action | Risk | Owner |
| --- | --- | --- | --- |
| 11 | Azure tenant and subscription; deploy `infra/azure` nonprod, then prod; run the post-deploy checks | R-09 | Customer + Engineering |
| 12 | Switch the deploy job from the legacy Container Apps script (`infra/deploy.sh`) to `infra/azure` (App Service), keeping build once and promote | R-09 | Engineering |
| 13 | MFA and recovery: Entra External ID (recommended), or TOTP plus email reset | R-05/R-06 | Engineering |
| 14 | Require an account to create workspaces and consultations; bind them to the account on the server; token rotation | R-04/R-07 | Engineering |
| 15 | Security event audit log (sign-in, failures, password change, sign out everywhere, account deletion) to App Insights, with no personal data beyond the account id | T8 | Engineering |
| 16 | DPIA, privacy notice, AI provider terms | R-08 | Customer |
| 17 | Independent penetration test; fix every critical and high finding | Gate | Customer |
| 18 | Migration (`MIGRATION-RUNBOOK.md`) and the first restore drill | R-01/R-09 | Engineering |

## P2: after launch

| # | Action |
| --- | --- |
| 19 | A data-encryption key separate from `SESSION_SECRET` (Key Vault, versioned) (R-10) |
| 20 | Prompt-injection test corpus in CI (R-11) |
| 21 | Idle session timeout; a list of active sessions |
| 22 | PostgreSQL Entra token authentication (no password) |
| 23 | Base images pinned by digest; build provenance attestations |
| 24 | `Cache-Control: no-store` on all API responses |
| 25 | Self-hosted fonts; drop Google Fonts from the CSP |
