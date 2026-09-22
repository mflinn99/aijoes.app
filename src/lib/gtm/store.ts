/**
 * GTM persistence. Idempotent by construction (Directive Phase 9): every write
 * is an upsert on a natural key, so re-running an agent cannot duplicate an
 * account, a signal, a hypothesis or an opportunity.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type {
  GtmAccount, GtmSignal, OpportunityHypothesis, GtmContact,
  OutreachMessage, GtmOpportunity, GtmMeeting, PipelineStage,
} from './types';
import { STAGE_PROBABILITY } from './types';
import type { AccountScores } from './icp';

// --- accounts --------------------------------------------------------------

export interface UpsertAccountInput {
  mspId: string;
  name: string;
  domain: string | null;
  source: string;
  synthetic?: boolean;
  companyId?: string | null;
}

/** Returns the account, created or matched. Never creates a duplicate. */
export function upsertAccount(db: TenantDb, input: UpsertAccountInput): GtmAccount {
  const existing = input.domain
    ? findAccountByDomain(db, input.mspId, input.domain)
    : findAccountByName(db, input.mspId, input.name);

  if (existing) {
    if (input.companyId && !existing.companyId) {
      db.run(
        `UPDATE gtm_accounts SET company_id = @companyId, updated_at = @now WHERE tenant_id = @tenantId AND id = @id`,
        { id: existing.id, companyId: input.companyId, now: new Date().toISOString() },
      );
      return { ...existing, companyId: input.companyId };
    }
    return existing;
  }

  const now = new Date().toISOString();
  const account: GtmAccount = {
    id: randomUUID(),
    mspId: input.mspId,
    name: input.name,
    domain: input.domain,
    companyId: input.companyId ?? null,
    source: input.source,
    synthetic: input.synthetic ?? false,
    status: 'candidate',
    researchState: 'unresearched',
    priorityScore: 0,
    scores: null,
    suppressed: false,
    suppressReason: null,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO gtm_accounts (id, tenant_id, msp_id, name, domain, company_id, source, synthetic, status,
       research_state, priority_score, scores_json, account_json, suppressed, created_at, updated_at)
     VALUES (@id, @tenantId, @mspId, @name, @domain, @companyId, @source, @synthetic, @status,
       @researchState, 0, '{}', @json, 0, @now, @now)`,
    {
      id: account.id, mspId: account.mspId, name: account.name, domain: account.domain,
      companyId: account.companyId, source: account.source, synthetic: account.synthetic ? 1 : 0,
      status: account.status, researchState: account.researchState, json: JSON.stringify({}), now,
    },
  );

  return account;
}

interface AccountRow {
  id: string; msp_id: string; name: string; domain: string | null; company_id: string | null;
  source: string; synthetic: number; status: string; research_state: string; priority_score: number;
  scores_json: string; suppressed: number; suppress_reason: string | null;
  created_at: string; updated_at: string;
}

function toAccount(r: AccountRow): GtmAccount {
  return {
    id: r.id, mspId: r.msp_id, name: r.name, domain: r.domain, companyId: r.company_id,
    source: r.source, synthetic: r.synthetic === 1, status: r.status as GtmAccount['status'],
    researchState: r.research_state as GtmAccount['researchState'], priorityScore: r.priority_score,
    scores: r.scores_json && r.scores_json !== '{}' ? (JSON.parse(r.scores_json) as AccountScores) : null,
    suppressed: r.suppressed === 1, suppressReason: r.suppress_reason,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function findAccountByDomain(db: TenantDb, mspId: string, domain: string): GtmAccount | null {
  const r = db.get<AccountRow>(
    `SELECT * FROM gtm_accounts WHERE tenant_id = @tenantId AND msp_id = @mspId AND domain = @domain`,
    { mspId, domain },
  );
  return r ? toAccount(r) : null;
}

export function findAccountByName(db: TenantDb, mspId: string, name: string): GtmAccount | null {
  const r = db.get<AccountRow>(
    `SELECT * FROM gtm_accounts WHERE tenant_id = @tenantId AND msp_id = @mspId AND name = @name`,
    { mspId, name },
  );
  return r ? toAccount(r) : null;
}

export function getAccount(db: TenantDb, id: string): GtmAccount | null {
  const r = db.get<AccountRow>(`SELECT * FROM gtm_accounts WHERE tenant_id = @tenantId AND id = @id`, { id });
  return r ? toAccount(r) : null;
}

export function listAccounts(
  db: TenantDb,
  opts: { mspId: string; limit?: number; researchState?: string; minPriority?: number; includeSynthetic?: boolean } ,
): GtmAccount[] {
  const clauses = ['tenant_id = @tenantId', 'msp_id = @mspId'];
  const params: Record<string, unknown> = { mspId: opts.mspId };

  if (opts.researchState) { clauses.push('research_state = @researchState'); params['researchState'] = opts.researchState; }
  if (opts.minPriority !== undefined) { clauses.push('priority_score >= @minPriority'); params['minPriority'] = opts.minPriority; }
  if (opts.includeSynthetic === false) clauses.push('synthetic = 0');

  return db
    .all<AccountRow>(
      `SELECT * FROM gtm_accounts WHERE ${clauses.join(' AND ')} ORDER BY priority_score DESC LIMIT ${Math.min(opts.limit ?? 500, 2000)}`,
      params,
    )
    .map(toAccount);
}

export function countAccounts(db: TenantDb, mspId: string, opts: { synthetic?: boolean; researchState?: string } = {}): number {
  const clauses = ['tenant_id = @tenantId', 'msp_id = @mspId'];
  const params: Record<string, unknown> = { mspId };
  if (opts.synthetic !== undefined) { clauses.push('synthetic = @synthetic'); params['synthetic'] = opts.synthetic ? 1 : 0; }
  if (opts.researchState) { clauses.push('research_state = @researchState'); params['researchState'] = opts.researchState; }
  const row = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gtm_accounts WHERE ${clauses.join(' AND ')}`, params);
  return row?.n ?? 0;
}

