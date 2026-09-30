# Replit Agent prompt — populate the SaleSonic personas app

Paste everything below this line into the SaleSonic Repl’s Agent.

---

Populate this app with the SaleSonic demonstration dataset below. This is real
demo content, not placeholder text: load it exactly as written. Do not summarise,
paraphrase or replace any quoted sentence with generic sales copy — the specific
names, figures and quotes are the whole point of the demo.

Build three role-specific dashboards (Salesman, Sales Manager, Sales Director /
Executive) over one shared set of deal data. Each dashboard is designed so the person can actually control business activity that day, not just look at reports.

## Commercial DNA (the foundation — entered once, calibrates everything)

The single source of truth that calibrates every forecast, recommendation, score and report to the business. Entered once by leadership.

- Annual/quarterly targets: £4.2m annual, phased by quarter
- Products/services & average deal size: Enterprise Rollout £250–600k, Contact Centre £150–350k
- Compensation plans: Quota, accelerators, commission structure
- Sales methodology: MEDDIC (primary) + Challenger elements
- Ideal Customer Profile: Enterprise retail, utilities, financial services
- Average sales cycle: 6–9 months
- Target margins: 22–28%
- Geographic coverage/territories: UK national, focus North & London
- Historical win rates: Overall 28%, New logo 18%, Existing 41%
- Stage conversion rates: Discovery → Proposal 62%, Proposal → Close 34%
- Data sources: CRM, finance system, HR/comp plans, sales playbook, leadership input.

## The six deals

6 deals (one per client) with realistic history, contacts, stages, values and close dates so the SaleSonic LLM has rich context to work with.

| Client | Account Manager | Deal Name | Value | Stage / Status | Close Date | Probability |
|---|---|---|---|---|---|---|
| Coors | Ralph Kelly | Enterprise Stores Rollout | £600K | Won | 15 Jun 2025 | 100% |
| Morrison | Andrew Fleming | Contact Centre Modernisation | £350K | Lost | 28 Apr 2025 | 0% |
| Barclays | Brian Greenbank | Software Upgrade – Core Banking | £500K | Winning (late stage) | 15 Oct 2026 | 80% |
| Asda Stores | Sean Kearney | Enterprise Stores Rollout Phase 2 | £250K | Winning | 30 Nov 2026 | 65% |
| TFL | Des Hunt | Contact Centre Platform | £150K | Losing / At Risk | 20 Dec 2026 | 35% |
| United Utilities | Ralph Kelly | Software Upgrade – Customer Portal | £100K | Early / Pipeline | 30 Jun 2027 | 40% |

Each deal below carries all six contact roles, its dated activity history, and one
anecdote. Attach the history as activity records against the deal, and show the
anecdote on the deal record — it is what makes the recommendations specific.

### Deal 1 – Coors | Enterprise Stores Rollout | £600K | WON (closed 15 Jun 2025)

Account Manager: Ralph Kelly

Key contacts:
- Economic Buyer (EB): Sarah Thompson – Commercial Director
- Technical Buyer (TB): Mark Davies – IT Infrastructure Lead
- User Buyer (UB): Lisa Patel – Head of Retail Operations
- Champion (Champion): Lisa Patel – Head of Retail Operations
- Influencer (Influencer): James O'Neill – Regional Ops Manager
- Approver (Approver): Sarah Thompson – Commercial Director

9-month history highlights:
- Jan 2025: Discovery call. Lisa flagged major stock-out issues across 120 stores.
- Feb 2025: Workshop – mapped current vs future process. Mark raised integration concerns with legacy POS.
- Mar 2025: Proposal presented. Sarah pushed hard on ROI and payback < 14 months.
- Apr 2025: Technical deep-dive. Mark signed off architecture after we agreed on phased API approach.
- May 2025: Commercial negotiation. Sarah asked for 8% discount + extended support. We held at 5% + free year-1 training.
- 12 Jun 2025: Final board paper approved.
- 15 Jun 2025: Contract signed.

Anecdotal information: “Lisa became our internal champion after the February workshop. She told Ralph 'If we don't fix stock accuracy before peak season, we'll lose another £2m'. That urgency drove the whole deal.”

