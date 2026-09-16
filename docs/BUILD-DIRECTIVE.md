CLAUDE CODE BUILD DIRECTIVE
AIGoGo MetaMSP — Automated Land & Expand Engine

You are building a production-grade AIGoGo Group capability that turns a company name or website URL into a continuously improving commercial and operational opportunity engine for MSPs.

This is not a reporting dashboard and not a collection of loosely connected applications.

The required end state is:

A user enters a company name or URL.
The platform learns the company.
It identifies credible ways to increase turnover, reduce cost, improve operations, optimise technology and supply chain, and expand the MSP relationship.
Every sufficiently qualified recommendation has a START button.
START converts the recommendation into an executable agent workflow using relevant AIGoGo Group capabilities.
The system monitors the outcome, measures realised value, learns from execution and continuously finds the next opportunity.

The core commercial loop is:

LAND → LEARN → IDENTIFY → QUANTIFY → START → EXECUTE → MEASURE → EXPAND → REPEAT

This should become a central JoJo / MetaMSP orchestration capability.

1. PRIMARY OUTCOME

Build a working MVP that can accept either:

- company name
- company URL/domain

and return a structured company analysis with three primary opportunity classes:

MAKE MORE
Opportunities to increase revenue, turnover, pipeline, customer value, sales conversion, margin, market reach or recurring revenue.

SPEND LESS
Opportunities to reduce supplier spend, technology cost, licence cost, cloud spend, process cost, procurement leakage, duplicated tooling, manual labour or operational inefficiency.

MSP EXPAND
Opportunities for the MSP serving that customer to legitimately increase recurring revenue, introduce additional managed services, improve the account or sell relevant services.

Every opportunity must have:

- title
- description
- evidence
- source/evidence references
- estimated annual financial value
- estimated implementation cost where possible
- confidence score
- effort score
- time-to-value
- risk level
- dependencies
- AIGoGo capabilities applicable
- required integrations
- recommended execution playbook
- current execution status
- START availability
- realised value once executed

The platform must distinguish clearly between:

1. facts
2. inferred facts
3. hypotheses
4. recommendations
5. executable actions

Never fabricate certainty.

2. USER EXPERIENCE

The initial user journey must be extremely simple.

Landing screen:

Enter a company name or website

Field examples:

claritas-solutions.co.uk

or

Claritas Solutions

Primary CTA:

ANALYSE COMPANY

Once submitted, show progressive analysis rather than leaving the user waiting on a blank screen.

Suggested analysis stages:

1. Identifying company
2. Building company profile
3. Analysing market
4. Analysing customers and propositions
5. Analysing competitors
6. Assessing sales/growth opportunities
7. Building supply-chain hypothesis
8. Assessing technology estate
9. Assessing cost optimisation
10. Assessing MSP expansion opportunity
11. Building prioritised opportunity plan

The resulting main page should have three large financial cards:

MAKE MORE
Estimated opportunity: £X

SPEND LESS
Estimated opportunity: £Y

MSP EXPAND
Potential additional MSP ARR: £Z

Below this show ranked opportunities.

Each opportunity card should contain:

- opportunity
- estimated value
- confidence
- effort
- time-to-value
- reason
- recommended next action
- START button

Example:

Dormant Customer Reactivation
Potential: £142,000 revenue
Confidence: 84%
Effort: Medium
Time to value: 30–60 days

184 historic/dormant customer records may represent a reactivation opportunity.

[VIEW EVIDENCE] [START]

3. BUILD THE COMPANY DIGITAL TWIN

Create a canonical Company Digital Twin schema.

This must be extensible and become the persistent company knowledge layer.

Minimum structure:

CompanyTwin {
  id
  legalName
  tradingNames[]
  domain
  urls[]
  companyNumber
  status
  incorporationDate
  headquarters
  locations[]
  sectors[]
  industries[]
  sicCodes[]
  employeesEstimate
  turnoverEstimate
  growthEstimate
  ownership
  directors[]
  keyPeople[]
  products[]
  services[]
  customerSegments[]
  valuePropositions[]
  markets[]
  competitors[]
  partners[]
  technologyEstate[]
  softwareEstate[]
  cloudEstate[]
  cyberIndicators[]
  suppliers[]
  supplyChain[]
  knownContracts[]
  estimatedSpendCategories[]
  salesChannels[]
  marketingChannels[]
  crmIndicators[]
  recruitmentSignals[]
  strategicSignals[]
  financialSignals[]
  operationalSignals[]
  externalEvents[]
  knownMSPRelationship
  currentMSPServices[]
  dataSources[]
  confidenceByField{}
  lastUpdatedAt
}

