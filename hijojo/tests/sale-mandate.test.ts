// A sale mandate end to end: an OpCo with no website, analysed from its teaser,
// prospecting for acquirers. Fictional data only.

import { describe, expect, it } from "vitest";
import { createWorld } from "../server/sim/world";
import { ACQUIRERS, SLATE } from "../server/sim/scenarios";

const email = (d: string) => ACQUIRERS[d].contacts[0].email;

async function launched(opts: Parameters<typeof createWorld>[0] = {}) {
  const w = createWorld({ scenarios: [SLATE], ...opts });
  const opco = w.engine.addOpco(SLATE.opco);
  await w.settle();
  return { ...w, opco };
}

describe("sale mandate (Project SLATE, fictional)", () => {
  it("profiles the mandate from the teaser alone and contacts only qualified acquirers", async () => {
    const w = await launched();
    const opco = w.repo.opco(w.opco.id)!;
    expect(opco.status).toBe("PROFILED");
    expect(w.web.requests.some((u) => u.includes("slate-mandate.test") && !u.startsWith("CHECK"))).toBe(false);
    const cost = w.repo.profile(opco.id)!.cost;
    expect(cost.status).toBe("UNKNOWN"); // the teaser states no price; none is invented

    const status = Object.fromEntries(w.repo.prospects().map((p) => [p.domain, p.status]));
    expect(status).toEqual({
      "penninems.test": "CONTACTED",
      "northgatecloud.test": "CONTACTED",
      "saltaire.test": "REJECTED", // not an acquirer
      "ousevalley.test": "REJECTED", // last deal in 2023: no current appetite
      "caldersystems.test": "RESEARCHING", // right company, wrong person
    });
  });

  it("sends the teaser facts, the NDA link and no price", async () => {
    const w = await launched();
    const [m] = w.mail.sentTo(email("penninems.test"));
    expect(m.body).toContain("Project SLATE");
    expect(m.body).toContain("70% recurring revenue across 38 customer organisations");
    expect(m.body).toContain(SLATE.opco.introLink);
    expect(m.body).toContain("Wharfe Networks");
    expect(m.body).not.toMatch(/valuation|asking price|£/i);
  });

  it("rejects a financial figure that is not in the teaser", async () => {
    const w = await launched({
      composeOverride: (d) => (d === "northgatecloud.test" ? { teaser: "EBITDA is £400k; the teaser is available under NDA here:" } : null),
    });
    expect(w.mail.sentTo(email("northgatecloud.test"))).toHaveLength(0);
    const [c] = w.repo.communications({ prospectId: w.prospect("northgatecloud.test").id });
    expect(w.repo.qaReports(c.id).at(-1)!.checks.find((x) => x.name === "claims.supported")!.passed).toBe(false);
  });

  it("hands an interested acquirer to Mark and stops", async () => {
    const w = await launched();
    w.mail.replyFrom(email("penninems.test"), "Interested. Please send the NDA.");
    await w.settle();
    expect(w.prospect("penninems.test").status).toBe("PASSED_TO_MARK");
    const [h] = w.mail.sentTo("mark@aigogo.ai");
    expect(h.body).toContain("Project SLATE");
    expect(h.body).toContain("Ruth Calloway");
    await w.advanceDays(10);
    expect(w.mail.sentTo(email("penninems.test"))).toHaveLength(1);
  });
});