### Deal 2 – Morrison | Contact Centre Modernisation | £350K | LOST (closed 28 Apr 2025)

Account Manager: Andrew Fleming

Key contacts:
- Economic Buyer (EB): David Crowther – Customer Experience Director
- Technical Buyer (TB): Priya Sharma – Head of Technology
- User Buyer (UB): Helen Brooks – Contact Centre Ops Manager
- Champion (Champion): Helen Brooks – Contact Centre Ops Manager (early)
- Influencer (Influencer): Tom Reid – Procurement
- Approver (Approver): David Crowther – Customer Experience Director

History:
- Sep 2024: Initial meeting – Helen described high agent attrition and poor CSAT.
- Nov 2024: Demo of new platform. Strong positive reaction from ops team.
- Jan 2025: Commercial proposal issued.
- Feb 2025: Procurement entered. Tom Reid insisted on 3-vendor RFP.
- Mar 2025: We came second on price to a lower-cost competitor.
- Apr 2025: David decided to go with the cheaper option "to protect margin this year".

Anecdotal information: “Helen was our champion until Procurement took control. She later told Andrew 'I still think your solution was better, but the CFO only looked at year-1 cost'.”

Loss reason: Price – came second to a lower-cost competitor after Procurement forced a 3-vendor RFP.
Loss learning: Procurement took control late. Ensure Economic Buyer stays engaged earlier next time.

Competitive: Lower-cost competitor — We were second on price — Lost

### Deal 3 – Barclays | Software Upgrade – Core Banking | £500K | Winning (close 15 Oct 2026)

Account Manager: Brian Greenbank

Key contacts:
- Economic Buyer (EB): Rachel Forsyth – Managing Director, Technology
- Technical Buyer (TB): Amir Khan – Chief Architect
- User Buyer (UB): Sophie Lane – Head of Retail Banking Ops
- Champion (Champion): Sophie Lane – Head of Retail Banking Ops
- Influencer (Influencer): Michael Grant – Risk & Compliance
- Approver (Approver): Rachel Forsyth – Managing Director, Technology

History (last 9 months):
- Jan 2026: Discovery – Sophie highlighted regulatory pressure on legacy system.
- Mar 2026: Architecture workshop with Amir. Positive technical feedback.
- May 2026: Business case presented. Rachel asked for clearer risk reduction narrative.
- Jul 2026: Security & compliance review passed (Michael Grant supportive).
- Aug 2026: Commercial terms agreed in principle.
- Sep 2026: Final internal governance in progress.

Anecdotal information: “Sophie told Brian 'If we miss the FCA timeline I'll be the one explaining it to the Board'. That personal risk is driving her sponsorship.”

Current blocker: Final internal governance in progress

### Deal 4 – Asda Stores | Enterprise Stores Rollout Phase 2 | £250K | Winning (close 30 Nov 2026)

Account Manager: Sean Kearney

Key contacts:
- Economic Buyer (EB): Paul Rigby – Retail Transformation Director
- Technical Buyer (TB): Nadia Hussain – IT Delivery Lead
- User Buyer (UB): Karen White – Store Operations Director
- Champion (Champion): Karen White – Store Operations Director
- Influencer (Influencer): Store Regional Managers – Regional Management
- Approver (Approver): Paul Rigby – Retail Transformation Director

History:
- Mar 2026: Phase 1 success referenced. Karen pushing hard for Phase 2 before Black Friday.
- May 2026: Scope workshop completed.
- Jul 2026: Proposal accepted in principle.
- Aug 2026: Budget confirmation delayed by internal re-forecast.
- Sep 2026: Budget now unlocked. Contract red-lines in legal.

Anecdotal information: “Karen said 'Phase 1 saved us 14 minutes per stock take. Multiply that by 600 stores and the business case writes itself'.”

Current blocker: Legal red-lines are the only blocker

### Deal 5 – TFL | Contact Centre Platform | £150K | Losing / At Risk (close 20 Dec 2026)

Account Manager: Des Hunt

