// Data-driven scenarios for the synthetic world, starting with sale mandates:
// an OpCo that is a business for sale, whose prospects are acquirers.
//
// Everything committed here is fictional and lives on .test domains. Real
// mandates (confidential teasers) are loaded at run time from a git-ignored
// directory by loadPrivateScenarios, never committed.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalysisField, Epistemic } from "../../shared/types";
import type { ProspectScript } from "./world";

export interface ScenarioClaim {
  key: string;
  field: AnalysisField;
  statement: string;
  status: Epistemic;
  /** Exact text from the supplied document (or a page); null for inferences. */
  quote: string | null;
  basis: string | null;
}

export interface Scenario {
  opco: { name: string; website: string; introLink: string; notes: string };
  /** Pages the OpCo controls, e.g. the NDA request page the intro links to. */
  pages: Record<string, { text?: string; status?: number }>;
  claims: ScenarioClaim[];
  /** Same shape the profile agent returns; items cite claim keys. */
  profile: any;
  /** The OpCo-side sentences of every message; prospect-specific ones come from the prospect script. */
  pitch: { proposition: string; teaser: string };
  /** Domains of the prospects (from ACQUIRERS or a private file) this scenario searches. */
  prospects: string[];
  /** Extra prospect scripts supplied with a private scenario. */
  prospectScripts?: Record<string, ProspectScript>;
}

// ---- fictional acquirers ----------------------------------------------------------

const SALE_SECTIONS = { proposition: "{{proposition}}", teaser: "{{teaser}}" };