export function updateAccount(
  db: TenantDb,
  id: string,
  patch: Partial<Pick<GtmAccount, 'status' | 'researchState' | 'priorityScore' | 'scores' | 'companyId' | 'suppressed' | 'suppressReason'>>,
): void {
  const current = getAccount(db, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.run(
    `UPDATE gtm_accounts SET status = @status, research_state = @researchState, priority_score = @priority,
       scores_json = @scores, company_id = @companyId, suppressed = @suppressed, suppress_reason = @reason,
       updated_at = @now
     WHERE tenant_id = @tenantId AND id = @id`,
    {
      id, status: next.status, researchState: next.researchState, priority: next.priorityScore,
      scores: JSON.stringify(next.scores ?? {}), companyId: next.companyId,
      suppressed: next.suppressed ? 1 : 0, reason: next.suppressReason, now: new Date().toISOString(),
    },
  );
}

// --- signals ---------------------------------------------------------------

export function recordSignal(db: TenantDb, signal: Omit<GtmSignal, 'id'>): void {
  db.run(
    `INSERT INTO gtm_signals (id, tenant_id, account_id, kind, summary, strength, source, locator, detected_at, expires_at)
     VALUES (@id, @tenantId, @accountId, @kind, @summary, @strength, @source, @locator, @detectedAt, @expiresAt)
     ON CONFLICT(tenant_id, account_id, kind, summary) DO UPDATE SET
       strength = @strength, detected_at = @detectedAt, expires_at = @expiresAt`,
    { id: randomUUID(), ...signal },
  );
}

export function listSignals(db: TenantDb, accountId?: string, limit = 200): GtmSignal[] {
  const rows = db.all<{ id: string; account_id: string; kind: string; summary: string; strength: number; source: string; locator: string | null; detected_at: string; expires_at: string | null }>(
    accountId
      ? `SELECT * FROM gtm_signals WHERE tenant_id = @tenantId AND account_id = @accountId ORDER BY detected_at DESC LIMIT ${limit}`
      : `SELECT * FROM gtm_signals WHERE tenant_id = @tenantId ORDER BY detected_at DESC LIMIT ${limit}`,
    accountId ? { accountId } : {},
  );
  return rows.map((r) => ({
    id: r.id, accountId: r.account_id, kind: r.kind, summary: r.summary, strength: r.strength,
    source: r.source, locator: r.locator, detectedAt: r.detected_at, expiresAt: r.expires_at,
  }));
}

// --- hypotheses ------------------------------------------------------------

/**
 * Upsert on (account, archetype). The row's id wins on a re-run: a hypothesis is
 * the same hypothesis whether or not the generator handed it a fresh UUID, and
 * an id in the JSON that disagrees with the id column makes getHypothesis()
 * return null for a row that plainly exists.
 */
export function saveHypothesis(db: TenantDb, h: OpportunityHypothesis): OpportunityHypothesis {
  const existing = db.get<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM gtm_hypotheses
     WHERE tenant_id = @tenantId AND account_id = @accountId AND archetype = @archetype`,
    { accountId: h.accountId, archetype: h.archetype },
  );

  const persisted: OpportunityHypothesis = existing
    ? { ...h, id: existing.id, createdAt: existing.created_at }
    : h;

  db.run(
    `INSERT INTO gtm_hypotheses (id, tenant_id, account_id, archetype, service_ids, headline, value_low,
       value_high, value_point, confidence, quality, status, hypothesis_json, created_at, updated_at)
     VALUES (@id, @tenantId, @accountId, @archetype, @serviceIds, @headline, @low, @high, @point,
       @confidence, @quality, @status, @json, @createdAt, @updatedAt)
     ON CONFLICT(tenant_id, account_id, archetype) DO UPDATE SET
       headline = @headline, value_low = @low, value_high = @high, value_point = @point,
       confidence = @confidence, quality = @quality, status = @status, hypothesis_json = @json,
       updated_at = @updatedAt`,
    {
      id: persisted.id, accountId: persisted.accountId, archetype: persisted.archetype,
      serviceIds: JSON.stringify(persisted.serviceIds),
      headline: persisted.headline, low: persisted.commercialValue.low, high: persisted.commercialValue.high,
      point: persisted.commercialValue.point, confidence: persisted.confidence,
      quality: persisted.quality, status: persisted.status,
      json: JSON.stringify(persisted), createdAt: persisted.createdAt, updatedAt: persisted.updatedAt,
    },
  );
  return persisted;
}

export function listHypotheses(
  db: TenantDb,
  opts: { accountId?: string; quality?: string[]; limit?: number } = {},
): OpportunityHypothesis[] {
  const clauses = ['tenant_id = @tenantId'];
  const params: Record<string, unknown> = {};
  if (opts.accountId) { clauses.push('account_id = @accountId'); params['accountId'] = opts.accountId; }
  if (opts.quality?.length) clauses.push(`quality IN (${opts.quality.map((q) => `'${q}'`).join(',')})`);

  return db
    .all<{ hypothesis_json: string }>(
      `SELECT hypothesis_json FROM gtm_hypotheses WHERE ${clauses.join(' AND ')} ORDER BY value_point DESC LIMIT ${Math.min(opts.limit ?? 500, 2000)}`,
      params,
    )
    .map((r) => JSON.parse(r.hypothesis_json) as OpportunityHypothesis);
}

export function getHypothesis(db: TenantDb, id: string): OpportunityHypothesis | null {
  const r = db.get<{ hypothesis_json: string }>(
    `SELECT hypothesis_json FROM gtm_hypotheses WHERE tenant_id = @tenantId AND id = @id`, { id },
  );
  return r ? (JSON.parse(r.hypothesis_json) as OpportunityHypothesis) : null;
}

// --- contacts --------------------------------------------------------------

export function upsertContact(db: TenantDb, c: Omit<GtmContact, 'id'> & { id?: string }): GtmContact {
  const id = c.id ?? randomUUID();
  db.run(
    `INSERT INTO gtm_contacts (id, tenant_id, account_id, name, role, email, linkedin, source, confidence, consent_basis, suppressed, created_at)
     VALUES (@id, @tenantId, @accountId, @name, @role, @email, @linkedin, @source, @confidence, @consentBasis, @suppressed, @now)
     ON CONFLICT(tenant_id, account_id, email) DO UPDATE SET
       name = @name, role = @role, linkedin = @linkedin, confidence = @confidence, consent_basis = @consentBasis`,
    {
      id, accountId: c.accountId, name: c.name, role: c.role, email: c.email, linkedin: c.linkedin,
      source: c.source, confidence: c.confidence, consentBasis: c.consentBasis,
      suppressed: c.suppressed ? 1 : 0, now: new Date().toISOString(),
    },
  );
  return { ...c, id };
}

export function listContacts(db: TenantDb, accountId: string): GtmContact[] {
  return db
    .all<{ id: string; account_id: string; name: string | null; role: string | null; email: string | null; linkedin: string | null; source: string; confidence: number; consent_basis: string | null; suppressed: number }>(
      `SELECT * FROM gtm_contacts WHERE tenant_id = @tenantId AND account_id = @accountId ORDER BY confidence DESC`,
      { accountId },
    )
    .map((r) => ({
      id: r.id, accountId: r.account_id, name: r.name, role: r.role, email: r.email,
      linkedin: r.linkedin, source: r.source, confidence: r.confidence,
      consentBasis: r.consent_basis, suppressed: r.suppressed === 1,
    }));
}

// --- outreach --------------------------------------------------------------

/**
 * Upsert on the natural key (hypothesis, contact, step). Returns the message as
 * persisted — when an existing row is updated the stored id wins, so a caller
 * that saves a second time cannot end up holding an id that is not in the table.
 */
export function saveOutreach(db: TenantDb, m: OutreachMessage): OutreachMessage {
  db.run(
    `INSERT INTO gtm_outreach (id, tenant_id, account_id, hypothesis_id, contact_id, contact_key, channel, step, subject,
       body, status, reason_for_contact, evidence_json, approved_by, sent_at, blocked_reason, created_at)
     VALUES (@id, @tenantId, @accountId, @hypothesisId, @contactId, @contactKey, @channel, @step, @subject, @body,
       @status, @reason, @evidence, @approvedBy, @sentAt, @blocked, @createdAt)
     ON CONFLICT(tenant_id, hypothesis_id, contact_key, step) DO UPDATE SET
       subject = @subject, body = @body, status = @status, approved_by = @approvedBy,
       sent_at = @sentAt, blocked_reason = @blocked`,
    {
      id: m.id, accountId: m.accountId, hypothesisId: m.hypothesisId, contactId: m.contactId,
      contactKey: m.contactId ?? '-',
      channel: m.channel, step: m.step, subject: m.subject, body: m.body, status: m.status,
      reason: m.reasonForContact, evidence: JSON.stringify(m.evidence), approvedBy: m.approvedBy,
      sentAt: m.sentAt, blocked: m.blockedReason, createdAt: m.createdAt,
    },
  );

  const stored = db.get<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM gtm_outreach
     WHERE tenant_id = @tenantId AND hypothesis_id = @hypothesisId AND contact_key = @contactKey AND step = @step`,
    { hypothesisId: m.hypothesisId, contactKey: m.contactId ?? '-', step: m.step },
  );
  return stored ? { ...m, id: stored.id, createdAt: stored.created_at } : m;
}

