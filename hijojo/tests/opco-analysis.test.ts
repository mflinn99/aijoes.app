import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db";
import { Repo } from "../server/repo";
import { FakeClock } from "../server/clock";
import { SimWeb } from "../server/sim/web";
import { ScriptedLlm } from "../server/llm/client";
import { analyseOpco } from "../server/agents/opco";

const SITE = "https://clearwater.test";

function web() {
  return new SimWeb({
    [SITE]: {
      html: `<title>Clearwater Customs</title><p>Clearwater files UK customs declarations automatically for freight forwarders.</p>
             <p>Manual customs entries delay shipments and incur penalties.</p>`,
    },
    [`${SITE}/pricing`]: { html: `<p>Plans start at £900 per month for up to 500 declarations.</p>` },
    [`${SITE}/about`]: { html: `<p>Clearwater is the only platform that submits directly to the CDS service with no broker.</p>` },
  });
}

/** The scripted analyst cites the stored source ids it is given. */
function analyst(opts: { fabricateProposition?: boolean } = {}) {
  return new ScriptedLlm({
    opco_analysis: (t) => {
      const sources = (t.context as { sources: { id: string; url: string }[] }).sources;
      const home = sources.find((s) => s.url === SITE)!.id;
      const pricing = sources.find((s) => s.url.endsWith("/pricing"))!.id;
      const about = sources.find((s) => s.url.endsWith("/about"))!.id;
      return {
        claims: [
          {
            key: "prop",
            field: "proposition",
            statement: "Automated UK customs declarations for freight forwarders",
            status: "FACT",
            evidence: [
              {
                sourceId: home,
                quote: opts.fabricateProposition
                  ? "Clearwater is trusted by 400 of the UK's largest forwarders"
                  : "files UK customs declarations automatically for freight forwarders",
              },
            ],
            basis: null,
          },
          { key: "problem", field: "problem", statement: "Manual entries delay shipments", status: "FACT", evidence: [{ sourceId: home, quote: "Manual customs entries delay shipments and incur penalties" }], basis: null },
          { key: "usp", field: "usp", statement: "Submits directly to CDS without a broker", status: "FACT", evidence: [{ sourceId: about, quote: "submits directly to the CDS service with no broker" }], basis: null },
          { key: "cost", field: "cost", statement: "From £900 per month", status: "FACT", evidence: [{ sourceId: pricing, quote: "Plans start at £900 per month" }], basis: null },
          { key: "buyer", field: "buyer", statement: "Operations leaders at forwarders", status: "INFERENCE", evidence: [], basis: "The product replaces an operational process" },
          { key: "roi", field: "proof", statement: "Cuts clearance time by 70%", status: "FACT", evidence: [{ sourceId: home, quote: "cuts clearance time by 70%" }], basis: null },
        ],
      };
    },
    opco_profile: () => ({
      proposition: { text: "Automated customs declarations for UK freight forwarders", claimKeys: ["prop"] },
      problem: { text: "Manual entries delay shipments", claimKeys: ["problem"] },
      usp: { text: "Direct CDS submission, no broker", claimKeys: ["usp"] },
      cost: { text: "From £900/month", claimKeys: ["cost"] },
      icp: {
        sectors: ["Freight forwarding"], subsectors: [], geographies: ["United Kingdom"], employeeMin: 50, employeeMax: 1000,
        revenue: null, technology: [], maturity: null, ownership: [], growth: null, regulatory: ["UK customs"], other: [],
      },
      buyers: { economic: ["Managing Director"], operational: ["Head of Customs"], technical: [], influencer: [] },
      signals: [{ id: "new-bonded-site", name: "New bonded facility", description: "Opening bonded warehouse capacity", whyItMatters: "More declarations", keywords: ["bonded"] }],
      exclusions: [{ kind: "domain", value: "rival.test", reason: "Competitor" }],
    }),
  });
}

