// The human handoff. Everything Mark needs to pick the conversation up without
// opening the platform.

import type { Communication, Contact, Finding, InboundMessage, Opco, Prospect, ResponseClass, Source } from "../../shared/types";

const LABEL: Record<ResponseClass, string> = {
  POSITIVE: "Positive",
  INTERESTED: "Interested / question",
  REFERRAL: "Referral",
  NOT_NOW: "Not now",
  NOT_INTERESTED: "Not interested",
  UNSUBSCRIBE: "Unsubscribe",
  OTHER: "Other",
  BOUNCE: "Bounce",
  AUTO_REPLY: "Automatic reply",
};

export function nextAction(cls: ResponseClass, contact: Contact, inbound: InboundMessage): string {
  const excerpt = inbound.body.split("\n").find((l) => l.trim())?.trim().slice(0, 160) ?? "";
  switch (cls) {
    case "POSITIVE":
      return `Reply to ${contact.name} personally within one business day and propose two times for a call. Keep it to their stated interest; do not restart the sequence.`;
    case "INTERESTED":
      return `Answer ${contact.name}'s question directly ("${excerpt}"), then offer a short call. Check any answer about capability or price with the OpCo before committing.`;
    case "REFERRAL":
      return `Contact the person ${contact.name} referred you to, naming ${contact.name} and the original reason for getting in touch. Confirm the new contact's role first.`;
    default:
      return "Review the reply and decide whether any human follow-up is appropriate.";
  }
}

export function buildHandoff(input: {
  opco: Opco;
  prospect: Prospect;
  contact: Contact;
  findings: Finding[];
  sources: Source[];
  sent: Communication[];
  inbound: InboundMessage;
  cls: ResponseClass;
}): { subject: string; body: string } {
  const { opco, prospect, contact, inbound, cls } = input;
  const srcById = new Map(input.sources.map((s) => [s.id, s]));
  const score = prospect.score;
  const facts = input.findings.filter((f) => f.status === "FACT");
  const lines: string[] = [];
  const h = (t: string) => lines.push("", t, "-".repeat(t.length));

  lines.push(`${LABEL[cls]} response from ${contact.name} at ${prospect.name}, for ${opco.name}.`, "Automation has stopped for this prospect. It is yours from here.");

  h("Prospect");
  lines.push(
    `OpCo: ${opco.name}${opco.website ? ` (${opco.website})` : ""}`,
    `Company: ${prospect.name} (https://${prospect.domain})`,
    `Name: ${contact.name}`,
    `Role: ${contact.title}`,
    `Email: ${contact.email}`,
    ...(contact.sourceUrl ? [`Contact source: ${contact.source} (${contact.sourceUrl})`] : [`Contact source: ${contact.source}`]),
  );
  if (prospect.attributes.sector || prospect.attributes.employees || prospect.attributes.geography) {
    lines.push(
      `Profile: ${[prospect.attributes.sector, prospect.attributes.employees ? `${prospect.attributes.employees} employees` : null, prospect.attributes.geography].filter(Boolean).join(", ")}`,
    );
  }

  h("Their response");
  lines.push(`Received ${inbound.receivedAt.slice(0, 16).replace("T", " ")} UTC. Classified: ${LABEL[cls]} (${inbound.classificationReason ?? ""}).`, `Subject: ${inbound.subject}`, "", inbound.body.trim());

  h("Recommended next action");
  lines.push(nextAction(cls, contact, inbound));

  h("Why they were selected");
  lines.push(`Why them: ${prospect.whyThem ?? "-"}`, `Why now: ${prospect.whyNow ?? "-"}`, `Why ${opco.name}: ${prospect.whyProposition ?? "-"}`);
  if (score) {
    lines.push(
      "",
      `Qualification score: ${score.total}/100 (threshold ${score.threshold}, confidence ${score.confidence}%)`,
      ...Object.entries(score.dimensions).map(([k, d]) => `  ${k}: ${d.points}/${d.max}${d.rationale ? ` - ${d.rationale}` : ""}`),
    );
  }

  h("Supporting evidence");
  for (const f of facts) {
    lines.push(`- ${f.statement}${f.observedAt ? ` (${f.observedAt.slice(0, 10)})` : ""}`);
    for (const e of f.evidence) lines.push(`    "${e.quote}" - ${srcById.get(e.sourceId)?.url ?? e.sourceId}`);
  }

  h("Outreach sent");
  for (const c of input.sent) {
    lines.push(`${c.kind === "intro" ? "Introduction" : "Follow-up"} sent ${c.sentAt?.slice(0, 16).replace("T", " ") ?? "-"} UTC`, `Subject: ${c.subject}`, "", c.body, "");
  }

  h("Links");
  lines.push(`Intro link used: ${opco.introLink}`, ...(opco.website ? [`OpCo website: ${opco.website}`] : []), `Prospect website: https://${prospect.domain}`);

  return { subject: `[Hijojo] ${LABEL[cls]}: ${contact.name}, ${prospect.name} (${opco.name})`, body: lines.join("\n") };
}
