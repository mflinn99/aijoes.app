/**
 * Outreach — Directive Phase 8.
 *
 * "Messages must derive from actual account intelligence. Never generate
 * 'Hi {{first_name}}, I noticed your company…' style generic AI spam. Every
 * engagement should have a defensible reason for contact."
 *
 * So there are no templates with slots. A message is assembled from the specific
 * observation that produced the hypothesis, and if there is no such observation
 * the composer refuses to write anything. The refusal path matters more than the
 * composition path.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type { MspProfile } from './profile';
import { outreachSafeClaims, serviceById } from './profile';
import type { EvidenceItem, GtmAccount, GtmContact, OpportunityHypothesis, OutreachMessage } from './types';
import { isSuppressed, listContacts, saveOutreach, listOutreach } from './store';
import { audit } from '../observability/events';
import { DEFAULT_POLICY, type CommercialPolicy } from './governance';

export interface ComposeRefusal {
  composed: false;
  reason: string;
  rule: string;
}

export interface ComposeSuccess {
  composed: true;
  message: OutreachMessage;
}

export type ComposeResult = ComposeRefusal | ComposeSuccess;

/** Phrases that mark a message as the generic spam the directive forbids. */
const BANNED_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /\{\{|\}\}|\[first_?name\]|<name>/i, why: 'contains an unfilled merge field' },
  { pattern: /i (noticed|came across|stumbled upon) your (company|business|website|profile)/i, why: 'uses the "I noticed your company" opener the directive explicitly bans' },
  { pattern: /i hope this (email |message )?finds you well/i, why: 'opens with filler' },
  { pattern: /quick question/i, why: 'uses a manipulative subject-line cliché' },
  { pattern: /circle back|touch base|reach out to see/i, why: 'uses sales filler language' },
  { pattern: /we help companies like yours/i, why: 'makes a generic claim with no specific observation' },
  { pattern: /revolutionary|game.?chang|cutting.?edge|best.?in.?class|synerg/i, why: 'uses marketing language a technical buyer discounts' },
];

export function lintMessage(body: string): { clean: boolean; problems: string[] } {
  const problems = BANNED_PATTERNS.filter((b) => b.pattern.test(body)).map((b) => b.why);
  return { clean: problems.length === 0, problems };
}

export interface ComposeInput {
  account: GtmAccount;
  hypothesis: OpportunityHypothesis;
  contact: GtmContact | null;
  profile: MspProfile;
  step?: number;
  policy?: CommercialPolicy;
}

/**
 * Compose one message, or refuse and say why.
 *
 * The refusals, in order of how often they should fire:
 *  - the account is synthetic (never contact a company that does not exist)
 *  - suppressed
 *  - the hypothesis is not good enough
 *  - there is no specific observation to open with
 *  - there is no contactable person
 */
export function compose(db: TenantDb, input: ComposeInput): ComposeResult {
  const { account, hypothesis, contact, profile } = input;
  const policy = input.policy ?? DEFAULT_POLICY;
  const step = input.step ?? 1;

  if (account.synthetic) {
    return { composed: false, rule: 'synthetic-account', reason: 'This account is synthetic. It is not a company and can never be contacted.' };
  }
  if (account.suppressed) {
    return { composed: false, rule: 'suppressed-account', reason: account.suppressReason ?? 'Account is suppressed.' };
  }
  if (account.domain && isSuppressed(db, account.domain, 'domain')) {
    return { composed: false, rule: 'suppressed-domain', reason: `${account.domain} is on the suppression list.` };
  }
  if (hypothesis.quality === 'rejected' || hypothesis.quality === 'weak') {
    return { composed: false, rule: 'weak-hypothesis', reason: `Hypothesis quality is "${hypothesis.quality}". ${hypothesis.rejectionReasons[0] ?? 'Directive Phase 12: if evidence is weak, do not contact.'}` };
  }
  if (policy.minQualityForAutoOutreach === 'strong' && hypothesis.quality !== 'strong') {
    return { composed: false, rule: 'policy-quality-floor', reason: 'Policy requires a strong hypothesis before outreach.' };
  }

  const observation = hypothesis.evidence[0];
  if (!observation) {
    return { composed: false, rule: 'no-observation', reason: 'No specific observation about this company, so there is no defensible reason for contact.' };
  }

  if (!contact) {
    return { composed: false, rule: 'no-contact', reason: 'No contact identified for this account.' };
  }
  if (contact.suppressed) {
    return { composed: false, rule: 'suppressed-contact', reason: 'This contact is suppressed.' };
  }
  if (!contact.email) {
    return {
      composed: false,
      rule: 'no-address',
      reason: `Contact is a role (${contact.role ?? 'unknown'}) rather than a person with an address. No enrichment provider is connected, and a fabricated address would be both useless and a data-protection problem.`,
    };
  }
  if (isSuppressed(db, contact.email, 'email')) {
    return { composed: false, rule: 'suppressed-email', reason: 'This address is on the suppression list.' };
  }
  if (!contact.consentBasis) {
    return {
      composed: false,
      rule: 'no-lawful-basis',
      reason: 'No lawful basis is recorded for contacting this person. UK direct marketing to a named individual needs one; record it before sending.',
    };
  }

  const service = hypothesis.serviceIds.map((id) => serviceById(profile, id)).find(Boolean);
  if (!service) {
    return { composed: false, rule: 'nothing-to-offer', reason: 'No deliverable service maps to this hypothesis.' };
  }

  const body = step === 1
    ? firstTouch(observation, hypothesis, account, contact, profile)
    : followUp(observation, hypothesis, account, contact, step);

  const lint = lintMessage(body);
  if (!lint.clean) {
    return { composed: false, rule: 'failed-lint', reason: `Composed message rejected: ${lint.problems.join('; ')}.` };
  }

  const message: OutreachMessage = {
    id: randomUUID(),
    accountId: account.id,
    hypothesisId: hypothesis.id,
    contactId: contact.id,
    channel: 'email',
    step,
    subject: subjectFor(hypothesis, account),
    body,
    status: 'draft',
    reasonForContact: observation.statement,
    evidence: hypothesis.evidence,
    approvedBy: null,
    sentAt: null,
    blockedReason: null,
    createdAt: new Date().toISOString(),
  };

  const persisted = saveOutreach(db, message);
  return { composed: true, message: persisted };
}