Key contacts:
- Economic Buyer (EB): James Okafor – Director of Customer Service
- Technical Buyer (TB): Elena Petrova – Digital Platforms Lead
- User Buyer (UB): Chris Morgan – Contact Centre Manager
- Champion (Champion): Chris Morgan – Contact Centre Manager (weakening)
- Influencer (Influencer): Finance Business Partner – Finance
- Approver (Approver): James Okafor – Director of Customer Service

History:
- Feb 2026: Strong start – Chris very engaged.
- Apr 2026: Technical proof-of-concept successful.
- Jun 2026: Budget freeze announced across TFL.
- Aug 2026: Deal stalled. James now prioritising cost reduction over transformation.
- Sep 2026: Competitor offering 20% lower price entered discussions.

Anecdotal information: “Chris told Des last week 'I still want your platform, but James has been told to cut 12% from the cost base. I'm losing the argument'.”

Current blocker: Budget freeze, 12% cost-cut mandate, competitor at 20% lower price

Competitive: Unnamed competitor — 20% lower price — Live threat

Risk flags: Champion weakening; Budget pressure; Competitor price attack; Economic Buyer engagement weak

### Deal 6 – United Utilities | Software Upgrade – Customer Portal | £100K | Early Pipeline (close 30 Jun 2027)

Account Manager: Ralph Kelly

Key contacts:
- Economic Buyer (EB): Fiona McLeod – Customer Director
- Technical Buyer (TB): Raj Patel – Digital Delivery Manager
- User Buyer (UB): Amy Collins – Online Services Lead
- Champion (Champion): Amy Collins – Online Services Lead
- Influencer (Influencer): Regulatory Affairs – Regulatory Affairs
- Approver (Approver): Fiona McLeod – Customer Director

History:
- Jun 2026: First meeting – Amy described poor self-service adoption.
- Jul 2026: Discovery workshop.
- Aug 2026: High-level proposal sent.
- Sep 2026: Waiting for internal prioritisation meeting in October.

Anecdotal information: “Amy said 'Customers are still ringing us for things they should be able to do online. Every call costs us £6.40'.”

Current blocker: Waiting for internal prioritisation meeting in October

## The three dashboards

### 1. Salesman Dashboard

Who: Ralph Kelly, Sean Kearney, Des Hunt, Brian Greenbank, Andrew Fleming
Purpose: Help the individual seller prioritise and execute the right actions on their own deals today.
Lens: The individual seller logs in and immediately sees only their own deals, scored and prioritised against the company's Commercial DNA (targets, methodology, margin expectations, etc.).

Sections:
- **My Pipeline at a Glance** — List of their deals with current stage, value, probability, close date and MEDDIC health score.
- **Today's Priorities** (top of screen, action-focused) — Ranked list of 3–5 concrete next actions, generated from the deal history and Commercial DNA.
- **Deal Health & Risks** — Traffic-light MEDDIC scores + specific gaps (e.g. "Economic Buyer engagement weak on TFL").
- **Quick Actions** — One-click: Draft email, Log activity, Update probability, Request Manager / War Room review.
- **Recent Activity Feed** — Last meetings, emails and notes so the seller has full context without leaving the screen.

Today’s Priorities (show these verbatim, in this order):
1. Des Hunt — TFL £150K – At Risk: “Re-engage James Okafor today – offer phased commercial option to counter 12% cost-cut pressure. Champion Chris is weakening.”
2. Sean Kearney — Asda £250K: “Send revised contract to legal and ask Karen White to escalate to Paul Rigby if no response by EOD.”
3. Brian Greenbank — Barclays £500K: “Confirm final governance date with Sophie Lane – reference her FCA personal risk comment from May.”
4. Ralph Kelly — United Utilities £100K: “Request introduction from Amy Collins to Fiona McLeod before October prioritisation meeting.”

Per-deal recommendations (show against each deal):
- Barclays £500K (Brian) – High MEDDIC score, strong Champion (Sophie), clear Economic Buyer urgency around FCA deadline.
  → “Book final commercial call this week. Suggested talk track focused on risk reduction for Rachel. Probability now 80% – push for signature before internal governance slips.”