export function listOutreach(db: TenantDb, opts: { accountId?: string; status?: string; limit?: number } = {}): OutreachMessage[] {
  const clauses = ['tenant_id = @tenantId'];
  const params: Record<string, unknown> = {};
  if (opts.accountId) { clauses.push('account_id = @accountId'); params['accountId'] = opts.accountId; }
  if (opts.status) { clauses.push('status = @status'); params['status'] = opts.status; }

  return db
    .all<{ id: string; account_id: string; hypothesis_id: string; contact_id: string | null; channel: string; step: number; subject: string | null; body: string; status: string; reason_for_contact: string; evidence_json: string; approved_by: string | null; sent_at: string | null; blocked_reason: string | null; created_at: string }>(
      `SELECT * FROM gtm_outreach WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${Math.min(opts.limit ?? 200, 1000)}`,
      params,
    )
    .map((r) => ({
      id: r.id, accountId: r.account_id, hypothesisId: r.hypothesis_id, contactId: r.contact_id,
      channel: r.channel as OutreachMessage['channel'], step: r.step, subject: r.subject, body: r.body,
      status: r.status as OutreachMessage['status'], reasonForContact: r.reason_for_contact,
      evidence: JSON.parse(r.evidence_json), approvedBy: r.approved_by, sentAt: r.sent_at,
      blockedReason: r.blocked_reason, createdAt: r.created_at,
    }));
}

