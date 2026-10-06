// The Microsoft 365 Copilot app package: the documented manifest rules, and
// agreement between the plugin, the OpenAPI description and the running API.
// (The official JSON schemas are not reachable from the build environment;
// validate with Microsoft 365 Agents Toolkit before publishing.)

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import request from "supertest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../server/app";
import { createUser } from "../server/auth";
import { createEntraVerifier, TOKEN_STORE_CLIENT_ID } from "../server/entra";
import { createWorld, OPCO } from "../server/sim/world";
// @ts-expect-error: plain ESM script without types
import { buildPackage, fill } from "../scripts/copilot-package.mjs";

const DIR = "copilot/appPackage";
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");
const manifest = JSON.parse(read("manifest.json"));
const agent = JSON.parse(read("declarativeAgent.json"));
const plugin = JSON.parse(read("hijojo-plugin.json"));
const openapi = parseYaml(read("openapi.yaml"));

const operations: { method: string; path: string; id: string; op: any }[] = Object.entries(openapi.paths).flatMap(([path, item]: [string, any]) =>
  Object.entries(item).map(([method, op]: [string, any]) => ({ method, path, id: op.operationId, op })),
);

function pngSize(file: string): [number, number] {
  const b = readFileSync(`${DIR}/${file}`);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("Copilot app package", () => {
  it("app manifest: v1.24, icons of the required sizes, and the agent it names exists", () => {
    expect(manifest.manifestVersion).toBe("1.24");
    expect(manifest.$schema).toContain("/teams/v1.24/");
    expect(manifest.name.short.length).toBeLessThanOrEqual(30);
    expect(manifest.description.short.length).toBeLessThanOrEqual(80);
    expect(manifest.description.full.length).toBeLessThanOrEqual(4000);
    expect(pngSize(manifest.icons.color)).toEqual([192, 192]);
    expect(pngSize(manifest.icons.outline)).toEqual([32, 32]);
    for (const a of manifest.copilotAgents.declarativeAgents) expect(existsSync(`${DIR}/${a.file}`)).toBe(true);
  });

  it("declarative agent: v1.8 limits, and its instructions are the reviewed source", () => {
    expect(agent.version).toBe("v1.8");
    expect(agent.$schema).toContain("/declarative-agent/v1.8/");
    expect(agent.name.length).toBeLessThanOrEqual(100);
    expect(agent.description.length).toBeLessThanOrEqual(1000);
    expect(agent.instructions.length).toBeLessThanOrEqual(8000);
    expect(agent.instructions).toBe(readFileSync("copilot/instructions.txt", "utf8").trim());
    expect(agent.conversation_starters.length).toBeLessThanOrEqual(12);
    expect(agent.actions.length).toBeGreaterThanOrEqual(1);
    expect(agent.actions.length).toBeLessThanOrEqual(10);
    for (const a of agent.actions) expect(existsSync(`${DIR}/${a.file}`)).toBe(true);
  });

  it("the instructions keep Hijojo's boundaries", () => {
    expect(agent.instructions).toMatch(/cannot send/i);
    expect(agent.instructions).toMatch(/Never invent/);
    expect(agent.instructions).toMatch(/FACT.*INFERENCE.*UNKNOWN/s);
  });

  it("plugin: v2.4, valid names, Entra SSO through the token store, and confirmation on every write", () => {
    expect(plugin.schema_version).toBe("v2.4");
    expect(plugin.namespace).toMatch(/^[A-Za-z0-9]+$/);
    expect(plugin.name_for_human.length).toBeLessThanOrEqual(20);
    expect(plugin.description_for_human.length).toBeLessThanOrEqual(100);
    expect(plugin.description_for_model.length).toBeLessThanOrEqual(2048);
    const [runtime] = plugin.runtimes;
    expect(runtime).toMatchObject({ type: "OpenApi", auth: { type: "OAuthPluginVault", reference_id: "${{HIJOJO_SSO_AUTH_CONFIG_ID}}" } });
    expect(existsSync(`${DIR}/${runtime.spec.url}`)).toBe(true);

    const ids = operations.map((o) => o.id).sort();
    expect(plugin.functions.map((f: any) => f.name).sort()).toEqual(ids);
    expect([...runtime.run_for_functions].sort()).toEqual(ids);
    for (const f of plugin.functions) expect(f.name).toMatch(/^[A-Za-z0-9_]+$/);
    for (const o of operations.filter((o) => o.method !== "get")) {
      const f = plugin.functions.find((x: any) => x.name === o.id);
      expect(f.capabilities?.confirmation?.type, o.id).toBe("AdaptiveCard");
    }
  });

  it("OpenAPI: 3.0, one server, every operation described", () => {
    expect(openapi.openapi).toMatch(/^3\.0\./);
    expect(openapi.servers).toHaveLength(1);
    for (const o of operations) {
      expect(o.id, `${o.method} ${o.path}`).toBeTruthy();
      expect(o.op.description, o.id).toBeTruthy();
    }
  });

  it("every operation in the OpenAPI description is served by Hijojo", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const tenant = "11111111-2222-3333-4444-555555555555";
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" }] });
    const w = createWorld();
    const app = createApp(w.engine, { ai: { configured: false, detail: "" }, research: { configured: false, detail: "" }, contacts: { configured: false, detail: "" }, mail: { configured: false, detail: "" } }, {
      entra: createEntraVerifier({ tenantId: tenant, audiences: ["api://hijojo"], requiredScope: "access_as_user", allowedClientIds: [TOKEN_STORE_CLIENT_ID] }, jwks),
    });
    createUser(w.repo, { email: "admin@aigogo.test", name: "A", role: "ADMIN", password: "correct horse battery" });
    w.engine.addOpco(OPCO);
    await w.settle();
    w.mail.replyFrom("dana.reyes@northbridge.test", "Yes, let's talk.");
    await w.settle();
    const nb = w.prospect("northbridge.test");
    const ids: Record<string, string> = { opcoId: w.repo.opcos()[0].id, prospectId: nb.id, handoffId: w.repo.handoffs()[0].id };
    const token = await new SignJWT({ scp: "access_as_user", tid: tenant, azp: TOKEN_STORE_CLIENT_ID, preferred_username: "admin@aigogo.test" })
      .setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience("api://hijojo").setExpirationTime("1h").sign(privateKey);
    const bodies: Record<string, unknown> = {
      addOpco: { name: "Project SLATE", introLink: "https://slate-mandate.test/nda", notes: "Teaser." },
      recordProspectFeedback: { falsePositive: false },
      recordHandoffVerdict: { verdict: "ACCEPTED" },
    };
    for (const o of operations) {
      const url = "/api/copilot" + o.path.replace(/\{(\w+)\}/g, (_, k) => ids[k]);
      const res = await (request(app) as any)[o.method](url).set("authorization", `Bearer ${token}`).send(bodies[o.id] ?? {});
      expect([200, 201], `${o.id} ${o.method.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
  });

  it("packages with every placeholder filled, and refuses if one is missing", () => {
    const vars = {
      TEAMS_APP_ID: "6a1c6f0e-2c1b-4b0e-9a55-0f3c8e2d7b11", AGENT_VERSION: "1.0.0", HIJOJO_API_URL: "https://hijojo.example.com",
      HIJOJO_SSO_AUTH_CONFIG_ID: "auth-config-1", SUPPORT_EMAIL: "support@aigogo.test", PRIVACY_URL: "https://aigogo.test/privacy", TERMS_URL: "https://aigogo.test/terms",
    };
    const zip: Buffer = buildPackage(vars);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(fill(read("openapi.yaml"), vars)).toContain("https://hijojo.example.com/api/copilot");
    expect(() => buildPackage({ ...vars, HIJOJO_SSO_AUTH_CONFIG_ID: "" })).toThrow(/HIJOJO_SSO_AUTH_CONFIG_ID/);
  });
});