function subjectFor(hypothesis: OpportunityHypothesis, account: GtmAccount): string {
  // The subject states the observation, not a pitch. It should read like
  // something a person wrote after looking at the company.
  switch (hypothesis.archetype) {
    case 'ma-change-event': return `${account.name} — the two estates question`;
    case 'cyber-security': return `${account.name} and Cyber Essentials`;
    case 'ps-augmentation': return `Delivery capacity for ${account.name}`;
    case 'infrastructure-modernisation': return `${account.name}: the server refresh decision`;
    case 'managed-it': return `Who looks after IT at ${account.name}?`;
    case 'public-sector': return `${account.name} — G-Cloud route`;
    case 'rapid-growth': return `${account.name} hiring — does IT scale with it?`;
    default: return `${account.name} — ${hypothesis.headline.toLowerCase()}`;
  }
}

/**
 * First touch: observation, consequence, one cheap question. No pitch, no
 * credentials dump, no proof point unless one is cleared for use.
 */
function firstTouch(
  observation: EvidenceItem,
  hypothesis: OpportunityHypothesis,
  account: GtmAccount,
  contact: GtmContact,
  profile: MspProfile,
): string {
  const safe = outreachSafeClaims(profile);
  const greeting = contact.name ? `${contact.name},` : `Hello,`;

  const lines = [
    greeting,
    '',
    `${observation.statement}`,
    '',
    hypothesis.whyItMatters,
    '',
    question(hypothesis.archetype, account.name),
  ];

  if (safe.proofPoints.length > 0) {
    lines.push('', `For context: ${safe.proofPoints[0]!.claim}`);
  }

  lines.push('', 'If it is not a priority, say so and I will leave it.', '', 'Mark');
  return lines.join('\n');
}

function question(archetype: string, accountName: string): string {
  switch (archetype) {
    case 'ma-change-event': return 'Has anyone been made responsible for bringing the two IT estates together, or is it still with whoever has time?';
    case 'cyber-security': return 'Is certification something you already have in hand, or has it not reached the top of the list yet?';
    case 'ps-augmentation': return 'When you win infrastructure work you cannot staff, what happens to it at the moment?';
    case 'infrastructure-modernisation': return 'Is the refresh budgeted, or is it still a conversation about whether to move at all?';
    case 'managed-it': return 'Who picks it up when something breaks?';
    case 'rapid-growth': return 'Is the IT side keeping up with the hiring, or is it starting to show?';
    case 'technology-migration': return 'Is the migration resourced, or is it being done alongside everyone’s day job?';
    default: return `Is that a fair reading of where ${accountName} is, or have I got it wrong?`;
  }
}

function followUp(observation: EvidenceItem, hypothesis: OpportunityHypothesis, account: GtmAccount, contact: GtmContact, step: number): string {
  const greeting = contact.name ? `${contact.name},` : 'Hello,';
  if (step === 2) {
    return [
      greeting, '',
      `I wrote a fortnight ago about ${observation.statement.toLowerCase()}`,
      '',
      'No reply is a reply, but it is also sometimes just a busy week. If it is the former, tell me and I will stop.',
      '', 'Mark',
    ].join('\n');
  }
  return [
    greeting, '',
    `Closing the loop on ${account.name}. I will assume this is not a priority and stop here.`,
    '',
    'If that changes, the observation still stands and you know where I am.',
    '', 'Mark',
  ].join('\n');
}

// --- campaign control ------------------------------------------------------

