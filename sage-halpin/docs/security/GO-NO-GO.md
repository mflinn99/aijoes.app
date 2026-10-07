# Go/no-go assessment: production release on Azure

**Decision: NO-GO** (7 October 2026).

This does not mean the code is broken. It means the release gates below are
not met and the evidence they need does not exist yet. Sentinel8 is **not**
described here as secure, certified, compliant or "military grade". It has
had a focused hardening pass with test evidence (`EVIDENCE-PACK.md`), and no
independent test.

## Release gates

| Gate | Status | What clears it |
| --- | --- | --- |
| G1. The customer controls the tenant, subscription, repository, domain, AI account and data | **Fail**: the live app and data are in an account the customer cannot access (R-01); no tenant | Custody steps in `MIGRATION-RUNBOOK.md` step 1; the Azure tenant |
| G2. Exposed credentials revoked | **Fail** (unverified) | Revoke the Anthropic key; confirm |
| G3. Budget ceiling approved | **Fail** | Customer states it (`COST-MODEL.md`) |
| G4. Infrastructure deployed from `infra/azure` and post-deploy checks pass | **Not started** | G1 and G3 |
| G5. CI green on the default branch, with branch protection and prod reviewers enabled | **Unverified** | Push; enable the settings in `PIPELINE.md` |
| G6. Independent penetration test with no unresolved critical or high findings | **Not started** | Commission it after G4 on nonprod |
| G7. ASVS L2 "Not met" items closed or formally risk-accepted by the customer | **Fail**: MFA, recovery, change notification, security event log, plus R-04 and R-07 | `REMEDIATION-PLAN.md` P1 items 13–15 |
| G8. Restore drill passed; RPO and RTO measured | **Not started** | After G4 |
| G9. Migration rehearsal reconciled with zero unexplained differences | **Blocked** by G1 | `MIGRATION-RUNBOOK.md` step 5 |
| G10. DPIA and privacy notice; AI provider terms checked | **Not started** | Customer (R-08) |
| G11. Provider obligations signed by a named party | **Not started** | `PROVIDER-OBLIGATIONS.md` |

## Done in this pass (with evidence)

- Revocable server-side sessions: sign-out everywhere, password change with re-authentication, per-account lockout, a common-password denylist and the `__Host-` cookie.
- An SSRF bypass (F-01, high) found and fixed, with a regression test.
- Tenant-isolation tests.
- A daily cap on AI calls.
- An app-side Front Door ID check.
- Hardened CI: actions pinned by SHA; gitleaks, CodeQL, npm audit, dependency review and an SBOM; build once and promote by digest; OIDC.
- One authoritative Bicep for the approved design, which builds and lints clean.
- The full set of design, risk and runbook documents listed in `README.md`.

## What the customer must do next (in order)

1. Revoke the exposed Anthropic key.
2. Take the platform into your own Replit workspace (or approve going straight to Azure), and export the data.
3. Provide the Azure tenant and subscription; state the budget ceiling.
4. Confirm DNS ownership of `sentinel8.ai`.
5. Enable branch protection and environment reviewers on GitHub.
6. Choose the customer authentication option (`IDENTITY.md`; External ID recommended).
