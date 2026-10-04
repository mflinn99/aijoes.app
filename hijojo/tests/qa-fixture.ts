// A known-good QA context; each test breaks exactly one thing.

import type { QaContext } from "../server/qa/qa";
import { renderBody } from "../server/agents/compose";
import { testConfig } from "../server/config";
import type { Claim, Communication, Contact, Finding, Opco, Prospect, ProspectingProfile, Source } from "../shared/types";

export const NOW = new Date("2026-10-05T09:00:00.000Z");

export const opco: Opco = {
  id: "o1", name: "Clearwater", website: "https://clearwater.test", introLink: "https://clearwater.test/intro",
  notes: "", status: "PROFILED", statusDetail: null, createdAt: NOW.toISOString(),
};

export const sources: Source[] = [
  {
    id: "s-news", url: "https://northbridge.test/news", kind: "prospect-site", title: null, retrievedAt: "2026-10-04T00:00:00.000Z",
    publishedAt: "2026-09-21T00:00:00.000Z", contentHash: "h",
    text: "Northbridge Freight will open a 40,000 sq ft bonded warehouse at Felixstowe in January 2027.",
  },
  {
    id: "s-careers", url: "https://northbridge.test/careers", kind: "prospect-site", title: null, retrievedAt: "2026-10-04T00:00:00.000Z",
    publishedAt: "2026-09-28T00:00:00.000Z", contentHash: "h",
    text: "We are recruiting four customs entry clerks to support growing import volumes.",
  },
  {
    id: "s-opco", url: "https://clearwater.test", kind: "opco-site", title: null, retrievedAt: "2026-10-01T00:00:00.000Z",
    publishedAt: null, contentHash: "h", text: "Clearwater files UK customs declarations automatically for freight forwarders.",
  },
];

export const findings: Finding[] = [
  {
    id: "f-warehouse", prospectId: "p1", kind: "trigger", statement: "Opening a bonded warehouse at Felixstowe in January 2027",
    status: "FACT", evidence: [{ sourceId: "s-news", quote: "open a 40,000 sq ft bonded warehouse at Felixstowe" }],
    signalId: "new-bonded-site", observedAt: "2026-09-21T00:00:00.000Z", note: null,
  },
  {
    id: "f-hiring", prospectId: "p1", kind: "trigger", statement: "Recruiting four customs entry clerks",
    status: "FACT", evidence: [{ sourceId: "s-careers", quote: "recruiting four customs entry clerks" }],
    signalId: "customs-hiring", observedAt: "2026-09-28T00:00:00.000Z", note: null,
  },
];

export const claims: Claim[] = [
  {
    id: "c-prop", field: "proposition", statement: "Automated UK customs declarations for freight forwarders", status: "FACT",
    evidence: [{ sourceId: "s-opco", quote: "files UK customs declarations automatically" }], basis: null, note: null,
  },
  { id: "c-roi", field: "proof", statement: "Cuts clearance time by 70%", status: "UNKNOWN", evidence: [], basis: null, note: "not found" },
];

export const profile: ProspectingProfile = {
  opcoId: "o1", version: 1,
  proposition: { text: "Automated customs declarations", status: "FACT", claimIds: ["c-prop"] },
  problem: { text: "Manual entries", status: "FACT", claimIds: [] },
  usp: { text: "", status: "UNKNOWN", claimIds: [] },
  cost: { text: "", status: "UNKNOWN", claimIds: [] },
  icp: {
    sectors: ["Freight forwarding"], subsectors: [], geographies: ["United Kingdom"], employeeMin: 50, employeeMax: 1000, revenue: null,
    technology: [], maturity: null, ownership: [], growth: null, regulatory: [], other: [],
  },
  buyers: { economic: ["Chief Operating Officer"], operational: ["Head of Customs"], technical: [], influencer: [] },
  signals: [
    { id: "new-bonded-site", name: "New bonded facility", description: "", whyItMatters: "", keywords: [] },
    { id: "customs-hiring", name: "Hiring customs staff", description: "", whyItMatters: "", keywords: [] },
  ],
  exclusions: [{ kind: "domain", value: "clearwater.test", reason: "AIGoGo company" }],
  complete: true, gaps: [], createdAt: NOW.toISOString(),
};

export const prospect: Prospect = {
  id: "p1", opcoId: "o1", name: "Northbridge Freight", domain: "northbridge.test", status: "QUALIFIED", statusReason: null,
  attributes: { sector: "Freight forwarding", employees: 320, geography: "United Kingdom" }, score: null,
  whyThem: "", whyNow: "", whyProposition: "", conflicts: [], contactId: "ct1", discoveredVia: "test",
  createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), researchedAt: NOW.toISOString(),
};

export const contact: Contact = {
  id: "ct1", prospectId: "p1", name: "Dana Reyes", title: "Chief Operating Officer", email: "dana.reyes@northbridge.test",
  emailStatus: "verified", employerDomain: "northbridge.test", source: "test", sourceUrl: null,
};

export const sections = {
  whyThem: "Northbridge Freight's plan to open a bonded warehouse at Felixstowe caught my eye.",
  whyNow: "With customs entry clerks being recruited ahead of January, declaration volumes are clearly about to rise.",
  problem: "Keying entries by hand tends to become the bottleneck when a bonded site comes online.",
  proposition: "Clearwater files UK customs declarations automatically for freight forwarders.",
  teaser: "There is a two-minute walkthrough of how a new bonded site gets set up:",
  cta: "Would it be useful to see it before the Felixstowe opening?",
};

export function comm(over: Partial<Communication> = {}, s = sections): Communication {
  const body = renderBody({ contact, sections: s, link: opco.introLink, senderName: "Alex Morgan", opcoName: opco.name });
  return {
    id: "cm1", prospectId: "p1", contactId: "ct1", kind: "intro", attempt: 1,
    subject: "Felixstowe bonded warehouse and customs entries",
    body, link: opco.introLink, sections: s,
    evidence: [
      { section: "whyThem", findingId: "f-warehouse" },
      { section: "whyNow", findingId: "f-hiring" },
    ],
    opcoClaimIds: ["c-prop"], approach: "trigger-led", status: "DRAFT", statusReason: null, contentHash: "h",
    createdAt: NOW.toISOString(), sentAt: null,
    ...over,
  };
}

export function ctx(over: Partial<QaContext> = {}): QaContext {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return {
    comm: comm(),
    opco,
    otherOpcoNames: ["SaleSonic", "Toleron"],
    prospect,
    profile,
    contact,
    findings,
    sources: (id) => byId.get(id),
    claims,
    suppressed: { suppressed: false, reason: null },
    history: { outbound: [], inbound: [], intro: null, introFindings: [], otherBodies: [], domainOutboundOtherOpcos: [] },
    now: NOW,
    config: testConfig(),
    ...over,
  };
}
