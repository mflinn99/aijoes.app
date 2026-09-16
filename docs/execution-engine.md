# Execution Engine

Directive §11, §12, §15.

> "The START button must represent a real execution contract. Do not implement START
> as a dummy status change."

## The fifteen steps, as implemented

The directive's START workflow is split into three phases, with a human between
planning and doing.

### `planExecution()` — steps 1–8

1. **Validate the opportunity** — `startAvailable()` gate: status, playbook, confidence, readiness.
2. **Refresh evidence** — the twin and opportunity are re-read from store.
3. **Confirm the financial model** — playbook eligibility rules run against current confidence, value, integrations and readiness.
4. **Generate the execution plan** — playbook tasks become execution tasks.
5. **Identify agents/capabilities** — every task goes through the router; the rationale is kept.
6. **Validate integrations** — missing integrations become blockers, named.
7. **Identify approvals** — external actions and playbook-gated tasks are marked.
8. **Present the execution preview** — task count, gates, cost, target, proportionality, simulated capabilities.

A plan with blockers is `DRAFT` and cannot be authorised. Blockers are listed in the
preview so the user knows exactly what to fix.

### `authorisePlan()` — step 9

A named human accepts. The plan moves to `AUTHORISED`, an approval row is written,
the audit log records who and why, and the benefit advances `THEORETICAL → APPROVED`.

### `runExecution()` — steps 10–15

10. **Execute authorised tasks** in sequence.
11. **Monitor** — up to two retries per task, every attempt emitting an agent event.
12. **Measure** — outcomes carry `measuredValueGbp`.
13. **Record realised benefit** — the ledger advances to `REALISED`.
14. **Update the Company Twin** — the opportunity's status and realised value are written back.
15. **Find the next opportunity** — the portfolio's next best action recomputes, since the executed one leaves the startable pool.

## Gating

```
approvalRequired = playbook_says_so OR (action_is_external AND NOT autonomy.mayExecute)
```

Internal preparation runs on the plan's own authorisation. §12's PREPARE level exists
precisely so the work gets done and the human approves the step that leaves the
building, not every step before it.

A gated task **stops the run** rather than being skipped: the plan is sequential and a
later task usually consumes the gated one's output. Rejecting a gate stops the plan.

Structurally, every capability action marked `external` has `approvalId` forced into
its `requiredInputs` by the registry, so an external action cannot be invoked without
one. A new external action cannot be added without inheriting the gate.

## Proportionality

Before a plan can be authorised, planned execution cost is checked against the value
at stake. Above 25%, the plan is blocked. The router applies the same test per
candidate. Directive §26: do not spend £1,000 analysing a £500 opportunity.

## Rollback

Every plan carries a category-specific rollback statement, shown in the preview
before authorisation and on the monitoring screen after. Stop conditions come from
the playbook.

## Stopping

`stopPlan()` marks every pending, awaiting or running task as skipped with the stated
reason. Separately, the tenant-wide autonomy halt drops every grant to `OBSERVE` in
one call, so nothing new can reach an external action.
