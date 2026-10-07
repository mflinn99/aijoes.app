import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { setCompletionObserver, type CompletionRequest } from "../server/ai.js";
import { getStore } from "../server/store.js";
import { agentKnowledge } from "../server/workspace.js";

// The decision log: every decision is logged, saved on the server with the
// organisation's workspace, and reusable: the agents read it as precedent,
// it outlives the board question, and decisions can be edited and revisited.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
afterEach(() => setCompletionObserver(null));

async function workspace(app = createApp()) {
  const res = await request(app).post("/api/workspaces").send({ name: "Harrow & Vale", sector: "Instruments", profile: "120 people." }).expect(201);
  return { app, id: res.body.id as string, token: res.body.adminToken as string };
}

const list = async (app: ReturnType<typeof createApp>, id: string, token: string) =>
  (await request(app).get(`/api/workspaces/${id}/decisions`).set(bearer(token)).expect(200)).body.decisions as Record<string, unknown>[];

describe("logging decisions", () => {
  it("logs a decision taken elsewhere, dated, and saves it with the workspace", async () => {
    const { app, id, token } = await workspace();
    const res = await request(app)
      .post(`/api/workspaces/${id}/decisions`)
      .set(bearer(token))
      .send({ question: "Renew the Leeds lease?", decision: "Renew for five years", position: "support_with_conditions", rationale: "Break clause at year three.", plan: "CFO to sign by 1 Nov", decidedAt: "2026-09-30" })
      .expect(201);
    expect(res.body.decision).toMatchObject({ source: "manual", question: "Renew the Leeds lease?", position: "support_with_conditions", decidedAt: "2026-09-30T12:00:00.000Z", outcome: null });
    expect(res.body.decision.consultationId).toMatch(/^d-/);
    expect(await list(app, id, token)).toEqual([expect.objectContaining({ decision: "Renew for five years", plan: "CFO to sign by 1 Nov" })]);
  });

  it("logs a scenario-analysis decision with its calibration", async () => {
    const { app, id, token } = await workspace();
    const res = await request(app)
      .post(`/api/workspaces/${id}/decisions`)
      .set(bearer(token))
      .send({ source: "analysis", question: "Reduce Payroll", decision: "DON'T DO", position: "oppose", rationale: "Evidence insufficient.", calibration: { risk: 0.2, ambition: 0.5, time: 0.5, cost: 0.8 } })
      .expect(201);
    expect(res.body.decision).toMatchObject({ source: "analysis", mode: "agents", calibration: { risk: 0.2, cost: 0.8 } });
  });

  it("refuses incomplete or invalid decisions", async () => {
    const { app, id, token } = await workspace();
    const post = (body: Record<string, unknown>) => request(app).post(`/api/workspaces/${id}/decisions`).set(bearer(token)).send(body);
    expect((await post({ decision: "x", position: "support" })).body.error).toBe("question required");
    expect((await post({ question: "q", position: "support" })).body.error).toBe("decision required");
    expect((await post({ question: "q", decision: "d", position: "maybe" })).status).toBe(400);
    expect((await post({ question: "q", decision: "d", position: "support", decidedAt: "2999-01-01" })).body.error).toMatch(/today or earlier/);
    expect((await post({ question: "q", decision: "d", position: "support", source: "question" })).status).toBe(400);
    expect((await post({ question: "q", decision: "d", position: "support", source: "analysis", calibration: { risk: 3 } })).body.error).toBe("invalid calibration");
  });

  it("edits and deletes logged decisions; records outcomes without needing the agents", async () => {
    const { app, id, token } = await workspace();
    const made = (await request(app).post(`/api/workspaces/${id}/decisions`).set(bearer(token)).send({ question: "Open Leeds?", decision: "Yes", position: "support" }).expect(201)).body.decision;
    const edited = await request(app).patch(`/api/workspaces/${id}/decisions/${made.consultationId}`).set(bearer(token)).send({ decision: "Yes, in spring", plan: "Hire a site lead" }).expect(200);
    expect(edited.body.decision).toMatchObject({ decision: "Yes, in spring", plan: "Hire a site lead", question: "Open Leeds?" });
    expect(edited.body.decision.updatedAt).toBeTruthy();

    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const outcome = await request(app).post(`/api/workspaces/${id}/decisions/${made.consultationId}/outcome`).set(bearer(token)).send({ result: "as_expected", note: "Opened on time" }).expect(200);
    expect(outcome.body.decision.outcome).toMatchObject({ result: "as_expected", note: "Opened on time" });
    expect(seen).toHaveLength(0); // no agent advised, so no reflection call

    await request(app).delete(`/api/workspaces/${id}/decisions/${made.consultationId}`).set(bearer(token)).expect(204);
    expect(await list(app, id, token)).toEqual([]);
  });

  it("keeps each organisation's decisions to itself", async () => {
    const app = createApp();
    const a = await workspace(app);
    const b = await workspace(app);
    const made = (await request(app).post(`/api/workspaces/${b.id}/decisions`).set(bearer(b.token)).send({ question: "q", decision: "d", position: "support" }).expect(201)).body.decision;
    await request(app).get(`/api/workspaces/${b.id}/decisions`).set(bearer(a.token)).expect(404);
    await request(app).patch(`/api/workspaces/${b.id}/decisions/${made.consultationId}`).set(bearer(a.token)).send({ plan: "x" }).expect(404);
    await request(app).delete(`/api/workspaces/${a.id}/decisions/${made.consultationId}`).set(bearer(a.token)).expect(404);
  });
});