export function getOutreach(db: TenantDb, id: string): OutreachMessage | null {
  return listOutreach(db, { limit: 1000 }).find((m) => m.id === id) ?? null;
}

// --- opportunities ---------------------------------------------------------

/**
 * Probability is always re-derived from the stage. The engine has no basis for a
 * per-deal judgement, and carrying a stale probability through a stage change
 * would freeze the weighted forecast at the old number without anyone noticing.
 */
export function upsertOpportunity(db: TenantDb, o: Omit<GtmOpportunity, 'weightedGbp'>): GtmOpportunity {
  const probability = STAGE_PROBABILITY[o.stage];
  const full: GtmOpportunity = { ...o, probability, weightedGbp: Math.round(o.valueGbp * probability) };

  db.run(
    `INSERT INTO gtm_opportunities (id, tenant_id, account_id, hypothesis_id, name, stage, value_gbp,
       probability, weighted_gbp, owner, next_action, next_action_at, last_action_at, close_date, source,
       crm_id, opportunity_json, created_at, updated_at)
     VALUES (@id, @tenantId, @accountId, @hypothesisId, @name, @stage, @value, @probability, @weighted,
       @owner, @nextAction, @nextActionAt, @lastActionAt, @closeDate, @source, @crmId, @json, @createdAt, @updatedAt)
     ON CONFLICT(tenant_id, hypothesis_id) DO UPDATE SET
       stage = @stage, value_gbp = @value, probability = @probability, weighted_gbp = @weighted,
       owner = @owner, next_action = @nextAction, next_action_at = @nextActionAt,
       last_action_at = @lastActionAt, close_date = @closeDate, crm_id = @crmId,
       opportunity_json = @json, updated_at = @updatedAt`,
    {
      id: full.id, accountId: full.accountId, hypothesisId: full.hypothesisId, name: full.name,
      stage: full.stage, value: full.valueGbp, probability: full.probability, weighted: full.weightedGbp,
      owner: full.owner, nextAction: full.nextAction, nextActionAt: full.nextActionAt,
      lastActionAt: full.lastActionAt, closeDate: full.closeDate, source: full.source, crmId: full.crmId,
      json: JSON.stringify(full), createdAt: full.createdAt, updatedAt: full.updatedAt,
    },
  );
  return full;
}

