/**
 * The ten GTM agents — Directive Phase 6.
 *
 * Logical roles over the existing orchestration, not ten applications. Each is a
 * function with a declared input and output that records what it did and why, so
 * a hand-off is inspectable rather than implied.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type { MspProfile } from './profile';
import { sellableServices, serviceById } from './profile';
import { buildIcpContext, scoreAccount, ARCHETYPES } from './icp';
import { generateHypotheses, workable } from './hypothesis';
import { getTwin } from '../db/repositories/company';
import { understandingScore } from '../core/company-twin';
import { valueOf } from '../core/provenance';
import type { Signal } from '../core/company-twin';
import { audit, recordEvent } from '../observability/events';
import {
  upsertAccount, listAccounts, getAccount, updateAccount, recordSignal, listSignals,
  saveHypothesis, listHypotheses, listContacts, upsertContact, isSuppressed,
  listOpportunities, upsertOpportunity, getHypothesis, countAccounts,
} from './store';
import type { GtmAccount, OpportunityHypothesis, PipelineStage } from './types';
import { STAGE_PROBABILITY } from './types';
import { sourceById, type DiscoveredAccount } from './sources';

export interface AgentRun {
  agent: string;
  startedAt: string;
  completedAt: string;
  processed: number;
  produced: number;
  skipped: number;
  notes: string[];
}

function run(agent: string): { finish: (r: Omit<AgentRun, 'agent' | 'startedAt' | 'completedAt'>) => AgentRun } {
  const startedAt = new Date().toISOString();
  return {
    finish: (r) => ({ agent, startedAt, completedAt: new Date().toISOString(), ...r }),
  };
}

// --- 1. MARKET AGENT -------------------------------------------------------

/** Builds and replenishes the target universe. */
export async function marketAgent(
  db: TenantDb,
  opts: { mspId: string; sourceId: string; limit: number; payload?: string },
): Promise<AgentRun & { discovered: DiscoveredAccount[] }> {
  const r = run('market');
  const source = sourceById(opts.sourceId);
  const notes: string[] = [];

  if (!source) {
    return { ...r.finish({ processed: 0, produced: 0, skipped: 0, notes: [`No source "${opts.sourceId}".`] }), discovered: [] };
  }

  const availability = await source.availability();
  if (!availability.available) {
    notes.push(`${source.name} unavailable: ${availability.detail}${availability.requirement ? ` Requires: ${availability.requirement}` : ''}`);
    return { ...r.finish({ processed: 0, produced: 0, skipped: 0, notes }), discovered: [] };
  }

  const discovered = await source.discover({ limit: opts.limit, ...(opts.payload !== undefined ? { payload: opts.payload } : {}) });
  let produced = 0;
  let skipped = 0;

  for (const d of discovered) {
    // Suppression is checked at intake, so a do-not-contact company never even
    // enters the universe.
    const suppression = d.domain ? isSuppressed(db, d.domain, 'domain') : isSuppressed(db, d.name, 'name');
    const account = upsertAccount(db, {
      mspId: opts.mspId, name: d.name, domain: d.domain, source: d.source, synthetic: d.synthetic,
    });

    if (suppression) {
      updateAccount(db, account.id, { suppressed: true, suppressReason: suppression, status: 'rejected' });
      skipped++;
      continue;
    }
    produced++;
  }

  notes.push(`${source.name}: ${discovered.length} discovered, ${produced} in universe, ${skipped} suppressed at intake.`);

  audit(db, {
    actor: 'agent:market', actorKind: 'agent', action: 'gtm.universe.expanded',
    subjectType: 'msp', subjectId: opts.mspId,
    detail: { source: opts.sourceId, discovered: discovered.length, produced, skipped },
  });

  return { ...r.finish({ processed: discovered.length, produced, skipped, notes }), discovered };
}

// --- 2. SIGNAL AGENT -------------------------------------------------------