- Asda £250K (Sean) – Good momentum, strong Champion (Karen).
  → “Legal red-lines are the only blocker. Send the revised contract today and ask Karen to escalate to Paul if needed. Target close 30 Nov.”
- TFL £150K (Des) – At risk. Champion weakening, budget pressure, competitor price attack.
  → “Deal is losing. Immediate action: re-engage James with a revised commercial option (lower year-1 cost + phased rollout) or recommend graceful exit to protect forecast accuracy.”
- United Utilities £100K (Ralph) – Early stage.
  → “Keep warm. Next step: get Amy to introduce you to Fiona before the October prioritisation meeting.”

One-click actions: Draft email, Update MEDDIC scorecard, Log decision, Request War Room review, Log activity, Update probability, Request Manager review.

What this person controls from here: Daily prioritisation, next-best actions, deal progression and forecast accuracy on their own book.

### 2. Sales Manager Dashboard

Who: Looks across the whole team – Ralph, Andrew, Brian, Sean, Des
Purpose: Coach the team, protect the forecast, and remove blockers.
Lens: The manager sees the whole team's pipeline with coaching signals and risk flags.

Sections:
- **Team Pipeline & Forecast Summary** — Total pipeline, weighted forecast, coverage ratio vs target, and confidence score – all calibrated to Commercial DNA.
- **Today's Priorities (manager-level)** — Manager-level actions for today.
- **Rep Performance & Coaching Signals** — Heatmap of each rep's deals by stage and risk. Flags who needs support (e.g. Des on TFL).
- **At-Risk & Winning Deals** — Clear list of deals that need intervention or acceleration.
- **Team Activity & Momentum** — Meetings held, next steps completed, forecast changes in the last 7 days.

Today’s Priorities (show these verbatim, in this order):
1. “Deal Inspection needed on TFL (£150K) – probability dropped, champion fading. Book 15-min coaching call with Des today.”
2. “Barclays (£500K) and Asda (£250K) are both in final stages – help Brian and Sean clear remaining governance/legal blockers this week.”
3. “Morrison loss (£350K) learning: ensure Economic Buyer stays engaged earlier. Share insight with team in weekly meeting.”
4. “Pipeline gap: need another £180K of high-confidence opportunities this quarter.”

What the dashboard highlights:
- Pipeline coverage and forecast confidence: Calibrated to the team's target.
- Coors £600K – Already won: Positive momentum contribution.
- Morrison £350K – Lost: Learning point: "Procurement took control late. Ensure Economic Buyer stays engaged earlier next time."
- TFL £150K – Red flag: Low probability, champion fading. Coaching prompt for Des: "Schedule deal inspection this week. Focus on rebuilding urgency with James or de-risk the forecast."
- Barclays & Asda – Both in "Winning" zone: Manager is prompted to help remove final blockers (governance / legal).
- Overall forecast gap and suggested actions: e.g. "You need another £180K of high-confidence pipeline this quarter".

Pipeline gap: £180K of high-confidence opportunities needed this quarter.
Tools: Team-level MEDDIC heatmaps; One-click "Deal Inspection" reports.

What this person controls from here: Coaching focus for the day, forecast hygiene, resource allocation, and early intervention on slipping deals.

### 3. Sales Director / Executive Dashboard

Who: Board/leadership level
Purpose: Control overall business performance, risk and big decisions.
Lens: Board-level lens. Focuses on risk, coverage, momentum and big calls.

Sections:
- **Calibrated Forecast & Revenue Gap** — Won + weighted pipeline vs target. Clear revenue gap and coverage ratio shown. Revenue gap vs target and pipeline coverage ratio.
- **Today's Priorities (executive)** — Executive decisions required today.
- **Strategic Deal Watchlist** — Top 5 deals by value/risk with one-line status and recommended executive action.
- **Momentum & Trends** — Win rate, average sales cycle, forecast accuracy trend over the last 9 months.
- **War Room & Decision Log** — Quick access to pressure-test big calls and see every previous commercial decision.