Every populated field should where practicable preserve:

- value
- source
- timestamp
- confidence
- method: observed / inferred / user supplied / connected-data

Do not simply overwrite conflicting facts. Preserve provenance.

4. BUILD THE COMPANY LEARNING ENGINE

The system must learn the company from public and authorised sources.

Initial public-information discovery should support:

- company website
- Companies House where available
- search engine results
- public business profiles
- job listings
- LinkedIn/public employee indicators where lawful and technically available
- press/news
- product/service pages
- customer case studies
- partner pages
- technology indicators
- market/category information
- competitor websites
- supplier references
- public filings
- public procurement information
- public pricing where available

Design the ingestion layer so connected systems can be added later without changing the Company Twin contract.

Expected future connectors include:

- Microsoft 365
- CRM
- PSA
- RMM
- accounting
- bank transaction feeds
- procurement systems
- licence portals
- Azure
- AWS
- telecoms
- HR systems
- customer support
- ERP
- supplier portals

Create a connector interface now even if all integrations are not implemented.

Example:

interface CompanyDataConnector {
  id: string
  name: string
  category: string
  authType: string
  discover(): Promise<DiscoveryResult>
  fetch(companyId: string): Promise<SourceRecord[]>
  normalise(records: SourceRecord[]): Promise<NormalisedRecord[]>
}

5. TOLERON-STYLE ANALYSIS ENGINE

Use the strongest existing Toleron concepts and patterns available in the repository/group infrastructure.

Do not duplicate existing capability unnecessarily.

First inspect the codebase and any accessible group repositories or service definitions for:

- Toleron
- SaleSonic
- ListeningPost
- SourcingAI
- Buyonic
- GrothOS
- Sixonic
- Strata / MetaMSP
- Onward
- JoJo
- other relevant AIGoGo capabilities

Build an internal capability registry.

Example:

Capability {
  id
  name
  type
  description
  supportedActions[]
  apiEndpoint
  authMethod
  maturity
  executionMode
  requiredInputs[]
  outputs[]
  owner
  health
}

The user should not have to understand the individual opcos.

JoJo chooses capabilities behind the scenes.

The system should behave as a unified AIGoGo capability mesh.

6. BUILD THE OPPORTUNITY GRAPH

Create a canonical Opportunity entity.

Opportunity {
  id
  companyId
  category: MAKE_MORE | SPEND_LESS | MSP_EXPAND
  subcategory
  title
  summary
  problem
  evidence[]
  assumptions[]
  reasoningSummary
  financialModel
  estimatedAnnualValue
  implementationCost
  netBenefit
  roi
  confidence
  effort
  risk
  timeToValue
  dependencies[]
  capabilities[]
  playbookId
  executionReadiness
  executionStatus
  approvalRequirements[]
  owner
  startedAt
  completedAt
  realisedValue
  realisedValueEvidence[]
}

Create a scoring model.

Initial prioritisation formula should consider:

- financial value
- confidence
- effort
- time-to-value
- execution readiness
- risk
- strategic relevance
- MSP commercial relevance

Do not hard-code opaque AI ranking.

Expose the calculation.

Example:

Opportunity Score =
(value_weight × financial_value_normalised)
+
(confidence_weight × confidence)
+
(readiness_weight × execution_readiness)
-
(effort_weight × effort)
-
(risk_weight × risk)
-
(time_weight × time_to_value)

Make weights configurable.

7. MAKE MORE ENGINE

Build a set of initial revenue-growth playbooks.

At minimum assess:

Existing customer expansion
- cross-sell
- upsell
- dormant account reactivation
- renewal improvement
- contract expansion
- pricing uplift
- margin improvement

New business
- ICP development
- target account identification
- prospect discovery
- trigger/event-based selling
- market expansion
- geographical expansion
- channel partnerships
- reseller opportunities
- strategic partnerships

Sales execution
- pipeline weakness
- insufficient meetings
- insufficient opportunities
- stalled opportunities
- low conversion
- slow sales velocity
- account concentration
- poor follow-up
- CRM gaps

Marketing
- proposition clarity
- content gaps
- SEO opportunity
- outbound
- account-based marketing
- case studies
- customer proof
- referral programme

Product/service
- service packaging
- recurring revenue opportunity
- productisation
- premium services
- AI-enabled services
- underserved customer need

