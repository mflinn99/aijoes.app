// The Copilot API: Entra ID bearer tokens (as issued through the Microsoft
// Enterprise token store), mapped to Hijojo users and their roles.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

type KeyLike = CryptoKey;
import { createApp } from "../server/app";
import { createUser } from "../server/auth";
import { createWorld, OPCO } from "../server/sim/world";
import { createEntraVerifier, TOKEN_STORE_CLIENT_ID } from "../server/entra";

const TENANT = "11111111-2222-3333-4444-555555555555";
const AUDIENCE = "api://auth-hijojo.example/abcd";
const status = { ai: { configured: false, detail: "" }, research: { configured: false, detail: "" }, contacts: { configured: false, detail: "" }, mail: { configured: false, detail: "" } };

let key: KeyLike;
let otherKey: KeyLike;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
});

async function token(over: Record<string, unknown> = {}, opts: { key?: KeyLike; exp?: string } = {}) {
  return new SignJWT({ scp: "access_as_user", tid: TENANT, azp: TOKEN_STORE_CLIENT_ID, preferred_username: "op@aigogo.test", name: "Op", oid: "o-1", ...over })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? key);
}

let w: ReturnType<typeof createWorld>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  w = createWorld();
  const entra = createEntraVerifier({ tenantId: TENANT, audiences: [AUDIENCE], requiredScope: "access_as_user", allowedClientIds: [TOKEN_STORE_CLIENT_ID] }, jwks);
  app = createApp(w.engine, status, { entra });
  createUser(w.repo, { email: "op@aigogo.test", name: "Op", role: "OPERATOR", password: "correct horse battery" });
  createUser(w.repo, { email: "viewer@aigogo.test", name: "Viewer", role: "VIEWER", password: "correct horse battery" });
});

const get = async (path: string, t?: string) => request(app).get(path).set("authorization", `Bearer ${t ?? (await token())}`);

describe("Copilot API authentication", () => {
  it("accepts a valid Entra token for a Hijojo user", async () => {
    const r = await get("/api/copilot/opcos");
    expect(r.status).toBe(200);
  });

  it("rejects missing, forged, expired, wrong-audience, wrong-tenant and wrong-client tokens", async () => {
    expect((await request(app).get("/api/copilot/opcos")).status).toBe(401);
    expect((await get("/api/copilot/opcos", await token({}, { key: otherKey }))).status).toBe(401);
    expect((await get("/api/copilot/opcos", await token({}, { exp: "-10m" }))).status).toBe(401);
    const wrongAud = await new SignJWT({ scp: "access_as_user", tid: TENANT, azp: TOKEN_STORE_CLIENT_ID, preferred_username: "op@aigogo.test" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`).setAudience("api://someone-else").setExpirationTime("1h").sign(key);
    expect((await get("/api/copilot/opcos", wrongAud)).status).toBe(401);
    expect((await get("/api/copilot/opcos", await token({ tid: "99999999-0000-0000-0000-000000000000" }))).status).toBe(401);
    expect((await get("/api/copilot/opcos", await token({ azp: "some-other-client" }))).status).toBe(401);
  });

  it("requires the delegated scope", async () => {
    expect((await get("/api/copilot/opcos", await token({ scp: "User.Read" }))).status).toBe(403);
  });

  it("refuses a valid token for someone who is not a Hijojo user", async () => {
    const r = await get("/api/copilot/opcos", await token({ preferred_username: "stranger@aigogo.test" }));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/not a Hijojo user/);
  });

  it("does not accept a browser session cookie on Copilot routes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").set("x-hijojo", "1").send({ email: "op@aigogo.test", password: "correct horse battery" });
    expect((await agent.get("/api/copilot/opcos")).status).toBe(401);
  });
});

describe("Copilot API actions", () => {
  async function launched() {
    w.engine.addOpco(OPCO);
    await w.settle();
    return w.repo.opcos()[0];
  }

  it("lists OpCos with stage counts and shows a profile with evidence status", async () => {
    const opco = await launched();
    const list = (await get("/api/copilot/opcos")).body;
    expect(list.opcos[0]).toMatchObject({ id: opco.id, name: "Clearwater", stages: { Contacted: 3 } });
    const profile = (await get(`/api/copilot/opcos/${opco.id}`)).body;
    expect(profile.proposition).toMatchObject({ status: "FACT" });
    expect(profile.buyingSignals.length).toBeGreaterThan(0);
  });

  it("lists prospects by stage and explains one: who, why them, why now, score, evidence, communication", async () => {
    const opco = await launched();
    const contacted = (await get(`/api/copilot/opcos/${opco.id}/prospects?stage=Contacted`)).body.prospects;
    expect(contacted.map((p: any) => p.name).sort()).toEqual(["Halden Foods Logistics", "Northbridge Freight", "Ridgeway Shipping"]);
    const nb = contacted.find((p: any) => p.name === "Northbridge Freight");
    const d = (await get(`/api/copilot/prospects/${nb.id}`)).body;
    expect(d.who).toMatchObject({ name: "Dana Reyes", title: "Chief Operating Officer" });
    expect(d.whyThem).toBeTruthy();
    expect(d.whyNow).toBeTruthy();
    expect(d.score.total).toBeGreaterThanOrEqual(80);
    expect(d.evidence[0]).toHaveProperty("url");
    expect(d.communications[0]).toMatchObject({ kind: "intro", status: "SENT", qa: "PASS" });
  });

  it("reports outcomes", async () => {
    await launched();
    const m = (await get("/api/copilot/outcomes")).body;
    expect(m.emailsSent.intro).toBe(3);
  });

  it("lets an operator add an OpCo, and stops a viewer", async () => {
    const add = (t: string) =>
      request(app).post("/api/copilot/opcos").set("authorization", `Bearer ${t}`).send({ name: "Project SLATE", introLink: "https://slate-mandate.test/nda", notes: "A teaser." });
    expect((await add(await token())).status).toBe(201);
    expect((await add(await token({ preferred_username: "viewer@aigogo.test" }))).status).toBe(403);
  });

  it("can halt sending but never resume it, switch live sending on or lower the threshold", async () => {
    const t = await token();
    expect((await request(app).post("/api/copilot/halt").set("authorization", `Bearer ${t}`)).status).toBe(200);
    expect(w.engine.halted()).toBe(true);
    for (const path of ["/api/copilot/resume", "/api/copilot/live", "/api/copilot/threshold", "/api/copilot/send"]) {
      expect((await request(app).post(path).set("authorization", `Bearer ${t}`)).status).toBe(404);
    }
  });
});