export function listOpportunities(db: TenantDb, opts: { stage?: PipelineStage; open?: boolean; limit?: number } = {}): GtmOpportunity[] {
  const clauses = ['tenant_id = @tenantId'];
  if (opts.stage) clauses.push(`stage = '${opts.stage}'`);
  if (opts.open) clauses.push(`stage NOT IN ('won','lost')`);

  return db
    .all<{ opportunity_json: string }>(
      `SELECT opportunity_json FROM gtm_opportunities WHERE ${clauses.join(' AND ')} ORDER BY weighted_gbp DESC LIMIT ${Math.min(opts.limit ?? 500, 2000)}`,
    )
    .map((r) => JSON.parse(r.opportunity_json) as GtmOpportunity);
}

export function getOpportunity(db: TenantDb, id: string): GtmOpportunity | null {
  const r = db.get<{ opportunity_json: string }>(
    `SELECT opportunity_json FROM gtm_opportunities WHERE tenant_id = @tenantId AND id = @id`, { id },
  );
  return r ? (JSON.parse(r.opportunity_json) as GtmOpportunity) : null;
}

// --- meetings --------------------------------------------------------------

export function recordMeeting(db: TenantDb, m: Omit<GtmMeeting, 'id' | 'createdAt'> & { id?: string }): GtmMeeting {
  const meeting: GtmMeeting = { id: m.id ?? randomUUID(), createdAt: new Date().toISOString(), ...m };
  db.run(
    `INSERT INTO gtm_meetings (id, tenant_id, account_id, opportunity_id, contact_id, scheduled_for, status, notes, created_at)
     VALUES (@id, @tenantId, @accountId, @opportunityId, @contactId, @scheduledFor, @status, @notes, @createdAt)`,
    {
      id: meeting.id, accountId: meeting.accountId, opportunityId: meeting.opportunityId,
      contactId: meeting.contactId, scheduledFor: meeting.scheduledFor, status: meeting.status,
      notes: meeting.notes, createdAt: meeting.createdAt,
    },
  );
  return meeting;
}