Each recommendation should be actionable.

Example:

If the system identifies an insufficient sales pipeline, START should be capable of producing an execution plan such as:

1. define ICP
2. identify target accounts
3. enrich contacts
4. identify relevant triggers
5. generate account insight
6. produce outreach
7. execute approved outreach
8. handle responses
9. qualify leads
10. book meetings
11. update CRM
12. monitor target

Where relevant, use SaleSonic and related AIGoGo capabilities.

8. SPEND LESS ENGINE

Build the initial cost-optimisation analysis categories:

- Microsoft licences
- SaaS
- cloud
- telecoms
- hardware
- managed services
- cyber
- insurance
- professional services
- recruitment
- contractors
- logistics
- software duplication
- unused licences
- supplier fragmentation
- contract renewal
- procurement compliance
- maverick spend
- supplier concentration
- process labour
- automation opportunities

Where actual spend data is not connected, clearly label recommendations as hypotheses or benchmark-led opportunities.

Once financial/transaction/invoice systems are connected, promote hypotheses to quantified opportunities.

9. BUILD THE SUPPLY CHAIN GRAPH

Create a persistent supply-chain model.

Minimum entity relationships:

Company
  -> Supplier
  -> Category
  -> Product/Service
  -> Contract
  -> Spend
  -> User/Department
  -> Business Process
  -> Dependency
  -> Alternative Supplier
  -> Switching Cost
  -> Risk
  -> Saving Opportunity

Schema example:

SupplierRelationship {
  companyId
  supplierId
  supplierName
  category
  products[]
  contractStart
  contractEnd
  renewalDate
  annualSpend
  spendConfidence
  usage
  businessOwner
  dependencies[]
  alternatives[]
  switchingComplexity
  criticality
  risk
  savingsPotential
  sourceRecords[]
}

Build initial visualisation of the supply chain.

The objective is to allow JoJo to reason across relationships, not merely analyse invoices individually.

10. MSP EXPANSION ENGINE

This is a critical differentiator.

The system must simultaneously ask:

Given what we now know about this company, what should its MSP reasonably offer next?

Create an MSP expansion model.

Example services:

- managed Microsoft
- cloud management
- cloud optimisation
- cyber
- backup
- compliance
- AI governance
- automation
- data
- device management
- service desk
- telecoms
- procurement
- licence management
- fractional IT leadership
- business intelligence
- growth services
- sales optimisation
- supply-chain optimisation

For each proposed expansion calculate where possible:

- customer problem
- evidence
- customer benefit
- suggested service
- likely monthly charge
- MSP delivery cost
- estimated MSP gross margin
- likely implementation effort
- confidence
- relationship sensitivity
- next-best conversation

Dashboard should show:

Current MSP MRR: £3,200
Potential MSP MRR: £9,850
Expansion opportunity: +£6,650 MRR
Potential annual increase: £79,800

Create actions:

- BUILD PROPOSAL
- PREPARE CUSTOMER REVIEW
- START DELIVERY

11. EXECUTION ENGINE

The START button must represent a real execution contract.

Do not implement START as a dummy status change.

Create:

ExecutionPlan {
  id
  opportunityId
  objective
  targetOutcome
  financialTarget
  tasks[]
  requiredCapabilities[]
  integrations[]
  permissions[]
  approvals[]
  constraints[]
  metrics[]
  stopConditions[]
  rollbackPlan
  status
}

Each task:

ExecutionTask {
  id
  executionPlanId
  action
  assignedCapability
  assignedAgent
  inputs
  expectedOutputs
  preconditions
  approvalRequired
  status
  startedAt
  completedAt
  outcome
  evidence
}

START workflow:

1. validate opportunity
2. refresh evidence
3. confirm current financial model
4. generate execution plan
5. identify agents/capabilities
6. validate integrations
7. identify approvals
8. present execution preview
9. accept authorisation
10. execute authorised tasks
11. monitor
12. measure results
13. record realised benefit
14. update Company Twin
15. find next opportunity

For actions that affect external systems, money, customers, contracts or communications, enforce appropriate permissions and approval.

Architecture must support progressively delegated autonomy.

12. AUTONOMY LEVELS

Implement a policy structure for:

LEVEL 0 — OBSERVE
Analyse only.

LEVEL 1 — RECOMMEND
Analyse and propose actions.

LEVEL 2 — PREPARE
Prepare deliverables and actions but require approval before external execution.

