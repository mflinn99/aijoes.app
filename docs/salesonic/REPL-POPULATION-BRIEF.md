# SaleSonic Personas Repl — Population Brief

Target app: `https://3-salesonic-personas.replit.app`

This brief is the instruction set for populating that Repl from
`SaleSonic_Data_Requirements_for_Demonstration.docx`. Everything below is
traceable to that document; nothing has been invented. The document is stored
verbatim at `docs/salesonic/SOURCE-DOCUMENT.txt`, the structured data at
`data/salesonic/salesonic-demo-data.json`, and the list of sentences that must
survive into the app at `data/salesonic/narrative-manifest.json`.

## The non-negotiable

The narrative in the document must be present in the app — not summarised, not
paraphrased into generic sales copy. 264 specific assertions are tracked, and
two commands check them:

```
npm run salesonic:verify                    # the data must carry all 264
npm run salesonic:check -- --url https://3-salesonic-personas.replit.app \
    --path / --path /salesman --path /manager --path /director
```

`salesonic:check` reports coverage per section and names every missing
sentence. It exits non-zero while any is missing, so it can be run on every
change to the Repl rather than trusted once.

## What to load

### 1. Commercial DNA (the foundation, entered once)

£4.2m annual target phased by quarter · Enterprise Rollout £250–600k, Contact
Centre £150–350k · quota, accelerators and commission structure · MEDDIC
(primary) plus Challenger elements · ICP of enterprise retail, utilities and
financial services · 6–9 month average sales cycle · 22–28% target margins ·
UK national with focus on North & London · win rates overall 28%, new logo 18%,
existing 41% · stage conversion Discovery → Proposal 62%, Proposal → Close 34%.

Every forecast, score and recommendation in the app is calibrated to this.

### 2. The six deals

| Client | Account Manager | Deal Name | Value | Stage / Status | Close Date | Probability |
|---|---|---|---|---|---|---|
| Coors | Ralph Kelly | Enterprise Stores Rollout | £600K | Won | 15 Jun 2025 | 100% |
| Morrison | Andrew Fleming | Contact Centre Modernisation | £350K | Lost | 28 Apr 2025 | 0% |
| Barclays | Brian Greenbank | Software Upgrade – Core Banking | £500K | Winning (late stage) | 15 Oct 2026 | 80% |
| Asda Stores | Sean Kearney | Enterprise Stores Rollout Phase 2 | £250K | Winning | 30 Nov 2026 | 65% |
| TFL | Des Hunt | Contact Centre Platform | £150K | Losing / At Risk | 20 Dec 2026 | 35% |
| United Utilities | Ralph Kelly | Software Upgrade – Customer Portal | £100K | Early / Pipeline | 30 Jun 2027 | 40% |

Each deal carries all six MEDDIC contact roles (Economic Buyer, Technical
Buyer, User Buyer, Champion, Influencer, Approver) with real names and job
titles, a dated activity history of four to seven entries covering up to nine
months, and one anecdote.

**The anecdotes are the point.** They are what turns a generic recommendation
into a specific one, so they must appear on screen against their deal, not be
compressed away:

- Coors — Lisa told Ralph *"If we don't fix stock accuracy before peak season, we'll lose another £2m"*.
- Morrison — Helen told Andrew *"I still think your solution was better, but the CFO only looked at year-1 cost"*.
- Barclays — Sophie told Brian *"If we miss the FCA timeline I'll be the one explaining it to the Board"*.
- Asda — Karen said *"Phase 1 saved us 14 minutes per stock take. Multiply that by 600 stores and the business case writes itself"*.
- TFL — Chris told Des *"I still want your platform, but James has been told to cut 12% from the cost base. I'm losing the argument"*.
- United Utilities — Amy said *"Customers are still ringing us for things they should be able to do online. Every call costs us £6.40"*.

### 3. The three dashboards

Each is designed so the person can actually control business activity that day,
not just look at reports.

**Salesman** (Ralph Kelly, Sean Kearney, Des Hunt, Brian Greenbank, Andrew
Fleming). Sections: My Pipeline at a Glance · Today's Priorities (top of
screen, action-focused) · Deal Health & Risks (traffic-light MEDDIC scores and
specific gaps such as "Economic Buyer engagement weak on TFL") · Quick Actions
(draft email, log activity, update probability, request Manager / War Room
review) · Recent Activity Feed. Today's Priorities are the four ranked, named
actions from the document, TFL first.

**Sales Manager** (across Ralph, Andrew, Brian, Sean, Des). Sections: Team
Pipeline & Forecast Summary · Today's Priorities (manager-level) · Rep
Performance & Coaching Signals · At-Risk & Winning Deals · Team Activity &
Momentum. Carries the Morrison learning point, the TFL red flag and coaching
prompt for Des, and the £180K high-confidence pipeline gap.

**Sales Director / Executive** (board level). Sections: Calibrated Forecast &
Revenue Gap · Today's Priorities (executive) · Strategic Deal Watchlist ·
Momentum & Trends · War Room & Decision Log. The forecast bands are the
document's own: Won £600K (Coors); high confidence Barclays £500K → weighted
£400K; medium Asda £250K → weighted £160K; low / at risk TFL £150K → heavily
discounted; early United Utilities £100K → low weighting.

The board-ready narrative reads: *"Two deals (Barclays + Asda) are on track to
land before year-end. TFL is the main downside risk. Morrison loss highlights
need for earlier Economic Buyer lock-in."*

All three views stay calibrated to the same Commercial DNA and the same
underlying deal data, so everyone is working from one version of the truth.

### 4. Capability catalogue, diagnostic signals and the checklist

The ten numbered capabilities (Commercial DNA Setup through Executive Actions,
including War Room's six advisory personas resolving to one logged
recommendation), the six diagnostic signals with their meanings and triggers,
the four-part data requirements checklist with sources and priorities, and the
minimum viable data list all load as reference content. They are what the demo
uses to explain *why* the recommendations are specific.

## Two notes on fidelity

- Asda at £250K and 65% weights to £162.5K, but the document states £160K. The
  document wins; the dataset records £160K and the test pins it.
- TFL's weighting is described only as "heavily discounted". £52,500 (35%) is
  stored as the arithmetic value, with "heavily discounted" kept as the label
  the screen should show.

## Order of work in the Repl

1. Load Commercial DNA.
2. Load the six deals with contacts, values, stages, close dates, probabilities.
3. Attach the activity history and anecdotes to each deal.
4. Wire the three dashboards, each with its own Today's Priorities.
5. Add the capability catalogue, diagnostic signals and checklist.
6. Run `salesonic:check` against the deployed URL and close every gap it names.
