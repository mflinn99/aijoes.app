/**
 * Onward Professional Services — commercial configuration.
 *
 * PROVENANCE WARNING, read this before trusting any number below.
 *
 * This environment's egress policy blocks all general web access: onwardps.co.uk
 * returns 403 at the proxy, as does every other external host except GitHub, npm
 * and the Anthropic API. The platform's own website connector therefore could
 * not fetch Onward's site, and nothing here is `website-verified`.
 *
 * What follows is built from web-search result summaries, which are real but
 * weaker evidence than a direct fetch: they are snippets about the site rather
 * than the site. Every such field is marked `web-search-snippet` with a caveat,
 * and `usableInOutreach` is false for every proof point until Onward confirms it.
 *
 * Commercial figures (deal sizes, margins, cycle lengths, capacity) are marked
 * `inferred` — they are planning placeholders derived from typical UK MSP
 * economics, NOT statements about Onward. They must be replaced before any
 * pipeline number leaves this system. See BLOCKERS.md.
 */

import type { MspProfile } from '@/lib/gtm/profile';

const RETRIEVED = '2026-09-22T19:20:00.000Z';
/** A second search pass on the same date returned the same claims. Same source, so a small lift only. */
const CORROBORATED = '2026-09-22T19:55:00.000Z';
const SEARCH_CAVEAT = 'From a web-search summary, not a direct fetch of onwardps.co.uk (egress blocked). Confirm with Onward.';
const INFERRED_CAVEAT = 'Planning placeholder from typical UK MSP economics. NOT an Onward figure. Replace before quoting.';

