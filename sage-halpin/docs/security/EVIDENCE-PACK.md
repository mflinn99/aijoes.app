# Evidence pack

Everything below was **executed on 7 October 2026** in the build environment
(Linux, Node 22, PostgreSQL 16 on a local port, Chromium through Playwright)
against the code on branch `claude/build-this-xsgedw`. Anything not executed
is listed under **Unverified**, with its blocker. No result here comes from
Azure: nothing has been deployed there.

## Executed

| # | Check | Command or script | Result |
| --- | --- | --- | --- |
| E1 | Type check | `npm run typecheck` | Pass |
| E2 | Unit and API tests (in-memory store, mock AI, real PostgreSQL for the store tests) | `TEST_DATABASE_URL=… npx vitest run --no-file-parallelism` | **129 passed, 0 failed** (11 files) |
| E3 | Production build | `npm run build` | Pass (`dist/server.mjs` 163 kB) |
| E4 | Website link and brand checks | `npm run check:site`, `npm run check:brand` | Pass |
| E5 | Production dependency vulnerabilities | `npm audit --omit=dev` | **0** |
| E6 | Secret scan, full git history | `gitleaks git . --config .gitleaks.toml` (8.24.3) | **No leaks** (6 reviewed false positives allow-listed precisely) |
| E7 | Bicep build, lint, parameter files | `STRICT=1 infra/azure/validate.sh` (Bicep 0.47.16) | **0 errors, 0 warnings** |
| E8 | Workflow lint | actionlint 1.7.12; YAML parse | Pass |
| E9 | SBOM | `npm sbom --sbom-format cyclonedx --omit dev` | CycloneDX 1.5, 129 components |
| E10 | Account security in the browser, production mode (`__Host-` cookie, PostgreSQL) | `evidence/account-security.e2e.mjs` | **13 of 13**: common password refused; cookie flags; second device; wrong current password refused; change signs out other devices; sign out everywhere; copied cookie refused after; no script errors; 0 server errors |
| E11 | Full journey: website → sign-up → onboarding → board question → checkpoint → sign-out → sign-in on a second device; phone width; access control | `e2e-app.mjs` (build environment) | **57 of 57** |
| E12 | Getting-started guide journey | `guide-e2e.mjs` | **46 of 46** on a fresh server. A run straight after E11 on the same server hit the per-IP limit (429), which is expected |
| E13 | SSRF regression F-01 | `tests/net.test.ts` on the old code, then the fixed code | Failed 2 of 4 before the fix (reproduced); 4 of 4 after |
| E14 | Tenant isolation | `tests/tenancy.test.ts` | Another tenant's token gets 404 on 9 workspace routes and 3 consultation routes; cross-tenant linking refused |
| E15 | Front Door ID enforcement | `tests/api.test.ts` "behind Azure Front Door" | Pass |
| E16 | Live Replit deployment status | Replit connector `get_publish_status` | `success`, `https://exciting-inferior-axis.replit.app`. **Runs an older commit without E10, E13 or E15** |

## Unverified (with blockers)

| Item | Blocker |
| --- | --- |
| Azure deployment, what-if, and the 12 post-deploy checks in `infra/azure/README.md` (origin not publicly reachable, SCM 403, FTP off, Key Vault public access blocked, TLS, WAF blocking) | No customer Azure tenant or subscription; no budget ceiling |
| `TRUST_PROXY_HOPS=2` is correct behind Front Door + App Service | Needs a deployment |
| Restore drill, zone failover, region restore | Needs a deployment |
| Alerts fire and reach the right people | Needs a deployment and named owners |
| GitHub workflows run green on GitHub | Not yet pushed and run. Branch protection and environment reviewers can't be read (API 403) |
| Exposed Anthropic key revoked | Needs the key owner |
| Replit data: contents, backups, encryption, location | Account not controlled by the customer; no data access |
| DNS records for `sentinel8.ai` (NS, MX, SPF, DMARC, CAA) | DNS tools blocked in the build environment |
| Azure prices | Pricing endpoints blocked; estimates only (`COST-MODEL.md`) |
| **Independent penetration test** | Not commissioned. **Required for release** |
| ASVS L2 conformance | Not achieved. 5 "Not met" items (`ASVS-L2-MATRIX.md`) |
