import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { createUser } from "../server/auth";
import { createWorld, OPCO } from "../server/sim/world";

const status = {
  ai: { configured: false, detail: "test" },
  research: { configured: false, detail: "test" },
  contacts: { configured: false, detail: "test" },
  mail: { configured: false, detail: "test" },
};

let w: ReturnType<typeof createWorld>;
let app: ReturnType<typeof createApp>;

async function signIn(email: string) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").set("x-hijojo", "1").send({ email, password: "correct horse battery" });
  expect(r.status).toBe(200);
  return agent;
}

beforeEach(() => {
  w = createWorld();
  app = createApp(w.engine, status);
  createUser(w.repo, { email: "admin@aigogo.test", name: "Admin", role: "ADMIN", password: "correct horse battery" });
  createUser(w.repo, { email: "op@aigogo.test", name: "Op", role: "OPERATOR", password: "correct horse battery" });
  createUser(w.repo, { email: "viewer@aigogo.test", name: "Viewer", role: "VIEWER", password: "correct horse battery" });
});

describe("API", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/opcos")).status).toBe(401);
  });

  it("rejects a wrong password without saying which part was wrong", async () => {
    const r = await request(app).post("/api/auth/login").set("x-hijojo", "1").send({ email: "admin@aigogo.test", password: "nope nope nope" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("Incorrect email or password");
  });

  it("sets an httpOnly, SameSite=Strict session cookie", async () => {
    const r = await request(app).post("/api/auth/login").set("x-hijojo", "1").send({ email: "op@aigogo.test", password: "correct horse battery" });
    expect(r.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(r.headers["set-cookie"][0]).toMatch(/SameSite=Strict/);
  });

  it("refuses writes without the X-Hijojo header", async () => {
    const op = await signIn("op@aigogo.test");
    expect((await op.post("/api/opcos").send(OPCO)).status).toBe(403);
  });

  it("lets an operator add an OpCo, which is then analysed", async () => {
    const op = await signIn("op@aigogo.test");
    const r = await op.post("/api/opcos").set("x-hijojo", "1").send(OPCO);
    expect(r.status).toBe(201);
    await w.settle();
    const detail = await op.get(`/api/opcos/${r.body.id}`);
    expect(detail.body.profile.proposition.status).toBe("FACT");
    expect(detail.body.sources[0].text).toBeUndefined();
  });

  it("refuses an OpCo website on a private network", async () => {
    const op = await signIn("op@aigogo.test");
    const r = await op.post("/api/opcos").set("x-hijojo", "1").send({ name: "X", website: "http://169.254.169.254/" });
    expect(r.status).toBe(400);
  });

  it("does not let a viewer change anything", async () => {
    const v = await signIn("viewer@aigogo.test");
    expect((await v.post("/api/opcos").set("x-hijojo", "1").send(OPCO)).status).toBe(403);
    expect((await v.post("/api/settings/halt").set("x-hijojo", "1").send({ halted: true })).status).toBe(403);
  });

  it("lets an operator halt, but only an administrator resume", async () => {
    const op = await signIn("op@aigogo.test");
    expect((await op.post("/api/settings/halt").set("x-hijojo", "1").send({ halted: true })).body.halted).toBe(true);
    expect((await op.post("/api/settings/halt").set("x-hijojo", "1").send({ halted: false })).status).toBe(403);
    const admin = await signIn("admin@aigogo.test");
    expect((await admin.post("/api/settings/halt").set("x-hijojo", "1").send({ halted: false })).body.halted).toBe(false);
  });

  it("will not switch live sending on without a live transport", async () => {
    const admin = await signIn("admin@aigogo.test");
    expect((await admin.post("/api/settings/live").set("x-hijojo", "1").send({ on: true })).status).toBe(409);
  });

  it("allows the threshold to be raised but not lowered", async () => {
    const admin = await signIn("admin@aigogo.test");
    expect((await admin.post("/api/settings/threshold").set("x-hijojo", "1").send({ value: 70 })).status).toBe(400);
    expect((await admin.post("/api/settings/threshold").set("x-hijojo", "1").send({ value: 85 })).body.threshold).toBe(85);
  });

  it("shows a prospect's who, why them, why now, score, evidence, communication and activity", async () => {
    const op = await signIn("op@aigogo.test");
    await op.post("/api/opcos").set("x-hijojo", "1").send(OPCO);
    await w.settle();
    const p = w.prospect("northbridge.test");
    const r = await op.get(`/api/prospects/${p.id}`);
    expect(r.body.contact.name).toBe("Dana Reyes");
    expect(r.body.prospect.whyThem).toBeTruthy();
    expect(r.body.prospect.whyNow).toBeTruthy();
    expect(r.body.prospect.score.total).toBeGreaterThanOrEqual(80);
    expect(r.body.findings.some((f: any) => f.evidence.some((e: any) => e.url === "https://northbridge.test/news"))).toBe(true);
    expect(r.body.communications[0].qa[0].verdict).toBe("PASS");
    expect(r.body.events.length).toBeGreaterThan(0);
  });

  it("simulates a reply end to end in simulation mode", async () => {
    const op = await signIn("op@aigogo.test");
    await op.post("/api/opcos").set("x-hijojo", "1").send(OPCO);
    await w.settle();
    const p = w.prospect("northbridge.test");
    await op.post("/api/simulation/reply").set("x-hijojo", "1").send({ prospectId: p.id, body: "Yes, let's talk." });
    await w.settle();
    expect(w.prospect("northbridge.test").status).toBe("PASSED_TO_MARK");
    expect((await op.get("/api/simulation/outbox")).body[0].to).toBe("mark@aigogo.ai");
  });

  it("reports metrics", async () => {
    const op = await signIn("op@aigogo.test");
    await op.post("/api/opcos").set("x-hijojo", "1").send(OPCO);
    await w.settle();
    const m = (await op.get("/api/metrics")).body;
    expect(m.emailsSent.intro).toBe(3);
    expect(m.opensAndClicks).toMatch(/Not tracked/);
  });
});
