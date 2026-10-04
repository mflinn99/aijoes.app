// Runtime configuration. Secrets come from the environment of the deployment,
// never from source or the UI.

export interface Config {
  /** "simulate" (default) records mail instead of sending it. */
  sendMode: "simulate" | "live";
  /** Where qualified responses go. The remit names this address. */
  handoffTo: string;
  senderName: string;
  senderEmail: string;
  /** Hard ceiling on introductions plus follow-ups per rolling 24 hours. */
  dailySendCap: number;
  followupAfterDays: number;
  /** After the follow-up, how long before an unanswered sequence is closed. */
  closeAfterDays: number;
  maxNewProspectsPerRun: number;
  /** Evidence older than this (by retrieval) must be refreshed before a send. */
  evidenceMaxAgeDays: number;
  /** A trigger published longer ago than this cannot justify "why now". */
  triggerMaxAgeDays: number;
  /** One contact per person across all OpCos within this window. */
  contactCooldownDays: number;
  maxComposeAttempts: number;
  inboxPollMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    sendMode: env.HIJOJO_SEND_MODE === "live" ? "live" : "simulate",
    handoffTo: env.HIJOJO_HANDOFF_TO || "mark@aigogo.ai",
    senderName: env.HIJOJO_SENDER_NAME || "AIGoGo",
    senderEmail: env.HIJOJO_SENDER_MAILBOX || "",
    dailySendCap: num("HIJOJO_DAILY_SEND_CAP", 20),
    followupAfterDays: 5,
    closeAfterDays: 14,
    maxNewProspectsPerRun: num("HIJOJO_MAX_NEW_PROSPECTS", 10),
    evidenceMaxAgeDays: 30,
    triggerMaxAgeDays: 180,
    contactCooldownDays: 90,
    maxComposeAttempts: 2,
    inboxPollMinutes: num("HIJOJO_INBOX_POLL_MINUTES", 5),
  };
}

export const testConfig = (over: Partial<Config> = {}): Config => ({
  ...loadConfig({}),
  senderName: "Alex Morgan",
  senderEmail: "alex@aigogo.test",
  ...over,
});