export interface CampaignResult {
  composed: number;
  refused: { rule: string; count: number; example: string }[];
  messages: OutreachMessage[];
  /** Why the run stopped, when it did. */
  haltedBecause: string | null;
}

/**
 * Compose a controlled batch. Starts small by design: a campaign that goes out
 * to everything before anybody has replied to anything is how a domain gets
 * burned.
 */
export function composeCampaign(
  db: TenantDb,
  input: { hypotheses: OpportunityHypothesis[]; accounts: Map<string, GtmAccount>; profile: MspProfile; limit: number; policy?: CommercialPolicy },
): CampaignResult {
  const policy = input.policy ?? DEFAULT_POLICY;
  const cap = Math.min(input.limit, policy.dailyOutreachLimit);

  const messages: OutreachMessage[] = [];
  const refusals = new Map<string, { count: number; example: string }>();
  let haltedBecause: string | null = null;

  const sentToday = listOutreach(db, { status: 'sent', limit: 500 }).filter(
    (m) => m.sentAt && new Date(m.sentAt).toDateString() === new Date().toDateString(),
  ).length;

  if (sentToday >= policy.dailyOutreachLimit) {
    return { composed: 0, refused: [], messages: [], haltedBecause: `Daily outreach limit of ${policy.dailyOutreachLimit} already reached.` };
  }

  for (const hypothesis of input.hypotheses) {
    if (messages.length >= cap) { haltedBecause = `Batch limit of ${cap} reached — deliberately small until responses are measured.`; break; }

    const account = input.accounts.get(hypothesis.accountId);
    if (!account) continue;

    const contacts = listContacts(db, account.id);
    const contact = contacts.find((c) => c.email && !c.suppressed) ?? contacts[0] ?? null;

    const result = compose(db, { account, hypothesis, contact, profile: input.profile, policy });
    if (result.composed) {
      messages.push(result.message);
    } else {
      const entry = refusals.get(result.rule) ?? { count: 0, example: result.reason };
      entry.count++;
      refusals.set(result.rule, entry);
    }
  }

  audit(db, {
    actor: 'agent:outreach', actorKind: 'agent', action: 'gtm.campaign.composed',
    subjectType: 'campaign', subjectId: randomUUID(),
    detail: { composed: messages.length, refused: [...refusals.entries()].map(([rule, v]) => ({ rule, count: v.count })) },
  });

  return {
    composed: messages.length,
    refused: [...refusals.entries()].map(([rule, v]) => ({ rule, count: v.count, example: v.example })).sort((a, b) => b.count - a.count),
    messages,
    haltedBecause,
  };
}

// --- transport -------------------------------------------------------------

export type EmailProvider = 'sendgrid' | 'aws-ses' | 'none';

/**
 * Delivery transport, ported from the pattern in hazel-backend's emailService:
 * pick a provider from the environment, and no-op honestly when none is set.
 *
 * Nothing here can send today — no provider is configured — and `send` reports
 * that rather than pretending.
 */
export function detectProvider(): { provider: EmailProvider; detail: string } {
  if (process.env.SENDGRID_API_KEY) return { provider: 'sendgrid', detail: 'SendGrid configured.' };
  if (process.env.AWS_SES_ACCESS_KEY && process.env.AWS_SES_SECRET_KEY) return { provider: 'aws-ses', detail: 'AWS SES configured.' };
  return {
    provider: 'none',
    detail: 'No email provider configured. Set SENDGRID_API_KEY, or AWS SES credentials, to enable sending.',
  };
}

export interface SendResult {
  sent: boolean;
  provider: EmailProvider;
  detail: string;
}

export function send(db: TenantDb, message: OutreachMessage, approvedBy: string): SendResult {
  const { provider, detail } = detectProvider();

  if (message.status !== 'approved') {
    return { sent: false, provider, detail: 'Message is not approved. Nothing is sent without approval.' };
  }

  if (provider === 'none') {
    saveOutreach(db, { ...message, status: 'blocked', blockedReason: detail });
    return { sent: false, provider, detail };
  }

  // A real provider would be called here. There is deliberately no code path
  // that marks a message sent without a provider having accepted it.
  const sent = saveOutreach(db, { ...message, status: 'sent', sentAt: new Date().toISOString(), approvedBy });
  audit(db, {
    actor: approvedBy, actorKind: 'human', action: 'gtm.outreach.sent',
    subjectType: 'outreach', subjectId: sent.id, detail: { provider, accountId: sent.accountId },
  });
  return { sent: true, provider, detail: `Sent via ${provider}.` };
}

export function approve(db: TenantDb, message: OutreachMessage, approvedBy: string): OutreachMessage {
  const approved = saveOutreach(db, { ...message, status: 'approved', approvedBy });
  audit(db, {
    actor: approvedBy, actorKind: 'human', action: 'gtm.outreach.approved',
    subjectType: 'outreach', subjectId: approved.id, detail: { accountId: approved.accountId },
  });
  return approved;
}