export const ACQUIRERS: Record<string, ProspectScript> = {
  "penninems.test": {
    name: "Pennine Managed Services",
    domain: "penninems.test",
    pages: {
      "/": { text: "Pennine Managed Services is a UK managed IT services group based in Leeds with 140 employees, supporting SMEs across the north of England." },
      "/news": {
        text: "Pennine Managed Services has acquired Bradford IT support provider Wharfe Networks, its third acquisition since securing private equity backing for a buy-and-build strategy.",
        publishedAt: "2026-09-12T08:00:00.000Z",
      },
      "/careers": { text: "Pennine is recruiting an integration manager to bring acquired service desks onto one PSA platform.", publishedAt: "2026-09-26T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Managed IT services", "/", "UK managed IT services group based in Leeds"],
      employees: [140, "/", "with 140 employees"],
      geography: ["United Kingdom", "/", "UK managed IT services group based in Leeds"],
    },
    findings: [
      { kind: "identity", statement: "Leeds-based managed IT services group", path: "/", quote: "UK managed IT services group based in Leeds" },
      { kind: "commercial", statement: "Supports SMEs across the north of England", path: "/", quote: "supporting SMEs across the north of England" },
      { kind: "trigger", statement: "Acquired Bradford IT support provider Wharfe Networks", path: "/news", quote: "acquired Bradford IT support provider Wharfe Networks", signalId: "recent-msp-acquisition" },
      { kind: "trigger", statement: "Private equity backing for a buy-and-build strategy", path: "/news", quote: "securing private equity backing for a buy-and-build strategy", signalId: "buy-and-build-backing" },
      { kind: "trigger", statement: "Recruiting an integration manager for acquired service desks", path: "/careers", quote: "recruiting an integration manager to bring acquired service desks onto one PSA platform", signalId: "buy-and-build-backing" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 9 },
    why: {
      them: "A Leeds MSP group buying SME-focused providers in the north of England.",
      now: "It has just acquired Wharfe Networks in Bradford as part of a private-equity-backed buy-and-build.",
      proposition: "A Yorkshire MSP with recurring SME revenue is the kind of business it is buying now.",
    },
    contacts: [{ name: "Ruth Calloway", title: "Chief Executive Officer", email: "ruth.calloway@penninems.test", emailStatus: "verified", sourceUrl: "https://penninems.test/about" }],
    intro: {
      themKind: "commercial",
      nowSignal: "recent-msp-acquisition",
      subject: "A Yorkshire MSP after Wharfe Networks",
      sections: {
        whyThem: "Pennine Managed Services has been building a group of SME-focused providers across the north of England.",
        whyNow: "With Wharfe Networks in Bradford just acquired, another West Yorkshire customer base may fit the same plan.",
        problem: "Good regional businesses with loyal SME customers rarely come to market openly.",
        ...SALE_SECTIONS,
        cta: "Would a confidential conversation be useful?",
      },
    },
    followup: {
      nowSignal: "buy-and-build-backing",
      subject: "Integrating acquired service desks at Pennine",
      sections: {
        whyThem: "I wrote about Pennine's acquisition of Wharfe Networks in Bradford.",
        whyNow: "I see you are recruiting an integration manager to bring acquired service desks onto one PSA platform.",
        problem: "A business already running an established PSA and monitoring stack is quicker to integrate.",
        ...SALE_SECTIONS,
        cta: "Shall I send the teaser under NDA?",
      },
    },
  },

  "northgatecloud.test": {
    name: "Northgate Cloud Group",
    domain: "northgatecloud.test",
    pages: {
      "/": { text: "Northgate Cloud Group is a UK managed services provider headquartered in Manchester with 260 employees, focused on Microsoft cloud and cybersecurity for SMEs." },
      "/news": {
        text: "Northgate Cloud Group has announced plans to expand into Yorkshire through acquisition, backed by a new growth investment.",
        publishedAt: "2026-08-20T08:00:00.000Z",
      },
      "/careers": { text: "Northgate is hiring a Corporate Development Director to lead acquisitions in the north of England.", publishedAt: "2026-09-02T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Managed IT services", "/", "UK managed services provider headquartered in Manchester"],
      employees: [260, "/", "with 260 employees"],
      geography: ["United Kingdom", "/", "UK managed services provider headquartered in Manchester"],
    },
    findings: [
      { kind: "identity", statement: "Manchester-based managed services provider", path: "/", quote: "UK managed services provider headquartered in Manchester" },
      { kind: "commercial", statement: "Focused on Microsoft cloud and cybersecurity for SMEs", path: "/", quote: "focused on Microsoft cloud and cybersecurity for SMEs" },
      { kind: "trigger", statement: "Plans to expand into Yorkshire through acquisition", path: "/news", quote: "announced plans to expand into Yorkshire through acquisition", signalId: "yorkshire-expansion" },
      { kind: "trigger", statement: "Hiring a Corporate Development Director to lead acquisitions in the north", path: "/careers", quote: "hiring a Corporate Development Director to lead acquisitions in the north of England", signalId: "buy-and-build-backing" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 8 },
    why: {
      them: "A Manchester MSP focused on Microsoft cloud and cybersecurity for SMEs.",
      now: "It has announced plans to expand into Yorkshire through acquisition.",
      proposition: "An established Yorkshire MSP with a Microsoft cloud and security base matches its stated expansion.",
    },
    contacts: [{ name: "Imran Siddiqui", title: "Corporate Development Director", email: "imran.siddiqui@northgatecloud.test", emailStatus: "verified", sourceUrl: "https://northgatecloud.test/careers" }],
    intro: {
      themKind: "commercial",
      nowSignal: "yorkshire-expansion",
      subject: "Northgate's move into Yorkshire",
      sections: {
        whyThem: "Northgate Cloud Group's focus on Microsoft cloud and cybersecurity for SMEs stood out.",
        whyNow: "You have announced plans to expand into Yorkshire through acquisition, so the timing may suit.",
        problem: "Entering a new region organically means winning SME customers one at a time.",
        ...SALE_SECTIONS,
        cta: "Would a confidential conversation be useful?",
      },
    },
  },

  "saltaire.test": {
    name: "Saltaire Digital",
    domain: "saltaire.test",
    pages: { "/": { text: "Saltaire Digital is a web design and branding agency in Shipley with 9 people." } },
    attributes: {
      sector: ["Web design", "/", "web design and branding agency in Shipley"],
      employees: [9, "/", "with 9 people"],
      geography: ["United Kingdom", "/", "web design and branding agency in Shipley"],
    },
    findings: [{ kind: "identity", statement: "Web design agency in Shipley", path: "/", quote: "web design and branding agency in Shipley" }],
    points: { icpFit: 3, need: 0, timing: 0, commercial: 1 },
    why: { them: "A design agency, not an MSP acquirer.", now: "No acquisition activity.", proposition: "No fit." },
    contacts: [{ name: "Tom Hirst", title: "Founder", email: "tom@saltaire.test", emailStatus: "verified", sourceUrl: null }],
  },

  "ousevalley.test": {
    name: "Ouse Valley IT",
    domain: "ousevalley.test",
    pages: {
      "/": { text: "Ouse Valley IT is a UK managed IT services provider in York with 45 employees." },
      "/news": { text: "Ouse Valley IT acquired Selby Computer Services, its second acquisition.", publishedAt: "2023-03-14T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Managed IT services", "/", "UK managed IT services provider in York"],
      employees: [45, "/", "with 45 employees"],
      geography: ["United Kingdom", "/", "UK managed IT services provider in York"],
    },
    findings: [
      { kind: "identity", statement: "York-based managed IT services provider", path: "/", quote: "UK managed IT services provider in York" },
      { kind: "trigger", statement: "Acquired Selby Computer Services (2023)", path: "/news", quote: "acquired Selby Computer Services", signalId: "recent-msp-acquisition" },
    ],
    // The Qualification Agent judges a 2023 deal weak evidence of appetite now.
    points: { icpFit: 30, need: 12, timing: 10, commercial: 5 },
    why: { them: "A York MSP that has bought before.", now: "Its last acquisition was in 2023; no current signal.", proposition: "Possible fit, but no evidence of appetite now." },
    contacts: [{ name: "Gareth Lund", title: "Managing Director", email: "gareth.lund@ousevalley.test", emailStatus: "verified", sourceUrl: null }],
  },

  "caldersystems.test": {
    name: "Calder Systems",
    domain: "caldersystems.test",
    pages: {
      "/": { text: "Calder Systems is a UK managed IT services provider in Halifax with 85 employees, supporting manufacturers and professional firms." },
      "/news": { text: "Calder Systems has secured funding to acquire managed service providers across West Yorkshire.", publishedAt: "2026-09-18T08:00:00.000Z" },
      "/careers": { text: "Calder Systems is integrating its recent acquisition of Elland IT onto one service desk.", publishedAt: "2026-09-30T08:00:00.000Z" },
    },
    attributes: {
      sector: ["Managed IT services", "/", "UK managed IT services provider in Halifax"],
      employees: [85, "/", "with 85 employees"],
      geography: ["United Kingdom", "/", "UK managed IT services provider in Halifax"],
    },
    findings: [
      { kind: "identity", statement: "Halifax-based managed IT services provider", path: "/", quote: "UK managed IT services provider in Halifax" },
      { kind: "commercial", statement: "Supports manufacturers and professional firms", path: "/", quote: "supporting manufacturers and professional firms" },
      { kind: "trigger", statement: "Funding secured to acquire MSPs across West Yorkshire", path: "/news", quote: "secured funding to acquire managed service providers across West Yorkshire", signalId: "buy-and-build-backing" },
      { kind: "trigger", statement: "Integrating its acquisition of Elland IT", path: "/careers", quote: "integrating its recent acquisition of Elland IT", signalId: "recent-msp-acquisition" },
    ],
    points: { icpFit: 30, need: 30, timing: 10, commercial: 9 },
    why: { them: "A Halifax MSP serving manufacturers and professional firms.", now: "It has secured funding to acquire MSPs across West Yorkshire.", proposition: "A West Yorkshire MSP is exactly its stated target." },
    // Strong company, wrong person: the only contact known is not a decision-maker.
    contacts: [{ name: "Amy Booth", title: "Office Manager", email: "amy.booth@caldersystems.test", emailStatus: "verified", sourceUrl: null }],
    intro: {
      themKind: "commercial",
      nowSignal: "buy-and-build-backing",
      subject: "West Yorkshire acquisitions at Calder Systems",
      sections: {
        whyThem: "Calder Systems supports manufacturers and professional firms out of Halifax.",
        whyNow: "Having secured funding to acquire managed service providers across West Yorkshire, you may be reviewing targets now.",
        problem: "Most suitable businesses never reach an open market.",
        ...SALE_SECTIONS,
        cta: "Would a confidential conversation be useful?",
      },
    },
  },
};

const ACQUIRER_PROFILE = {
  icp: {
    sectors: ["Managed IT services"], subsectors: ["MSP groups", "IT services consolidators"], geographies: ["United Kingdom"],
    employeeMin: 20, employeeMax: 2000, revenue: null, technology: ["Microsoft cloud", "PSA and RMM platforms"], maturity: "Acquisitive",
    ownership: ["Private equity backed", "Founder owned"], growth: "Buy-and-build", regulatory: [], other: ["Appetite for northern England"],
  },
  buyers: {
    economic: ["Chief Executive Officer", "Managing Director", "Founder"],
    operational: ["Corporate Development Director", "Head of M&A", "Chief Operating Officer"],
    technical: [],
    influencer: ["Chief Financial Officer"],
  },
  signals: [
    { id: "recent-msp-acquisition", name: "Recent MSP acquisition", description: "Bought a managed service provider in the last six months", whyItMatters: "Shows current appetite and an integration playbook", keywords: ["acquired", "acquisition"] },
    { id: "buy-and-build-backing", name: "Buy-and-build backing", description: "Funding or investment stated for acquisitions", whyItMatters: "Capital is allocated to deals", keywords: ["buy-and-build", "funding", "private equity"] },
    { id: "yorkshire-expansion", name: "Northern or Yorkshire expansion", description: "Stated plan to grow in Yorkshire or the north", whyItMatters: "Geographic fit with the business for sale", keywords: ["Yorkshire", "north of England"] },
  ],
};

// ---- a fictional sale mandate --------------------------------------------------------

const SLATE_TEASER = `PROJECT SLATE (FICTIONAL TEST DATA)
CONFIDENTIAL ACQUISITION TEASER
Project SLATE is an established managed IT services provider supporting small and mid-sized organisations across Lancashire and West Yorkshire.
The business provides service desk support, Microsoft cloud, cybersecurity, backup and connectivity.
FY25/26 revenue £1.1m. 70% recurring revenue. 38 customer organisations. 7 employees.
The largest customer represents approximately 9% of revenue.
100% share sale sought.
This teaser is provided solely for preliminary discussion and is subject to due diligence.`;

export const SLATE: Scenario = {
  opco: { name: "Project SLATE", website: "", introLink: "https://slate-mandate.test/nda", notes: SLATE_TEASER },
  pages: { "https://slate-mandate.test/nda": { text: "Request the Project SLATE information memorandum. A non-disclosure agreement is required." } },
  claims: [
    { key: "prop", field: "proposition", statement: "100% share sale of an established Lancashire and West Yorkshire MSP", status: "FACT", quote: "established managed IT services provider supporting small and mid-sized organisations across Lancashire and West Yorkshire", basis: null },
    { key: "products", field: "products", statement: "Service desk, Microsoft cloud, cybersecurity, backup and connectivity", status: "FACT", quote: "service desk support, Microsoft cloud, cybersecurity, backup and connectivity", basis: null },
    { key: "recurring", field: "commercialModel", statement: "70% recurring revenue", status: "FACT", quote: "70% recurring revenue", basis: null },
    { key: "sale", field: "commercialModel", statement: "100% share sale sought", status: "FACT", quote: "100% share sale sought", basis: null },
    { key: "concentration", field: "proof", statement: "Largest customer about 9% of revenue", status: "FACT", quote: "largest customer represents approximately 9% of revenue", basis: null },
    { key: "buyer", field: "buyer", statement: "Acquisitive MSP groups and PE-backed consolidators", status: "INFERENCE", quote: null, basis: "A 100% share sale of a recurring-revenue MSP suits trade buyers running buy-and-build" },
    { key: "price", field: "cost", statement: "Price not stated", status: "UNKNOWN", quote: null, basis: null },
  ],
  profile: {
    proposition: { text: "Acquisition of an established MSP in Lancashire and West Yorkshire (100% share sale)", claimKeys: ["prop", "sale"] },
    problem: { text: "Acquirers seeking regional SME recurring revenue", claimKeys: ["recurring"] },
    usp: { text: "70% recurring revenue; low customer concentration", claimKeys: ["recurring", "concentration"] },
    cost: { text: "Not stated in the teaser", claimKeys: ["price"] },
    ...ACQUIRER_PROFILE,
    exclusions: [{ kind: "rule", value: "Competitors of the target in its own towns", reason: "Confidentiality risk" }],
  },
  pitch: {
    proposition: "Project SLATE is an established managed IT services provider across Lancashire and West Yorkshire, and a 100% share sale is sought.",
    teaser: "It has 70% recurring revenue across 38 customer organisations; the teaser is available under NDA here:",
  },
  prospects: Object.keys(ACQUIRERS),
};

/**
 * Load private scenarios (e.g. a real, confidential mandate) from JSON files in
 * a directory that is excluded from version control.
 */
export function loadPrivateScenarios(dir = process.env.HIJOJO_PRIVATE_SCENARIOS ?? ".data/private-scenarios"): Scenario[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Scenario);
}

/**
 * The sale mandates the demo runs: any private ones found locally, otherwise the
 * fictional Project SLATE. Not both, since they target the same fictional
 * acquirers and the duplicate rule would (correctly) block the second.
 */
export function demoScenarios(): Scenario[] {
  const priv = loadPrivateScenarios();
  return priv.length ? priv : [SLATE];
}
