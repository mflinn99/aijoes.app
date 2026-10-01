import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";

// Sends questionnaire invitations. With Azure Communication Services
// configured, the app emails each person directly. Without it ("manual"), the
// lead is given each person's link and a ready-written email to send from
// their own mailbox, so the feature works before any email service exists.

export type EmailProvider = "acs" | "manual";

export interface OutgoingEmail {
  to: { address: string; displayName: string };
  subject: string;
  text: string;
  html: string;
}

export class EmailConfigError extends Error {}

export function emailProvider(): EmailProvider {
  const raw = (process.env.EMAIL_PROVIDER ?? "manual").toLowerCase();
  if (raw !== "acs" && raw !== "manual") throw new EmailConfigError(`EMAIL_PROVIDER must be acs or manual (got "${raw}")`);
  return raw;
}

/** The public address used in emailed links. Never taken from the request's Host header. */
export function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function assertEmailConfigured(): void {
  if (emailProvider() !== "acs") return;
  const missing = ["ACS_ENDPOINT", "EMAIL_SENDER", "PUBLIC_BASE_URL"].filter((name) => !process.env[name]);
  if (missing.length) throw new EmailConfigError(`Set ${missing.join(", ")} for EMAIL_PROVIDER=acs`);
}

let client: EmailClient | null = null;

/** Test seam: replaces the sender (pass null to restore the real one). */
let override: ((email: OutgoingEmail) => Promise<void>) | null = null;
export function setEmailSenderForTests(fn: ((email: OutgoingEmail) => Promise<void>) | null): void {
  override = fn;
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  if (override) return override(email);
  assertEmailConfigured();
  client ??= process.env.ACS_CONNECTION_STRING
    ? new EmailClient(process.env.ACS_CONNECTION_STRING)
    : new EmailClient(process.env.ACS_ENDPOINT as string, new DefaultAzureCredential());
  const poller = await client.beginSend({
    senderAddress: process.env.EMAIL_SENDER as string,
    recipients: { to: [email.to] },
    content: { subject: email.subject, plainText: email.text, html: email.html },
  });
  const result = await poller.pollUntilDone();
  if (result.status !== "Succeeded") throw new Error(`Email not sent (${result.status})`);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
