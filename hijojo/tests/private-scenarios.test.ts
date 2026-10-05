// Runs any private scenario present locally (e.g. a confidential mandate kept
// under .data/private-scenarios). Skipped where there are none, such as CI.

import { describe, expect, it } from "vitest";
import { createWorld } from "../server/sim/world";
import { loadPrivateScenarios } from "../server/sim/scenarios";

const scenarios = loadPrivateScenarios();

describe.skipIf(scenarios.length === 0)("private scenarios", () => {
  for (const sc of scenarios) {
    it(`${sc.opco.name}: every cited quotation is in the document, and only QA-passed messages go out`, async () => {
      const w = createWorld({ scenarios: [sc] });
      const opco = w.engine.addOpco(sc.opco);
      await w.settle();
      const claims = w.repo.claims(opco.id);
      for (const c of sc.claims.filter((c) => c.quote)) {
        expect(claims.find((x) => x.statement === c.statement)!.status, c.key).toBe(c.status);
      }
      expect(w.repo.profile(opco.id)!.complete).toBe(true);
      for (const comm of w.repo.communications().filter((c) => c.status === "SENT")) {
        expect(w.repo.qaReports(comm.id).at(-1)!.verdict).toBe("PASS");
        expect(comm.body).toContain(sc.opco.name);
      }
      expect(w.mail.sent.length).toBeGreaterThan(0);
    });
  }
});
