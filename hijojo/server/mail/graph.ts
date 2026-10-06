// Microsoft Outlook via Microsoft Graph (app-only, client credentials).
//
// Sending creates a draft, then sends it. The draft carries the idempotency key
// as an extended property and all ids are immutable, so after an uncertain
// send the engine can ask Outlook what really happened instead of resending.
//
// Permissions (application): Mail.ReadWrite and Mail.Send, restricted to the
// one sender mailbox with an Exchange application access policy. See
// docs/OUTLOOK.md.

import { DefaultAzureCredential } from "@azure/identity";
import type { Inbox, MailTransport, OutgoingMail, ReceivedMail, ReconcileResult, SendResult } from "./transport";

export interface GraphConfig {
  mailbox: string;
  /** Client-credentials app registration. */
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  /** Alternatively, a token source such as the Container App's managed identity. */
  tokenProvider?: () => Promise<string>;
}

/**
 * Outlook configuration from the environment: either the app's managed identity
 * (HIJOJO_GRAPH_MANAGED_IDENTITY=1, no secret to store) or a client secret.
 */
export function graphConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GraphConfig | null {
  const mailbox = env.HIJOJO_SENDER_MAILBOX ?? "";
  if (!mailbox) return null;
  if (env.HIJOJO_GRAPH_MANAGED_IDENTITY === "1") {
    const credential = new DefaultAzureCredential();
    return {
      mailbox,
      tokenProvider: async () => {
        const t = await credential.getToken("https://graph.microsoft.com/.default");
        if (!t) throw new Error("Managed identity returned no Graph token");
        return t.token;
      },
    };
  }
  const c = { tenantId: env.HIJOJO_GRAPH_TENANT_ID ?? "", clientId: env.HIJOJO_GRAPH_CLIENT_ID ?? "", clientSecret: env.HIJOJO_GRAPH_CLIENT_SECRET ?? "" };
  return Object.values(c).every(Boolean) ? { mailbox, ...c } : null;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

const GRAPH = "https://graph.microsoft.com/v1.0";
/** A custom MAPI string property in our own namespace. */
export const IDEMPOTENCY_PROP = "String {7c1e4a52-3f0b-4f43-9a37-5b8e3c2d9f10} Name HijojoIdempotencyKey";

class GraphError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export class GraphMail implements MailTransport, Inbox {
  readonly name = "outlook";
  readonly live = true;
  private token: { value: string; expires: number } | null = null;
  private fetchImpl: FetchLike;

  constructor(
    private cfg: GraphConfig,
    fetchImpl?: FetchLike,
    private now: () => number = Date.now,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as any);
  }

  private async accessToken(): Promise<string> {
    if (this.cfg.tokenProvider) return this.cfg.tokenProvider();
    if (this.token && this.token.expires > this.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(this.cfg.tenantId ?? "")}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId ?? "",
        client_secret: this.cfg.clientSecret ?? "",
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    });
    if (res.status !== 200) throw new GraphError(res.status, `Token request failed (HTTP ${res.status})`);
    const body = await res.json();
    this.token = { value: body.access_token, expires: this.now() + Number(body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const token = await this.accessToken();
    let res;
    try {
      res = await this.fetchImpl(path.startsWith("http") ? path : `${GRAPH}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          prefer: 'IdType="ImmutableId"',
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new GraphError(null, `Network error: ${(e as Error).message}`);
    }
    if (res.status === 401) this.token = null;
    return res;
  }

  private get box() {
    return `/users/${encodeURIComponent(this.cfg.mailbox)}`;
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    // 1. Draft. Nothing has been sent if this fails.
    let draft: { id: string; conversationId: string | null };
    try {
      const res = await this.call("POST", `${this.box}/messages`, {
        subject: mail.subject,
        body: { contentType: "Text", content: mail.body },
        toRecipients: [{ emailAddress: { address: mail.to, ...(mail.toName ? { name: mail.toName } : {}) } }],
        singleValueExtendedProperties: [{ id: IDEMPOTENCY_PROP, value: mail.idempotencyKey }],
      });
      if (res.status !== 201) {
        const transient = res.status === 429 || res.status >= 500;
        return { status: "failed", permanent: !transient, reason: `Draft creation failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}` };
      }
      const b = await res.json();
      draft = { id: b.id, conversationId: b.conversationId ?? null };
    } catch (e) {
      return { status: "failed", permanent: false, reason: (e as Error).message };
    }

    // 2. Send. From here an error leaves us uncertain.
    try {
      const res = await this.call("POST", `${this.box}/messages/${encodeURIComponent(draft.id)}/send`);
      if (res.status === 202) return { status: "sent", providerId: draft.id, conversationId: draft.conversationId };
      if (res.status >= 500 || res.status === 429) return { status: "uncertain", reason: `Send returned HTTP ${res.status}`, providerRef: draft.id };
      return { status: "failed", permanent: true, reason: `Send rejected (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      return { status: "uncertain", reason: (e as Error).message, providerRef: draft.id };
    }
  }

  async reconcile(providerRef: string | null, idempotencyKey: string): Promise<ReconcileResult> {
    try {
      if (providerRef) {
        const res = await this.call("GET", `${this.box}/messages/${encodeURIComponent(providerRef)}?$select=id,isDraft,conversationId`);
        if (res.status === 200) {
          const m = await res.json();
          return m.isDraft ? { status: "not_sent" } : { status: "sent", providerId: m.id, conversationId: m.conversationId ?? null };
        }
        if (res.status !== 404) return { status: "unknown" };
      }
      const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${IDEMPOTENCY_PROP}' and ep/value eq '${idempotencyKey.replace(/'/g, "''")}')`;
      const res = await this.call("GET", `${this.box}/messages?$filter=${encodeURIComponent(filter)}&$select=id,isDraft,conversationId`);
      if (res.status !== 200) return { status: "unknown" };
      const found: any[] = (await res.json()).value ?? [];
      const sent = found.find((m) => !m.isDraft);
      if (sent) return { status: "sent", providerId: sent.id, conversationId: sent.conversationId ?? null };
      return { status: "not_sent" };
    } catch {
      return { status: "unknown" };
    }
  }

  async poll(since: string): Promise<ReceivedMail[]> {
    const out: ReceivedMail[] = [];
    const select = "id,from,subject,body,receivedDateTime,conversationId,internetMessageHeaders";
    let url: string | null =
      `${this.box}/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$select=${select}&$orderby=receivedDateTime&$top=50`;
    for (let page = 0; url && page < 20; page++) {
      const res = await this.call("GET", url, undefined, { prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' });
      if (res.status !== 200) throw new GraphError(res.status, `Inbox poll failed (HTTP ${res.status})`);
      const body = await res.json();
      for (const m of body.value ?? []) {
        out.push({
          providerId: m.id,
          fromEmail: (m.from?.emailAddress?.address ?? "").toLowerCase(),
          fromName: m.from?.emailAddress?.name ?? null,
          subject: m.subject ?? "",
          body: m.body?.content ?? "",
          receivedAt: new Date(m.receivedDateTime).toISOString(),
          conversationId: m.conversationId ?? null,
          headers: Object.fromEntries((m.internetMessageHeaders ?? []).map((h: any) => [String(h.name).toLowerCase(), String(h.value)])),
        });
      }
      url = body["@odata.nextLink"] ?? null;
    }
    return out;
  }
}
