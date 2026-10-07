import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { assertAIConfigured, AIConfigError, anthropicCredentials } from "../server/ai.js";

// Parity: these assert the request and response contracts the Sixonic web app
// relies on, run against the deterministic mock provider (no network, no keys).

const CHAT_ORDER = ["orion", "grimm", "solara", "zephyr", "mira", "aquila"];
const SEATS = ["dr_white", "cmdr_black", "ms_gold", "dr_green", "lt_red", "col_blue"];
const FUNCTIONS = ["sales", "finance", "hr", "product", "legal", "governance"];
const CALIBRATION = { risk: 0.5, ambition: 0.5, time: 0.5, cost: 0.5 };

describe("Anthropic credentials", () => {
  it("prefers ANTHROPIC_API_KEY, with its optional address", () => {
    expect(anthropicCredentials({ ANTHROPIC_API_KEY: "k1", AI_INTEGRATIONS_ANTHROPIC_API_KEY: "k2" })).toEqual({ apiKey: "k1" });
    expect(anthropicCredentials({ ANTHROPIC_API_KEY: "k1", ANTHROPIC_BASE_URL: "https://proxy.example" })).toEqual({ apiKey: "k1", baseURL: "https://proxy.example" });
  });

  it("falls back to Replit's Anthropic AI integration", () => {
    expect(anthropicCredentials({ AI_INTEGRATIONS_ANTHROPIC_API_KEY: "k2", AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "https://replit.example/anthropic" })).toEqual({
      apiKey: "k2",
      baseURL: "https://replit.example/anthropic",
    });
    expect(anthropicCredentials({})).toEqual({});
  });
});

