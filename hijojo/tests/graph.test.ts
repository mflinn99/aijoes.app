// The Outlook adapter against a fake Microsoft Graph. No tenant is contacted.

import { describe, expect, it } from "vitest";
import { GraphMail, IDEMPOTENCY_PROP } from "../server/mail/graph";

type Handler = (url: string, init: any) => { status: number; body?: any } | Promise<{ status: number; body?: any }>;

function fakeGraph(routes: Handler) {
  const calls: { url: string; method: string; body: any; headers: Record<string, string> }[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? (url.includes("oauth2") ? init.body : JSON.parse(init.body)) : undefined, headers: init.headers ?? {} });
    if (url.includes("/oauth2/v2.0/token")) return resp({ status: 200, body: { access_token: "tok", expires_in: 3600 } });
    return resp(await routes(url, init));
  };
  return { fetchImpl, calls };
}
const resp = (r: { status: number; body?: any }) => ({ status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body ?? "") });

const cfg = { tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "outreach@aigogo.ai" };
const mail = { to: "dana@northbridge.test", toName: "Dana", subject: "Hello", body: "Body", idempotencyKey: "cm_1" };

describe("Outlook via Microsoft Graph", () => {
  it("creates a draft carrying the idempotency key, then sends it", async () => {
    const g = fakeGraph((url, init) => {
      if (init.method === "POST" && url.endsWith("/messages")) return { status: 201, body: { id: "m1", conversationId: "conv1" } };
      if (url.endsWith("/messages/m1/send")) return { status: 202 };
      return { status: 404 };
    });
    const r = await new GraphMail(cfg, g.fetchImpl).send(mail);
    expect(r).toEqual({ status: "sent", providerId: "m1", conversationId: "conv1" });
    const draft = g.calls.find((c) => c.url.endsWith("/users/outreach%40aigogo.ai/messages"))!;
    expect(draft.body.singleValueExtendedProperties).toEqual([{ id: IDEMPOTENCY_PROP, value: "cm_1" }]);
    expect(draft.body.toRecipients[0].emailAddress.address).toBe("dana@northbridge.test");
    expect(draft.headers.prefer).toContain("ImmutableId");
  });

  it("reports a failed draft as definitely not sent", async () => {
    const g = fakeGraph(() => ({ status: 403, body: { error: "Access denied" } }));
    const r = await new GraphMail(cfg, g.fetchImpl).send(mail);
    expect(r).toMatchObject({ status: "failed", permanent: true });
  });

  it("treats an error after the draft exists as uncertain, with the draft as reference", async () => {
    const g = fakeGraph((url, init) => {
      if (init.method === "POST" && url.endsWith("/messages")) return { status: 201, body: { id: "m1", conversationId: "c" } };
      return { status: 503 };
    });
    expect(await new GraphMail(cfg, g.fetchImpl).send(mail)).toMatchObject({ status: "uncertain", providerRef: "m1" });
  });

  it("reconciles by reference: a sent message is no longer a draft", async () => {
    const g = fakeGraph(() => ({ status: 200, body: { id: "m1", isDraft: false, conversationId: "c" } }));
    expect(await new GraphMail(cfg, g.fetchImpl).reconcile("m1", "cm_1")).toEqual({ status: "sent", providerId: "m1", conversationId: "c" });
    const g2 = fakeGraph(() => ({ status: 200, body: { id: "m1", isDraft: true } }));
    expect(await new GraphMail(cfg, g2.fetchImpl).reconcile("m1", "cm_1")).toEqual({ status: "not_sent" });
  });

  it("reconciles without a reference by searching for the idempotency key", async () => {
    const g = fakeGraph(() => ({ status: 200, body: { value: [{ id: "m9", isDraft: false, conversationId: "c9" }] } }));
    expect(await new GraphMail(cfg, g.fetchImpl).reconcile(null, "cm_1")).toMatchObject({ status: "sent", providerId: "m9" });
    expect(decodeURIComponent(g.calls.at(-1)!.url)).toContain("ep/value eq 'cm_1'");
  });

  it("polls the inbox across pages and maps replies", async () => {
    const g = fakeGraph((url) => {
      if (url === "https://graph.microsoft.com/v1.0/next") {
        return { status: 200, body: { value: [{ id: "i2", from: { emailAddress: { address: "B@x.test" } }, subject: "s", body: { content: "b" }, receivedDateTime: "2026-10-06T10:00:00Z" }] } };
      }
      return {
        status: 200,
        body: {
          value: [
            {
              id: "i1", from: { emailAddress: { address: "Dana@Northbridge.test", name: "Dana" } }, subject: "Re: Hello",
              body: { content: "Yes" }, receivedDateTime: "2026-10-06T09:00:00Z", conversationId: "conv1",
              internetMessageHeaders: [{ name: "Auto-Submitted", value: "no" }],
            },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
        },
      };
    });
    const mails = await new GraphMail(cfg, g.fetchImpl).poll("2026-10-06T00:00:00.000Z");
    expect(mails.map((m) => m.providerId)).toEqual(["i1", "i2"]);
    expect(mails[0]).toMatchObject({ fromEmail: "dana@northbridge.test", conversationId: "conv1", headers: { "auto-submitted": "no" } });
  });

  it("reuses the access token until it nears expiry", async () => {
    let t = 0;
    const g = fakeGraph(() => ({ status: 200, body: { value: [] } }));
    const gm = new GraphMail(cfg, g.fetchImpl, () => t);
    await gm.poll("2026-01-01T00:00:00Z");
    await gm.poll("2026-01-01T00:00:00Z");
    expect(g.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    t = 3600 * 1000;
    await gm.poll("2026-01-01T00:00:00Z");
    expect(g.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
  });
});
