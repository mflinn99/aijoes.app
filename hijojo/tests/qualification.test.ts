import { describe, expect, it } from "vitest";
import {
  decideQualification,
  effectiveThreshold,
  icpMatch,
  matchExclusion,
  roleMatch,
  scoreProspect,
  type Assessment,
} from "../server/qualification";
import type { Contact, Finding, ProspectingProfile, Source } from "../shared/types";
import { SCORE_WEIGHTS } from "../shared/types";

const NOW = new Date("2026-10-05T09:00:00.000Z");

const profile: ProspectingProfile = {
  opcoId: "o1",
  version: 1,
  proposition: { text: "Automated customs declarations", status: "FACT", claimIds: ["c1"] },
  problem: { text: "Manual customs filing delays freight", status: "FACT", claimIds: ["c2"] },
  usp: { text: "Files directly to CDS", status: "FACT", claimIds: ["c3"] },
  cost: { text: "From £900/month", status: "FACT", claimIds: ["c4"] },
  icp: {
    sectors: ["Logistics", "Freight forwarding"],
    subsectors: [],
    geographies: ["United Kingdom"],
    employeeMin: 50,
    employeeMax: 1000,
    revenue: null,
    technology: [],
    maturity: null,
    ownership: [],
    growth: null,
    regulatory: [],
    other: [],
  },
  buyers: {
    economic: ["Chief Operating Officer", "Managing Director"],
    operational: ["Head of Customs", "Operations Director"],
    technical: ["IT Director"],
    influencer: ["Compliance Manager"],
  },
  signals: [
    { id: "sig-warehouse", name: "New bonded facility", description: "", whyItMatters: "", keywords: ["bonded"] },
    { id: "sig-hiring", name: "Hiring customs staff", description: "", whyItMatters: "", keywords: ["customs clerk"] },
  ],
  exclusions: [
    { kind: "domain", value: "competitor.test", reason: "Competitor" },
    { kind: "sector", value: "Public sector", reason: "Procurement rules" },
    { kind: "name", value: "Existing Client Ltd", reason: "Already a customer" },
  ],
  complete: true,
  gaps: [],
  createdAt: NOW.toISOString(),
};

const src = (id: string): Source => ({
  id, url: `https://${id}.test`, kind: "news", title: null, retrievedAt: NOW.toISOString(), publishedAt: null, contentHash: "h", text: "",
});

const f = (id: string, kind: Finding["kind"], extra: Partial<Finding> = {}): Finding => ({
  id,
  prospectId: "p1",
  kind,
  statement: id,
  status: "FACT",
  evidence: [{ sourceId: `src-${id}`, quote: "a quotation long enough" }],
  signalId: null,
  observedAt: null,
  note: null,
  ...extra,
});

const findings: Finding[] = [
  f("ident", "identity"),
  f("icp", "icp"),
  f("trig", "trigger", { signalId: "sig-warehouse", observedAt: "2026-09-20T00:00:00.000Z" }),
  f("comm", "commercial"),
];
const sources = new Map(findings.map((x) => [`src-${x.id}`, src(`src-${x.id}`)]));

const coo: Contact = {
  id: "ct1", prospectId: "p1", name: "Dana Reyes", title: "Chief Operating Officer", email: "dana@northbridge.test",
  emailStatus: "verified", employerDomain: "northbridge.test", source: "manual", sourceUrl: null,
};

const strong: Assessment = {
  icpFit: { points: 30, rationale: "UK freight forwarder, 300 staff", findingIds: ["icp", "ident"] },
  need: { points: 30, rationale: "Opening a bonded warehouse", findingIds: ["trig"] },
  timing: { points: 10, rationale: "Announced two weeks ago", findingIds: ["trig"] },
  commercial: { points: 10, rationale: "Volume justifies subscription", findingIds: ["comm"] },
};

const attrs = { sector: "Freight forwarding", employees: 300, geography: "United Kingdom" };