LEVEL 3 — EXECUTE
Execute within explicitly delegated scopes.

LEVEL 4 — AUTONOMOUS
Continuously execute approved classes of low-risk actions within financial, operational and policy guardrails.

Store autonomy by:

- organisation
- user
- action type
- capability
- monetary threshold
- risk level

Never imply autonomy where authority has not been granted.

13. JOJO ORCHESTRATION

JoJo should become the coordinating intelligence layer.

Add a JoJo objective interface such as:

JoJo, analyse Claritas Solutions and tell me the best ways to increase turnover and cut cost.

JoJo, start the top three low-risk opportunities.

JoJo, review the SaleSonic pipeline. If fewer than 10 qualified sales appointments are booked for the target period, create and execute an approved outreach plan to restore the target to 10.

JoJo, find £100k of addressable annual savings across this company.

JoJo, show me the top five MSP expansion opportunities across my customer estate.

JoJo must:

- translate objective into measurable outcome
- obtain evidence
- select appropriate capability
- construct plan
- understand delegated authority
- execute
- monitor
- intervene on failure
- escalate when necessary
- measure outcome

Avoid creating a monolithic agent.

JoJo should orchestrate specialist agents.

14. CAPABILITY ROUTER

Build an internal capability router.

Example:

routeObjective(objective, companyTwin) => {
  candidateCapabilities
  capabilityScores
  recommendedCapability
  fallbackCapability
}

Scoring criteria:

- fitness for task
- capability health
- data availability
- execution success history
- cost
- speed
- confidence
- risk
- customer suitability

The router should allow new AIGoGo capabilities to be registered without altering core orchestration logic.

15. PLAYBOOK ENGINE

Create reusable executable playbooks.

Initial playbooks should include:

- dormant-customer-reactivation
- pipeline-generation
- new-market-entry
- cross-sell
- pricing-review
- microsoft-licence-optimisation
- saas-rationalisation
- cloud-cost-optimisation
- supplier-consolidation
- contract-renewal
- procurement-event
- process-automation
- cyber-uplift
- msp-account-expansion
- customer-business-review

A playbook must contain:

Playbook {
  id
  name
  category
  requiredEvidence[]
  eligibilityRules[]
  tasks[]
  capabilityRequirements[]
  financialModel
  defaultKPIs[]
  approvalPolicy
  stopConditions[]
}

Playbooks should be versioned.

16. OUTCOME / BENEFITS LEDGER

Create a persistent Benefits Ledger.

The system must distinguish:

- theoretical value
- approved value
- forecast value
- committed value
- realised value
- verified realised value

Schema:

Benefit {
  opportunityId
  type: REVENUE | SAVING | MARGIN | MRR | ARR | PRODUCTIVITY
  forecastValue
  realisedValue
  verifiedValue
  measurementPeriod
  baseline
  measurementMethod
  evidence[]
  confidence
}

The system should be able to answer:

- How much value have we identified?
- How much is approved?
- How much is being executed?
- How much has actually been realised?
- Which AIGoGo capabilities created the value?
- Which MSP customers have the largest unexploited opportunity?

17. MSP PORTFOLIO VIEW

Build an MSP estate dashboard.

Example:

Customer | Current MRR | Make More | Spend Less | MSP Expand ARR | Active Actions
Customer A | £3,200 | £640k | £186k | £79.8k | 7
Customer B | £1,800 | £190k | £43k | £31k | 3
Customer C | £6,100 | £1.2m | £270k | £116k | 11

Allow sorting by:

- largest revenue opportunity
- largest saving opportunity
- largest MSP expansion
- highest confidence
- quickest wins
- relationship risk
- renewal date
- unstarted value
- realised value

Add:

NEXT BEST ACTION ACROSS ESTATE

JoJo should calculate the highest-value practical action for the MSP at portfolio level.

18. ONWARD AS REFERENCE ENVIRONMENT

Design the system so it can be piloted against Onward or another AIGoGo MSP dataset.

Do not make Onward-specific assumptions in the core schema.

Create an MSP tenant model supporting:

MSP
  -> Customers
  -> Users
  -> Services
  -> Contracts
  -> Opportunities
  -> Executions
  -> Benefits

Where real Onward integrations or datasets are available and authorised, build adapters.

The objective is to allow the group to run the engine across an existing MSP estate and quantify:

- current customer ARR
- potential MSP expansion ARR
- customer revenue-growth potential
- customer savings potential
- fastest wins
- group capabilities applicable

