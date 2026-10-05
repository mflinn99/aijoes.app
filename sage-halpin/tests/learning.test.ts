import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { setCompletionObserver, type CompletionRequest } from "../server/ai.js";
import { getStore } from "../server/store.js";
import { parseFeed, scanWorkspace, scanDue } from "../server/horizon.js";
import { checkFeedUrl, isPublicAddress } from "../server/net.js";
import { loadWorkspace, trackRecords, type DecisionRecord } from "../server/workspace.js";
import { weightedTally } from "../shared/board.js";

// Decision modes, how agents are developed and learn in the company, and how
// the platform keeps looking outward. Mock AI, in-memory store, no network.

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const PEOPLE = [
  { id: "person-ceo1", name: "Alex Morgan", role: "Chief Executive", email: "alex@example.com" },
  { id: "person-cfo1", name: "Sam Patel", role: "Fractional CFO", email: "sam@example.com" },
];

async function workspace(app = createApp(), body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/workspaces")
    .send({ name: "Harrow & Vale", sector: "Instruments", profile: "120 people.", ...body })
    .expect(201);
  return { app, wsId: res.body.id as string, wsToken: res.body.adminToken as string };
}

async function question(app: ReturnType<typeof createApp>, ws: { wsId: string; wsToken: string } | null, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/consultations")
    .send({
      organisation: "Harrow & Vale",
      leadName: "Alex Morgan",
      question: "Should we open a second factory?",
      people: PEOPLE,
      ...(ws ? { workspace: { id: ws.wsId, token: ws.wsToken } } : {}),
      ...overrides,
    })
    .expect(201);
  return { id: res.body.id as string, admin: res.body.adminToken as string };
}

async function answer(app: ReturnType<typeof createApp>, id: string, admin: string, personId: string, position: string) {
  const inv = await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({ personIds: [personId] }).expect(200);
  await request(app)
    .post(`/api/respond/${inv.body.invitations[0].token}`)
    .send({ answers: [{ questionId: "position", value: position }, { questionId: "confidence", value: "4" }] })
    .expect(200);
  return inv.body.invitations[0].token as string;
}

afterEach(() => setCompletionObserver(null));

describe("who decides", () => {
  it("lets the agents decide alone: no people, no questionnaire", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { mode: "agents", people: undefined });
    const view = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(view.body).toMatchObject({ mode: "agents", peopleWeight: 0, invitees: [] });
    await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(409);
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "mixed" }).expect(409);
  });

  it("lets the people decide alone: the shadow board is not convened", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { mode: "people" });
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(409);
    await answer(app, id, admin, "person-ceo1", "support");
    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "people" }).expect(200);
    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "mixed" }).expect(409);
  });

  it("validates the mode and the weighting", async () => {
    const app = createApp();
    const base = { organisation: "O", leadName: "L", question: "Q?", people: PEOPLE };
    await request(app).post("/api/consultations").send({ ...base, mode: "committee" }).expect(400);
    await request(app).post("/api/consultations").send({ ...base, peopleWeight: 120 }).expect(400);
    await request(app).post("/api/consultations").send({ ...base, peopleWeight: 55.5 }).expect(400);
    await request(app).post("/api/consultations").send({ ...base, workspace: { id: "nope-nope-nope", token: "x" } }).expect(400);
  });

  it("runs a collaborative deliberation: two rounds, a weighted combined view", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { mode: "collaborative", peopleWeight: 70, shareWithPeople: true });
    await request(app).post(`/api/consultations/${id}/challenge`).set(bearer(admin)).send({}).expect(409);

    const token = await answer(app, id, admin, "person-cfo1", "oppose");
    const before = await request(app).get(`/api/respond/${token}`).expect(200);
    expect(before.body.boardView).toBeNull();

    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
    // Round two for the people: they see the agents' view and can revise.
    const shared = await request(app).get(`/api/respond/${token}`).expect(200);
    expect(shared.body.boardView.agents).toHaveLength(6);
    expect(shared.body.boardView.recommendation).toEqual(expect.any(String));

    // Round two for the agents: they challenge the people's answers.
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const challenge = await request(app).post(`/api/consultations/${id}/challenge`).set(bearer(admin)).send({}).expect(200);
    expect(challenge.body.opinions).toHaveLength(6);
    expect(challenge.body.opinions[0].position).toBe("support_with_conditions");
    expect(seen[0].messages[0].content).toContain("Sam Patel");

    seen.length = 0;
    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "mixed" }).expect(200);
    expect(seen[0].system).toContain("people's views carry 70%");
    expect(seen[0].messages[0].content).toContain('<weighted_tally people_weight="70">');
  });

  it("only shares the agents' view with people when the chair chooses to", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { mode: "collaborative", shareWithPeople: false });
    const token = await answer(app, id, admin, "person-ceo1", "support");
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
    expect((await request(app).get(`/api/respond/${token}`).expect(200)).body.boardView).toBeNull();
  });

  it("weights the tally as the chair set it", () => {
    const tally = weightedTally(["support", "support", "oppose", null], ["oppose", "oppose"], 75);
    const score = (p: string) => tally.find((t) => t.position === p)?.score;
    expect(score("support")).toBe(50); // 2/3 of 75
    expect(score("oppose")).toBe(50); // 1/3 of 75 + all of 25
    // A side that has not spoken carries no weight.
    expect(weightedTally(["support"], [null], 30).find((t) => t.position === "support")?.score).toBe(100);
  });
});