describe("weights", () => {
  it("are exactly the remit's and sum to 100", () => {
    expect(SCORE_WEIGHTS).toEqual({ icpFit: 30, need: 30, buyer: 15, timing: 10, commercial: 10, evidence: 5 });
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("threshold", () => {
  it("defaults to 80 and can be raised but never lowered", () => {
    expect(effectiveThreshold(undefined)).toBe(80);
    expect(effectiveThreshold(90)).toBe(90);
    expect(effectiveThreshold(50)).toBe(80);
    expect(effectiveThreshold(Number.NaN)).toBe(80);
  });
});

describe("ICP matching", () => {
  it("matches sector, size and geography", () => {
    const m = icpMatch(attrs, profile.icp);
    expect(m).toMatchObject({ sector: "match", size: "match", geography: "match", cap: 30 });
  });

  it("caps a sector outside the ICP to zero", () => {
    expect(icpMatch({ ...attrs, sector: "Fashion retail" }, profile.icp).cap).toBe(0);
  });

  it("caps a company outside the size range", () => {
    expect(icpMatch({ ...attrs, employees: 12 }, profile.icp).cap).toBeLessThanOrEqual(15);
  });

  it("does not award full fit on unknown attributes", () => {
    expect(icpMatch({ sector: null, employees: null, geography: null }, profile.icp).cap).toBeLessThan(30);
  });
});

describe("exclusions", () => {
  it("matches domain, name and sector exclusions", () => {
    expect(matchExclusion({ name: "X", domain: "www.competitor.test", attributes: attrs }, profile)?.reason).toBe("Competitor");
    expect(matchExclusion({ name: "existing client ltd", domain: "e.test", attributes: attrs }, profile)?.reason).toBe("Already a customer");
    expect(matchExclusion({ name: "Council", domain: "c.test", attributes: { ...attrs, sector: "Public sector" } }, profile)?.reason).toBe(
      "Procurement rules",
    );
    expect(matchExclusion({ name: "Northbridge", domain: "northbridge.test", attributes: attrs }, profile)).toBeNull();
  });
});

describe("buyer role matching", () => {
  it("matches equivalent titles and abbreviations", () => {
    expect(roleMatch("COO", profile.buyers)).toBe("economic");
    expect(roleMatch("Director of Operations", profile.buyers)).toBe("operational");
    expect(roleMatch("Group IT Director", profile.buyers)).toBe("technical");
  });

  it("never matches junior titles", () => {
    expect(roleMatch("Operations Director (Intern)", profile.buyers)).toBeNull();
    expect(roleMatch("Marketing Intern", profile.buyers)).toBeNull();
  });
});

describe("scoring", () => {
  it("scores an evidenced prospect with a relevant contact above threshold", () => {
    const card = scoreProspect({ assessment: strong, findings, sources, contact: coo, profile, attributes: attrs, now: NOW });
    expect(card.dimensions.buyer.points).toBe(15);
    expect(card.dimensions.timing.points).toBe(10);
    expect(card.total).toBeGreaterThanOrEqual(80);
    expect(card.passed).toBe(true);
    expect(card.total).toBe(Object.values(card.dimensions).reduce((a, d) => a + d.points, 0));
  });

  it("clamps inflated points to the dimension's weight", () => {
    const card = scoreProspect({
      assessment: { ...strong, need: { ...strong.need, points: 99 } },
      findings, sources, contact: coo, profile, attributes: attrs, now: NOW,
    });
    expect(card.dimensions.need.points).toBe(30);
  });

  it("gives no need points without a cited trigger finding (no 'they are in the sector')", () => {
    const card = scoreProspect({
      assessment: { ...strong, need: { points: 30, rationale: "They are in the target sector", findingIds: ["icp"] } },
      findings, sources, contact: coo, profile, attributes: attrs, now: NOW,
    });
    expect(card.dimensions.need.points).toBe(0);
    expect(card.passed).toBe(false);
  });

  it("ignores findings that are not FACT for need and timing", () => {
    const inferred = findings.map((x) => (x.id === "trig" ? { ...x, status: "INFERENCE" as const } : x));
    const card = scoreProspect({ assessment: strong, findings: inferred, sources, contact: coo, profile, attributes: attrs, now: NOW });
    expect(card.dimensions.need.points).toBe(0);
    expect(card.dimensions.timing.points).toBe(0);
  });

  it("ignores cited findings that do not exist", () => {
    const card = scoreProspect({
      assessment: { ...strong, commercial: { points: 10, rationale: "", findingIds: ["made-up"] } },
      findings, sources, contact: coo, profile, attributes: attrs, now: NOW,
    });
    expect(card.dimensions.commercial.points).toBe(0);
  });

  it("reduces timing for a stale trigger", () => {
    const stale = findings.map((x) => (x.id === "trig" ? { ...x, observedAt: "2026-01-01T00:00:00.000Z" } : x));
    const card = scoreProspect({ assessment: strong, findings: stale, sources, contact: coo, profile, attributes: attrs, now: NOW });
    expect(card.dimensions.timing.points).toBe(0);
  });

  it("gives no buyer points without an appropriate contact", () => {
    const card = scoreProspect({ assessment: strong, findings, sources, contact: null, profile, attributes: attrs, now: NOW });
    expect(card.dimensions.buyer.points).toBe(0);
  });

  it("does not count signals that learning has suspended", () => {
    const card = scoreProspect({
      assessment: strong, findings, sources, contact: coo, profile, attributes: attrs, now: NOW, suspendedSignals: ["sig-warehouse"],
    });
    expect(card.dimensions.need.points).toBe(0);
  });

  it("derives evidence quality from distinct verified sources", () => {
    const card = scoreProspect({ assessment: strong, findings, sources, contact: coo, profile, attributes: attrs, now: NOW });
    expect(card.dimensions.evidence.points).toBe(5);
    const thin = findings.map((x) => ({ ...x, evidence: [{ sourceId: "src-icp", quote: "a quotation long enough" }] }));
    expect(scoreProspect({ assessment: strong, findings: thin, sources, contact: coo, profile, attributes: attrs, now: NOW }).dimensions.evidence.points).toBe(1);
  });

  it("reports a confidence between 0 and 100", () => {
    const card = scoreProspect({ assessment: strong, findings, sources, contact: coo, profile, attributes: attrs, now: NOW });
    expect(card.confidence).toBeGreaterThan(0);
    expect(card.confidence).toBeLessThanOrEqual(100);
  });
});

describe("qualification decision", () => {
  const card = scoreProspect({ assessment: strong, findings, sources, contact: coo, profile, attributes: attrs, now: NOW });

  it("qualifies at or above threshold", () => {
    expect(decideQualification({ card, exclusion: null, conflicts: [] }).status).toBe("QUALIFIED");
  });

  it("rejects an excluded company whatever its score", () => {
    expect(decideQualification({ card, exclusion: { kind: "domain", value: "x", reason: "Competitor" }, conflicts: [] })).toMatchObject({
      status: "REJECTED",
    });
  });

  it("returns a prospect with conflicting data to research", () => {
    expect(decideQualification({ card, exclusion: null, conflicts: ["Two different registered addresses"] }).status).toBe("RESEARCHING");
  });

  it("rejects below threshold and says by how much", () => {
    const low = { ...card, total: 79, passed: false };
    const d = decideQualification({ card: low, exclusion: null, conflicts: [] });
    expect(d.status).toBe("REJECTED");
    expect(d.reason).toMatch(/79/);
  });
});
