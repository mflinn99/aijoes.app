# Sixonic → Sage Halpin mapping

Every feature is carried across. None was dropped. Tests are in `tests/`;
"walkthrough" means the Playwright walk of the built app recorded in
`docs/BUILD-STATUS.md`.

| Sixonic feature | Sage Halpin name and label | Carried | Proof | Notes |
| --- | --- | --- | --- | --- |
| Home, boardroom visual, Start/Resume Scenario, Ask the Board, Enter Workspace | Same actions; wordmark SAGE HALPIN · THE EVOLVING BOARD; table centre "SAGE HALPIN" | Yes | walkthrough | Copy rewritten in Sage Halpin voice; disclosure added to the footer |
| Executive Workspace: KPI snapshot, alert engine, decisions, levers, risks | Unchanged | Yes | walkthrough; `brand.test.ts` (alerts) | Alerts are attributed to perspectives (RISK, GOVERNANCE, COMMERCIAL) instead of character names |
| Boardroom chat, full board | Same; each answer tagged "AI agent · role" | Yes | `api.test.ts` full board; walkthrough | Six agents in the original order |
| Boardroom chat, single seat | Same | Yes | `api.test.ts` single seat | |
| Session history in chat | Same | Yes | `api.test.ts` history | A leading assistant turn is dropped before calling the model (Claude requires the first turn to be the user's) |
| Discussion starters | Same | Yes | walkthrough | |
| Chair's "Final Decision" | "Recommended resolution" | Yes | walkthrough | The agent recommends; the person decides |
| Scenario analysis: six challenges and board truths | Same | Yes | `api.test.ts` every challenge | Prompts and board truths unchanged |
| Calibration dials | Same | Yes | `api.test.ts` contract and validation | Values must be 0–1 |
| Per-agent SWOT and consequences | Same | Yes | `api.test.ts` contract | |
| DO / DON'T DO verdict with assessment | Same; labelled "Board Recommendation · for your decision" until locked, then "Your Decision" | Yes | `api.test.ts`; walkthrough | |
| Traditional (functional) view | Same | Yes | `api.test.ts` contract | |
| Feedback rounds (two) | Same | Yes | `api.test.ts` feedback round | |
| Lock decision, decision log, outcomes | Same | Yes | walkthrough | |
| Bespoke challenge "coming soon" and waitlist | Same; waitlist link shown only when `VITE_ENQUIRY_EMAIL` is set | Yes | code review | No Sage Halpin address exists yet (BLOCKERS) |
| Browser-local storage | Same, keys `sagehalpin_anon_*` | Yes | walkthrough | New domain, so there is nothing to migrate |
| `/reset-password` redirect | Same redirect | Yes | code review | The unused page component was removed; the route still redirects |
| `/api/healthz` | Same, plus `/api/readyz` | Yes | `api.test.ts` | |
| Demo video modal | Removed | No (was unused) | — | Not rendered anywhere; embedded a placeholder video |
| OpenAI (`gpt-5.1`, `gpt-4.1`) | Claude on Microsoft Foundry (`claude-opus-5-5`) | Yes | contract tests with mock; live model not yet run | See BUILD-STATUS: behaviour with the live model is unverified |