/** Detects reasons-to-contact from what research has already found. */
export function signalAgent(db: TenantDb, opts: { mspId: string; limit?: number }): AgentRun {
  const r = run('signal');
  const accounts = listAccounts(db, { mspId: opts.mspId, researchState: 'researched', limit: opts.limit ?? 500 });
  let produced = 0;
  const notes: string[] = [];

  for (const account of accounts) {
    if (!account.companyId) continue;
    const twin = getTwin(db, account.companyId);
    if (!twin) continue;

    const groups: { field: keyof typeof twin; kind: string; strength: number }[] = [
      { field: 'recruitmentSignals', kind: 'hiring', strength: 0.5 },
      { field: 'strategicSignals', kind: 'strategic', strength: 0.8 },
      { field: 'externalEvents', kind: 'external-event', strength: 0.9 },
      { field: 'operationalSignals', kind: 'operational', strength: 0.6 },
      { field: 'cyberIndicators', kind: 'cyber', strength: 0.7 },
      { field: 'financialSignals', kind: 'financial', strength: 0.7 },
    ];

    for (const g of groups) {
      const signals = (valueOf(twin[g.field] as never) as Signal[] | null) ?? [];
      for (const s of signals) {
        recordSignal(db, {
          accountId: account.id, kind: g.kind, summary: s.summary, strength: g.strength,
          source: s.sourceLabel, locator: s.locator ?? null, detectedAt: s.detectedAt, expiresAt: null,
        });
        produced++;
      }
    }
  }

  notes.push(`${produced} signal(s) across ${accounts.length} researched account(s).`);
  return r.finish({ processed: accounts.length, produced, skipped: 0, notes });
}

// --- 3. ACCOUNT INTELLIGENCE AGENT -----------------------------------------

/**
 * Develops account understanding, then scores it. Research itself is the
 * existing analysis pipeline — this agent decides who is worth researching and
 * turns the result into the seven scores.
 */
export function accountIntelligenceAgent(
  db: TenantDb,
  opts: { mspId: string; profile: MspProfile; limit?: number },
): AgentRun {
  const r = run('account-intelligence');
  const accounts = listAccounts(db, { mspId: opts.mspId, limit: opts.limit ?? 1000 });
  let produced = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const account of accounts) {
    if (!account.companyId) { skipped++; continue; }
    const twin = getTwin(db, account.companyId);
    if (!twin) { skipped++; continue; }

    const understanding = understandingScore(twin);
    const ctx = buildIcpContext(twin, opts.profile, understanding);
    const contacts = listContacts(db, account.id).filter((c) => !c.suppressed);
    const scores = scoreAccount(ctx, contacts.length);

    updateAccount(db, account.id, {
      scores,
      priorityScore: Math.round(scores.priority.value * 1000) / 10,
      researchState: 'researched',
      status: scores.priority.value >= 0.5 ? 'qualified-target' : account.status,
    });
    produced++;
  }

  notes.push(`${produced} account(s) scored, ${skipped} skipped for want of research.`);
  return r.finish({ processed: accounts.length, produced, skipped, notes });
}

// --- 4. OPPORTUNITY AGENT --------------------------------------------------

/** Turns evidence into commercial hypotheses, and rejects the weak ones. */
export function opportunityAgent(
  db: TenantDb,
  opts: { mspId: string; profile: MspProfile; limit?: number },
): AgentRun & { strong: number; workable: number; rejected: number } {
  const r = run('opportunity');
  const accounts = listAccounts(db, { mspId: opts.mspId, researchState: 'researched', limit: opts.limit ?? 500 });
  let produced = 0;
  let strong = 0;
  let workableCount = 0;
  let rejected = 0;
  const notes: string[] = [];

  for (const account of accounts) {
    if (!account.companyId || !account.scores) continue;
    const twin = getTwin(db, account.companyId);
    if (!twin) continue;

    const understanding = understandingScore(twin);
    const ctx = buildIcpContext(twin, opts.profile, understanding);
    const hypotheses = generateHypotheses({ account, ctx, scores: account.scores, profile: opts.profile });

    for (const h of hypotheses) {
      saveHypothesis(db, h);
      produced++;
      if (h.quality === 'strong') strong++;
      else if (h.quality === 'workable') workableCount++;
      else rejected++;
    }
  }

  notes.push(`${produced} hypotheses: ${strong} strong, ${workableCount} workable, ${rejected} rejected.`);

  audit(db, {
    actor: 'agent:opportunity', actorKind: 'agent', action: 'gtm.hypotheses.generated',
    subjectType: 'msp', subjectId: opts.mspId,
    detail: { produced, strong, workable: workableCount, rejected },
  });

  return { ...r.finish({ processed: accounts.length, produced, skipped: rejected, notes }), strong, workable: workableCount, rejected };
}