export const ONWARD: MspProfile = {
  id: 'onward-professional-services',

  name: { value: 'Onward Professional Services', source: 'web-search-snippet', confidence: 0.9, retrievedAt: RETRIEVED, locator: 'https://onwardps.co.uk/' },
  domain: { value: 'onwardps.co.uk', source: 'web-search-snippet', confidence: 0.95, retrievedAt: RETRIEVED },

  positioning: {
    value:
      'Microsoft-centred managed services and IT consultancy, delivered both directly and white-label through other IT firms. ' +
      'Azure Virtual Desktop is a stated specialism.',
    source: 'web-search-snippet',
    confidence: 0.6,
    retrievedAt: RETRIEVED,
    caveat: SEARCH_CAVEAT,
  },

  yearsTrading: { value: 25, source: 'web-search-snippet', confidence: 0.5, retrievedAt: RETRIEVED, caveat: SEARCH_CAVEAT },

  goToMarketModel: {
    value:
      'Two routes: direct to end customers, and white-label delivery for IT consultancies, software developers and tech ' +
      'businesses who need infrastructure and support for their own clients. The second is unusual and commercially ' +
      'important — it makes other IT firms a target segment rather than competitors.',
    source: 'web-search-snippet',
    confidence: 0.65,
    retrievedAt: RETRIEVED,
    caveat: SEARCH_CAVEAT,
  },

  sectors: {
    value: ['Professional services', 'Legal', 'Accountancy', 'Technology and software', 'IT consultancies (white-label)', 'Public sector'],
    source: 'web-search-snippet',
    confidence: 0.55,
    retrievedAt: RETRIEVED,
    caveat: `${SEARCH_CAVEAT} Accountancy and legal appear in a stated cost-reduction claim; public sector is inferred from a G-Cloud Digital Marketplace listing for Azure Virtual Desktop.`,
  },

  geography: { value: ['United Kingdom'], source: 'inferred', confidence: 0.7, retrievedAt: RETRIEVED, caveat: 'Inferred from .co.uk domain and G-Cloud presence.' },

  routesToMarket: {
    value: ['Direct', 'White-label through IT firms', 'G-Cloud / Digital Marketplace'],
    source: 'web-search-snippet',
    confidence: 0.6,
    retrievedAt: RETRIEVED,
    caveat: 'G-Cloud route indicated by a Digital Marketplace listing for Azure Virtual Desktop implementation and support.',
  },

  serviceLines: [
    {
      id: 'azure-virtual-desktop',
      name: 'Azure Virtual Desktop implementation and support',
      category: 'Cloud / end-user computing',
      description: 'Design, migration and ongoing support of Azure Virtual Desktop estates, including white-label delivery.',
      deliveryModels: ['project', 'managed-service'],
      buyerProblems: [
        'Ageing on-premises VDI or RDS estate reaching end of support',
        'Hybrid working needs a managed desktop that is not a laptop estate',
        'Acquisition means two desktop estates and no common platform',
        'Regulated data must not sit on endpoints',
      ],
      triggerSignals: ['citrix', 'vmware horizon', 'rds', 'terminal server', 'remote desktop', 'hybrid working', 'virtual desktop', 'windows 10 end of support'],
      commercials: { typicalDealLowGbp: 25_000, typicalDealHighGbp: 150_000, recurring: true, typicalMonthlyGbp: 4_000, grossMarginPct: 42 },
      typicalSalesCycleDays: 90,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['buyonic'],
      confidence: 0.7,
      provenance: 'web-search-snippet',
    },
    {
      id: 'managed-it',
      name: 'Managed IT services',
      category: 'Managed services',
      description: 'Proactive IT support and management, direct or white-label, with predictable cost.',
      deliveryModels: ['managed-service'],
      buyerProblems: [
        'Internal IT is one or two people and cannot cover the whole estate',
        'Reactive support is costing more than it looks and nothing improves',
        'An IT firm needs delivery capacity it does not want to employ',
      ],
      triggerSignals: ['hiring it manager', 'it support', 'outsourced it', 'no internal it', 'msp', 'acquisition', 'multi-site'],
      commercials: { typicalDealLowGbp: 18_000, typicalDealHighGbp: 240_000, recurring: true, typicalMonthlyGbp: 3_500, grossMarginPct: 38 },
      typicalSalesCycleDays: 75,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['strata-metamsp'],
      confidence: 0.75,
      provenance: 'web-search-snippet',
    },
    {
      id: 'it-consultancy',
      name: 'IT strategy and consultancy',
      category: 'Consultancy',
      description: 'Technology roadmaps and practical guidance aligned to business goals.',
      deliveryModels: ['consultancy', 'project'],
      buyerProblems: [
        'Technology decisions are made reactively with nobody owning the roadmap',
        'A board wants an independent view before committing capital',
        'Post-acquisition estates need a rationalisation plan',
      ],
      triggerSignals: ['acquisition', 'merger', 'new cto', 'new cio', 'digital transformation', 'it strategy', 'private equity'],
      commercials: { typicalDealLowGbp: 8_000, typicalDealHighGbp: 75_000, recurring: false, grossMarginPct: 55 },
      typicalSalesCycleDays: 45,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['grothos', 'strata-metamsp'],
      confidence: 0.7,
      provenance: 'web-search-snippet',
    },
    {
      id: 'cyber-security',
      name: 'Cyber security and compliance',
      category: 'Cyber',
      description: 'Security posture work aligned to ISO 27001, GDPR and Cyber Essentials.',
      deliveryModels: ['project', 'managed-service', 'consultancy'],
      buyerProblems: [
        'A tender or insurer requires Cyber Essentials or ISO 27001 and the company holds neither',
        'Client data obligations exceed the controls actually in place',
        'A breach or near miss has made security a board topic',
      ],
      triggerSignals: ['iso 27001', 'cyber essentials', 'gdpr', 'data protection', 'breach', 'ransomware', 'soc 2', 'tender', 'framework'],
      commercials: { typicalDealLowGbp: 12_000, typicalDealHighGbp: 120_000, recurring: true, typicalMonthlyGbp: 2_200, grossMarginPct: 45 },
      typicalSalesCycleDays: 80,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['strata-metamsp'],
      confidence: 0.7,
      provenance: 'web-search-snippet',
    },
    {
      id: 'cloud-hosting',
      name: 'Cloud hosting and infrastructure',
      category: 'Cloud / infrastructure',
      description: 'Azure-based hosting and infrastructure, including migration from on-premises and other clouds.',
      deliveryModels: ['project', 'managed-service'],
      buyerProblems: [
        'On-premises hardware is at end of life and a refresh is due',
        'A data centre contract or colocation lease is ending',
        'Cloud spend has grown without anybody owning it',
      ],
      triggerSignals: ['on-premises', 'data centre', 'colocation', 'server refresh', 'azure', 'aws', 'migration', 'end of life'],
      commercials: { typicalDealLowGbp: 20_000, typicalDealHighGbp: 200_000, recurring: true, typicalMonthlyGbp: 5_000, grossMarginPct: 35 },
      typicalSalesCycleDays: 100,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['buyonic', 'sixonic'],
      confidence: 0.7,
      provenance: 'web-search-snippet',
    },
    {
      id: 'white-label-delivery',
      name: 'White-label delivery partner',
      category: 'Partner / wholesale',
      description: 'Delivering infrastructure and support under another IT firm’s brand.',
      deliveryModels: ['managed-service', 'resource-augmentation'],
      buyerProblems: [
        'An IT consultancy wins infrastructure work it cannot staff',
        'A software business has to support the platform it sells and does not want to build a NOC',
        'A smaller MSP needs out-of-hours or specialist cover',
      ],
      triggerSignals: ['it consultancy', 'software development', 'saas', 'systems integrator', 'hiring infrastructure engineer', 'managed service'],
      commercials: { typicalDealLowGbp: 30_000, typicalDealHighGbp: 300_000, recurring: true, typicalMonthlyGbp: 6_000, grossMarginPct: 32 },
      typicalSalesCycleDays: 120,
      deliveryCapacity: 'ready',
      aigogoExtensions: ['strata-metamsp', 'sixonic'],
      confidence: 0.8,
      provenance: 'web-search-snippet',
    },
    {
      id: 'resource-augmentation',
      name: 'Professional services resource augmentation',
      category: 'Resource',
      description: 'Named engineers and consultants supplied into a customer or partner team.',
      deliveryModels: ['resource-augmentation'],
      buyerProblems: [
        'A programme is resourced on paper and not in practice',
        'A specialist skill is needed for months, not permanently',
        'A delivery date is at risk and headcount cannot arrive in time',
      ],
      triggerSignals: ['hiring', 'contract', 'programme', 'transformation', 'migration', 'backlog'],
      commercials: { typicalDealLowGbp: 15_000, typicalDealHighGbp: 180_000, recurring: false, grossMarginPct: 28 },
      typicalSalesCycleDays: 35,
      deliveryCapacity: 'constrained',
      aigogoExtensions: [],
      confidence: 0.6,
      provenance: 'inferred',
    },
    {
      id: 'ai-readiness',
      name: 'AI readiness and governance',
      category: 'AI',
      description: 'Preparing a Microsoft estate for AI adoption: data, identity, licensing and policy.',
      deliveryModels: ['consultancy', 'project'],
      buyerProblems: [
        'Staff are already using AI tools with company data under no policy',
        'Copilot has been bought and nothing has changed',
        'A board has asked what AI means for the business and nobody owns the answer',
      ],
      triggerSignals: ['copilot', 'ai policy', 'artificial intelligence', 'machine learning', 'data governance', 'hiring data'],
      commercials: { typicalDealLowGbp: 10_000, typicalDealHighGbp: 90_000, recurring: false, grossMarginPct: 50 },
      typicalSalesCycleDays: 60,
      deliveryCapacity: 'partner-required',
      aigogoExtensions: ['sixonic', 'strata-metamsp'],
      confidence: 0.4,
      provenance: 'inferred',
    },
  ],

  accreditations: [
    { name: 'Microsoft Solutions Partner', held: 'claimed-unverified', relevance: 'Underpins every Azure and M365 proposition', provenance: 'web-search-snippet' },
    { name: 'Microsoft Cloud Solution Provider (CSP)', held: 'claimed-unverified', relevance: 'Allows licence resale and tenant management', provenance: 'web-search-snippet' },
    { name: 'ISO 27001 alignment', held: 'claimed-unverified', relevance: 'Stated as alignment, which is not the same as certification — check before quoting', provenance: 'web-search-snippet' },
    { name: 'Cyber Essentials', held: 'claimed-unverified', relevance: 'Required by many tenders', provenance: 'web-search-snippet' },
    { name: 'G-Cloud supplier', held: 'claimed-unverified', relevance: 'Public sector route to market without a full tender', provenance: 'web-search-snippet' },
  ],

  partnerships: {
    value: ['Microsoft'],
    source: 'web-search-snippet',
    confidence: 0.75,
    retrievedAt: RETRIEVED,
    caveat: SEARCH_CAVEAT,
  },

  proofPoints: [
    {
      id: 'cost-reduction-30-clients',
      claim: 'Helped over 30 clients reduce their IT costs within 12 months.',
      sector: null,
      serviceIds: ['managed-it', 'cloud-hosting'],
      customer: null,
      quantified: '30+ clients, 12 months',
      provenance: 'web-search-snippet',
      corroboratedAt: CORROBORATED,
      // Corroborated by a second, independent search run on 2026-09-22 returning
      // the same claim. Two snippets of the same page is still one source, so the
      // lift is small and it stays unusable in outreach until Onward confirms it.
      confidence: 0.6,
      usableInOutreach: false,
    },
    {
      id: 'legal-accountancy-30-percent',
      claim: 'Helped accountancy and legal practices reduce costs by 30% while improving security.',
      sector: 'Professional services',
      serviceIds: ['managed-it', 'cyber-security', 'cloud-hosting'],
      customer: null,
      quantified: '30% cost reduction',
      provenance: 'web-search-snippet',
      corroboratedAt: CORROBORATED,
      // Same corroboration as above, same limit on what it is worth.
      confidence: 0.6,
      usableInOutreach: false,
    },
    {
      id: 'gcloud-avd-listing',
      claim: 'Azure Virtual Desktop implementation and support is listed on the G-Cloud Digital Marketplace.',
      sector: 'Public sector',
      serviceIds: ['azure-virtual-desktop'],
      customer: null,
      quantified: null,
      provenance: 'web-search-snippet',
      confidence: 0.6,
      usableInOutreach: false,
    },
  ],

  // Absent is absent. Onward's rate card is not public and was not supplied.
  rateCard: null,

  capacity: {
    value: { consultantsAvailable: null, note: 'Not supplied. Until it is, no service is promoted on the basis of available capacity, and resource augmentation is marked constrained.' },
    source: 'user-supplied',
    confidence: 0,
    retrievedAt: RETRIEVED,
    caveat: 'Phase 12 requires reducing promotion of constrained capability; without this figure that rule cannot fire on evidence.',
  },

  knownGaps: [
    'Direct verification of onwardps.co.uk — blocked by this environment’s egress policy',
    'Confirmation of which accreditations are certified versus aligned',
    'Rate card and pricing parameters (needed before any quotation)',
    'Delivery capacity by skill (needed for Phase 12 capacity throttling)',
    'Existing and historic customer list (needed to suppress current customers from prospecting)',
    'Historic wins and losses (needed to seed the Phase 15 learning loop)',
    'Case studies cleared for use in outreach',
    'CRM access (needed for Phase 9 closed loop)',
  ],
};