describe("developing and educating agents", () => {
  it("keeps workspaces private to their admin token, and validates settings", async () => {
    const { app, wsId, wsToken } = await workspace();
    await request(app).get(`/api/workspaces/${wsId}`).expect(404);
    await request(app).get(`/api/workspaces/${wsId}`).set(bearer("wrong")).expect(404);
    const ws = await request(app).get(`/api/workspaces/${wsId}`).set(bearer(wsToken)).expect(200);
    expect(ws.body).not.toHaveProperty("adminTokenHash");
    await request(app).post("/api/workspaces").send({}).expect(400);
    await request(app).put(`/api/workspaces/${wsId}`).set(bearer(wsToken)).send({ scanEveryHours: 1 }).expect(400);
    await request(app).put(`/api/workspaces/${wsId}`).set(bearer(wsToken)).send({ watchTopics: ["x".repeat(81)] }).expect(400);
  });

  it("lets the chair teach an agent, and approve, edit or retire what it learns", async () => {
    const { app, wsId, wsToken } = await workspace();
    const taught = await request(app)
      .post(`/api/workspaces/${wsId}/agents/solara/lessons`)
      .set(bearer(wsToken))
      .send({ kind: "principle", text: "Our hurdle rate for capital projects is 12%." })
      .expect(201);
    expect(taught.body).toMatchObject({ agentId: "solara", source: "chair", status: "active" });
    await request(app)
      .post(`/api/workspaces/${wsId}/agents/solara/lessons`)
      .set(bearer(wsToken))
      .send({ kind: "principle", text: "Our  hurdle rate for capital projects is 12%." })
      .expect(409);
    await request(app).post(`/api/workspaces/${wsId}/agents/nobody/lessons`).set(bearer(wsToken)).send({ kind: "fact", text: "x" }).expect(400);
    await request(app).post(`/api/workspaces/${wsId}/agents/solara/lessons`).set(bearer(wsToken)).send({ kind: "rumour", text: "x" }).expect(400);

    const retired = await request(app)
      .patch(`/api/workspaces/${wsId}/lessons/${taught.body.id}`)
      .set(bearer(wsToken))
      .send({ status: "retired" })
      .expect(200);
    expect(retired.body.status).toBe("retired");
  });

  it("has an agent study material and propose what to learn, for the chair to approve", async () => {
    const { app, wsId, wsToken } = await workspace();
    const studied = await request(app)
      .post(`/api/workspaces/${wsId}/agents/grimm/study`)
      .set(bearer(wsToken))
      .send({ title: "Risk appetite statement 2026", text: "We will not borrow above 2x EBITDA." })
      .expect(200);
    expect(studied.body.proposed[0]).toMatchObject({ agentId: "grimm", source: "study", status: "proposed", ref: "Risk appetite statement 2026" });

    const approved = await request(app)
      .patch(`/api/workspaces/${wsId}/lessons/${studied.body.proposed[0].id}`)
      .set(bearer(wsToken))
      .send({ status: "active", text: "Borrowing stays below 2x EBITDA." })
      .expect(200);
    expect(approved.body).toMatchObject({ status: "active", text: "Borrowing stays below 2x EBITDA." });
  });

  it("gives agents only their active lessons, and the outside view, when they advise", async () => {
    const { app, wsId, wsToken } = await workspace();
    await request(app).post(`/api/workspaces/${wsId}/agents/grimm/lessons`).set(bearer(wsToken)).send({ kind: "fact", text: "Our bank covenant is 2x EBITDA." }).expect(201);
    await request(app).post(`/api/workspaces/${wsId}/agents/grimm/study`).set(bearer(wsToken)).send({ title: "Doc", text: "Material." }).expect(200);
    await request(app).put(`/api/workspaces/${wsId}`).set(bearer(wsToken)).send({ feeds: [{ url: "https://news.example.com/rss", label: "News" }] }).expect(200);
    await scanWorkspace(getStore(), (await loadWorkspace(getStore(), wsId))!, async () => RSS);

    const { id, admin } = await question(app, { wsId, wsToken });
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);

    const grimm = seen.find((r) => r.system.includes("Risk & Resilience agent on the Sentinel8 board"))!;
    expect(grimm.system).toContain("Our bank covenant is 2x EBITDA.");
    expect(grimm.system).not.toContain("Mock lesson from the material studied."); // proposed, not approved
    expect(grimm.system).toContain("<external_landscape");
    expect(grimm.system).toContain("<external_signals>");
    const orion = seen.find((r) => r.system.includes("Governance & Compliance agent on the Sentinel8 board"))!;
    expect(orion.system).not.toContain("Our bank covenant");
  });

  it("learns from feedback on its opinions", async () => {
    const { app, wsId, wsToken } = await workspace();
    const { id, admin } = await question(app, { wsId, wsToken });
    await request(app).post(`/api/consultations/${id}/feedback`).set(bearer(admin)).send({ agentId: "nobody", rating: "helpful" }).expect(400);
    const fb = await request(app)
      .post(`/api/consultations/${id}/feedback`)
      .set(bearer(admin))
      .send({ agentId: "mira", rating: "off_target", note: "Our people are unionised; consult the works council first." })
      .expect(200);
    expect(fb.body.lesson).toMatchObject({ agentId: "mira", kind: "correction", source: "feedback", status: "active" });
  });

  it("learns from decisions and how they turned out", async () => {
    const { app, wsId, wsToken } = await workspace();
    const { id, admin } = await question(app, { wsId, wsToken });
    await answer(app, id, admin, "person-ceo1", "support");
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
    await request(app).post(`/api/consultations/${id}/decision`).set(bearer(admin)).send({ decision: "Go ahead", position: "maybe" }).expect(400);
    await request(app)
      .post(`/api/consultations/${id}/decision`)
      .set(bearer(admin))
      .send({ decision: "Open the second factory in Q3.", position: "support_with_conditions", rationale: "Demand." })
      .expect(200);

    const view = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(view.body.status).toBe("closed");
    expect(view.body.decision.decision).toBe("Open the second factory in Q3.");

    const decisions = await request(app).get(`/api/workspaces/${wsId}/decisions`).set(bearer(wsToken)).expect(200);
    expect(decisions.body.decisions[0]).toMatchObject({ consultationId: id, position: "support_with_conditions", outcome: null });
    expect(decisions.body.decisions[0].agentPositions.aquila).toBe("support_with_conditions");

    const review = await request(app)
      .post(`/api/workspaces/${wsId}/decisions/${id}/outcome`)
      .set(bearer(wsToken))
      .send({ result: "worse", note: "Costs overran by 30%." })
      .expect(200);
    expect(review.body.proposed[0]).toMatchObject({ agentId: "grimm", source: "outcome", status: "proposed" });

    const agents = await request(app).get(`/api/workspaces/${wsId}/agents`).set(bearer(wsToken)).expect(200);
    const record = (id: string) => agents.body.agents.find((a: { id: string }) => a.id === id).record;
    // The chair agreed with a decision that went worse than expected; the others urged more information.
    expect(record("aquila")).toMatchObject({ consultations: 1, decisions: 1, aligned: 1, outcomesReviewed: 1, calledRight: 0 });
    expect(record("grimm")).toMatchObject({ aligned: 0, outcomesReviewed: 1, calledRight: 1 });
  });

  it("scores track records from decisions and outcomes", () => {
    const base = { question: "Q", mode: "collaborative", decision: "D", rationale: "", decidedAt: "2026-01-01", peoplePositions: [] } as const;
    const records = trackRecords([
      { ...base, consultationId: "a", position: "support", agentPositions: { solara: "support", grimm: "oppose" }, outcome: { result: "better", note: "", recordedAt: "" } },
      { ...base, consultationId: "b", position: "oppose", agentPositions: { solara: "support", grimm: null }, outcome: { result: "failed", note: "", recordedAt: "" } },
    ] as unknown as DecisionRecord[]);
    expect(records.solara).toEqual({ consultations: 2, decisions: 2, aligned: 1, outcomesReviewed: 2, calledRight: 2 });
    expect(records.grimm).toEqual({ consultations: 2, decisions: 1, aligned: 0, outcomesReviewed: 1, calledRight: 0 });
  });
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bank rate held at 4%]]></title><link>https://news.example.com/rates</link><pubDate>Mon, 28 Sep 2026 09:00:00 GMT</pubDate><description>The &amp; committee voted 6&#8211;3.</description></item>
<item><title>New export controls on sensors</title><link>https://news.example.com/export</link><pubDate>Tue, 29 Sep 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>Rules apply from January.</p>]]></description></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Skills levy reform</title><link rel="alternate" href="https://gov.example.com/levy"/><updated>2026-09-27T10:00:00Z</updated><summary>Changes to apprenticeships.</summary></entry></feed>`;

