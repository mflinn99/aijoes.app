# Risk register

Likelihood (L) and impact (I) are rated 1–5. Score = L × I. Critical ≥ 15, high 10–14, medium 5–9, low ≤ 4.
"Owner" is a role. Named people must be assigned by the customer (see `IDENTITY.md`).

| ID | Risk | L | I | Score | Status | Treatment | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | **The live platform, its database and its secrets sit in a Replit account the customer does not control.** The customer cannot see, back up, export or shut down their users' data | 5 | 5 | 25 Critical | Open | Move the app to a customer-owned Replit workspace now (`docs/REPLIT.md`), or straight to Azure. Export the data under the customer's control. Until then, do not invite real users' personal data | Customer (business owner) |
| R-02 | **Anthropic API key exposed in chat** | 4 | 4 | 16 Critical | Open (revocation unverified) | Revoke it in the Anthropic Console. Issue a new key with a monthly spend limit, stored only in Key Vault or Replit Secrets. Review the key's usage for the exposure period | Customer (Anthropic org owner) |
| R-03 | No approved budget ceiling. Paid infrastructure (Front Door Premium is about $330 a month on its own) could be committed without consent | 3 | 3 | 9 Medium | Open | The ceiling must be stated before deployment. A budget with alerts is in the Bicep. The deploy is blocked until then | Customer (finance) |
| R-04 | AI spend abuse: workspaces, consultations and board chat can be used without an account, so per-IP limits are the only per-client control | 4 | 3 | 12 High | Partly mitigated | **Done:** a per-server daily call cap. **To do:** require an account to create workspaces and consultations; WAF rate limits at Front Door; a provider-side spend limit | Engineering |
| R-05 | No MFA for accounts | 3 | 4 | 12 High | Open | Decision in `IDENTITY.md`: adopt Entra External ID (MFA and recovery built in), or add TOTP/WebAuthn. Required before a high-assurance launch | Customer + Engineering |
| R-06 | No self-service password recovery. A user who forgets their password is locked out | 4 | 2 | 8 Medium | Open | Comes with External ID, or an email reset flow once the ACS sender domain is verified. Blocked by email domain ownership | Engineering |
| R-07 | Tenant isolation rests on bearer capability tokens, not on the server binding workspaces to accounts. A leaked token (browser history, a shared device) gives full workspace access | 3 | 4 | 12 High | Open | Bind workspaces and consultations to the owning account on the server. Rotate tokens on demand. Isolation tests exist for account data, not for workspaces | Engineering |
| R-08 | Personal data (names, emails, CVs, answers) is sent to an AI provider. Lawful basis, DPIA and provider terms are not recorded | 3 | 4 | 12 High | Open | DPIA; the privacy notice; check the provider's terms and data residency (Foundry in UK South for UK residency) | Customer (data protection) |
| R-09 | Single instance on Replit: no zone redundancy, no RPO or RTO, unknown backups | 4 | 4 | 16 Critical | Open | Azure target design: PostgreSQL with PITR and zone-redundant HA, App Service across zones (ADR-001) | Engineering |
| R-10 | `SESSION_SECRET` is both the cookie-signing key and the root of the encryption key for saved workspaces. Rotating it makes saved workspaces unreadable | 2 | 4 | 8 Medium | Accepted (documented) | Follow-up: separate data-encryption key in Key Vault, with key versioning | Engineering |
| R-11 | Prompt injection through feeds, questionnaire answers or CVs changes model output (for example a fabricated signal or a biased synthesis) | 3 | 3 | 9 Medium | Partly mitigated | Untrusted content is wrapped and the model has no tools apart from web search. Output is parsed and validated. Model output is advisory, and permissions are enforced in code. To do: an injection test corpus in CI | Engineering |
| R-12 | DNS registrar and records for `sentinel8.ai` are unknown: risk of losing the domain, subdomain takeover or email spoofing | 3 | 4 | 12 High | Open | Confirm the registrar account owner; registrar lock; MFA; CAA; SPF/DMARC `p=reject` if there is no mail; remove dangling records | Customer (domain owner) |
| R-13 | GitHub repository protections unverified (branch protection, required reviews, who has write access). The repository is public | 3 | 4 | 12 High | Open | Settings in `PIPELINE.md`. The CI now pins actions, scans for secrets and dependencies, and runs CodeQL | Repository owner |
| R-14 | In-memory per-IP rate limits reset on restart and are per replica | 3 | 2 | 6 Medium | Accepted with a compensating control | WAF rate-limit rules at Front Door. The per-account sign-in lock is stored in the database | Engineering |
| R-15 | Demo or seed accounts in production | 1 | 4 | 4 Low | Verified absent | Source has no seed accounts. The mock AI provider is refused in production. Test accounts made during verification on Replit ("Final Check" and others) must be deleted at handover | Engineering |
| R-16 | Horizon scanner SSRF: an organisation enters an internal URL | 2 | 4 | 8 Medium | Mitigated (finding F-01 fixed) | `net.ts` resolves DNS and refuses private, loopback and link-local addresses on every redirect, with size and time limits. **F-01 (High, fixed 7 Oct 2026):** an IPv4-mapped IPv6 literal in hex form (`https://[::ffff:127.0.0.1]/` normalises to `[::ffff:7f00:1]`), NAT64 and 6to4 forms passed the check. Now every IPv6 form is parsed and judged by its embedded IPv4 address; `tests/net.test.ts`. On Azure, outbound traffic goes through VNet integration with NSG rules | Engineering |
| R-17 | Logs containing secrets or personal data | 2 | 3 | 6 Medium | Mitigated | Request bodies are never logged. Questionnaire tokens are redacted from URLs. No cookies or headers are logged | Engineering |
| R-18 | Supply chain: compromised npm package or GitHub Action | 2 | 5 | 10 High | Partly mitigated | Lockfile with `npm ci`; actions pinned by SHA; Dependabot; dependency review; SBOM. To do: npm provenance checks | Engineering |
| R-19 | Website points at a platform address outside the customer's control (R-01). If that app were repointed, the website's buttons would send users there | 2 | 4 | 8 Medium | Partly mitigated | The website checks `/api/healthz` identifies as Sentinel8. Fix: an `app.sentinel8.ai` the customer owns | Customer |
| R-20 | Website and platform on different origins; the platform's CSP permits Google Fonts | 1 | 2 | 2 Low | Accepted | Self-host fonts at a later date | Engineering |

## Top five, in order

1. R-01: get the platform and its data under customer control.
2. R-02: revoke the exposed key.
3. R-09: production hosting with backups and HA (Azure).
4. R-04 and R-07: require accounts, and bind workspaces to accounts on the server.
5. R-05, R-12 and R-13: MFA, domain and repository controls.
