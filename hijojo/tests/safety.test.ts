import { describe, expect, it } from "vitest";
import { createWorld, OPCO, PROSPECTS } from "../server/sim/world";
import { Engine } from "../server/engine";
import type { MailTransport } from "../server/mail/transport";

const NB = "northbridge.test";
const nbEmail = PROSPECTS[NB].contacts[0].email;

async function launched(opts: Parameters<typeof createWorld>[0] = {}) {
  const w = createWorld({ discover: [NB], ...opts });
  w.engine.addOpco(OPCO);
  return w;
}

describe("safety", () => {
  it("the database refuses a second live introduction to the same prospect", async () => {
    const w = await launched();
    await w.settle();
    const p = w.prospect(NB);
    const comm = w.repo.communications({ prospectId: p.id })[0];
    expect(() => w.repo.insertOutbound({ prospectId: p.id, commId: comm.id, kind: "intro", toEmail: nbEmail })).toThrow(/UNIQUE/);
  });

  it("two workers racing to send the same message send it once", async () => {
    const w = await launched();
    // Stop before the send job runs.
    for (let i = 0; i < 20; i++) {
      const job = w.engine.jobs.list({ status: "pending" }).find((j) => j.type === "send");
      if (job) break;
      await w.engine.runDue(1);
    }
    const commId = w.repo.communications()[0].id;
    const other = new Engine({ ...w.engine.d });
    const results = await Promise.all([w.engine.send(commId), other.send(commId)]);
    expect(results.filter((r) => r.outcome === "sent")).toHaveLength(1);
    expect(w.mail.sentTo(nbEmail)).toHaveLength(1);
  });

  it("an uncertain send is reconciled, never blindly resent", async () => {
    const w = await launched();
    w.mail.nextResult = { status: "uncertain", reason: "Timeout after request was written", providerRef: null };
    await w.settle();
    const [comm] = w.repo.communications();
    expect(comm.status).toBe("UNCERTAIN");
    expect(w.mail.sentTo(nbEmail)).toHaveLength(0);
    // Reconcile finds it was not sent, and only then retries.
    w.clock.advance(11 * 60_000);
    await w.settle();
    expect(w.mail.sentTo(nbEmail)).toHaveLength(1);
    expect(w.prospect(NB).status).toBe("CONTACTED");
  });

  it("a send interrupted mid-flight is reconciled rather than repeated", async () => {
    const w = await launched();
    await w.settle();
    const [comm] = w.repo.communications();
    // Simulate a crash that left the row in SENDING after the provider accepted it.
    w.repo.setCommStatus(comm.id, "SENDING");
    const r = await w.engine.send(comm.id);
    expect(r.outcome).toBe("uncertain");
    await w.settle();
    expect(w.mail.sentTo(nbEmail)).toHaveLength(1);
  });

  it("a bounced address is suppressed and the sequence stops", async () => {
    const w = await launched();
    await w.settle();
    w.mail.deliver({
      fromEmail: "postmaster@northbridge.test", fromName: null, subject: "Undeliverable: Felixstowe bonded warehouse",
      body: "Delivery has failed to these recipients", conversationId: w.mail.sent[0].conversationId,
    });
    await w.settle();
    expect(w.repo.isSuppressed(nbEmail).suppressed).toBe(true);
    expect(w.repo.contact(w.prospect(NB).contactId!)!.emailStatus).toBe("bounced");
    await w.advanceDays(10);
    expect(w.mail.sentTo(nbEmail)).toHaveLength(1);
  });

  it("an address the mail server rejects is marked invalid and suppressed", async () => {
    const w = await launched();
    w.mail.invalidRecipients.add(nbEmail);
    await w.settle();
    expect(w.mail.sentTo(nbEmail)).toHaveLength(0);
    expect(w.repo.isSuppressed(nbEmail).suppressed).toBe(true);
    expect(w.prospect(NB).status).toBe("RESEARCHING");
  });

  it("a suppressed domain is never contacted", async () => {
    const w = await launched();
    w.repo.suppress(NB, "domain", "Asked by their legal team");
    await w.settle();
    expect(w.mail.sent).toHaveLength(0);
    expect(w.prospect(NB).status).toBe("REJECTED");
  });

  it("a reply from anyone at the company stops automation for that company", async () => {
    const w = await launched();
    await w.settle();
    w.mail.deliver({ fromEmail: "ops@northbridge.test", fromName: null, subject: "Re: Felixstowe", body: "Dana is away; I'll pass this on.", conversationId: null });
    await w.settle();
    expect(w.prospect(NB).status).toBe("RESPONDED");
    await w.advanceDays(10);
    expect(w.mail.sentTo(nbEmail)).toHaveLength(1);
  });

  it("missing evidence: a company whose pages cannot be retrieved is never qualified", async () => {
    const w = await launched();
    for (const path of ["", "/news", "/careers"]) w.web.remove(`https://${NB}${path}`);
    await w.settle();
    expect(w.prospect(NB).status).toBe("RESEARCHING");
    expect(w.prospect(NB).score).toBeNull();
    expect(w.mail.sent).toHaveLength(0);
  });

  it("conflicting prospect data returns the prospect to research", async () => {
    const w = await launched();
    const research = (w.llm as any).handlers.prospect_research;
    w.llm.setHandler("prospect_research", (t) => ({ ...research(t), conflicts: ["Two different registered addresses"] }));
    await w.settle();
    expect(w.prospect(NB).status).toBe("RESEARCHING");
    expect(w.prospect(NB).statusReason).toMatch(/Conflicting/);
    expect(w.mail.sent).toHaveLength(0);
  });

  it("the halt switch stops all sending immediately", async () => {
    const w = await launched();
    w.repo.setSetting("halted", "1");
    await w.settle();
    expect(w.mail.sent).toHaveLength(0);
    expect(w.repo.communications()[0].statusReason).toMatch(/halted/);
  });

  it("live mode will not send until an administrator switches it on", async () => {
    const w = await launched({ config: { sendMode: "live" } });
    const live: MailTransport = { ...w.mail, name: "graph", live: true, send: w.mail.send.bind(w.mail), reconcile: w.mail.reconcile.bind(w.mail) };
    (w.engine.d as any).transport = live;
    await w.settle();
    expect(w.mail.sent).toHaveLength(0);
    expect(w.repo.communications()[0].statusReason).toMatch(/administrator/);
  });

  it("simulation mode refuses to run with a live transport", async () => {
    const w = await launched();
    (w.engine.d as any).transport = { ...w.mail, live: true, send: w.mail.send.bind(w.mail), reconcile: w.mail.reconcile.bind(w.mail) };
    expect(w.engine.sendingState().canSend).toBe(false);
  });

  it("the daily cap defers sends instead of exceeding it", async () => {
    const w = createWorld({ config: { dailySendCap: 1 } });
    w.engine.addOpco(OPCO);
    await w.settle();
    expect(w.mail.sent).toHaveLength(1);
    await w.advanceDays(1);
    expect(w.mail.sent).toHaveLength(1); // still inside the same rolling 24 hours
    await w.advanceDays(1);
    expect(w.mail.sent).toHaveLength(2);
  });

  it("the threshold cannot be lowered below 80 by configuration", async () => {
    const w = await launched();
    w.repo.setSetting("threshold", "40");
    expect(w.engine.threshold()).toBe(80);
  });

  it("an incomplete profile stops prospecting before any company is searched", async () => {
    const w = createWorld();
    w.llm.setHandler("opco_analysis", () => ({ claims: [] }));
    w.engine.addOpco(OPCO);
    await w.settle();
    expect(w.repo.opcos()[0].status).toBe("INCOMPLETE");
    expect(w.repo.prospects()).toHaveLength(0);
  });

  it("a model failure halts the stage instead of inventing output", async () => {
    const w = createWorld();
    w.llm.setHandler("prospect_research", () => {
      throw new Error("API unavailable");
    });
    w.engine.addOpco(OPCO);
    await w.settle();
    await w.advanceDays(1);
    expect(w.mail.sent).toHaveLength(0);
    expect(w.repo.prospects().every((p) => p.status === "RESEARCHING" || p.status === "REJECTED")).toBe(true);
  });
});