Today’s Priorities (show these verbatim, in this order):
1. “TFL £150K is the main downside risk – decide today whether to de-commit or support a revised commercial approach.”
2. “Barclays £500K is the largest near-term upside – confirm it remains on track for mid-October close.”
3. “Run War Room on TFL and Barclays this week for a single logged recommendation.”
4. “Morrison loss highlights a process gap (late Procurement involvement) – decide if methodology coaching is required across the team.”

Calibrated forecast (use these exact bands and figures):
- Won: £600K (Coors)
- High confidence (80%+): Barclays £500K → weighted £400K
- Medium: Asda £250K → weighted £160K
- Low / at risk: TFL £150K → heavily discounted
- Early: United Utilities £100K → low weighting

Revenue gap vs target and pipeline coverage ratio.

Executive dashboard forecast summary:
- Closed Won: £600K (Coors)
- High confidence: Barclays £500K (80%)
- High confidence: Asda £250K (65%)
- At risk: TFL £150K (35%)
- Early: United Utilities £100K

War Room: War Room recommendation on the two biggest live deals (Barclays and TFL). Six advisory personas review the deal → single logged recommendation.
Example logged recommendation: “Barclays: accelerate to close in October – risk of governance delay is higher than competitive risk. TFL: protect forecast accuracy – move to 20% or de-commit”

Board-ready narrative: “Two deals (Barclays + Asda) are on track to land before year-end. TFL is the main downside risk. Morrison loss highlights need for earlier Economic Buyer lock-in.”

What this person controls from here: Overall forecast commitment, major deal strategy, resource focus, and board-level narrative.

### How the three dashboards work together

- Salesman → Executes the right actions on individual deals today.
- Sales Manager → Coaches, unblocks and protects the team forecast today.
- Sales Director → Makes the big calls and controls overall business trajectory.

All three views stay calibrated to the same Commercial DNA and the same underlying deal data, so everyone is working from one version of the truth.

## Why the recommendations are specific, not academic

Because the data gives the model:
- Clear contacts (EB / TB / UB / Champion etc.)
- Nine months of meeting notes and correspondence
- Specific anecdotes ("Lisa said we'll lose another £2m…", "Sophie is personally on the hook for the FCA deadline…")
- Realistic stage history and competitive notes

SaleSonic can generate recommendations such as:
- “Call Sophie before Friday – reference the FCA timeline she mentioned in May.”
- “Des – James is under 12% cost-cut pressure. Offer a phased commercial option or recommend forecast reduction.”
- “Sean – Karen's 14-minute stock-take saving is your strongest proof point with Paul.”

That is the difference between generic advice and calibrated, deal-specific next actions.

## Capability catalogue (reference section — what SaleSonic does)

### 1. Commercial DNA Setup (Foundation – done once)

What it does: Creates the single source of truth that calibrates every forecast, recommendation, score and report to your business.

Info needed:
- Annual/quarterly revenue targets
- Services / products sold and typical deal sizes
- Compensation plans (quotas, accelerators, commission structure)
- Chosen sales methodology (MEDDIC, Challenger, SPIN, Sandler or mix)
- Ideal Customer Profile, average sales cycle, target margins
- Geographic coverage / territories
- Historical win rates (overall + by segment / new vs existing)

Data sources: CRM, finance system, HR/comp plans, sales playbook, leadership input.

Notes:
- If win rates look unrealistically high → system flags "possible lack of competitive deals or weak pipeline quality".
- If geographic coverage is thin in a territory → flags "new territory risk / under-penetration".

### 2. Calibrated Forecasts

What it does: Produces pipeline coverage, forecast confidence, revenue gap and momentum – all adjusted to your Commercial DNA.

Info needed:
- Current pipeline (deals, values, stages, close dates, probabilities)
- Historical conversion rates by stage
- Win rates by segment, product, territory, deal size
- Seasonality and target phasing

Data sources: CRM opportunity data + historical closed-won/lost + Commercial DNA targets.

Notes:
- High win rates + low competitive losses → "May indicate not enough competitive deals or sandbagging".
- Large pipeline stuck at top of funnel → "Early-stage bloat – conversion risk high, coverage overstated".

### 3. Methodology-Scored Deal Inspections (MEDDIC scorecard etc.)

What it does: Scores every live deal against the chosen methodology and highlights gaps.