describe("a board question's decision", () => {
  async function decide(app: ReturnType<typeof createApp>, ws: { id: string; token: string }) {
    const q = await request(app)
      .post("/api/consultations")
      .send({
        organisation: "Harrow & Vale",
        leadName: "Alex Morgan",
        question: "Should we open a second factory?",
        context: "Demand is up 30%.",
        mode: "agents",
        workspace: { id: ws.id, token: ws.token },
      })
      .expect(201);
    const { id, adminToken } = q.body as { id: string; adminToken: string };
    await request(app)
      .post(`/api/consultations/${id}/files`)
      .set(bearer(adminToken))
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "site-survey.txt")
      .send(Buffer.from("Site B floods."))
      .expect(201);
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(adminToken)).send({ organisationProfile: "", people: [] }).expect(200);
    await request(app)
      .post(`/api/consultations/${id}/decision`)
      .set(bearer(adminToken))
      .send({ decision: "Open the second factory at site A", position: "support_with_conditions", rationale: "Avoid the flood risk at B.", plan: "Lease signed by March" })
      .expect(200);
    return { id, adminToken };
  }

  it("is saved with its context, the chair's recommendation and document names, and outlives the question", async () => {
    const app = createApp();
    const ws = await workspace(app);
    const { id, adminToken } = await decide(app, ws);
    const [record] = await list(app, ws.id, ws.token);
    expect(record).toMatchObject({
      source: "question",
      consultationId: id,
      question: "Should we open a second factory?",
      context: "Demand is up 30%.",
      decision: "Open the second factory at site A",
      plan: "Lease signed by March",
      documents: ["site-survey.txt"],
    });
    expect(String(record.recommendation)).toMatch(/Mock chair view/);

    // The question itself can be deleted (or expire); the decision stays in the log.
    await request(app).delete(`/api/consultations/${id}`).set(bearer(adminToken)).expect(204);
    expect(await list(app, ws.id, ws.token)).toEqual([expect.objectContaining({ consultationId: id, decision: "Open the second factory at site A" })]);
  });

  it("stays as recorded: notes can be added, but not rewritten or deleted", async () => {
    const app = createApp();
    const ws = await workspace(app);
    const { id } = await decide(app, ws);
    await request(app).patch(`/api/workspaces/${ws.id}/decisions/${id}`).set(bearer(ws.token)).send({ decision: "Something else" }).expect(400);
    const noted = await request(app).patch(`/api/workspaces/${ws.id}/decisions/${id}`).set(bearer(ws.token)).send({ plan: "Lease signed by April" }).expect(200);
    expect(noted.body.decision.plan).toBe("Lease signed by April");
    await request(app).delete(`/api/workspaces/${ws.id}/decisions/${id}`).set(bearer(ws.token)).expect(409);
  });

  it("is reused: the agents read the board's decisions and outcomes as precedent", async () => {
    const app = createApp();
    const ws = await workspace(app);
    const { id } = await decide(app, ws);
    await request(app).post(`/api/workspaces/${ws.id}/decisions`).set(bearer(ws.token)).send({ question: "Renew the Leeds lease?", decision: "Renew", position: "support" }).expect(201);
    await request(app).post(`/api/workspaces/${ws.id}/decisions/${id}/outcome`).set(bearer(ws.token)).send({ result: "worse", note: "Costs ran 20% over" }).expect(200);

    const knowledge = await agentKnowledge(getStore(), ws.id, "grimm");
    expect(knowledge).toContain("<board_decisions");
    expect(knowledge).toContain("Should we open a second factory? → Decided: Open the second factory at site A (Support with conditions)");
    expect(knowledge).toContain("Outcome: Worse than expected (Costs ran 20% over)");
    expect(knowledge).toContain("Renew the Leeds lease? → Decided: Renew (Support). Outcome not yet recorded");

    // And they reach the next board question's prompts.
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const next = await request(app)
      .post("/api/consultations")
      .send({ organisation: "Harrow & Vale", leadName: "Alex Morgan", question: "Should we open a third factory?", mode: "agents", workspace: { id: ws.id, token: ws.token } })
      .expect(201);
    await request(app).post(`/api/consultations/${next.body.id}/shadow-board`).set(bearer(next.body.adminToken)).send({ organisationProfile: "", people: [] }).expect(200);
    expect(seen.find((r) => r.purpose === "shadow")!.system).toContain("Costs ran 20% over");
  });
});
