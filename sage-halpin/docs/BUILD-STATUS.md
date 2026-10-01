# Build status

29 September 2026.

## Complete and verified in the build environment

- **Functionality carried across**: every Sixonic screen, action and API
  contract (see `MAPPING.md`). The demo video modal was removed; it was not used.
- **Rebrand**: name, wordmark, symbol, favicon, social image, palette (ink,
  ivory, brass, slate), type (Unbounded and Figtree, both rounded), copy and metadata. The
  brand check finds no Sixonic branding and no "roster" in shipped files.
- **People and AI**: agents are named by role and tagged "AI agent"; the chair
  recommends a resolution and the person decides; the disclosure is in the footer.
- **AI on Azure**: Claude on Microsoft Foundry through `@anthropic-ai/foundry-sdk`,
  authenticated with Microsoft Entra ID (the managed identity) or, optionally, a
  Key Vault-held key.
- **Hardening**: input validation and size limits on both AI endpoints,
  per-client rate limits, security headers including a content security policy,
  no request bodies in logs, and a production guard against the mock provider.
- **Tests**: 31 passing (API contracts for both endpoints, all six challenges,
  feedback rounds, validation, rate limiting, security headers, AI
  configuration, brand).
- **Browser walkthrough** (Chromium, mock provider): home, workspace, boardroom
  session, full analysis through lock, decision log, and phone width. No page or
  console errors, including under the content security policy.
- **Container**: the image builds (tests and the brand check run inside the
  build) and starts in production mode as a non-root user. It refuses to start
  with the mock provider.
- **Infrastructure**: `infra/main.bicep` compiles and lints clean with Bicep
  0.47. The deploy script passes a shell syntax check and the workflow passes
  actionlint.

- **Board assembly and board questions** (1 October 2026): onboarding of the
  organisation and its real people (name, role, email, phone, expertise, CV);
  a persona for each of the six agents, which the lead can seat and brief; board
  questions that email (or hand the lead) a questionnaire link for each person;
  the respondent's questionnaire; and the decision seen as people only, shadow
  board only, and people and agents together. 20 API tests cover creating,
  inviting (manual and emailed), answering, access control, link replacement,
  closing, the three views, deletion, retention and rate limits. A Chromium
  walkthrough ran the whole flow (lead and a respondent on a phone-width
  screen) with no page errors. Not yet run against real Azure Table Storage or
  Azure Communication Services, which need a subscription.

- **Decision modes, agent development and horizon scanning** (1 October 2026):
  the chair chooses per question whether people, agents or both decide
  (collaborative: two rounds, a challenge round and a chair-set weighting);
  agents are educated by the chair and learn from feedback, outcomes, study and
  horizon scanning, with every proposed lesson held for approval; a scheduled
  scanner reads feeds and searches the web, keeps signals and maintains the
  landscape briefing agents read. 18 more API tests (70 in all), including feed
  parsing, private-address refusal and prompt contents. A Chromium walkthrough
  covered all of it. Not yet run against real feeds, real web search or real
  Claude output (no network or credentials in the build environment).

- **Website**: `site/` (landing page and demo) serves correctly as a static
  site, with relative links so it works both at the GitHub Pages address and at
  www.sentinel8.ai. The brand check covers it.

## Not yet verified

- **Real Claude output.** No Foundry deployment or Claude API key was
  available, so every test used the mock provider. The prompts, board truths and
  output formats are unchanged, but the model is: Sixonic used GPT-5.1 and
  GPT-4.1 at set temperatures, and the new default, `claude-opus-5-5`, takes no
  temperature. Model reasoning ("thinking") counts against the token limit, so
  limits were raised; answer length is still governed by the prompts' own rules
  ("maximum 4 sentences"). Check answer length and the JSON replies in the first
  staging run.
- **A real Azure deployment.** The template compiles against Azure's resource
  schemas, but it has not been applied to a subscription.
- **The website on its domain.** GitHub Pages and the DNS record still need
  setting up (`HOSTING.md`).
- **The Foundry role** needed for managed-identity access (BLOCKERS).

## Changes in behaviour, by design

- Invalid input now gets a 400 (it was either accepted or produced a 500).
- Model failures return 502, and a model refusal returns 422 with a request to
  rephrase (both were 500). The web app shows its existing error messages.
- Too many sessions from one client get a 429, with its own message on the
  analysis page.
- Persona colours in the chat use the same legible colours as the rest of the
  app (three of the originals were near-invisible pale tints on the light
  background).

## Departures from the build instruction

The instruction assumed Sixonic might have a database, sign-in and multi-tenant
data. It has none, so keeping its functionality means none were added:
no PostgreSQL, no Entra sign-in for users, no audit chain, no pnpm monorepo. Azure
Front Door and Application Insights are not provisioned; the runbook says when to
add them. These are in `BACKLOG.md`.