Info needed:
- Deal contacts (Economic Buyer, Technical Buyer, User Buyer, Champion, Influencer, Approver)
- Meeting notes, emails, call summaries
- Competitive situation, decision process, metrics, pain, budget, timeline
- Current stage and next steps

Data sources: CRM contacts & activities, uploaded documents, email/calendar integration, manual notes.

Notes:
- Missing Economic Buyer or weak Champion is immediately flagged.
- Stuck deals at top of funnel show low scores on Metrics / Decision Criteria / Paper Process.

### 4. RFP Analyser – Go/No-Go Verdicts

What it does: Reads an RFP and gives a clear Go / No-Go recommendation with rationale.

Info needed:
- Full RFP document (PDF, DOCX, TXT)
- Your capabilities, win themes, commercial constraints (from Commercial DNA)
- Historical win rates on similar RFPs

Data sources: Uploaded RFP + Commercial DNA + past RFP outcomes in CRM.

### 5. Document Extract & Analysis

What it does: Pulls key commercial intelligence from proposals, contracts, meeting notes, board papers, etc.

Info needed:
- Any PDF / DOCX / TXT document related to a deal or opportunity.

Data sources: User upload or linked document store.

### 6. War Room (6 Advisory Personas → one logged recommendation)

What it does: Pressure-tests a major deal or decision with six different advisory lenses and produces a single, logged recommendation.

Info needed:
- Full deal history, contacts, competitive notes, commercial terms, risk factors, methodology scores.

Data sources: Everything already in the deal record + Commercial DNA.

Notes:
- Especially powerful when win rates are high (to stress-test whether the deal is truly competitive) or when pipeline is stuck (to decide accelerate vs de-commit).

### 7. Board-Ready Reports & Decision Log

What it does: Generates executive narratives and permanently logs every major commercial decision.

Info needed:
- Forecast data, deal inspections, War Room outcomes, targets, momentum trends.

Data sources: All of the above + Decision Log entries.

### 8. Forecast & Analysis Planner (9 frameworks) + Strategy Engine

What it does: Scenario planning, what-if analysis, milestone & campaign planning.

Info needed:
- Targets, current pipeline, historical conversion, geographic coverage, new territory plans, product mix.

Data sources: CRM + Commercial DNA + manual planning inputs.

Notes:
- Highlights "new territory" risk if coverage or historical win rates in that geography are low.
- Flags "too much pipeline not moving" when stage velocity is poor.

### 9. Role-Optimised Dashboards & Today's Priorities

What it does: Salesman / Manager / Director each see different views with concrete daily actions.

Info needed:
- All deal and activity data above, plus user role and territory assignment.

Data sources: CRM + user profile + Commercial DNA.

### 10. Executive Actions (one-click)

What it does: 15+ pre-built actions (e.g. "Inspect this deal", "Run War Room", "Generate board paper", "Update forecast confidence").

Info needed:
- Whatever the specific action requires (usually already in the system).

## Diagnostic signals SaleSonic surfaces

| Signal | What it often means | Data that triggers it |
|---|---|---|
| Win rates unusually high | Not enough competitive deals, weak qualification, or sandbagging | Closed-won vs closed-lost ratio, competitive mention rate |
| Large pipeline stuck at top of funnel | Poor qualification or slow early-stage progression | Stage age + conversion rates by stage |
| Thin geographic coverage | Under-penetrated territory or new market risk | Deals/wins by region vs target coverage |
| New territory low win rate | Learning curve or wrong ICP for that area | Win rate filtered by geography + deal age |
| High pipeline coverage but low confidence | Quantity without quality | Coverage ratio vs MEDDIC / methodology scores |
| Deals with missing EB or Champion | High risk of late-stage collapse | Contact roles on the opportunity |

Short form for the dashboard:
- Win rates unusually high → possible lack of competitive deals or weak qualification
- Large volume of pipeline stuck at top of funnel → early-stage bloat / poor conversion
- Thin geographic coverage → under-penetrated or new territory risk
- New territory low win rate → learning curve or ICP mismatch
- High coverage but low confidence → quantity without quality
- Missing Economic Buyer or Champion → late-stage collapse risk

