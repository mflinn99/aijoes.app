# Onward Professional Services — Agentic GTM Status

Directive 02, final output. Written 2026-09-22.

Read the second section first. The engine works; it has not yet been given
anything real to work on.

---

## 1. What was built

An agentic go-to-market engine on top of the existing AIGoGo MetaMSP platform,
closing this loop:

> DISCOVER → RESEARCH → SCORE → IDENTIFY NEED → BUILD PROPOSITION →
> IDENTIFY BUYERS → ENGAGE → FOLLOW UP → QUALIFY → BOOK MEETING →
> UPDATE CRM → MONITOR PIPELINE → LEARN → REPEAT

Every stage is real code with real persistence, exercised by tests that assert
behaviour rather than existence. `src/lib/gtm/loop.ts` runs the whole thing as
one call and reports what each stage actually produced — including zero, with
the reason.

**Engine and configuration are separate.** Nothing in `src/lib/gtm/` names
Onward. Onward is a profile in `src/config/msp/onward.ts`. A second MSP is a
second config file.

---

## 2. What is proved, and what is not

**Proved.** The machine. Run against the synthetic fixtures it discovers,
researches, scores, generates 16 hypotheses, rejects 12 of them with reasons,
matches 4 to a service Onward can deliver, identifies buyer roles, refuses every
outreach composition for a stated reason, opens 2 opportunities, writes them to
a CRM record of origin, monitors the pipeline, escalates what exceeds policy and
records outcomes for learning. A second cycle changes nothing: same counts, and
a CRM reconcile reporting only "unchanged".

**Not proved.** Anything commercial. Nothing has been sent to anyone. No real
company has been researched, because outbound network access is blocked in this
environment. Run against six real UK companies, the engine correctly reported
`research-failed`, `understanding 0%`, zero hypotheses and zero contacts.

That second result is the one worth dwelling on. Asked to work on companies it
knows nothing about, the engine produced nothing. A system that had returned a
ranked target list there would have been fabricating, and would have looked more
impressive while being worthless.

---

## 3. Commercial targets

Configurable per MSP, seeded with the directive's numbers, counted live from the
pipeline tables — never from a tally the engine keeps about itself. Synthetic
accounts count for nothing.

| Objective | Target | Actual | Why |
|---|---:|---:|---|
| Accounts researched | 250 | 3 | Only the synthetic fixtures are researchable offline. |
| Evidence-backed hypotheses | 50 | 4 | Derived from those 3 accounts. 12 more were generated and rejected. |
| Qualified opportunities | 20 | 0 | Qualification requires a conversation. Nothing has been sent. |
| Meetings booked | 10 | 0 | As above. |
| Weighted PS pipeline | £500,000 | £3,473 | 2 opportunities at the 2% "identified" stage probability. |

None is met. All five depend on outbound network access and contact data, and on
nothing else in the build. See BLOCKERS.md.

---

## 4. What the engine refuses to do

These are the product, more than the generation is.

- **No generic outreach.** `BANNED_PATTERNS` rejects merge-field templates,
  "I noticed your company", "hope this finds you well", "quick question",
  "circle back", "we help companies like yours" and marketing adjectives. A
  message that fails the lint is not sent, it is not queued, it is refused.
- **No message without a specific observation** about that company and a lawful
  basis for contacting that person. Thirteen ordered refusal rules, and the
  first one is that synthetic accounts can never be contacted.
- **No hypothesis that cannot answer all eleven questions** of Phase 5. Fit
  below 45%, understanding below 25%, fewer than two independent evidence items,
  value below £8,000, no deliverable service — any one of these rejects it. In
  the last run 12 of 16 were rejected.
- **No invented contacts.** The engine identifies likely *roles* and stops. A
  name an agent made up is worse than no name.
- **No claim about Onward that Onward has not confirmed.** Every proof point is
  `usableInOutreach: false` until it is.
- **No self-modification.** The learning loop proposes; a named person
  activates; every version is retained and rollback is one call.
- **No sending without a provider having accepted the message.** There is no
  code path that marks a message sent otherwise.

---

## 5. Commercial governance

Mark keeps sales strategy, partnerships and material commercial positioning.
Seven escalation triggers, and the default is that routine work proceeds —
escalation is the exception.

Every escalation carries **context, evidence, a recommendation, an expected
value and a proposed action**. Never raw information. Escalations are raised
once per subject per trigger, so the queue stays a queue of decisions rather
than a queue of reminders.

In the last run, two £129,000 opportunities correctly escalated as
`unusually-high-value`.

---

## 6. Honesty and provenance

Every number in this system can be traced.

- Claims carry a source, a confidence and a retrieval time; conflicting claims
  are retained rather than resolved silently.
- Onward's own profile is marked `web-search-snippet` throughout, because the
  site could not be fetched. Deal ranges are marked `inferred` and captioned as
  planning placeholders that are *not* Onward figures.
