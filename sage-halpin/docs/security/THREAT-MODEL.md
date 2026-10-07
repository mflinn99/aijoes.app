# Threat model (STRIDE)

Scope: the Sentinel8 platform (app, API, data, AI calls, horizon scanner), its Azure target (ADR-001) and its delivery pipeline. Diagrams and trust boundaries are in `CURRENT-STATE.md` §5–6 and `ADR-001` (Trust boundaries).

**Assets:** account credentials and sessions; saved workspaces (people, CVs); consultation questions, invitee details and answers; workspace and decision history; AI spend; the deploy pipeline and its Azure rights; the domain and DNS.

**Threat actors:** an Internet attacker; a malicious or careless invitee; a malicious signed-in user (another tenant); a compromised dependency or action; a compromised supplier or operator account; a prompt-injecting feed or document author.

| # | STRIDE | Threat | Mitigation in place | Gap or action | Ref |
| --- | --- | --- | --- | --- | --- |
| T1 | Spoofing | Credential stuffing or guessing on sign-in | scrypt; per-IP and per-account lockout; same answer for an unknown email; common-password denylist | MFA (R-05); WAF rate rule at the edge | ASVS 2.2.1 |
| T2 | Spoofing | Session theft or replay | HttpOnly, Secure, `__Host-` cookie; server-side revocation; 14-day absolute expiry; sign out everywhere | Idle timeout not implemented (absolute only) | 3.3.x |
| T3 | Spoofing | Forged request from another site (CSRF) | JSON-only bodies plus an Origin check on every state-changing account route; SameSite=Lax; bearer tokens (not cookies) on workspace routes | — | 4.2.2 |
| T4 | Spoofing | A leaked questionnaire or workspace link is used by someone else | Tokens are random (≥ 128 bits), stored hashed and compared in constant time; redacted from logs; `Referrer-Policy: no-referrer` on `/respond` | Bind workspaces to accounts (R-07); token rotation | 3.5.x |
| T5 | Tampering | Changing another tenant's data | Every route authorises on the server (session or hashed token); the tenancy tests | Workspace creation without an account (R-04/R-07) | 4.1.x |
| T6 | Tampering | SQL injection | Parameterised queries; keys validated; table name allow-listed | — | 5.3.4 |
| T7 | Tampering | Supply-chain compromise (npm, actions) | Lockfile; actions pinned by SHA; Dependabot; dependency review; SBOM; CodeQL | Provenance verification; base images pinned by digest | 10.3.x, 14.2.x |
| T8 | Repudiation | No record of who changed what | Request logs (method, path, status, time) | An audit event log for account security events (sign-in, password change, sign out everywhere) is **not implemented** | 7.1.x |
| T9 | Information disclosure | Personal data to the AI provider | Sent only per question; data minimised (the prompt builder) | DPIA; provider terms (R-08) | 8.3.x |
| T10 | Information disclosure | Secrets or personal data in logs | Bodies never logged; tokens redacted; no cookies logged | Log review once on Azure | 7.1.1 |
| T11 | Information disclosure | Origin reached directly, bypassing the WAF | Azure: public access disabled, Private Link origin, FDID check | Verify after deploy (`infra/azure/README.md`) | — |
| T12 | Information disclosure | SSRF through feed URLs reaching internal services or metadata | DNS-resolved, private-IP-refusing fetcher, re-checked on each redirect; size and time limits | — | 12.6.1 |
| T13 | Information disclosure | Stored XSS through model output or answers | React escapes output; strict CSP (`script-src 'self'`); no `dangerouslySetInnerHTML` for untrusted content | Confirm with a pen test | 5.2.x, 14.4.x |
| T14 | Denial of service | Traffic flood | Front Door edge; WAF rate rules; per-IP limits; body size limit (256 kB) | — | 11.1.x |
| T15 | Denial of service / financial | AI spend exhaustion | Per-IP limits on AI routes; daily call cap per server; provider spend limit | Require accounts for AI routes (R-04) | 11.1.x |
| T16 | Elevation of privilege | Prompt injection makes the model act beyond its rights | The model has no tools except web search; it cannot reach data or actions; outputs are parsed and validated; permissions are enforced in code; untrusted text is wrapped | Injection test corpus (R-11) | — |
| T17 | Elevation of privilege | A pipeline or PR compromise deploys to prod | OIDC per environment; prod environment reviewers; deploy only from the default branch on push; least-privilege job permissions | Branch protection must be enabled (R-13) | 1.14.x |
| T18 | Elevation of privilege | Operator account takeover | Phishing-resistant MFA; PIM; break-glass process | Not yet in place (no tenant) | — |
| T19 | Spoofing | Domain or DNS hijack; email spoofing | — | Registrar lock, CAA, DMARC (R-12) | — |
| T20 | Tampering | Data loss through deletion or corruption | Azure: PITR 35 days, CanNotDelete locks, soft delete | Restore tests (quarterly) | — |
