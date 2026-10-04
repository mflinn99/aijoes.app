// Response classification. Rules decide first; the model is consulted only
// when the rules cannot tell, and can never turn an opt-out into anything else.

import { z } from "zod/v4";
import type { Llm } from "../llm/client";
import { UNTRUSTED_NOTICE } from "../llm/client";
import type { ResponseClass } from "../../shared/types";

export interface ClassifiableMail {
  subject: string;
  body: string;
  fromEmail: string;
  headers: Record<string, string>;
}

/** Remove quoted earlier messages so our own wording is never mistaken for theirs. */
export function stripQuoted(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^\s*From:\s.+/i.test(line) || /^_{5,}/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const RULES: [ResponseClass, RegExp][] = [
  ["UNSUBSCRIBE", /\b(unsubscribe|remove me|take me off|stop (?:emailing|contacting|sending)|do not (?:contact|email)|don'?t (?:contact|email)|opt(?:ed)?[- ]out|no more emails)\b/i],
  ["NOT_INTERESTED", /\b(not interested|no,? thanks|no thank you|not for us|not relevant|we(?:'re| are) (?:all )?set|already (?:have|use)|no need|pass on this)\b/i],
  ["REFERRAL", /\b((?:speak|talk) (?:to|with)|(?:contact|reach out to|try|email) (?:my colleague|my boss|our)|right person|cc'?d|copying in|handles this|in charge of|looks after|responsible for)\b/i],
  ["NOT_NOW", /\b(not (?:right )?now|not at the moment|maybe later|next (?:quarter|year|month)|new year|revisit|too busy|bad time|later in the year|check back|in a few months)\b/i],
  ["POSITIVE", /\b(interested|interesting|let'?s (?:talk|chat|speak|meet)|happy to (?:talk|chat|speak|meet|take a look)|book (?:a|some) time|schedule|set up (?:a )?(?:call|meeting|time)|sounds (?:good|great)|keen|would love|yes|send (?:me )?(?:more|details|over|the)|call me|timely)\b/i],
];

export function classifyByRules(m: ClassifiableMail): { cls: ResponseClass; reason: string } {
  const headers = Object.fromEntries(Object.entries(m.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (/^(mailer-daemon|postmaster|mail-daemon)@/i.test(m.fromEmail) || /\b(undeliverable|delivery status notification|mail delivery (?:failed|subsystem)|returned mail|delivery has failed)\b/i.test(m.subject)) {
    return { cls: "BOUNCE", reason: "Delivery failure notice" };
  }
  if (
    (headers["auto-submitted"] && headers["auto-submitted"] !== "no") ||
    headers["x-autoreply"] ||
    headers["x-autorespond"] ||
    /\b(out of (?:the )?office|automatic reply|auto(?:matic)?[- ]?reply|away from (?:the )?office|on annual leave)\b/i.test(m.subject)
  ) {
    return { cls: "AUTO_REPLY", reason: "Automatic reply" };
  }
  const text = stripQuoted(m.body);
  for (const [cls, re] of RULES) {
    const hit = text.match(re);
    if (hit) return { cls, reason: `Matched "${hit[0]}"` };
  }
  // Another person's address in the reply suggests a referral.
  const sender = m.fromEmail.toLowerCase();
  const other = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).find((e) => e.toLowerCase() !== sender);
  if (other) return { cls: "REFERRAL", reason: `Names another address (${other})` };
  if (text.includes("?")) return { cls: "INTERESTED", reason: "Asks a question" };
  return { cls: "OTHER", reason: "No clear signal" };
}

const ClassSchema = z.object({
  classification: z.enum(["POSITIVE", "INTERESTED", "REFERRAL", "NOT_NOW", "NOT_INTERESTED", "UNSUBSCRIBE", "OTHER"]),
  reason: z.string(),
});

export async function classifyResponse(m: ClassifiableMail, llm: Llm | null): Promise<{ cls: ResponseClass; reason: string }> {
  const rules = classifyByRules(m);
  if (rules.cls !== "OTHER" || !llm) return rules;
  try {
    const out = await llm.run({
      task: "classify_response",
      effort: "low",
      system: `Classify a reply to a sales introduction as POSITIVE, INTERESTED (a question or request for information), REFERRAL (points to someone else), NOT_NOW, NOT_INTERESTED, UNSUBSCRIBE or OTHER. ${UNTRUSTED_NOTICE}`,
      prompt: `<email>\nSubject: ${m.subject}\n\n${stripQuoted(m.body)}\n</email>`,
      context: m,
      schema: ClassSchema,
    });
    return { cls: out.classification, reason: `Model: ${out.reason}` };
  } catch {
    return rules;
  }
}