- Opportunity values are positioned inside those ranges by headcount alone, and
  an account whose headcount is unknown is priced near the bottom — being
  ignorant about a company is not a reason to price it optimistically.
- Stage probabilities are fixed and visible. There is no per-deal probability
  judgement, because the engine has no basis for one.
- Where the honest answer is "nothing", every surface says so with the reason.

---

## 7. Defects found by actually running it

Every one of these was found by running the engine or its end-to-end test, not
by reading the code. All are fixed.

1. **Six companies reported as "researched" that the engine knew nothing about.**
   The analysis pipeline survives connector failures by design, so a company
   whose every source was blocked came back as a successful run over an empty
   twin. Understanding, not the absence of an exception, is now the test.
2. **Hypothesis ids diverged from their rows on re-run**, so `getHypothesis()`
   returned null for rows that plainly existed and every regenerated hypothesis
   opened a second opportunity.
3. **A deal moving to "qualified" kept its 2% "identified" probability**,
   freezing the weighted forecast at the old number.
4. **Re-running the loop walked deals backwards** to the `identified` stage.
5. **Re-running the loop refreshed every deal's last-activity date**, which
   would have disabled every dormancy rule in the system.
6. **£192,344 of managed IT proposed to an eighteen-person consultancy.** The
   value score was being used to position within the same range it was partly
   derived from, so the error compounded. Now £44,640.
7. **One managed IT contract counted three times** in the forecast, because
   three archetypes pointed at the same service for the same account.
8. **Priority scores climbed on every re-run**, because inferred role
   placeholders — which have no email and cannot be contacted — were counted
   towards contactability.
9. **Outreach to an account with no named contact would have duplicated on
   every save**, because the natural key included a nullable column and SQLite
   treats NULLs as distinct in a UNIQUE index.
10. **Escalations would have re-raised on every autopilot run.**

Numbers 1, 6, 7 and 8 all inflate what the system appears to know or be worth.
That is the failure mode this directive exists to prevent, and it took running
the thing to find them.

---

## 8. Test coverage

**353 tests, all passing**, across 24 files. The GTM-specific ones:

| File | Tests | What it proves |
|---|---:|---|
| `gtm-crm.test.ts` | 17 | Idempotency (a second reconcile is entirely "unchanged"), search-before-create, outbox durability and backoff, non-retryable rejections not queued |
| `gtm-pipeline.test.ts` | 16 | Rules fire and only once a day, dormancy demotes, suppression refuses follow-ups, escalation is raised once, objectives count from the tables |
| `gtm-learning.test.ts` | 35 | Failure classification, no self-activation, rollback, sample-size floors, brief derivation, question routing |
| `gtm-end-to-end.test.ts` | 7 | The full chain the directive requires, the human half, and that a second cycle duplicates nothing |

---

## 9. What is blocked

Six things, in BLOCKERS.md, each with what it needs and who can supply it:
outbound network access, CRM credentials, an email provider, contact data,
Onward's commercial parameters, and confirmation of Onward's own claims.

The first is the one that matters. Everything commercial depends on it.

---

## 10. What to do next, in order

1. **Open outbound network access** for research and CRM hosts. Everything else
   is downstream of this.
2. **Supply Onward's rate card and capacity.** An hour of Mark's time makes
   every pipeline number quotable instead of caveated.
3. **Confirm the proof points**, with a named reference customer for each. The
   engine has things to say about Onward and is currently refusing to say them.
4. **Connect the CRM.** The writes are already idempotent; this just makes them
   land in two places.
5. **Supply contacts from Onward's own records.** Better evidence than any
   enrichment provider, and the lawful basis comes attached.
6. **Then, and only then, run it against real targets and read what it writes.**
   Approve the first twenty messages by hand. The engine's value is in what it
   refuses; you need to see the refusals before trusting the sends.

---

## 11. What it would take to make this repeatable across the MSP market

Mostly done. The engine takes an `MspProfile`; a new MSP is a config file with
service lines, proof points and commercial parameters. What a second customer
would need:

- A profile-building interview, so an MSP can be onboarded without someone
  hand-writing TypeScript.
- Per-tenant archetype weighting, which the versioned strategy mechanism already
  supports but no UI exposes.
- A CRM adapter per platform. The interface is there and HubSpot implements it;
  a second adapter is a day's work, not a redesign.

---

## 12. The honest summary

The machine is built, tested and runs. Its judgement is conservative and its
refusals are the best thing about it. It has never spoken to anyone, and until
the environment lets it see the outside world, it should not be described as a
revenue engine — it is a revenue engine that has not been switched on.

Give it network access, a rate card and twenty contacts, and the claims in
section 3 become testable within a week. Until then the only defensible claim is
the one in section 2: the machine works, and it has correctly declined to invent
a pipeline out of nothing.
