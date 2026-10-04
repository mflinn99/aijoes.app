// Continuous QA: outcomes feed back into qualification, only ever tightening it.

import { describe, expect, it } from "vitest";
import { createWorld, OPCO } from "../server/sim/world";
import { computeMetrics, suspendedSignals } from "../server/metrics";

describe("continuous QA and learning", () => {
  it("measures what the remit counts, not volume", async () => {
    const w = createWorld();
    w.engine.addOpco(OPCO);
    await w.settle();
    w.mail.replyFrom("dana.reyes@northbridge.test", "Yes, let's talk.");
    w.mail.replyFrom("morgan.blake@ridgeway.test", "Please unsubscribe me.");
    await w.settle();
    const m = computeMetrics(w.repo);
    expect(m.emailsSent).toEqual({ intro: 3, followup: 0 });
    expect(m.replies).toMatchObject({ n: 2, of: 3 });
    expect(m.positiveReplies).toMatchObject({ n: 1, of: 3 });
    expect(m.unsubscribeRate).toMatchObject({ n: 1 });
    expect(m.qaRejectionRate.n).toBeGreaterThan(0);
    expect(m.byTrigger.map((b) => b.key).sort()).toEqual(["cds-migration", "new-bonded-site", "new-customs-lead"]);
    expect(m.byIcp[0]).toMatchObject({ key: "Freight forwarding", contacted: 3 });
  });

  it("suspends a buying signal that keeps producing false positives, which then stops counting toward a score", async () => {
    const w = createWorld();
    w.engine.addOpco(OPCO);
    await w.settle();
    // Pretend three contacted prospects whose intros rested on new-bonded-site were judged false positives.
    const nb = w.prospect("northbridge.test");
    const intro = w.repo.communications({ prospectId: nb.id })[0];
    for (const id of [nb.id, "x1", "x2"]) {
      if (id !== nb.id) {
        w.repo.db.prepare("INSERT INTO communications SELECT ?, ?, contact_id, kind, attempt, subject, body, link, sections, evidence, opco_claim_ids, approach, status, status_reason, content_hash, created_at, sent_at FROM communications WHERE id = ?").run(`cm_${id}`, id, intro.id);
      }
      w.repo.setFeedback(id, true, "Wrong fit", "test");
    }
    expect(suspendedSignals(w.repo)).toEqual(["new-bonded-site"]);
    expect(computeMetrics(w.repo).falsePositiveRate.n).toBe(1);
  });
});
