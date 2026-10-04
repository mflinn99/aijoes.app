// The remit's acceptance scenarios A–J, run end to end on synthetic data with a
// controllable clock. Every stage is the production code path; only the web,
// the model and the mailbox are simulated.

import { describe, expect, it } from "vitest";
import { createWorld, OPCO, PROSPECTS, RIVAL } from "../server/sim/world";

const MARK = "mark@aigogo.ai";
const email = (domain: string) => PROSPECTS[domain].contacts[0].email;

async function launched(opts: Parameters<typeof createWorld>[0] = {}) {
  const w = createWorld(opts);
  const opco = w.engine.addOpco(OPCO);
  await w.settle();
  return { ...w, opco };
}

describe("E2E acceptance", () => {
  it("runs the whole loop: understands the OpCo, qualifies precisely and contacts only the right people", async () => {
    const w = await launched();
    expect(w.repo.opco(w.opco.id)!.status).toBe("PROFILED");
    const status = Object.fromEntries(w.repo.prospects().map((p) => [p.domain, p.status]));
    expect(status).toEqual({
      "northbridge.test": "CONTACTED",
      "haldenfoods.test": "CONTACTED",
      "pebble.test": "REJECTED",
      "ashgrove.test": "RESEARCHING",
      "ridgeway.test": "CONTACTED",
      [RIVAL.domain]: "REJECTED",
    });
    expect(w.mail.sent.map((m) => m.to).sort()).toEqual([email("haldenfoods.test"), email("northbridge.test"), email("ridgeway.test")].sort());
    for (const m of w.mail.sent) expect(m.body).toContain(OPCO.introLink);
  });

  it("A: excellent prospect → qualified → introduction → responds → Mark receives the handoff", async () => {
    const w = await launched();
    const p = w.prospect("northbridge.test");
    expect(p.score!.total).toBeGreaterThanOrEqual(80);
    expect(w.mail.sentTo(email("northbridge.test"))).toHaveLength(1);

    w.clock.advanceDays(1);
    w.mail.replyFrom(email("northbridge.test"), "Yes, this is timely. Let's talk next week.");
    await w.settle();

    expect(w.prospect("northbridge.test").status).toBe("PASSED_TO_MARK");
    expect(w.mail.sentTo(MARK)).toHaveLength(1);
    expect(w.mail.sentTo(MARK)[0].subject).toContain("Northbridge Freight");
  });

  it("B: excellent prospect → introduction → no response → five-day follow-up → stop", async () => {
    const w = await launched();
    const to = email("haldenfoods.test");
    await w.advanceDays(4);
    expect(w.mail.sentTo(to)).toHaveLength(1);
    expect(w.prospect("haldenfoods.test").status).toBe("CONTACTED");

    await w.advanceDays(1);
    const sent = w.mail.sentTo(to);
    expect(sent).toHaveLength(2);
    const [intro, followup] = sent;
    expect(new Date(followup.at).getTime() - new Date(intro.at).getTime()).toBeGreaterThanOrEqual(5 * 86_400_000);
    expect(followup.body).toContain("Immingham");
    expect(followup.body).not.toMatch(/just following up/i);
    expect(followup.body).toContain(OPCO.introLink);
    expect(w.prospect("haldenfoods.test").status).toBe("FOLLOWED_UP");

    await w.advanceDays(30);
    expect(w.mail.sentTo(to)).toHaveLength(2);
    expect(w.prospect("haldenfoods.test").status).toBe("CLOSED");
  });

  it("C: poor prospect → below threshold → never contacted", async () => {
    const w = await launched();
    const p = w.prospect("pebble.test");
    expect(p.status).toBe("REJECTED");
    expect(p.score!.total).toBeLessThan(80);
    expect(p.statusReason).toMatch(/below the 80 threshold/);
    expect(w.repo.communications({ prospectId: p.id })).toHaveLength(0);
    expect(w.mail.sentTo(email("pebble.test"))).toHaveLength(0);
    await w.advanceDays(10);
    expect(w.mail.sentTo(email("pebble.test"))).toHaveLength(0);
  });

  it("D: strong company but wrong person → QA fails → never contacted", async () => {
    const w = await launched();
    const p = w.prospect("ashgrove.test");
    expect(p.score!.passed).toBe(true);
    expect(p.status).toBe("RESEARCHING");
    expect(p.statusReason).toMatch(/not a relevant decision-maker/);
    const [comm] = w.repo.communications({ prospectId: p.id });
    const report = w.repo.qaReports(comm.id).at(-1)!;
    expect(report.verdict).toBe("REJECT");
    expect(report.checks.find((c) => c.name === "recipient.relevant")!.passed).toBe(false);
    expect(w.mail.sentTo(email("ashgrove.test"))).toHaveLength(0);
    await w.advanceDays(10);
    expect(w.mail.sentTo(email("ashgrove.test"))).toHaveLength(0);
  });

  it("E: prospect replies before day five → follow-up cancelled", async () => {
    const w = await launched();
    const to = email("ridgeway.test");
    await w.advanceDays(3);
    w.mail.replyFrom(to, "Not right now, maybe revisit in the new year.");
    await w.settle();
    expect(w.prospect("ridgeway.test").status).toBe("RESPONDED");
    expect(w.engine.jobs.byKey(`followup_check:${w.prospect("ridgeway.test").id}`)!.status).toBe("cancelled");

    await w.advanceDays(10);
    expect(w.mail.sentTo(to)).toHaveLength(1);
    expect(w.mail.sentTo(MARK)).toHaveLength(0); // "not now" is recorded, not handed off
  });

  it("F: prospect unsubscribes → immediately suppressed, and cannot be contacted again", async () => {
    const w = await launched();
    const to = email("ridgeway.test");
    w.mail.replyFrom(to, "Please unsubscribe me.");
    await w.settle();
    expect(w.repo.isSuppressed(to).suppressed).toBe(true);
    const p = w.prospect("ridgeway.test");
    expect(p.status).toBe("CLOSED");

    // Even if something put the prospect back in line, nothing goes out.
    w.repo.setProspectStatus(p.id, "QUALIFIED", "forced for test");
    w.engine.jobs.enqueue("compose", { prospectId: p.id, kind: "intro", attempt: 1 }, { key: "forced-compose" });
    await w.advanceDays(10);
    expect(w.mail.sentTo(to)).toHaveLength(1);
    const lastQa = w.repo.qaReports(w.repo.communications({ prospectId: p.id }).at(-1)!.id).at(-1)!;
    expect(lastQa.checks.find((c) => c.name === "suppression")!.passed).toBe(false);
  });

  it("G: agent invents an unsupported claim → QA rejects the communication", async () => {
    const w = await launched({
      composeOverride: (d) => (d === "northbridge.test" ? { proposition: "Clearwater cuts clearance time by 70% for freight forwarders." } : null),
    });
    const p = w.prospect("northbridge.test");
    const comms = w.repo.communications({ prospectId: p.id });
    expect(comms.length).toBe(w.config.maxComposeAttempts);
    for (const c of comms) {
      expect(c.status).toBe("QA_REJECT");
      expect(w.repo.qaReports(c.id).at(-1)!.checks.find((x) => x.name === "claims.supported")!.passed).toBe(false);
    }
    expect(p.status).toBe("RESEARCHING");
    expect(w.mail.sentTo(email("northbridge.test"))).toHaveLength(0);
  });

  it("G (rework): a rejected draft is rewritten from QA feedback and only the clean version is sent", async () => {
    const w = await launched({
      composeOverride: (d, _k, attempt) => (d === "northbridge.test" && attempt === 1 ? { proposition: "Clearwater is the UK's leading customs platform." } : null),
    });
    const comms = w.repo.communications({ prospectId: w.prospect("northbridge.test").id });
    expect(comms.map((c) => c.status)).toEqual(["QA_REJECT", "SENT"]);
    const [sent] = w.mail.sentTo(email("northbridge.test"));
    expect(sent.body).not.toMatch(/leading/);
    expect(w.llm.calls.filter((c) => c.task === "compose_message" && (c.context as any).feedback?.length)).toHaveLength(1);
  });

  it("H: broken link → send prevented", async () => {
    const w = createWorld();
    w.web.set(OPCO.introLink, { status: 404 });
    w.engine.addOpco(OPCO);
    await w.settle();
    expect(w.mail.sent).toHaveLength(0);
    const blocked = w.repo.communications().filter((c) => c.status === "SEND_BLOCKED");
    expect(blocked.length).toBe(3);
    for (const c of blocked) expect(c.statusReason).toMatch(/Link check failed/);
    expect(w.repo.allOutbound()).toHaveLength(0);
  });

  it("I: duplicate prospect → duplicate communication prevented", async () => {
    const w = await launched({ discover: ["northbridge.test", "www.northbridge.test", "NorthBridge.test", "haldenfoods.test"] });
    expect(w.repo.prospects().filter((p) => p.domain === "northbridge.test")).toHaveLength(1);
    await w.engine.discover(w.opco.id); // rediscovery finds nothing new
    expect(w.engine.addProspect(w.opco.id, { name: "Northbridge", domain: "https://www.northbridge.test/" })).toBeNull();
    await w.settle();
    expect(w.mail.sentTo(email("northbridge.test"))).toHaveLength(1);
  });

  it("J: positive response → complete prospect intelligence and conversation forwarded to Mark", async () => {
    const w = await launched();
    const to = email("northbridge.test");
    w.clock.advanceDays(2);
    const reply = w.mail.replyFrom(to, "Interesting - can you send me the walkthrough and some times for a call?", { fromName: "Dana Reyes" });
    await w.settle();
    await w.settle(); // a second sync of the same reply changes nothing

    const handoffs = w.repo.handoffs();
    expect(handoffs).toHaveLength(1);
    const [mail] = w.mail.sentTo(MARK);
    const intro = w.mail.sentTo(to)[0];
    const p = w.prospect("northbridge.test");
    for (const needle of [
      OPCO.name,
      "Northbridge Freight",
      "Dana Reyes",
      "Chief Operating Officer",
      to,
      intro.subject,
      intro.body,
      reply.body,
      `${p.score!.total}/100`,
      p.whyThem!,
      p.whyNow!,
      "open a 40,000 sq ft bonded warehouse at Felixstowe",
      "https://northbridge.test/news",
      OPCO.introLink,
      "Recommended next action",
    ]) {
      expect(mail.body).toContain(needle);
    }
    expect(p.status).toBe("PASSED_TO_MARK");
    // A human owns it now: no follow-up, ever.
    await w.advanceDays(20);
    expect(w.mail.sentTo(to)).toHaveLength(1);
  });
});
