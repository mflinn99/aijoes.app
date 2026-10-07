import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";

// Tenant isolation: one organisation's credentials never open another's data.
// Each workspace and consultation is reached only with its own admin token;
// any other token, including another tenant's valid one, gets the same 404 as
// a workspace that doesn't exist.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function workspace(app: ReturnType<typeof createApp>, name: string) {
  const res = await request(app).post("/api/workspaces").send({ name, sector: "Instruments", profile: "120 people." }).expect(201);
  return { id: res.body.id as string, token: res.body.adminToken as string };
}

describe("tenant isolation", () => {
  it("refuses another tenant's workspace token on every workspace route", async () => {
    const app = createApp();
    const a = await workspace(app, "Tenant A");
    const b = await workspace(app, "Tenant B");
    const routes: Array<[method: "get" | "put" | "delete" | "post", path: string]> = [
      ["get", ""], ["put", ""], ["get", "/agents"], ["get", "/decisions"], ["get", "/horizon"], ["get", "/checkpoint"],
      ["post", "/events"], ["post", "/horizon/scan"], ["delete", ""],
    ];
    for (const [method, path] of routes) {
      const res = await request(app)[method](`/api/workspaces/${b.id}${path}`).set(bearer(a.token)).send({ name: "hijack" });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Tenant B is untouched and still opens with its own token.
    const own = await request(app).get(`/api/workspaces/${b.id}`).set(bearer(b.token)).expect(200);
    expect(own.body.name ?? own.body.workspace?.name).toBe("Tenant B");
    expect(JSON.stringify(own.body)).not.toContain("adminTokenHash");
  });

  it("refuses another tenant's consultation token, and won't link a consultation to a workspace it can't open", async () => {
    const app = createApp();
    const body = {
      organisation: "Tenant A", leadName: "Alex Morgan", question: "Expand?", context: "", dueDate: "2026-12-01",
      questions: ["Main risk?"], people: [{ id: "person-a1", name: "Alex Morgan", role: "CEO", email: "alex@example.com" }],
    };
    const a = (await request(app).post("/api/consultations").send(body).expect(201)).body;
    const b = (await request(app).post("/api/consultations").send({ ...body, organisation: "Tenant B" }).expect(201)).body;
    await request(app).get(`/api/consultations/${b.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).post(`/api/consultations/${b.id}/close`).set(bearer(a.adminToken)).send({}).expect(404);
    await request(app).delete(`/api/consultations/${b.id}`).set(bearer(a.adminToken)).send({}).expect(404);
    await request(app).get(`/api/consultations/${b.id}`).set(bearer(b.adminToken)).expect(200);

    const victim = await workspace(app, "Victim");
    const linked = await request(app).post("/api/consultations").send({ ...body, workspace: { id: victim.id, token: "guessed-token" } });
    expect(linked.status).toBe(400);
    expect(linked.body.error).toBe("workspace not found");
  });
});