## Data sources SaleSonic relies on

- Commercial DNA (entered once by leadership)
- CRM (opportunities, contacts, stages, activities, closed history)
- Uploaded documents (RFPs, proposals, notes)
- Email / calendar (optional integration for richer history)
- User activity inside SaleSonic (decision log, War Room outcomes)

## SaleSonic – One-Page Data Requirements Checklist

### 1. Commercial DNA (Entered once – the foundation)

| Data Item | Example / Notes | Source | Priority |
|---|---|---|---|
| Annual/quarterly targets | £4.2m annual, phased by quarter | Finance / Leadership | Critical |
| Products/services & avg deal size | Enterprise Rollout £250–600k, Contact Centre £150–350k | Product / Sales | Critical |
| Compensation plans | Quota, accelerators, commission structure | HR / Finance | High |
| Sales methodology | MEDDIC (primary) + Challenger elements | Sales Leadership | Critical |
| Ideal Customer Profile | Enterprise retail, utilities, financial services | Sales / Marketing | High |
| Average sales cycle | 6–9 months | CRM historical | High |
| Target margins | 22–28% | Finance | Medium |
| Geographic coverage/territories | UK national, focus North & London | Sales Ops | High |
| Historical win rates | Overall 28%, New logo 18%, Existing 41% | CRM | Critical |

### 2. Live Pipeline & Deal Data (Ongoing)

| Data Item | Example / Notes | Source | Priority |
|---|---|---|---|
| Opportunity name, value, close date, stage | Coors Enterprise Stores Rollout – £600k – Closed Won | CRM | Critical |
| Probability / forecast category | 80% Commit, 65% Best Case, etc. | CRM / Rep input | Critical |
| Key contacts & roles | EB, TB, UB, Champion, Influencer, Approver | CRM Contacts | Critical |
| Meeting notes & activity history | 9 months of calls, emails, workshops | CRM Activities / Email | Critical |
| Competitive information | Competitor name, price position, strengths | Rep notes / CRM | High |
| Next steps & last activity date | "Send revised contract – 12 Sep" | CRM | High |

### 3. Historical Closed Data (for calibration)

| Data Item | Example / Notes | Source | Priority |
|---|---|---|---|
| Closed Won & Closed Lost deals | Last 12–24 months with values & reasons | CRM | Critical |
| Win / loss reasons | Price, features, relationship, timing, etc. | CRM or win/loss interviews | High |
| Stage conversion rates | Discovery → Proposal 62%, Proposal → Close 34% | CRM reporting | High |
| Win rates by segment | By product, territory, deal size, new vs existing | CRM | Critical |

### 4. Documents (as needed)

| Data Item | Example / Notes | Source | Priority |
|---|---|---|---|
| RFPs | Full tender documents | Customer / Bid team | High (when active) |
| Proposals & contracts | Submitted versions | Sales / Legal | Medium |
| Meeting notes / board papers | PDF, DOCX, TXT | Reps / Leadership | Medium |

### Minimum Viable Data to make demos powerful

- Commercial DNA completed
- 6–10 live + historical deals with contacts, values, stages and 6–9 months of activity notes
- Basic win/loss history (even if only 12 months)

Once this data is loaded, the three personas (Salesman, Manager, Director) immediately produce concrete, non-academic recommendations and prioritised daily actions.

## How to use this data

- Load the 6 deals into the demo environment with the contacts, stages, values and close dates above.
- Attach the meeting notes/correspondence snippets as activity history.
- The anecdotes give the LLM concrete "human" context so recommendations become specific rather than generic.

Load these six deals → the three personas immediately look and feel different: Salesman sees concrete next moves on his deals; Manager sees coaching and risk across the team; Director sees forecast health and big-call decisions.

## Two fidelity rules

- Asda at 65% of £250K is £162.5K, but the source states £160K. Use £160K.
- TFL’s weighting is described only as “heavily discounted”. Show that label; the
  arithmetic value is £52,500.

Every name, figure and quoted sentence above must be visible somewhere in the
finished app. Do not drop content to make a layout tidier — add a section instead.