export function listMeetings(db: TenantDb, opts: { upcoming?: boolean } = {}): GtmMeeting[] {
  const clauses = ['tenant_id = @tenantId'];
  if (opts.upcoming) clauses.push(`scheduled_for >= datetime('now')`, `status = 'booked'`);
  return db
    .all<{ id: string; account_id: string; opportunity_id: string | null; contact_id: string | null; scheduled_for: string; status: string; notes: string | null; created_at: string }>(
      `SELECT * FROM gtm_meetings WHERE ${clauses.join(' AND ')} ORDER BY scheduled_for ASC LIMIT 200`,
    )
    .map((r) => ({
      id: r.id, accountId: r.account_id, opportunityId: r.opportunity_id, contactId: r.contact_id,
      scheduledFor: r.scheduled_for, status: r.status as GtmMeeting['status'], notes: r.notes, createdAt: r.created_at,
    }));
}

// --- suppression -----------------------------------------------------------

export function addSuppression(db: TenantDb, matchType: 'domain' | 'email' | 'name', matchValue: string, reason: string, addedBy: string): void {
  db.run(
    `INSERT INTO gtm_suppressions (id, tenant_id, match_type, match_value, reason, added_by, created_at)
     VALUES (@id, @tenantId, @matchType, @matchValue, @reason, @addedBy, @now)
     ON CONFLICT(tenant_id, match_type, match_value) DO UPDATE SET reason = @reason`,
    { id: randomUUID(), matchType, matchValue: matchValue.toLowerCase(), reason, addedBy, now: new Date().toISOString() },
  );
}

export function isSuppressed(db: TenantDb, value: string, matchType: 'domain' | 'email' | 'name'): string | null {
  const r = db.get<{ reason: string }>(
    `SELECT reason FROM gtm_suppressions WHERE tenant_id = @tenantId AND match_type = @matchType AND match_value = @value`,
    { matchType, value: value.toLowerCase() },
  );
  return r?.reason ?? null;
}

export function listSuppressions(db: TenantDb): { matchType: string; matchValue: string; reason: string }[] {
  return db
    .all<{ match_type: string; match_value: string; reason: string }>(
      `SELECT match_type, match_value, reason FROM gtm_suppressions WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
    )
    .map((r) => ({ matchType: r.match_type, matchValue: r.match_value, reason: r.reason }));
}