describe("looking outward", () => {
  it("reads RSS and Atom feeds", () => {
    const rss = parseFeed(RSS, "News");
    expect(rss).toHaveLength(2);
    expect(rss[0]).toMatchObject({ title: "Bank rate held at 4%", url: "https://news.example.com/rates", source: "News", publishedAt: "2026-09-28T09:00:00.000Z" });
    expect(rss[0].summary).toBe("The & committee voted 6–3.");
    expect(rss[1].summary).toBe("Rules apply from January.");
    const atom = parseFeed(ATOM, "GOV");
    expect(atom[0]).toMatchObject({ title: "Skills levy reform", url: "https://gov.example.com/levy", publishedAt: "2026-09-27T10:00:00.000Z" });
  });

  it("refuses feed addresses that could reach private networks", () => {
    for (const bad of [
      "http://news.example.com/feed",
      "https://localhost/feed",
      "https://10.0.0.5/feed",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/feed",
      "https://user:pass@news.example.com/feed",
      "https://news.example.com:8443/feed",
      "https://metadata.google.internal/",
      "not a url",
    ]) {
      expect(() => checkFeedUrl(bad), bad).toThrow();
    }
    expect(checkFeedUrl("https://news.example.com/feed").hostname).toBe("news.example.com");
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
    expect(isPublicAddress("172.20.0.1")).toBe(false);
    expect(isPublicAddress("100.100.1.1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("fd00::1")).toBe(false);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });

  it("rejects unsafe feeds when the chair saves them", async () => {
    const { app, wsId, wsToken } = await workspace();
    await request(app).put(`/api/workspaces/${wsId}`).set(bearer(wsToken)).send({ feeds: [{ url: "http://internal/feed", label: "x" }] }).expect(400);
    const ok = await request(app)
      .put(`/api/workspaces/${wsId}`)
      .set(bearer(wsToken))
      .send({ feeds: [{ url: "https://news.example.com/rss", label: "News" }], watchTopics: ["export controls", "energy prices"], scanEveryHours: 24 })
      .expect(200);
    expect(ok.body).toMatchObject({ scanEveryHours: 24, watchTopics: ["export controls", "energy prices"] });
  });

  it("scans feeds and the web, keeps signals, briefs the agents and proposes lessons", async () => {
    const { app, wsId, wsToken } = await workspace();
    await request(app)
      .put(`/api/workspaces/${wsId}`)
      .set(bearer(wsToken))
      .send({ feeds: [{ url: "https://news.example.com/rss", label: "News" }, { url: "https://gov.example.com/atom", label: "GOV" }, { url: "https://broken.example.com/rss", label: "Broken" }], watchTopics: ["export controls"] })
      .expect(200);
    const fetchText = async (url: string) => {
      if (url.includes("news")) return RSS;
      if (url.includes("gov")) return ATOM;
      throw new Error("HTTP 500");
    };
    const store = getStore();
    const result = await scanWorkspace(store, (await loadWorkspace(store, wsId))!, fetchText);
    expect(result).toMatchObject({ status: "partial", found: 3, kept: 4 }); // 3 from feeds, 1 from web search
    expect(result.note).toContain("Broken");

    const horizon = await request(app).get(`/api/workspaces/${wsId}/horizon`).set(bearer(wsToken)).expect(200);
    expect(horizon.body.signals).toHaveLength(4);
    expect(horizon.body.signals.map((s: { via: string }) => s.via).sort()).toEqual(["feed", "feed", "feed", "web"]);
    expect(horizon.body.landscape).toMatchObject({ briefing: expect.stringContaining("landscape"), trends: [{ title: "Mock trend", direction: "rising" }] });
    expect(horizon.body.settings).toMatchObject({ lastScanStatus: "partial", lastScanAt: expect.any(String) });

    const agents = await request(app).get(`/api/workspaces/${wsId}/agents`).set(bearer(wsToken)).expect(200);
    const solara = agents.body.agents.find((a: { id: string }) => a.id === "solara");
    expect(solara.lessons).toContainEqual(expect.objectContaining({ source: "horizon", status: "proposed" }));

    // A second scan does not keep what it has already seen.
    const again = await scanWorkspace(store, (await loadWorkspace(store, wsId))!, fetchText);
    expect(again.kept).toBe(0);

    // The chair teaches a signal to the agents whose remit it concerns.
    const signal = horizon.body.signals.find((s: { via: string }) => s.via === "feed");
    const taught = await request(app).post(`/api/workspaces/${wsId}/horizon/signals/${signal.id}/teach`).set(bearer(wsToken)).send({}).expect(200);
    expect(taught.body.taught.map((l: { agentId: string }) => l.agentId).sort()).toEqual(["grimm", "solara"]);
    expect(taught.body.taught[0]).toMatchObject({ source: "horizon", status: "active", kind: "context" });
  });

  it("knows when a workspace is due for its next scan", async () => {
    const { wsId } = await workspace();
    const ws = (await loadWorkspace(getStore(), wsId))!;
    expect(scanDue(ws)).toBe(true); // web search on, never scanned
    const scanned = { ...ws, lastScanAt: new Date().toISOString(), scanEveryHours: 12 };
    expect(scanDue(scanned)).toBe(false);
    expect(scanDue(scanned, Date.now() + 13 * 3600_000)).toBe(true);
    expect(scanDue({ ...ws, webSearch: false, feeds: [] })).toBe(false);
  });
});

describe("permanent members", () => {
  const people = [
    { id: "person-chair1", name: "Jo Reyes", role: "Chair", email: "jo@example.com", permanent: true },
    { id: "person-cfo1", name: "Sam Patel", role: "Fractional CFO", email: "sam@example.com" },
  ];

  it("records who is a permanent member", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { people });
    const view = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(view.body.invitees.map((i: { permanent: boolean }) => i.permanent)).toEqual([true, false]);
    await request(app)
      .post("/api/consultations")
      .send({ organisation: "O", leadName: "L", question: "Q?", people: [{ ...people[0], permanent: "yes" }] })
      .expect(400);
  });

  it("will not decide without a permanent member's answer unless the chair confirms", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { people, mode: "people" });
    await answer(app, id, admin, "person-cfo1", "support");
    const blocked = await request(app).post(`/api/consultations/${id}/decision`).set(bearer(admin)).send({ decision: "Go", position: "support" }).expect(409);
    expect(blocked.body.missingPermanent).toEqual([{ personId: "person-chair1", name: "Jo Reyes", role: "Chair" }]);

    const decided = await request(app)
      .post(`/api/consultations/${id}/decision`)
      .set(bearer(admin))
      .send({ decision: "Go", position: "support", proceedWithoutPermanent: true })
      .expect(200);
    expect(decided.body.withoutPermanent).toEqual(["Jo Reyes (Chair)"]);
  });

  it("decides normally once every permanent member has answered", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { people, mode: "people" });
    await answer(app, id, admin, "person-chair1", "support");
    const decided = await request(app).post(`/api/consultations/${id}/decision`).set(bearer(admin)).send({ decision: "Go", position: "support" }).expect(200);
    expect(decided.body).not.toHaveProperty("withoutPermanent");
  });

  it("marks permanent members for the summary of the people's view", async () => {
    const app = createApp();
    const { id, admin } = await question(app, null, { people, mode: "people" });
    await answer(app, id, admin, "person-cfo1", "oppose");
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "people" }).expect(200);
    expect(seen[0].messages[0].content).toContain('<person name="Jo Reyes" role="Chair" member="permanent">No response yet.</person>');
  });
});

