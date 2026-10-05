import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createSession, readSession, hashPassword, verifyPassword } from "../server/auth.js";

// Accounts: sign up, sign in, sign out, the saved workspace, and the ways each
// is refused. Each test uses its own email so the shared memory store and the
// per-app rate limiters don't interfere.

let n = 0;
const email = () => `person${Date.now()}${n++}@acme.example`;
const PASSWORD = "correct horse battery";

async function signUp(app: ReturnType<typeof createApp>, address = email()) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").send({ name: "Pat Chair", email: address, password: PASSWORD });
  return { agent, res, address };
}

describe("passwords and sessions", () => {
  it("hashes passwords with a salt and verifies only the right one", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword("wrong password here", a)).toBe(false);
  });

  it("accepts a signed session and rejects tampered or expired ones", () => {
    const { value } = createSession("a-row");
    expect(readSession(value)).toBe("a-row");
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "a-other", exp: Date.now() + 1e9 })).toString("base64url");
    expect(readSession(`${forged}.${sig}`)).toBeNull();
    expect(readSession(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(readSession(createSession("a-row", Date.now() - 30 * 864e5).value)).toBeNull();
    expect(readSession(undefined)).toBeNull();
    expect(readSession("garbage")).toBeNull();
  });
});

describe("sign up", () => {
  it("creates an account, signs in and sets a secure session cookie", async () => {
    const app = createApp();
    const { agent, res, address } = await signUp(app);
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ email: address, name: "Pat Chair" });
    expect(res.body.account.passwordHash).toBeUndefined();
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/s8_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.account.email).toBe(address);
  });

  it("stores the email in lower case and refuses a second account for it", async () => {
    const app = createApp();
    const address = email();
    await signUp(app, address.toUpperCase());
    const again = await request(app).post("/api/auth/signup").send({ name: "Pat", email: address, password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.fields.email).toBeTruthy();
  });

  it("explains every invalid field", async () => {
    const res = await request(createApp()).post("/api/auth/signup").send({ name: "", email: "not-an-email", password: "short" });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "name", "password"]);
  });
});

describe("sign in and out", () => {
  it("signs in with the right password, case-insensitively by email", async () => {
    const app = createApp();
    const { address } = await signUp(app);
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/signin").send({ email: address.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    await agent.get("/api/auth/me").expect(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const app = createApp();
    const { address } = await signUp(app);
    const wrong = await request(app).post("/api/auth/signin").send({ email: address, password: "not the password" });
    const unknown = await request(app).post("/api/auth/signin").send({ email: email(), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("signs out and ends the session", async () => {
    const app = createApp();
    const { agent } = await signUp(app);
    const out = await agent.post("/api/auth/signout").send({}).expect(200);
    expect(String(out.headers["set-cookie"])).toMatch(/s8_session=;/);
    await agent.get("/api/auth/me").expect(401);
  });

  it("refuses requests without a session", async () => {
    const app = createApp();
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/account/data").expect(401);
    await request(app).put("/api/account/data").send({ data: {} }).expect(401);
  });

  it("rate-limits repeated sign-in attempts", async () => {
    const app = createApp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(app).post("/api/auth/signin").send({ email: "x@acme.example", password: "nope nope nope" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("cross-site protection", () => {
  it("refuses a change from another site's origin", async () => {
    const res = await request(createApp()).post("/api/auth/signup").set("Origin", "https://evil.example").send({ name: "x", email: email(), password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("refuses a form post that isn't JSON", async () => {
    const res = await request(createApp()).post("/api/auth/signin").type("form").send("email=a@b.co&password=xxxxxxxxxxxx");
    expect(res.status).toBe(415);
  });
});

describe("saved workspace", () => {
  it("saves and restores the account's workspace, encrypted at rest", async () => {
    const app = createApp();
    const { agent, address } = await signUp(app);
    expect((await agent.get("/api/account/data").expect(200)).body.data).toEqual({});
    const data = { organisation: JSON.stringify({ name: "Harrow & Vale", people: [{ name: "Jo" }] }), consultations: "[]" };
    await agent.put("/api/account/data").send({ data }).expect(200);

    // A new device: sign in again and get the same workspace back.
    const other = request.agent(app);
    await other.post("/api/auth/signin").send({ email: address, password: PASSWORD }).expect(200);
    expect((await other.get("/api/account/data").expect(200)).body.data).toEqual(data);
  });

  it("keeps each account's workspace to itself", async () => {
    const app = createApp();
    const a = await signUp(app);
    const b = await signUp(app);
    await a.agent.put("/api/account/data").send({ data: { organisation: "A's board" } }).expect(200);
    expect((await b.agent.get("/api/account/data").expect(200)).body.data).toEqual({});
  });

  it("refuses bad keys and oversized workspaces", async () => {
    const app = createApp();
    const { agent } = await signUp(app);
    await agent.put("/api/account/data").send({ data: { "../etc": "x" } }).expect(422);
    await agent.put("/api/account/data").send({ data: { organisation: 5 } }).expect(422);
    await agent.put("/api/account/data").send({ data: ["x"] }).expect(422);
  });

  it("still signs people in after the session secret is rotated, with an empty workspace", async () => {
    const before = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = "first-secret-0123456789abcdef-0123456789";
      const app = createApp();
      const { agent, address } = await signUp(app);
      await agent.put("/api/account/data").send({ data: { organisation: "sealed with the first secret" } }).expect(200);

      process.env.SESSION_SECRET = "second-secret-0123456789abcdef-012345678";
      await agent.get("/api/auth/me").expect(401); // old sessions end
      const again = request.agent(app);
      await again.post("/api/auth/signin").send({ email: address, password: PASSWORD }).expect(200);
      expect((await again.get("/api/account/data").expect(200)).body.data).toEqual({});
      await again.put("/api/account/data").send({ data: { organisation: "fresh" } }).expect(200);
      expect((await again.get("/api/account/data").expect(200)).body.data).toEqual({ organisation: "fresh" });
    } finally {
      if (before === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = before;
    }
  });

  it("deletes the account and its workspace with the password", async () => {
    const app = createApp();
    const { agent, address } = await signUp(app);
    await agent.put("/api/account/data").send({ data: { organisation: "x" } }).expect(200);
    await agent.delete("/api/account").send({ password: "wrong password!!" }).expect(401);
    await agent.delete("/api/account").send({ password: PASSWORD }).expect(200);
    await agent.get("/api/auth/me").expect(401);
    await request(app).post("/api/auth/signin").send({ email: address, password: PASSWORD }).expect(401);
  });
});
