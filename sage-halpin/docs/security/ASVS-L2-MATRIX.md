# OWASP ASVS 4.0.3 Level 2: requirement-to-evidence matrix

**This is not a claim of ASVS compliance.** It covers the requirements most
relevant to this application, chosen by risk. It is **not** all of the
roughly 280 Level 2 requirements. Each status rests on the evidence named;
"code review" means the code was read but no test asserts the behaviour.
Automated scans alone do not prove a requirement. The release gate
(`GO-NO-GO.md`) needs an independent penetration test to confirm these
results.

Status key:
- **Met (test):** a test asserts the behaviour.
- **Met (review):** the code was read; no test.
- **Partial:** partly met.
- **Not met:** missing.
- **Unverified:** depends on infrastructure that isn't deployed, or needs a pen test.
- **N/A:** does not apply.

| ASVS | Requirement (short) | Status | Evidence |
| --- | --- | --- | --- |
| 1.1.2 | Threat modelling for design changes | Met (review) | `THREAT-MODEL.md` |
| 1.4.1 | Access control enforced at a trusted service layer | Met (test) | `requireAccount`, `requireWorkspace`, `requireLead`; `tests/tenancy.test.ts` |
| 1.5.1 | Input and output requirements defined | Partial | Validation in each route; no central schema |
| 1.14.1 | Segregation of components with different trust levels | Unverified | ADR-001 network design; not deployed |
| 2.1.1 | Passwords at least 12 characters | Met (test) | `PASSWORD_MIN`; `auth.test.ts` "explains every invalid field" |
| 2.1.2 | Passwords of 64+ characters allowed | Met (review) | `PASSWORD_MAX` = 200 |
| 2.1.7 | Passwords checked against breached lists | Partial | Offline common-password list (`password-policy.ts`, tested); no breached-password API |
| 2.1.9 | No composition rules | Met (review) | Only length, the denylist and a variety check |
| 2.1.11 | Paste and password managers allowed | Met (review) | Standard inputs with `autocomplete` |
| 2.2.1 | Anti-automation (lockout or throttling) | Met (test) | Per-IP and per-account; `auth.test.ts` "locks sign-in…", "rate-limits…" |
| 2.2.3 | Notify the user after credential changes | Not met | Needs email (ACS sender domain unverified) |
| 2.4.1 | Passwords stored with an approved KDF and salt | Met (test) | scrypt N=16384, 16-byte salt; `auth.test.ts` "hashes passwords…" |
| 2.5.x | Credential recovery | Not met | No recovery flow (R-06) |
| 2.7/2.8 | Out-of-band and one-time verifiers (MFA) | Not met | R-05; `IDENTITY.md` options |
| 3.2.1 | New session token on authentication | Met (test) | `startSession` on sign-up, sign-in and password change |
| 3.2.2 | Session tokens with ≥ 64 bits of entropy | Met (review) | 256-bit session id, HMAC-signed |
| 3.3.1 | Logout invalidates the session on the server | Met (test) | "ends the session on the server, so a copied cookie stops working" |
| 3.3.2 | Re-authentication or idle timeout | Partial | 14-day absolute timeout; re-authentication for password change and account deletion; no idle timeout |
| 3.3.3 | Option to end all other sessions after a password change | Met (test) | Automatic on change; "signs out everywhere" |
| 3.3.4 | Users can view and log out of active sessions | Partial | Sign out everywhere (tested); no list of sessions |
| 3.4.1–3.4.5 | Cookie Secure, HttpOnly, SameSite, `__Host-`, path | Met (test) | `auth.test.ts`; browser check `security-e2e` in production mode |
| 3.5.2 | Static secrets not used for sessions | Met (review) | Random per-session ids; bearer tokens for capability links only |
| 4.1.1 | Access control enforced on the server | Met (test) | `tenancy.test.ts`, `auth.test.ts` "keeps each account's workspace to itself" |
| 4.1.3 | Least privilege | Partial | No roles; the workspace token holder has full rights (R-07) |
| 4.2.1 | Protection against IDOR | Met (test) | Another tenant's token gets 404 on every workspace route (`tenancy.test.ts`) |
| 4.2.2 | Anti-CSRF | Met (test) | `auth.test.ts` "refuses a change from another site's origin", "…that isn't JSON" |
| 4.3.1 | Admin interfaces use MFA | N/A | No admin interface in the app. The Azure management plane requires MFA (`IDENTITY.md`) |
| 5.1.3 | Input validated (allow lists) | Met (review) | Per-route validation; data keys `^[a-z0-9_]{1,80}$` |
| 5.2.x | Sanitisation; no untrusted HTML | Met (review) | React escaping; no untrusted `dangerouslySetInnerHTML` (only the chart theme CSS from code) |
| 5.3.4 | Parameterised queries | Met (test) | `postgres-store.test.ts` "treats keys as data, never as SQL" |
| 6.2.1 | Approved crypto; failures handled safely | Met (review) | AES-256-GCM, HKDF, HMAC-SHA256, scrypt; a decrypt failure gives an empty workspace, not an error leak |
| 6.4.1 | Secrets in a key vault | Unverified | Azure Key Vault references in `infra/azure`; on Replit they are in Replit Secrets (not customer-controlled, R-01) |
| 7.1.1 | No credentials or session tokens in logs | Met (review) | `app.ts` serialisers; token redaction tested in `api.test.ts` |
| 7.1.3 | Security events logged | Not met | No audit event log (T8) |
| 7.4.1 | Generic error messages | Met (review) | 500 gives "Something went wrong"; errors are logged on the server |
| 8.1.1 | Sensitive data not cached by intermediaries | Partial | `no-store` on health; API JSON has no explicit `Cache-Control: no-store` (follow-up) |
| 8.3.1 | Sensitive data in the body or headers, not the URL | Partial | Questionnaire tokens are in the URL by design (link in an email); redacted from logs; no-referrer |
| 8.3.4 | Inventory of sensitive data | Met (review) | `CURRENT-STATE.md` §3 |
| 9.1.1 | TLS for all connections | Unverified | Front Door HTTPS-only; PostgreSQL `require_secure_transport`; not deployed |
| 9.2.x | Outbound TLS verified | Met (review) | Node default certificate validation; no `rejectUnauthorized: false` |
| 10.3.2 | Dependency integrity and updates | Met (review) | Lockfile, `npm ci`, Dependabot, pinned actions |
| 11.1.4 | Anti-automation on expensive functions | Partial | Per-IP limits and the daily AI cap (`ai-budget.test.ts`); accounts not required (R-04) |
| 12.6.1 | SSRF protection | Met (test) | `net.ts` tests in `api.test.ts` |
| 12.1.1 | Upload size limits | Met (test) | 20 MB per file (413), 100 files and 250 MB per owner (`files.ts`; `files.test.ts` "lists, deletes and refuses bad uploads") |
| 12.2.1 | File content checked against its declared type | Met (test) | Type sniffed from magic bytes (`extract.ts` `sniffType`; `files.test.ts` "knows file types from their content") |
| 12.4.1 | Untrusted files stored outside the web root | Met (review) | Stored in the database in chunks, never on the web server's filesystem |
| 12.5.2 | Uploaded files not served as executable content | Met (test) | Always downloaded as attachments; HTML is served as `application/octet-stream` with `CSP: sandbox` (`files.test.ts`) |
| 12.4.2 | Antivirus scanning of uploads | Not met | Planned with Blob storage (Defender for Storage malware scanning) |
| 13.1.x | API: same encodings; JSON content type enforced | Met (test) | `sameSite` guard (415) |
| 13.2.1 | RESTful methods appropriate | Met (review) | — |
| 14.1.x | Build pipeline secure; reproducible | Partial | `PIPELINE.md`; build once and promote by digest; base image not pinned by digest |
| 14.2.1 | Components up to date; no known vulnerabilities | Met (test) | `npm audit --omit=dev` = 0 (7 Oct 2026); CI job |
| 14.2.6 | Third-party code inventory (SBOM) | Met (review) | CycloneDX SBOM in CI |
| 14.4.x | Security headers (CSP, nosniff, HSTS, frame-ancestors, Referrer-Policy) | Met (test) | `app.ts`; `api.test.ts` header checks |
| 14.5.3 | CORS origin allow-list | Met (review) | Only `/api/healthz` sends `Access-Control-Allow-Origin: *`; it returns no data |

**Totals (this subset):** 34 Met (test or review), 10 Partial, 6 Not met, 4 Unverified, 1 N/A. Level 2 is **not achieved**: the "Not met" rows (MFA, recovery, credential-change notification, security event log) are L2 requirements.
