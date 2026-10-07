# Sentinel8 security and Azure migration: handover pack

Current decision: **NO-GO for production release** (`GO-NO-GO.md`).

| Document | What it is |
| --- | --- |
| `CURRENT-STATE.md` | Verified inventory, ownership, data stores, current-state and data-flow diagrams |
| `RISK-REGISTER.md` | Scored risks, owners and treatment |
| `REMEDIATION-PLAN.md` | Prioritised actions (P0/P1/P2) and their status |
| `ADR-001-azure-hosting.md` | Architecture decision: services, trust boundaries, failure modes, alternatives |
| `COST-MODEL.md` | Itemised monthly cost (unverified estimates), configurations, budget decision |
| `IDENTITY.md` | Operator, pipeline and runtime identities; customer authentication options |
| `THREAT-MODEL.md` | STRIDE threats and mitigations |
| `ASVS-L2-MATRIX.md` | Requirement-to-evidence matrix (selected L2 requirements) |
| `PIPELINE.md` | CI/CD controls, required GitHub settings, isolation of production |
| `MIGRATION-RUNBOOK.md` | Replit-to-Azure steps, switch point, rollback limit (blocked) |
| `RECOVERY.md` | Backups, drills, and the runbooks each alert links to |
| `MONITORING.md` | Alert catalogue with owners and runbooks; known gaps |
| `PROVIDER-OBLIGATIONS.md` | Draft hosting and operations obligations |
| `EVIDENCE-PACK.md` | What was executed, with results; what is unverified and why |
| `GO-NO-GO.md` | Release gates and the decision |
| `../../infra/azure/README.md` | The Bicep: resources, deploy steps, post-deploy checks, deviations |