describe("OpCo analysis", () => {
  let repo: Repo;
  beforeEach(() => {
    repo = new Repo(openDb(":memory:"), new FakeClock());
  });

  it("extracts proposition, USP, cost and buyer with their evidence status", async () => {
    const opco = repo.createOpco({ name: "Clearwater", website: SITE });
    await analyseOpco({ repo, llm: analyst(), fetcher: web() }, opco.id);
    const claims = repo.claims(opco.id);
    const byField = (f: string) => claims.find((c) => c.field === f)!;
    expect(byField("proposition").status).toBe("FACT");
    expect(byField("usp").status).toBe("FACT");
    expect(byField("cost").status).toBe("FACT");
    expect(byField("buyer").status).toBe("INFERENCE");
  });

  it("never stores an invented marketing claim as FACT", async () => {
    const opco = repo.createOpco({ name: "Clearwater", website: SITE });
    await analyseOpco({ repo, llm: analyst(), fetcher: web() }, opco.id);
    const roi = repo.claims(opco.id).find((c) => c.field === "proof")!;
    expect(roi.status).toBe("UNKNOWN");
    expect(roi.note).toMatch(/not found/);
  });

  it("builds a prospecting profile with ICP, buyers and buying signals", async () => {
    const opco = repo.createOpco({ name: "Clearwater", website: SITE });
    await analyseOpco({ repo, llm: analyst(), fetcher: web() }, opco.id);
    const profile = repo.profile(opco.id)!;
    expect(profile.complete).toBe(true);
    expect(profile.proposition.status).toBe("FACT");
    expect(profile.cost).toMatchObject({ status: "FACT", text: "From £900/month" });
    expect(profile.icp.sectors).toEqual(["Freight forwarding"]);
    expect(profile.buyers.operational).toEqual(["Head of Customs"]);
    expect(profile.signals.map((s) => s.id)).toEqual(["new-bonded-site"]);
    expect(repo.opco(opco.id)!.status).toBe("PROFILED");
  });

  it("excludes the OpCo itself and other OpCos from prospecting", async () => {
    repo.createOpco({ name: "Sister", website: "https://sister.test" });
    const opco = repo.createOpco({ name: "Clearwater", website: SITE });
    await analyseOpco({ repo, llm: analyst(), fetcher: web() }, opco.id);
    const domains = repo.profile(opco.id)!.exclusions.filter((x) => x.kind === "domain").map((x) => x.value);
    expect(domains).toEqual(expect.arrayContaining(["clearwater.test", "sister.test", "rival.test"]));
  });

  it("marks the profile incomplete, so prospecting cannot start, when the proposition is unsupported", async () => {
    const opco = repo.createOpco({ name: "Clearwater", website: SITE });
    await analyseOpco({ repo, llm: analyst({ fabricateProposition: true }), fetcher: web() }, opco.id);
    const profile = repo.profile(opco.id)!;
    expect(profile.complete).toBe(false);
    expect(profile.gaps.join(" ")).toMatch(/proposition/i);
    expect(repo.opco(opco.id)!.status).toBe("INCOMPLETE");
  });

  it("uses supplied documents as a source", async () => {
    const opco = repo.createOpco({ name: "Clearwater", website: SITE, notes: "Board pack: 32 forwarders on contract." });
    await analyseOpco({ repo, llm: analyst(), fetcher: web() }, opco.id);
    expect(repo.sourcesFor({ opcoId: opco.id }).some((s) => s.kind === "opco-document" && s.text.includes("32 forwarders"))).toBe(true);
  });

  it("fails honestly, inventing nothing, when the website cannot be retrieved", async () => {
    const opco = repo.createOpco({ name: "Ghost", website: "https://unreachable.test" });
    const llm = analyst();
    await analyseOpco({ repo, llm, fetcher: new SimWeb() }, opco.id);
    expect(repo.opco(opco.id)!.status).toBe("FAILED");
    expect(repo.claims(opco.id)).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it("analyses an OpCo from supplied documents alone when it has no website (e.g. a sale mandate)", async () => {
    const doc = "Project SLATE is an established Lancashire managed IT services provider. 100% share sale sought.";
    const llm = new ScriptedLlm({
      opco_analysis: (t) => {
        const src = (t.context as any).sources[0];
        expect(src.url).toBe("supplied:notes");
        return { claims: [{ key: "prop", field: "proposition", statement: "Sale of an established MSP", status: "FACT", evidence: [{ sourceId: src.id, quote: "established Lancashire managed IT services provider" }], basis: null }] };
      },
      opco_profile: () => ({
        proposition: { text: "Acquisition of an established Lancashire MSP", claimKeys: ["prop"] },
        problem: { text: "Acquirers need regional scale", claimKeys: ["prop"] },
        usp: { text: "", claimKeys: [] },
        cost: { text: "", claimKeys: [] },
        icp: { sectors: ["Managed IT services"], subsectors: [], geographies: ["United Kingdom"], employeeMin: null, employeeMax: null, revenue: null, technology: [], maturity: null, ownership: [], growth: null, regulatory: [], other: [] },
        buyers: { economic: ["Chief Executive Officer"], operational: [], technical: [], influencer: [] },
        signals: [{ id: "recent-acquisition", name: "Recent MSP acquisition", description: "", whyItMatters: "", keywords: [] }],
        exclusions: [],
      }),
    });
    const fetcher = new SimWeb();
    const opco = repo.createOpco({ name: "Project SLATE", website: "", introLink: "https://slate.test/nda", notes: doc });
    const profile = await analyseOpco({ repo, llm, fetcher }, opco.id);
    expect(profile?.complete).toBe(true);
    expect(fetcher.requests).toHaveLength(0);
    expect(profile!.exclusions.every((x) => x.value !== "")).toBe(true);
    expect(repo.opco(opco.id)!.status).toBe("PROFILED");
  });

  it("fails honestly when there is neither a website nor a document", async () => {
    const opco = repo.createOpco({ name: "Empty", website: "", introLink: "https://x.test" });
    const llm = analyst();
    await analyseOpco({ repo, llm, fetcher: new SimWeb() }, opco.id);
    expect(repo.opco(opco.id)!.status).toBe("FAILED");
    expect(llm.calls).toHaveLength(0);
  });
});
