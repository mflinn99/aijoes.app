// Qualified → send → wait five days → check response → one follow-up or stop.

import { describe, expect, it } from "vitest";
import { createWorld, OPCO, PROSPECTS } from "../server/sim/world";

const HALDEN = "haldenfoods.test";
const to = PROSPECTS[HALDEN].contacts[0].email;

async function contacted() {
  const w = createWorld({ discover: [HALDEN] });
  w.engine.addOpco(OPCO);
  await w.settle();
  return w;
}

describe("sequence", () => {
  it("sends the introduction only after QA PASS on exactly the content sent", async () => {
    const w = await contacted();
    const [intro] = w.repo.communications({ prospectId: w.prospect(HALDEN).id });
    const qa = w.repo.qaReports(intro.id).at(-1)!;
    expect(qa.verdict).toBe("PASS");
    expect(qa.contentHash).toBe(intro.contentHash);
    expect(w.mail.sentTo(to)[0].body).toBe(intro.body);
  });

  it("does not follow up a moment before five days have passed", async () => {
    const w = await contacted();
    w.clock.advance(5 * 86_400_000 - 60_000);
    await w.settle();
    expect(w.mail.sentTo(to)).toHaveLength(1);
    w.clock.advance(60_000);
    await w.settle();
    expect(w.mail.sentTo(to)).toHaveLength(2);
  });

  it("schedules exactly one follow-up check per prospect, however often it is asked", async () => {
    const w = await contacted();
    const p = w.prospect(HALDEN);
    expect(w.engine.jobs.enqueue("followup_check", { prospectId: p.id }, { key: `followup_check:${p.id}` })).toBe(false);
  });

  it("re-validates before the follow-up and uses what it finds", async () => {
    const w = await contacted();
    await w.advanceDays(5);
    const fetched = w.web.requests.filter((u) => u.includes(HALDEN));
    expect(fetched.length).toBeGreaterThan(3); // researched twice
    expect(w.llm.calls.filter((c) => c.task === "prospect_qualification")).toHaveLength(2);
  });

  it("stops without a follow-up when re-validation no longer supports contact", async () => {
    const w = await contacted();
    // The triggers have gone: news and careers pages removed.
    w.web.remove(`https://${HALDEN}/news`);
    w.web.remove(`https://${HALDEN}/careers`);
    await w.advanceDays(6);
    expect(w.mail.sentTo(to)).toHaveLength(1);
    const p = w.prospect(HALDEN);
    expect(p.status).toBe("CLOSED");
    expect(p.statusReason).toMatch(/Re-validation/);
  });

  it("never sends a third message, even if something tries", async () => {
    const w = await contacted();
    await w.advanceDays(6);
    expect(w.mail.sentTo(to)).toHaveLength(2);
    const p = w.prospect(HALDEN);
    w.repo.setProspectStatus(p.id, "FOLLOW_UP_DUE", "forced");
    w.engine.jobs.enqueue("compose", { prospectId: p.id, kind: "followup", attempt: 1 }, { key: "forced" });
    await w.advanceDays(3);
    expect(w.mail.sentTo(to)).toHaveLength(2);
  });

  it("closes an unanswered sequence after the follow-up and keeps it closed", async () => {
    const w = await contacted();
    await w.advanceDays(5 + w.config.closeAfterDays + 1);
    expect(w.prospect(HALDEN).status).toBe("CLOSED");
    expect(w.mail.sentTo(to)).toHaveLength(2);
  });

  it("a reply to the follow-up still reaches Mark", async () => {
    const w = await contacted();
    await w.advanceDays(6);
    w.mail.replyFrom(to, "Fair point about Immingham. Happy to talk - when suits?");
    await w.settle();
    expect(w.prospect(HALDEN).status).toBe("PASSED_TO_MARK");
    expect(w.mail.sentTo("mark@aigogo.ai")[0].body).toContain("Follow-up sent");
  });
});