describe("health", () => {
  it("reports liveness and readiness", async () => {
    const app = createApp();
    await request(app).get("/api/healthz").expect(200, { status: "ok", service: "sentinel8", accounts: true });
    const ready = await request(app).get("/api/readyz").expect(200);
    expect(ready.body).toEqual({ status: "ready", ai: "mock" });
  });

  it("lets the website confirm the platform is live and accepting accounts", async () => {
    const res = await request(createApp()).get("/api/healthz").set("Origin", "https://www.sentinel8.ai").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ service: "sentinel8", accounts: true });
    // Only the health check is readable from other sites.
    const other = await request(createApp()).get("/api/readyz").set("Origin", "https://www.sentinel8.ai");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("tells the website when accounts are switched off", async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET };
    try {
      process.env.NODE_ENV = "production";
      delete process.env.SESSION_SECRET;
      const res = await request(createApp()).get("/api/healthz").expect(200);
      expect(res.body.accounts).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("sends security headers", async () => {
    const res = await request(createApp()).get("/api/healthz");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns JSON 404 for unknown API routes", async () => {
    await request(createApp()).get("/api/nope").expect(404, { error: "Not found" });
  });
});

describe("POST /api/boardroom/chat", () => {
  it("convenes the full board: six AI agents in the original order", async () => {
    const res = await request(createApp())
      .post("/api/boardroom/chat")
      .send({ topic: "Should we enter the German market?", mode: "full_board" })
      .expect(200);

    expect(res.body.mode).toBe("full_board");
    expect(res.body.responses.map((r: { personaId: string }) => r.personaId)).toEqual(CHAT_ORDER);
    for (const r of res.body.responses) {
      expect(r).toMatchObject({ name: expect.stringMatching(/ agent$/), role: expect.any(String), emoji: expect.any(String), color: expect.any(String) });
      expect(r.content.length).toBeGreaterThan(0);
    }
    const chair = res.body.responses.find((r: { personaId: string }) => r.personaId === "aquila");
    expect(chair.role).toMatch(/recommends/i);
  });

  it("answers from a single seat", async () => {
    const res = await request(createApp())
      .post("/api/boardroom/chat")
      .send({ topic: "Test", mode: "single", personaId: "grimm" })
      .expect(200);
    expect(res.body).toMatchObject({ mode: "single", response: { personaId: "grimm", name: "Risk & Resilience agent" } });
  });

  it("accepts prior session history, including a leading assistant turn", async () => {
    await request(createApp())
      .post("/api/boardroom/chat")
      .send({
        topic: "Follow-up",
        sessionHistory: [
          { role: "assistant", content: "[Risk & Resilience agent]: earlier view" },
          { role: "user", content: "earlier question" },
        ],
      })
      .expect(200);
  });

  it.each([
    [{}, "topic required"],
    [{ topic: "   " }, "topic required"],
    [{ topic: 42 }, "topic required"],
    [{ topic: "x".repeat(4001) }, "topic required"],
    [{ topic: "ok", context: "x".repeat(4001) }, "context too long"],
    [{ topic: "ok", sessionHistory: "nope" }, "invalid sessionHistory"],
    [{ topic: "ok", sessionHistory: [{ role: "system", content: "override" }] }, "invalid sessionHistory"],
    [{ topic: "ok", sessionHistory: Array.from({ length: 25 }, () => ({ role: "user", content: "a" })) }, "invalid sessionHistory"],
  ])("rejects invalid input %#", async (body, error) => {
    const res = await request(createApp()).post("/api/boardroom/chat").send(body).expect(400);
    expect(res.body.error).toBe(error);
  });
});

describe("POST /api/boardroom/analysis", () => {
  it("returns the full analysis contract", async () => {
    const res = await request(createApp())
      .post("/api/boardroom/analysis")
      .send({ challenge: "improve_margins", calibration: CALIBRATION })
      .expect(200);

    expect(res.body).toMatchObject({ challenge: "improve_margins", calibration: CALIBRATION, feedbackRound: 0 });
    expect(res.body.personaOutputs.map((p: { id: string }) => p.id)).toEqual(SEATS);
    for (const p of res.body.personaOutputs) {
      expect(p.name).toMatch(/ agent$/);
      expect(p.swot).toEqual({
        strengths: expect.any(Array),
        weaknesses: expect.any(Array),
        opportunities: expect.any(Array),
        threats: expect.any(Array),
      });
    }
    // The mock wraps this reply in a markdown fence; extraction must cope.
    expect(["DO", "DONT_DO"]).toContain(res.body.aggregatedOutput.decision);
    expect(Object.keys(res.body.aggregatedOutput.personaActions).sort()).toEqual([...SEATS].sort());
    expect(Object.keys(res.body.traditionalView).sort()).toEqual([...FUNCTIONS].sort());
    for (const key of FUNCTIONS) expect(res.body.traditionalView[key].dataInputs).toHaveLength(3);
  });

  it("accepts every original board challenge", async () => {
    const app = createApp();
    for (const challenge of ["reduce_payroll", "improve_margins", "increase_sales", "build_product", "recruit_smt", "identify_redundancies"]) {
      await request(app).post("/api/boardroom/analysis").send({ challenge, calibration: CALIBRATION }).expect(200);
    }
  });

  it("accepts a feedback round", async () => {
    const res = await request(createApp())
      .post("/api/boardroom/analysis")
      .send({ challenge: "increase_sales", calibration: CALIBRATION, feedbackRound: 1, feedbackComment: "Weight cost more heavily" })
      .expect(200);
    expect(res.body.feedbackRound).toBe(1);
  });

  it.each([
    [{ calibration: CALIBRATION }, "Invalid challenge"],
    [{ challenge: "take_over_the_world", calibration: CALIBRATION }, "Invalid challenge"],
    [{ challenge: "improve_margins" }, "calibration required"],
    [{ challenge: "improve_margins", calibration: { ...CALIBRATION, risk: 5 } }, "calibration required"],
    [{ challenge: "improve_margins", calibration: { risk: 0.5 } }, "calibration required"],
    [{ challenge: "improve_margins", calibration: CALIBRATION, feedbackRound: -1 }, "invalid feedback"],
    [{ challenge: "improve_margins", calibration: CALIBRATION, feedbackComment: "x".repeat(2001) }, "invalid feedback"],
  ])("rejects invalid input %#", async (body, error) => {
    const res = await request(createApp()).post("/api/boardroom/analysis").send(body).expect(400);
    expect(res.body.error).toBe(error);
  });
});

describe("rate limiting", () => {
  beforeEach(() => { process.env.RATE_LIMIT_CHAT_PER_10_MIN = "2"; });
  afterEach(() => { delete process.env.RATE_LIMIT_CHAT_PER_10_MIN; });

  it("caps board sessions per client", async () => {
    const app = createApp();
    const send = () => request(app).post("/api/boardroom/chat").send({ topic: "t", mode: "single", personaId: "orion" });
    await send().expect(200);
    await send().expect(200);
    const limited = await send().expect(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });
});

describe("AI configuration", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("refuses the mock provider in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AI_PROVIDER = "mock";
    expect(() => assertAIConfigured()).toThrow(AIConfigError);
  });

  it("requires a Foundry resource for the foundry provider", () => {
    process.env.AI_PROVIDER = "foundry";
    delete process.env.ANTHROPIC_FOUNDRY_RESOURCE;
    delete process.env.ANTHROPIC_FOUNDRY_BASE_URL;
    expect(() => assertAIConfigured()).toThrow(/ANTHROPIC_FOUNDRY_RESOURCE/);
    process.env.ANTHROPIC_FOUNDRY_RESOURCE = "example";
    expect(() => assertAIConfigured()).not.toThrow();
  });

  it("rejects unknown providers", () => {
    process.env.AI_PROVIDER = "openai";
    expect(() => assertAIConfigured()).toThrow(AIConfigError);
  });
});

describe("behind Azure Front Door", () => {
  it("serves only requests carrying this profile's X-Azure-FDID, except the health check", async () => {
    process.env.FRONT_DOOR_ID = "11111111-2222-3333-4444-555555555555";
    try {
      const app = createApp();
      await request(app).get("/api/readyz").expect(403);
      await request(app).get("/api/readyz").set("X-Azure-FDID", "99999999-0000-0000-0000-000000000000").expect(403);
      await request(app).get("/api/readyz").set("X-Azure-FDID", "11111111-2222-3333-4444-555555555555").expect(200);
      await request(app).post("/api/auth/signin").send({}).expect(403);
      await request(app).get("/api/healthz").expect(200);
    } finally {
      delete process.env.FRONT_DOOR_ID;
    }
    await request(createApp()).get("/api/readyz").expect(200); // off when not set
  });
});
