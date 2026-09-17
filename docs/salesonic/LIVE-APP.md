# SaleSonic Personas — live app and how to re-check it

Built app: `https://replit.com/@mflinn99/MagnificentSubtleFact`
Published at: `https://magnificent-subtle-fact.replit.app`

Narrative coverage at hand-off: **264/264 (100%)**, verified by reading the app's
own source files rather than trusting the build.

## Re-checking the live app

```
npm run salesonic:check -- --url https://magnificent-subtle-fact.replit.app \
    --path / --path /deals --path /reference --path /capabilities \
    --path /data-requirements
```

The app is client-rendered, so a plain HTTP fetch under-reports: the pages
arrive as an empty shell and the text is filled in by JavaScript. For a true
reading, save the rendered DOM of each screen (browser → Save page, or copy the
visible text) and pass those files instead:

```
npm run salesonic:check -- --file dumps/salesman.html --file dumps/manager.html \
    --file dumps/director.html --file dumps/capabilities.html
```

`data/salesonic/repl-content-snapshot.txt` is the verified content as it stood
at hand-off, kept so a later check can be compared against a known-good state:

```
npm run salesonic:check -- --file data/salesonic/repl-content-snapshot.txt
```

## What the check will not tell you

Coverage counts sentences, not layout. Two failures it passed straight through
during this build, both caught by reading the screen instead:

- The three-dashboard summary lines were all present in the code but the footer
  showed only the one matching the selected role, so a viewer ever saw one.
- The Director's revenue gap and coverage ratio figures were dropped while the
  sentence naming them stayed, so the check read green on a worse screen.

Treat 100% as "nothing is missing", not as "the screen is right".

## Content in the app that is not from the source document

Inferred by the build, reasonable for a demo, but not written by the author:

- Per-deal MEDDIC traffic-light ratings (Green / Amber / Red).
- Deal gaps: "No Economic Buyer" (Morrison), "Metrics unclear" (Asda),
  "Champion not tested" (United Utilities).
- "Confidence Score: Medium" on the manager view.

Everything else on screen traces to the document. Earlier drafts also contained
outright fabrications — invented Today's Priorities on all three dashboards, a
fictional "TFL 20% Discount Request" War Room with made-up advisory positions,
and invented metrics (7.2 month cycle, +92% forecast accuracy, 24 meetings).
All were removed. If content goes missing again, check for invented filler
replacing it rather than assuming an empty section.

## Method that worked

Send one change at a time and read the files back before sending the next. A
batch of prompts queues against the in-flight turn and is silently dropped, and
the Agent fills the resulting gaps with plausible invented content.
