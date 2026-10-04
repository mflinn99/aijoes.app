// Communication Agent. It writes the six short sections; the layout, link,
// signature and opt-out are rendered here so every message has the remit's
// structure: why them, why now, problem, proposition, teaser, link, CTA.

import { z } from "zod/v4";
import type { Repo } from "../repo";
import type { Llm } from "../llm/client";
import { hashText } from "../evidence";
import type { Claim, CommKind, CommSections, Communication, Contact, Finding, Opco, Prospect } from "../../shared/types";
import type { QaCheck } from "../../shared/types";

const SECTION_KEYS = ["whyThem", "whyNow", "problem", "proposition", "teaser", "cta"] as const;

const ComposeSchema = z.object({
  subject: z.string(),
  sections: z.object({
    whyThem: z.string(),
    whyNow: z.string(),
    problem: z.string(),
    proposition: z.string(),
    teaser: z.string(),
    cta: z.string(),
  }),
  evidence: z.array(z.object({ section: z.enum(SECTION_KEYS), findingId: z.string() })),
  opcoClaimIds: z.array(z.string()),
  approach: z.string(),
});

export function optOutLine(opcoName: string): string {
  return `If this isn't relevant, reply "no thanks" and ${opcoName} won't contact you again.`;
}

export function renderBody(input: { contact: Pick<Contact, "name">; sections: CommSections; link: string; senderName: string; opcoName: string }): string {
  const first = input.contact.name.trim().split(/\s+/)[0];
  const s = input.sections;
  const para = (...xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).join(" ");
  return [
    `Hi ${first},`,
    para(s.whyThem, s.whyNow),
    para(s.problem, s.proposition),
    para(s.teaser, input.link),
    s.cta.trim(),
    `${input.senderName}\n${input.opcoName}`,
    optOutLine(input.opcoName),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const COMPOSER_SYSTEM = `You are the Communication Agent. You write a short, individually relevant email to one named person, in plain British English.
The message must make obvious why this company, why this person and why now, using only the findings and claims provided. Structure: why them, why now, the relevant problem, a one-sentence proposition, a teaser that creates curiosity, and one low-friction call to action.
Rules:
- Each section is one or two sentences. Keep the whole message under 120 words.
- Use only the facts given. Do not add numbers, results, customer names, awards or superlatives that are not in the material.
- Never mention prices, discounts, trials, contracts, guarantees or commitments; never negotiate.
- No generic sales language ("innovative", "transform", "I hope this finds you well", "companies like yours", "quick question").
- Do not include links, signatures or opt-out lines; they are added for you.
- Cite, per section, the finding ids you relied on, and the OpCo claim ids behind the proposition.`;

export interface ComposeInput {
  kind: CommKind;
  opco: Opco;
  prospect: Prospect;
  contact: Contact;
  findings: Finding[];
  claims: Claim[];
  senderName: string;
  attempt: number;
  previous?: Communication | null;
  feedback?: QaCheck[];
}

export async function composeCommunication(deps: { repo: Repo; llm: Llm }, input: ComposeInput): Promise<Communication> {
  const facts = input.findings.filter((f) => f.status === "FACT");
  const claims = input.claims.filter((c) => c.status === "FACT");
  const out = await deps.llm.run({
    task: "compose_message",
    effort: "high",
    system: COMPOSER_SYSTEM,
    prompt: [
      `Message: ${input.kind === "intro" ? "first introduction" : "the single follow-up, five days after an unanswered introduction"}`,
      `To: ${input.contact.name}, ${input.contact.title} at ${input.prospect.name}`,
      `From: ${input.senderName}, ${input.opco.name}`,
      `Why them: ${input.prospect.whyThem ?? ""}`,
      `Why now: ${input.prospect.whyNow ?? ""}`,
      `Why this proposition: ${input.prospect.whyProposition ?? ""}`,
      `Findings (verified):\n${facts.map((f) => `- [${f.id}] ${f.kind}${f.signalId ? ` (${f.signalId})` : ""}: ${f.statement} | "${f.evidence[0]?.quote ?? ""}"`).join("\n")}`,
      `${input.opco.name} claims (verified):\n${claims.map((c) => `- [${c.id}] ${c.field}: ${c.statement}`).join("\n")}`,
      input.previous
        ? `The introduction already sent (do not repeat it; open with a short reminder, then add a different observation or benefit drawn from findings it did not use; never write "just following up"):\n${input.previous.body}\nFindings it used: ${input.previous.evidence.map((e) => e.findingId).join(", ")}`
        : "",
      input.feedback?.length
        ? `Independent QA returned the previous draft. Fix every point:\n${input.feedback.map((c) => `- ${c.name}: ${c.detail}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    context: { ...input },
    schema: ComposeSchema,
  });

  const link = input.opco.introLink;
  const body = renderBody({ contact: input.contact, sections: out.sections, link, senderName: input.senderName, opcoName: input.opco.name });
  return deps.repo.addCommunication({
    prospectId: input.prospect.id,
    contactId: input.contact.id,
    kind: input.kind,
    attempt: input.attempt,
    subject: out.subject.trim(),
    body,
    link,
    sections: out.sections,
    evidence: out.evidence,
    opcoClaimIds: out.opcoClaimIds,
    approach: out.approach,
    contentHash: hashText(`${input.contact.email}\n${out.subject}\n${body}`),
  });
}
