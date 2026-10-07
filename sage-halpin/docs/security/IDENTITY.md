# Identity and access

## Principles

- **The customer owns everything:** the Entra tenant, the Azure subscription, the GitHub repository (or an organisation the customer controls), the `sentinel8.ai` domain and registrar account, the AI provider account, and all data. Suppliers, including Claude sessions, get named, time-limited access that can be revoked. No shared logins.
- **Separate identities** for people, deployment and runtime. No identity crosses roles.
- **No long-lived secrets** where a managed or federated identity can be used.

## Operators (people)

| Control | Setting |
| --- | --- |
| Accounts | Named Entra ID members only. Guests for suppliers, removed when the work ends |
| MFA | **Phishing-resistant**: FIDO2 security keys or passkeys (Microsoft Authenticator device-bound passkeys), or Windows Hello for Business. Enforced with a Conditional Access authentication-strength policy for all users, and required for the Azure management plane |
| Privilege | No standing Owner or Contributor on prod. **PIM** eligible assignments: *Reader* standing; *Contributor* on the prod resource group activates for at most 4 hours with a justification and an approver; *Owner* or *User Access Administrator* activates for 1 hour with approval. Key Vault data roles (*Key Vault Secrets Officer*) are PIM only. No one holds PostgreSQL admin interactively; break-glass only |
| Break-glass | Two cloud-only Global Administrator accounts, excluded from Conditional Access except a FIDO2 requirement. Keys held by two named people in separate safes. Every sign-in alerts. Tested every quarter |
| Joiner | The business owner requests access; the access granted is recorded; PIM eligibility is granted, never standing access |
| Mover | Role reviewed within 5 working days; old eligibility removed |
| Leaver | Account disabled the same day; sessions revoked (`Revoke-MgUserSignInSession`); GitHub access removed; any secret they could read is rotated |
| Reviews | Quarterly Entra access reviews of PIM eligibility, guests and GitHub collaborators |

## Deployment (pipeline)

- An Entra app registration (or user-assigned identity) per environment: `sentinel8-deploy-nonprod` and `sentinel8-deploy-prod`.
- **Federated credentials only**: subjects `repo:<owner>/<repo>:environment:nonprod` and `…:environment:production`. No client secrets or certificates.
- **Scope:** *Contributor* on that environment's resource group only, plus *AcrPush* on its registry. The prod identity also has *AcrPull* on the nonprod registry, to import the promoted digest. No subscription-wide roles, and no *User Access Administrator*. Role assignments in the Bicep are created by a person with PIM, on first deploy or when roles change.
- The GitHub `production` environment needs reviewers, and deploys only from the default branch (`PIPELINE.md`).

## Runtime (application)

- One **user-assigned managed identity** per environment, with: *Key Vault Secrets User* (that vault only), *AcrPull* (that registry), *Storage Blob Data Contributor* (the `uploads` container only), *Cognitive Services User* on the Foundry resource if `AI_PROVIDER=foundry`.
- PostgreSQL: today the app connects with a password held in Key Vault. Follow-up: Entra token authentication for the managed identity, with no password.
- App Service SCM/Kudu: basic publishing credentials are disabled and SCM is restricted to deny all. Deployments go through the ARM control plane.

## Customer (end-user) authentication: options

| Option | What it gives | Cost and effort | Recommendation |
| --- | --- | --- | --- |
| **A. Keep the built-in accounts (as hardened in this review)** | Email + password (scrypt), revocable sessions, per-account lockout, common-password checks, password change with re-authentication, sign-out everywhere | Built. **Missing:** MFA and self-service recovery | Acceptable for a closed pilot with no high-risk data |
| **B. Microsoft Entra External ID (customer tenant)** | Hosted sign-up and sign-in, email OTP or passwordless, MFA (email OTP, SMS, TOTP), self-service password reset, risk-based Conditional Access, social IdPs, session revocation through Graph | Free for the first 50,000 monthly active users (pricing **unverified**, check before committing). Effort: add OIDC to the server (authorisation code + PKCE), map `oid` to an account, migrate existing accounts (users verify by email on first sign-in) | **Recommended for general availability.** It closes R-05 and R-06 without building MFA and recovery ourselves |
| **C. Add TOTP/WebAuthn and an email reset to A** | MFA and recovery in-house | Build and maintain the security-critical flows ourselves; email deliverability depends on ACS and DNS | Only if External ID is ruled out |

The app has **no admin role or admin surface**, so "admin MFA" applies to the Azure operators (above) only. If an operator console is ever added, it must sit behind Entra ID with phishing-resistant MFA, not the customer accounts.

## Customer authentication controls (built-in accounts, verified by tests)

| Control | Where | Test |
| --- | --- | --- |
| Server-side session record and revocation | `server/auth.ts` (`recordSession`, `endSession`, `endAllSessions`) | `tests/auth.test.ts` "ends the session on the server, so a copied cookie stops working"; browser check `security-e2e` |
| Sign out everywhere | `POST /api/auth/signout-everywhere` | "signs out everywhere" |
| Re-authentication for sensitive changes | Password change and account deletion need the current password | "changes the password only with the current one…", "deletes the account…" |
| Throttling | Per IP (10 per 10 minutes) and per account (lock for 15 minutes after 10 failures) | "rate-limits repeated sign-in attempts", "locks sign-in for an account…" |
| Same answer for an unknown email and a wrong password | `burnPasswordCheck` | "gives the same answer for a wrong password and an unknown email" |
| Server-side authorisation | Every account route checks the session on the server; workspace routes check the hashed bearer token | "keeps each account's workspace to itself"; the workspace tests |
| Cookie | `__Host-s8_session`, HttpOnly, Secure, SameSite=Lax, path / | Browser check (production mode) |

**Not yet proven:** tenant isolation for workspaces and consultations beyond token possession (R-07). See `REMEDIATION-PLAN.md`.