19. UI REQUIREMENTS

Create a polished executive interface.

Minimum screens:

1. Login
2. MSP Portfolio
3. Add / Analyse Company
4. Company Overview
5. Company Twin
6. Make More
7. Spend Less
8. MSP Expand
9. Supply Chain
10. Opportunity Detail
11. Execution Preview
12. Execution Monitoring
13. Benefits Ledger
14. Activity / Audit
15. Integrations
16. Autonomy / Permissions
17. Capability Health

Use concise business language.

Avoid exposing technical agent complexity to normal users.

Primary UX language should focus on:

- opportunity
- value
- evidence
- action
- progress
- benefit

20. COMPANY OVERVIEW SCREEN

Create a strong initial summary.

Example:

ACME ENGINEERING LTD

Company understanding: 86%
Last analysed: 12 minutes ago

MAKE MORE
£640k–£1.1m
9 opportunities

SPEND LESS
£186k
14 opportunities

MSP EXPAND
£79.8k ARR
6 opportunities

TOP NEXT ACTION

Reactivate dormant customer base
Potential value: £142k
Confidence: 84%
Expected time to value: 45 days

[START]

Include:

- company snapshot
- market
- business model
- key signals
- current priorities inferred
- key risks
- top opportunities
- active execution
- realised benefits

21. EVIDENCE AND EXPLAINABILITY

Every material recommendation needs an evidence view.

For example:

Why are we recommending Microsoft licence optimisation?

Then display:

- known facts
- data sources
- assumptions
- calculations
- uncertainty
- missing data
- what additional connection would improve confidence

Never show hidden chain-of-thought.

Provide concise reasoning summaries and auditable evidence instead.

22. DATA QUALITY

Implement confidence scoring at field and opportunity level.

Example:

Turnover: £8.2m
Confidence: 72%
Sources:
- Companies House filing
- company website
- third-party estimate

Employee count: 94
Confidence: 61%

Flag stale evidence.

Build a refresh mechanism.

23. FAIL GRACEFULLY

If a company has limited public information, do not invent a detailed business.

Instead show:

Company understanding: 37%

and indicate the highest-value connectors/data sources that would improve the analysis.

Example:

Connect Microsoft 365 → +11% expected understanding
Connect accounting → +21%
Connect CRM → +18%
Connect PSA → +17%

The platform should become progressively more valuable as data connections increase.

24. SECURITY AND TENANCY

Treat this as multi-tenant MSP infrastructure from day one.

Requirements:

- strict tenant isolation
- role-based access control
- encryption
- secrets management
- immutable audit trail for execution actions
- least privilege
- approval audit
- data-source provenance
- clear separation between MSP data and end-customer data
- deletion/export mechanisms
- configurable retention
- no cross-tenant learning from confidential data unless explicitly architected and permitted

25. OBSERVABILITY

Every agent/action must emit:

- request
- objective
- assigned capability
- start time
- completion time
- status
- cost
- tokens/API usage where relevant
- outcome
- failure
- retry
- evidence
- benefit generated

Create an internal operational dashboard.

26. COST CONTROL

Implement AI/API cost accounting by:

- tenant
- customer
- analysis
- agent
- capability
- execution
- realised benefit

Calculate:

AI/Execution Cost
versus
Identified Benefit
versus
Realised Benefit

JoJo should prefer proportionate execution.

Do not spend £1,000 analysing a £500 opportunity.

27. TESTING

Self-QA is non-negotiable.

Build:

- unit tests
- integration tests
- API contract tests
- tenant isolation tests
- permission tests
- START workflow tests
- financial calculation tests
- hallucination/evidence tests
- scraper/data-source failure tests
- agent failure/retry tests
- capability-router tests
- benefit-ledger tests

Create at least three synthetic companies:

1. small professional services company
2. manufacturing company
3. 100-user SME with Microsoft-heavy estate

Run full analysis against them.

Expected test output must prove:

- company twin created
- opportunities generated
- values calculated
- opportunity evidence retained
- START creates execution plan
- execution plan routes to appropriate mock capabilities
- approvals work
- result gets written back
- benefit ledger updates
- next opportunity is recalculated

28. DEVELOPMENT APPROACH

First inspect what exists.

Do not rewrite working infrastructure.

Perform:

Phase A — Discovery
- inspect repo structure
- inspect current schemas
- inspect JoJo
- inspect Toleron
- inspect agent infrastructure
- inspect integrations
- inspect auth
- inspect tenancy
- inspect deployment
- identify reusable group capabilities