// --- 5. SOLUTION AGENT -----------------------------------------------------

export interface SolutionMatch {
  hypothesisId: string;
  accountId: string;
  onwardServices: { id: string; name: string; deliverable: boolean; capacity: string }[];
  aigogoExtensions: string[];
  deliverable: boolean;
  caveats: string[];
}

/** Maps a hypothesis onto what Onward and AIGoGo can actually deliver. */
export function solutionAgent(db: TenantDb, opts: { profile: MspProfile; hypotheses?: OpportunityHypothesis[] }): AgentRun & { matches: SolutionMatch[] } {
  const r = run('solution');
  const hypotheses = opts.hypotheses ?? workable(listHypotheses(db, { quality: ['strong', 'workable'] }));
  const matches: SolutionMatch[] = [];
  const notes: string[] = [];

  for (const h of hypotheses) {
    const services = h.serviceIds.map((id) => serviceById(opts.profile, id)).filter((s) => Boolean(s));
    const caveats: string[] = [];

    for (const s of services) {
      if (!s) continue;
      if (s.deliveryCapacity === 'constrained') caveats.push(`${s.name} delivery is constrained — do not promote at volume.`);
      if (s.deliveryCapacity === 'partner-required') caveats.push(`${s.name} needs a delivery partner.`);
      if (s.provenance !== 'user-supplied') caveats.push(`${s.name} is described from public sources, not confirmed by Onward.`);
    }

    const extensions = [...new Set(services.flatMap((s) => s?.aigogoExtensions ?? []))];
    if (extensions.length > 0) {
      caveats.push('Every AIGoGo capability is currently simulated — extensions are roadmap, not deliverable.');
    }

    matches.push({
      hypothesisId: h.id,
      accountId: h.accountId,
      onwardServices: services.filter((s) => Boolean(s)).map((s) => ({
        id: s!.id, name: s!.name,
        deliverable: s!.deliveryCapacity === 'ready',
        capacity: s!.deliveryCapacity,
      })),
      aigogoExtensions: extensions,
      deliverable: services.some((s) => s?.deliveryCapacity === 'ready'),
      caveats: [...new Set(caveats)],
    });
  }

  notes.push(`${matches.filter((m) => m.deliverable).length} of ${matches.length} matched to a service Onward can deliver now.`);
  return { ...r.finish({ processed: hypotheses.length, produced: matches.length, skipped: 0, notes }), matches };
}

// --- 6. CONTACT AGENT ------------------------------------------------------

/**
 * Identifies the likely problem owner.
 *
 * With no enrichment provider connected it produces a *role* to look for, not a
 * person — and says so. Inventing a name and email would be the single most
 * damaging thing this system could do.
 */
export function contactAgent(db: TenantDb, opts: { mspId: string; limit?: number }): AgentRun & { rolesIdentified: number } {
  const r = run('contact');
  const hypotheses = listHypotheses(db, { quality: ['strong', 'workable'], limit: opts.limit ?? 200 });
  const notes: string[] = [];
  let rolesIdentified = 0;

  for (const h of hypotheses) {
    const archetype = ARCHETYPES.find((a) => a.id === h.archetype);
    if (!archetype) continue;

    const existing = listContacts(db, h.accountId);
    if (existing.length > 0) continue;

    // A role placeholder, explicitly not a person. No email, so no outreach can
    // be sent against it — which is the correct behaviour with no enrichment.
    for (const role of archetype.buyerRoles.slice(0, 2)) {
      upsertContact(db, {
        accountId: h.accountId, name: null, role, email: null, linkedin: null,
        source: 'archetype-inference', confidence: 0.4,
        consentBasis: null, suppressed: false,
      });
      rolesIdentified++;
    }
  }

  notes.push(
    `${rolesIdentified} likely-owner role(s) identified. No named contacts: no enrichment provider is connected, ` +
      `and a name invented by an agent is worse than no name.`,
  );
  return { ...r.finish({ processed: hypotheses.length, produced: rolesIdentified, skipped: 0, notes }), rolesIdentified };
}

// --- 9. GTM ANALYST --------------------------------------------------------

