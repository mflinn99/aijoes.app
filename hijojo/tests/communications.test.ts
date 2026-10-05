import { describe, expect, it } from "vitest";
import { runQa } from "../server/qa/qa";
import { comm, contact, ctx, findings, opco, sections, sources } from "./qa-fixture";
import { renderBody } from "../server/agents/compose";

const failed = (r: ReturnType<typeof runQa>) => r.checks.filter((c) => !c.passed).map((c) => c.name);

function withSections(over: Partial<typeof sections>, extra: Parameters<typeof comm>[0] = {}) {
  return comm(extra, { ...sections, ...over });
}

describe("independent QA: a good message", () => {
  it("passes and can answer all six relevance questions", () => {
    const r = runQa(ctx());
    expect(failed(r)).toEqual([]);
    expect(r.verdict).toBe("PASS");
    for (const v of Object.values(r.relevance)) expect(v).toBeTruthy();
  });

  it("renders the remit's structure: why them, why now, problem, proposition, teaser, link, CTA, opt-out", () => {
    const body = comm().body;
    const order = [sections.whyThem, sections.whyNow, sections.problem, sections.proposition, sections.teaser, opco.introLink, sections.cta, "no thanks"];
    const positions = order.map((s) => body.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("prospect-specific relevance", () => {
  it("rejects a message with no evidenced reason for choosing this company", () => {
    const c = withSections({ whyThem: "I work with a lot of logistics businesses." }, { evidence: [{ section: "whyNow", findingId: "f-hiring" }] });
    const r = runQa(ctx({ comm: c }));
    expect(failed(r)).toContain("relevance.whyCompany");
    expect(r.verdict).toBe("REJECT");
  });

  it("rejects a message with no current trigger (why now)", () => {
    const c = comm({ evidence: [{ section: "whyThem", findingId: "f-warehouse" }] });
    expect(failed(runQa(ctx({ comm: c })))).toContain("relevance.whyNow");
  });

  it("returns for rework a message that cites evidence but is not specific to the recipient", () => {
    const c = withSections({
      whyThem: "Your recent news caught my eye.",
      whyNow: "It sounds like an exciting time for the business.",
    });
    const r = runQa(ctx({ comm: c }));
    expect(failed(r)).toContain("relevance.specific");
  });

  it("flags a message that is near-identical to one sent to someone else", () => {
    const other = renderBody({ contact: { name: "Sam Hart" }, sections, link: opco.introLink, senderName: "Alex Morgan", opcoName: opco.name });
    const r = runQa(ctx({ history: { outbound: [], inbound: [], intro: null, introFindings: [], otherBodies: [other], domainOutboundOtherOpcos: [] } }));
    expect(failed(r)).toContain("relevance.specific");
  });

  it("rejects a citation to a finding that is not verified FACT", () => {
    const inferred = findings.map((f) => (f.id === "f-warehouse" ? { ...f, status: "INFERENCE" as const } : f));
    expect(failed(runQa(ctx({ findings: inferred })))).toContain("evidence.verified");
  });

  it("rejects a citation whose quotation no longer matches the stored source", () => {
    const tampered = findings.map((f) => (f.id === "f-warehouse" ? { ...f, evidence: [{ sourceId: "s-news", quote: "opening ten warehouses nationwide" }] } : f));
    expect(failed(runQa(ctx({ findings: tampered })))).toContain("evidence.verified");
  });
});

describe("unsupported claims", () => {
  it("rejects a statistic that no evidence supports", () => {
    const c = withSections({ proposition: "Clearwater cuts clearance time by 70% for freight forwarders." });
    const r = runQa(ctx({ comm: c }));
    expect(failed(r)).toContain("claims.supported");
    expect(r.verdict).toBe("REJECT");
  });

  it("rejects an unsupported superlative", () => {
    const c = withSections({ proposition: "Clearwater is the UK's leading customs platform." });
    expect(failed(runQa(ctx({ comm: c })))).toContain("claims.supported");
  });

  it("accepts a number that the cited evidence states", () => {
    const c = withSections({ whyThem: "Northbridge Freight's 40,000 sq ft bonded warehouse at Felixstowe caught my eye." });
    expect(failed(runQa(ctx({ comm: c })))).not.toContain("claims.supported");
  });

  it("rejects a proposition resting on a claim that is not FACT", () => {
    expect(failed(runQa(ctx({ comm: comm({ opcoClaimIds: ["c-roi"] }) })))).toContain("relevance.whyOpco");
  });

  it("rejects pricing, discounts and commitments (outside the agentic boundary)", () => {
    for (const cta of ["We can offer 20% off if you sign this month.", "We guarantee results within 30 days.", "Plans are priced at £900 a month."]) {
      expect(failed(runQa(ctx({ comm: withSections({ cta }) })))).toContain("claims.noCommitments");
    }
  });
});

describe("links", () => {
  it("rejects a message whose link is not the OpCo's", () => {
    const c = comm({ link: "https://elsewhere.test/demo", body: comm().body.replace(opco.introLink, "https://elsewhere.test/demo") });
    expect(failed(runQa(ctx({ comm: c })))).toContain("link.correct");
  });

  it("rejects extra links smuggled into the copy", () => {
    const c = withSections({ teaser: "See https://bit.ly/xyz for more, or the walkthrough:" });
    expect(failed(runQa(ctx({ comm: c })))).toContain("link.correct");
  });
});

describe("correct OpCo and recipient", () => {
  it("rejects a message that names a different OpCo", () => {
    const c = withSections({ proposition: "SaleSonic files UK customs declarations automatically for freight forwarders." });
    expect(failed(runQa(ctx({ comm: c })))).toContain("opco.correct");
  });

  it("rejects a recipient at a different company", () => {
    const r = runQa(ctx({ contact: { ...contact, email: "dana@gmail.test", employerDomain: "gmail.test" } }));
    expect(failed(r)).toContain("recipient.identity");
  });

  it("rejects an invalid or bounced address", () => {
    expect(failed(runQa(ctx({ contact: { ...contact, email: "not-an-email" } })))).toContain("recipient.valid");
    expect(failed(runQa(ctx({ contact: { ...contact, emailStatus: "bounced" } })))).toContain("recipient.valid");
  });

  it("rejects the wrong person and sends the prospect back to research", () => {
    const r = runQa(ctx({ contact: { ...contact, title: "Marketing Intern" } }));
    const check = r.checks.find((c) => c.name === "recipient.relevant")!;
    expect(check.passed).toBe(false);
    expect(check.scope).toBe("research");
    expect(r.verdict).toBe("REJECT");
  });

  it("returns a message without a clear call to action for rework", () => {
    expect(failed(runQa(ctx({ comm: withSections({ cta: "Thanks." }) })))).toContain("format.cta");
  });

  it("returns generic sales language for rework", () => {
    const c = withSections({ problem: "I hope this finds you well. Our innovative platform will transform your operations." });
    expect(failed(runQa(ctx({ comm: c })))).toContain("generic.language");
  });
});

describe("follow-up", () => {
  const intro = { ...comm(), status: "SENT" as const };
  const sentIntro = {
    id: "ob1", prospectId: "p1", commId: "cm1", kind: "intro" as const, toEmail: contact.email, status: "SENT" as const,
    providerId: "x", conversationId: "c", detail: null, createdAt: "2026-09-30T09:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z",
  };

  it("rejects a follow-up that only says it is following up", () => {
    const fu = withSections(
      { whyThem: "Just following up on my previous email about Northbridge Freight's bonded warehouse at Felixstowe." },
      { kind: "followup", id: "cm2", evidence: intro.evidence },
    );
    const r = runQa(ctx({ comm: fu, history: { outbound: [sentIntro], inbound: [], intro, introFindings: findings, otherBodies: [], domainOutboundOtherOpcos: [] } }));
    expect(failed(r)).toContain("followup.addsValue");
  });

  it("rejects a follow-up when the prospect has already replied", () => {
    const fu = comm({ kind: "followup", id: "cm2", evidence: [{ section: "whyThem", findingId: "f-warehouse" }, { section: "whyNow", findingId: "f-hiring" }] });
    const reply = {
      id: "in1", providerId: "p", prospectId: "p1", fromEmail: contact.email, fromName: null, subject: "Re:", body: "Not now",
      receivedAt: "2026-10-01T00:00:00.000Z", conversationId: "c", classification: null, classificationReason: null,
    };
    const r = runQa(ctx({ comm: fu, history: { outbound: [sentIntro], inbound: [reply], intro, introFindings: findings, otherBodies: [], domainOutboundOtherOpcos: [] } }));
    expect(failed(r)).toContain("history.previousResponse");
    expect(r.verdict).toBe("REJECT");
  });
});

// Regressions: each defect found during the build gets a test before its fix.
describe("regressions", () => {
  it("does not mistake 'leading' as a verb for a superlative claim", () => {
    const c = withSections({ whyNow: "With customs entry clerks being recruited while you are leading the move to a bonded site, volumes are clearly rising." });
    expect(failed(runQa(ctx({ comm: c })))).not.toContain("claims.supported");
    const bad = withSections({ proposition: "Clearwater is the UK's leading customs platform." });
    expect(failed(runQa(ctx({ comm: bad })))).toContain("claims.supported");
  });

  it("does not treat a system name in the evidence (e.g. CHIEF) as shouting", () => {
    const withAcronym = findings.map((f) =>
      f.id === "f-hiring" ? { ...f, statement: "Recruiting customs entry clerks to replace CHIEF entries" } : f,
    );
    const c = withSections({ problem: "Keying CHIEF entries by hand tends to become the bottleneck when a bonded site comes online." });
    expect(failed(runQa(ctx({ comm: c, findings: withAcronym })))).not.toContain("format");
    const shouty = withSections({ cta: "Would it be useful to see it before the opening? URGENT." });
    expect(failed(runQa(ctx({ comm: shouty })))).toContain("format");
  });
});

describe("regressions: sale mandates", () => {
  it("allows a sourced financial figure that is not a price, but still rejects pricing", () => {
    const sale = sources.map((s) => (s.id === "s-opco" ? { ...s, text: `${s.text} Revenue of £640k in FY25/26.` } : s));
    const byId = new Map(sale.map((s) => [s.id, s]));
    const c = withSections({ teaser: "The business turned over £640k in FY25/26; the walkthrough is here:" });
    expect(failed(runQa(ctx({ comm: c, sources: (id) => byId.get(id) })))).not.toContain("claims.noCommitments");
    for (const cta of ["The asking price is £1.2m.", "It costs £900 per month.", "Valuation of £2m is expected."]) {
      expect(failed(runQa(ctx({ comm: withSections({ cta }), sources: (id) => byId.get(id) })))).toContain("claims.noCommitments");
    }
  });

  it("does not treat the OpCo's own capitalised name (e.g. Project SLATE) as shouting", () => {
    const rock = { ...opco, name: "Project SLATE" };
    const s2 = { ...sections, proposition: "Project SLATE files UK customs declarations automatically for freight forwarders." };
    const c = comm({}, s2);
    const body = c.body.replace(/Clearwater/g, "Project SLATE");
    expect(failed(runQa(ctx({ opco: rock, comm: { ...c, body } })))).not.toContain("format");
  });
});
