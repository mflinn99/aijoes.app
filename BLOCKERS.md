# BLOCKERS

Directive 02 Phase 18. Everything here is something the engine cannot do in this
environment, with what it would take to unblock it and what continues meanwhile.

Nothing on this list is a code defect. Each is a credential, a permission or a
network policy the build cannot grant itself. The engine runs around all of them
— it just runs honestly, reporting that it knows nothing rather than inventing
something to show.

Last verified: 2026-09-22.

---

## 1. Outbound network access is blocked

**What is blocked.** All research. The website connector, Companies House,
LinkedIn, Microsoft Graph, Xero, HubSpot, and every other external host. The
container's egress proxy allows only `github.com`, `registry.npmjs.org` and the
Anthropic API.

**Why.** Environment network policy, chosen when the cloud environment was
created. Verified directly: `https://onwardps.co.uk/`,
`https://api.company-information.service.gov.uk/` and `https://api.hubapi.com/`
all fail at the proxy. The platform's `WebFetch` returns `EGRESS_BLOCKED`.

**What it takes.** An environment whose network policy permits outbound HTTPS to
the research and CRM hosts. This is set on the environment, not in the code —
see https://code.claude.com/docs/en/claude-code-on-the-web.

**Who.** Whoever owns the Claude Code environment configuration.

**Expected time.** Minutes, once decided.

**What continues.** Everything except research. The engine was run against six
real UK companies (Krome Technologies, Transparity, Phoenix Software, DSP, ANS,
Circle Cloud) and correctly reported `research-failed` and `understanding 0%`
for all six, generated zero hypotheses and contacted nobody. That is the
designed behaviour and it is the most important thing on this page: with no
evidence, the engine produces nothing rather than producing a target list.

**What unblocks when resolved.** The whole commercial half of the directive.
Every one of the five commercial targets depends on this and on nothing else.

---

## 2. No CRM credentials

**What is blocked.** Writing to Onward's actual CRM.

**Why.** No HubSpot private app token exists in the credential vault, and
`api.hubapi.com` is blocked in any case.

**What it takes.** A HubSpot private app token with `crm.objects.*.write`
scopes, plus the pipeline id and a stage map (our stage names to Onward's deal
stages). Stored via the platform's credential vault under `gtm.crm.hubspot` —
never in a file or an environment variable.

**Who.** Mark, or whoever administers Onward's HubSpot.

**Expected time.** Under an hour.

**What continues.** The full closed loop, against the local system of record.
Every meaningful action is already written to it idempotently; connecting a real
CRM makes the same writes go to both and the local copy becomes the
reconciliation source rather than dead weight. A second reconcile currently
reports only "unchanged", which is the proof that connecting a CRM will not
duplicate anything.

---

## 3. No approved email provider

**What is blocked.** Sending. Nothing has been sent and nothing can be.

**Why.** No Microsoft 365 or SendGrid credential is configured, and there is
deliberately no code path that marks a message sent without a provider having
accepted it.

**What it takes.** Either Microsoft Graph application permissions
(`Mail.Send`, consented by an Onward tenant administrator) or a SendGrid API
key, plus a sending domain with SPF, DKIM and DMARC aligned.

**Who.** Onward's Microsoft 365 administrator.

**Expected time.** A day, mostly domain authentication.

**What continues.** Composition, the refusal rules, approval, and the whole
pipeline behind it. Messages stop at approval, which is where they should stop
until a person has read what this engine writes.

**A deliberate constraint, not a blocker.** Even with a provider connected,
approval stays manual until response rates are measured. Turning on unattended
sending is a commercial decision, and it is Mark's.

---

## 4. No contact data source

**What is blocked.** Reaching a named person. The engine identifies likely
*roles* from the archetype ("Managing Director", "Finance Director") and
refuses to invent a name or guess an email pattern.

**Why.** No enrichment provider is connected, and LinkedIn is blocked.

**What it takes.** A contact source Onward is licensed to use, or contacts
supplied from Onward's own records — the latter is better evidence and comes
with a lawful basis attached.

**Who.** Mark.

**Expected time.** Immediate for existing contacts.

**What continues.** Research, scoring, hypotheses, propositions and the
pipeline. In the last run this was the single binding constraint on outreach:
every composition was refused with `no-address`.

---

## 5. Onward's commercial parameters are not supplied

**What is blocked.** Any pipeline number leaving this system.

**Why.** No rate card, no delivery capacity figure, no margin targets, no
minimum deal size. The deal ranges in `src/config/msp/onward.ts` are marked
`inferred` and captioned "planning placeholder from typical UK MSP economics,
NOT an Onward figure".

**What it takes.** A rate card or day rate, consultants available, minimum deal
size, and target gross margin per service line.

**Who.** Mark.

**Expected time.** An hour.

**What continues.** Everything, with every value carrying its caveat. The
opportunity values the engine currently produces are positioned inside those
placeholder ranges by headcount — £129,000 for a 104-person firm's managed IT,
£44,640 for an 18-person consultancy's Microsoft estate. Those are defensible
shapes built on undefensible inputs, and they must not be quoted.

---

## 6. Onward's own profile is second-hand

**What is blocked.** Making a verified claim about Onward in outreach.

**Why.** `onwardps.co.uk` cannot be fetched. The profile was built from
web-search result summaries — real, and corroborated by a second independent
search pass, but still snippets *about* the site rather than the site. Every
proof point is `usableInOutreach: false`.

**What it takes.** Either egress to onwardps.co.uk (blocker 1) or Onward
confirming the claims directly, with a named reference customer for each.

**Who.** Mark.

**Expected time.** Under an hour.

**What continues.** Everything. The engine composes without proof points; it
simply has less to say.

---

## What is NOT blocked

Worth stating, because a blockers page can read as though nothing works:

- The full loop runs, end to end, and its end-to-end test passes.
- A second cycle duplicates nothing: same accounts, same hypotheses, same
  opportunities, and a CRM reconcile reporting only "unchanged".
- Rejection works. In the last run 12 of 16 hypotheses were rejected with
  reasons, and every composition was refused with a stated rule.
- The recovery rules fire, are recorded, and correctly classify this
  environment's failures as `egress-blocked` — which degrades and continues
  rather than retrying, because a network policy is not transient.
- Governance works: opportunities above £100,000 escalate once, with context,
  evidence, a recommendation, an expected value and a proposed action.