export interface FunnelMetrics {
  accounts: number;
  researched: number;
  hypotheses: { strong: number; workable: number; rejected: number };
  contacted: number;
  responded: number;
  meetings: number;
  qualified: number;
  pipelineGbp: number;
  weightedPipelineGbp: number;
  conversion: { researchToHypothesis: number; hypothesisToContact: number; contactToResponse: number; responseToMeeting: number };
  /** The stage most constraining the funnel. */
  constraint: string;
}

export function gtmAnalyst(db: TenantDb, opts: { mspId: string }): FunnelMetrics {
  const accounts = countAccounts(db, opts.mspId);
  const researched = countAccounts(db, opts.mspId, { researchState: 'researched' });
  const all = listHypotheses(db, { limit: 2000 });
  const strong = all.filter((h) => h.quality === 'strong').length;
  const workableCount = all.filter((h) => h.quality === 'workable').length;
  const rejected = all.filter((h) => h.quality === 'rejected').length;

  const opportunities = listOpportunities(db, { limit: 2000 });
  const contacted = opportunities.filter((o) => o.stage !== 'identified').length;
  const responded = opportunities.filter((o) => ['responded', 'meeting-booked', 'qualified', 'proposal', 'won'].includes(o.stage)).length;
  const meetings = opportunities.filter((o) => ['meeting-booked', 'qualified', 'proposal', 'won'].includes(o.stage)).length;
  const qualified = opportunities.filter((o) => ['qualified', 'proposal', 'won'].includes(o.stage)).length;

  const open = opportunities.filter((o) => o.stage !== 'lost');
  const pipelineGbp = open.reduce((s, o) => s + o.valueGbp, 0);
  const weightedPipelineGbp = open.reduce((s, o) => s + o.weightedGbp, 0);

  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : 0);
  const conversion = {
    researchToHypothesis: ratio(strong + workableCount, researched),
    hypothesisToContact: ratio(contacted, strong + workableCount),
    contactToResponse: ratio(responded, contacted),
    responseToMeeting: ratio(meetings, responded),
  };

  // The constraint is the first stage that starves the next one.
  let constraint = 'None — the funnel is proportionate at every stage.';
  if (researched === 0) constraint = 'Research: no account has been researched, so nothing downstream can exist.';
  else if (strong + workableCount === 0) constraint = 'Hypotheses: accounts are researched but none clears the evidence bar.';
  else if (contacted === 0) constraint = 'Contact: hypotheses exist but nothing has been contacted.';
  else if (conversion.contactToResponse < 0.05) constraint = 'Response rate: outreach is going out and nothing is coming back. Proposition or audience.';
  else if (conversion.responseToMeeting < 0.3) constraint = 'Meeting conversion: replies are not becoming meetings.';

  return {
    accounts, researched,
    hypotheses: { strong, workable: workableCount, rejected },
    contacted, responded, meetings, qualified,
    pipelineGbp: Math.round(pipelineGbp),
    weightedPipelineGbp: Math.round(weightedPipelineGbp),
    conversion, constraint,
  };
}

// --- helper used by pipeline and outreach ----------------------------------

export function openOpportunityFor(db: TenantDb, hypothesisId: string) {
  return listOpportunities(db, { limit: 2000 }).find((o) => o.hypothesisId === hypothesisId) ?? null;
}

export function createOpportunityFromHypothesis(
  db: TenantDb,
  hypothesis: OpportunityHypothesis,
  account: GtmAccount,
  stage: PipelineStage = 'identified',
) {
  const existing = openOpportunityFor(db, hypothesis.id);
  const now = new Date().toISOString();

  return upsertOpportunity(db, {
    id: existing?.id ?? randomUUID(),
    accountId: account.id,
    hypothesisId: hypothesis.id,
    name: `${account.name} — ${hypothesis.headline}`,
    stage,
    valueGbp: hypothesis.commercialValue.point,
    probability: STAGE_PROBABILITY[stage],
    owner: existing?.owner ?? null,
    nextAction: hypothesis.nextAction,
    nextActionAt: existing?.nextActionAt ?? null,
    lastActionAt: now,
    closeDate: existing?.closeDate ?? null,
    source: 'agentic-gtm',
    crmId: existing?.crmId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export { listSignals, getAccount, getHypothesis, sellableServices, recordEvent };