describe("the checkpoint", () => {
  it("records events and achievements, and validates them", async () => {
    const { app, wsId, wsToken } = await workspace();
    const made = await request(app)
      .post(`/api/workspaces/${wsId}/events`)
      .set(bearer(wsToken))
      .send({ date: "2025-03-01", kind: "achievement", title: "Order book reaches seven months", detail: "Utility wins." })
      .expect(201);
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: "2025-03-01", kind: "rumour", title: "x" }).expect(400);
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: "01/03/2025", kind: "event", title: "x" }).expect(400);
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: "2099-01-01", kind: "event", title: "x" }).expect(400);
    await request(app).post(`/api/workspaces/${wsId}/events`).send({ date: "2025-03-01", kind: "event", title: "x" }).expect(404);
    await request(app).delete(`/api/workspaces/${wsId}/events/${made.body.id}`).set(bearer(wsToken)).expect(204);
    await request(app).delete(`/api/workspaces/${wsId}/events/${made.body.id}`).set(bearer(wsToken)).expect(404);
  });

  it("assembles three years of history: events, decisions with plans, outcomes, lessons and signals", async () => {
    const { app, wsId, wsToken } = await workspace();
    const old = new Date();
    old.setFullYear(old.getFullYear() - 4);
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: old.toISOString().slice(0, 10), kind: "event", title: "Too old to show" }).expect(201);
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: "2025-10-01", kind: "achievement", title: "Recurring revenue reaches 9%" }).expect(201);
    await request(app).post(`/api/workspaces/${wsId}/agents/grimm/lessons`).set(bearer(wsToken)).send({ kind: "fact", text: "Covenant is 2.5x EBITDA." }).expect(201);

    const { id, admin } = await question(app, { wsId, wsToken }, { mode: "agents", people: undefined });
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
    await request(app)
      .post(`/api/consultations/${id}/decision`)
      .set(bearer(admin))
      .send({ decision: "Open the second factory in Q3.", position: "support_with_conditions", plan: "1. Agree financing (FD, 30 Nov). 2. Site shortlist (COO, 15 Jan)." })
      .expect(200);
    await request(app).post(`/api/workspaces/${wsId}/decisions/${id}/outcome`).set(bearer(wsToken)).send({ result: "better" }).expect(200);

    const cp = await request(app).get(`/api/workspaces/${wsId}/checkpoint`).set(bearer(wsToken)).expect(200);
    const kinds = cp.body.entries.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["achievement", "agent", "decision", "plan", "outcome"]));
    expect(cp.body.entries.some((e: { title: string }) => e.title === "Too old to show")).toBe(false);
    const plan = cp.body.entries.find((e: { kind: string }) => e.kind === "plan");
    expect(plan.detail).toContain("Agree financing");
    const dates = cp.body.entries.map((e: { date: string }) => e.date);
    expect([...dates].sort()).toEqual(dates); // chronological
    expect(cp.body.latest).toBeNull();
  });

  it("publishes numbered checkpoints with insights, including people joining and leaving", async () => {
    const { app, wsId, wsToken } = await workspace();
    await request(app).post(`/api/workspaces/${wsId}/events`).set(bearer(wsToken)).send({ date: "2026-05-01", kind: "achievement", title: "Revenue reaches £38.4m" }).expect(201);
    const people = [
      { id: "person-cfo1-joined", date: "2024-03-01", kind: "joined", title: "Fractional CFO joined", detail: "Six-month mandate" },
      { id: "person-cfo1-left", date: "2024-09-01", kind: "left", title: "Fractional CFO left", detail: "Handover recorded" },
    ];
    await request(app).post(`/api/workspaces/${wsId}/checkpoints`).set(bearer(wsToken)).send({ people }).expect(400);
    await request(app)
      .post(`/api/workspaces/${wsId}/checkpoints`)
      .set(bearer(wsToken))
      .send({ publishedBy: "Alex", people: [{ ...people[0], kind: "promoted" }] })
      .expect(400);

    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const first = await request(app).post(`/api/workspaces/${wsId}/checkpoints`).set(bearer(wsToken)).send({ publishedBy: "Alex Morgan", people, status: "Revenue £38.4m" }).expect(201);
    expect(first.body).toMatchObject({ n: 1, publishedBy: "Alex Morgan", entryCount: 3, insights: expect.arrayContaining([expect.objectContaining({ title: expect.any(String) })]) });
    expect(first.body.entryIds).toContain("person-cfo1-left");
    expect(seen[0].messages[0].content).toContain("[Left] Fractional CFO left");

    const second = await request(app).post(`/api/workspaces/${wsId}/checkpoints`).set(bearer(wsToken)).send({ publishedBy: "Alex Morgan" }).expect(201);
    expect(second.body.n).toBe(2);
    const cp = await request(app).get(`/api/workspaces/${wsId}/checkpoint`).set(bearer(wsToken)).expect(200);
    expect(cp.body.latest.n).toBe(2);
    expect(cp.body.checkpoints.map((c: { n: number }) => c.n)).toEqual([2, 1]);
  });
});
