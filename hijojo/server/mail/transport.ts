// Mail is behind two small interfaces so the sequence logic never knows whether
// it is talking to Outlook or to the simulation.

export interface OutgoingMail {
  to: string;
  toName: string | null;
  subject: string;
  body: string;
  /** Stable per communication; lets a provider or a reconcile recognise a repeat. */
  idempotencyKey: string;
}

export type SendResult =
  | { status: "sent"; providerId: string; conversationId: string | null }
  /** Definitely not sent. `permanent` means retrying cannot help (e.g. invalid recipient). */
  | { status: "failed"; permanent: boolean; reason: string; invalidRecipient?: boolean }
  /** The request may or may not have gone out. Never retried blindly. */
  | { status: "uncertain"; reason: string; providerRef: string | null };

export type ReconcileResult = { status: "sent"; providerId: string; conversationId: string | null } | { status: "not_sent" } | { status: "unknown" };

export interface MailTransport {
  readonly name: string;
  readonly live: boolean;
  send(mail: OutgoingMail): Promise<SendResult>;
  /** After an uncertain send: find out what actually happened. */
  reconcile(providerRef: string | null, idempotencyKey: string): Promise<ReconcileResult>;
}

export interface ReceivedMail {
  providerId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  conversationId: string | null;
  headers: Record<string, string>;
}

export interface Inbox {
  readonly name: string;
  /** Messages received at or after `since`. Must be safe to call repeatedly. */
  poll(since: string): Promise<ReceivedMail[]>;
}

/**
 * The simulated mailbox: an outbox that records instead of sending, and an
 * inbox tests and the demo can drop replies into. Nothing leaves the process.
 */
export class SimMailbox implements MailTransport, Inbox {
  readonly name = "simulated";
  readonly live = false;
  readonly sent: (OutgoingMail & { providerId: string; conversationId: string; at: string })[] = [];
  private inbox: ReceivedMail[] = [];
  private seq = 0;
  /** Test hooks: make the next send fail or be uncertain. */
  nextResult: SendResult | null = null;
  invalidRecipients = new Set<string>();

  constructor(private now: () => Date = () => new Date()) {}

  async send(mail: OutgoingMail): Promise<SendResult> {
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return r;
    }
    if (this.invalidRecipients.has(mail.to.toLowerCase())) {
      return { status: "failed", permanent: true, reason: "550 5.1.1 Recipient address rejected", invalidRecipient: true };
    }
    const providerId = `sim-msg-${++this.seq}`;
    const conversationId = `sim-conv-${mail.idempotencyKey}`;
    this.sent.push({ ...mail, providerId, conversationId, at: this.now().toISOString() });
    return { status: "sent", providerId, conversationId };
  }

  async reconcile(_ref: string | null, idempotencyKey: string): Promise<ReconcileResult> {
    const m = this.sent.find((s) => s.idempotencyKey === idempotencyKey);
    return m ? { status: "sent", providerId: m.providerId, conversationId: m.conversationId } : { status: "not_sent" };
  }

  /** Deliver a reply as if the recipient had written back. */
  deliver(m: Omit<ReceivedMail, "providerId" | "receivedAt" | "headers"> & { receivedAt?: string; headers?: Record<string, string> }): ReceivedMail {
    const mail: ReceivedMail = {
      ...m,
      providerId: `sim-in-${++this.seq}`,
      receivedAt: m.receivedAt ?? this.now().toISOString(),
      headers: m.headers ?? {},
    };
    this.inbox.push(mail);
    return mail;
  }

  /** Reply within the conversation of the last message sent to `to`. */
  replyFrom(to: string, body: string, opts: { subject?: string; fromName?: string; headers?: Record<string, string> } = {}): ReceivedMail {
    const last = [...this.sent].reverse().find((s) => s.to.toLowerCase() === to.toLowerCase());
    return this.deliver({
      fromEmail: to,
      fromName: opts.fromName ?? null,
      subject: opts.subject ?? `Re: ${last?.subject ?? ""}`,
      body,
      conversationId: last?.conversationId ?? null,
      headers: opts.headers,
    });
  }

  async poll(since: string): Promise<ReceivedMail[]> {
    return this.inbox.filter((m) => m.receivedAt >= since);
  }

  sentTo(email: string) {
    return this.sent.filter((s) => s.to.toLowerCase() === email.toLowerCase());
  }
}