Produce /docs/current-state.md.

Phase B — Architecture
Produce:

- /docs/metamsp-architecture.md
- /docs/company-twin.md
- /docs/opportunity-graph.md
- /docs/execution-engine.md
- /docs/capability-registry.md
- /docs/security-model.md

Then build.

Do not stop at documentation.

Phase C — Foundation
Build:

- Company Twin
- Opportunity model
- Benefit Ledger
- Capability Registry
- Playbook Registry
- execution contracts

Phase D — Analysis MVP
Build:

- company URL/name input
- public company discovery
- Toleron-style analysis
- Make More
- Spend Less
- MSP Expand
- confidence/evidence

Phase E — Execution MVP
Build:

- START
- execution preview
- approval
- agent routing
- mock/real capability invocation
- execution monitoring
- result write-back

Phase F — Portfolio
Build:

- MSP customer estate
- prioritisation
- next-best-action
- benefit totals

Phase G — QA
Run all tests and repair failures.

29. AUTONOMOUS WORKING INSTRUCTION

Proceed autonomously through the work.

Do not repeatedly request approval for ordinary implementation decisions.

Use sensible defaults where detail is missing.

Where a dependency is unavailable:

1. define the interface
2. implement a mock/stub
3. continue the build
4. record the missing dependency
5. ensure it can be swapped for the live integration later

Do not stop the whole build because one external system is unavailable.

Do not silently skip requirements.

Maintain:

/docs/build-status.md

with:

- completed
- in progress
- blocked
- mocked
- remaining
- test status

Update it as work progresses.

30. DEFINITION OF DONE FOR THIS BUILD

The build is successful when I can:

1. open the app
2. enter a real company URL
3. see the company identified
4. see a useful Company Twin
5. see Make More opportunities
6. see Spend Less opportunities
7. see MSP Expand opportunities
8. open an opportunity
9. understand why it was recommended
10. see its estimated financial value
11. press START
12. see a genuine execution plan generated
13. authorise the plan
14. see tasks routed to agents/capabilities
15. see task status
16. see an outcome recorded
17. see the Benefit Ledger update
18. return to the portfolio dashboard
19. see the next-best action change based on what happened

A static mock-up is not sufficient.

A presentation is not sufficient.

A report generator is not sufficient.

A button that simply changes a database status is not sufficient.

The system must prove the complete loop:

UNDERSTAND → FIND VALUE → START → EXECUTE → MEASURE → EXPAND

31. STRATEGIC DESIGN PRINCIPLE

Treat every AIGoGo product or opco as an internal capability that can be invoked by JoJo.

The customer should experience one coherent system.

Architect toward:

MSP
   ↓
CUSTOMER ESTATE
   ↓
COMPANY DIGITAL TWINS
   ↓
OPPORTUNITY GRAPH
   ↓
MAKE MORE | SPEND LESS | MSP EXPAND
   ↓
JOJO
   ↓
CAPABILITY ROUTER
   ↓
AIGOGO CAPABILITY MESH
   ↓
EXECUTION AGENTS
   ↓
MEASURED BUSINESS OUTCOMES
   ↓
CONTINUOUS LAND & EXPAND

The strategic objective is to enable a small MSP to behave like a technology provider, procurement consultancy, growth consultancy, automation business and AI transformation organisation without needing to build those capabilities itself.

The product promise is:

We continuously understand your customers, identify credible ways to make them more money and spend less, and give you a button to execute the improvement.

Build toward that outcome.

32. FINAL OUTPUT REQUIRED FROM THIS RUN

At the end of the run, produce:

/docs/BUILD-REPORT.md

Include:

- architecture implemented
- functionality completed
- screenshots/screens/routes implemented
- schemas
- APIs
- agents
- capabilities discovered
- capabilities integrated
- mocked integrations
- tests run
- tests passing
- outstanding defects
- security observations
- deployment status
- exact instructions to run locally
- exact instructions to deploy
- next ten highest-value build actions

Also include a section:

AIGoGo Capability Gap Analysis

For every opportunity type the platform could identify, state:

- existing AIGoGo capability
- reusable percentage estimate
- integration required
- missing capability
- recommended new agent/service if needed

Then include:

NEXT AUTONOMOUS BUILD DIRECTIVE

Write the next Claude Code instruction required to move the platform materially closer to production without requiring me to reconstruct the context.

Begin immediately.
