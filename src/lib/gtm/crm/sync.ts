/**
 * The closed loop (Phase 9).
 *
 * "Every meaningful action must be reflected there." Meaningful is defined
 * narrowly and on purpose: an account becoming a qualified target, a message
 * actually sent, an opportunity moving stage, a meeting booked, and a task the
 * engine is handing to a person. Research churn and rejected hypotheses stay
 * out of the CRM — filling a salesperson's CRM with machine noise is how these
 * systems get switched off.
 *
 * Three guarantees:
 *   1. Idempotent. A local id maps to one external id per provider, and an
 *      unchanged payload is not re-sent at all.
 *   2. Durable. A retryable failure queues in the outbox and drains later, so a
 *      CRM outage never silently loses a pipeline update.
 *   3. Honest. When no CRM is configured the sync records the intent against the
 *      local system of record and says so; it never reports a write it did not make.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { TenantDb } from '../../db/tenant';
import { audit } from '../../observability/events';
import { getSecret } from '../../secrets/vault';
import type { GtmAccount, GtmContact, GtmMeeting, GtmOpportunity, OutreachMessage } from '../types';
import { getAccount, getOpportunity, getOutreach, listContacts, listOpportunities, listOutreach } from '../store';
import type { CrmAdapter, CrmEntityType, CrmWriteAction } from './types';
import { CrmError } from './types';
import { LocalCrmAdapter } from './local';
import { HubspotCrmAdapter, type HubspotCrmConfig } from './hubspot';

export const CRM_CREDENTIAL_REF = 'gtm.crm.hubspot';

export interface SyncOutcome {
  entityType: CrmEntityType;
  localId: string;
  provider: string;
  action: CrmWriteAction | 'queued' | 'failed';
  externalId: string | null;
  error?: string;
}

function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

// --- link table ------------------------------------------------------------

interface LinkRow { external_id: string; payload_hash: string }

export function getLink(db: TenantDb, provider: string, entityType: string, localId: string): { externalId: string; payloadHash: string } | null {
  const row = db.get<LinkRow>(
    `SELECT external_id, payload_hash FROM gtm_crm_links
     WHERE tenant_id = @tenantId AND provider = @provider AND entity_type = @entityType AND local_id = @localId`,
    { provider, entityType, localId },
  );
  return row ? { externalId: row.external_id, payloadHash: row.payload_hash } : null;
}

function putLink(db: TenantDb, provider: string, entityType: string, localId: string, externalId: string, hash: string): void {
  db.run(
    `INSERT INTO gtm_crm_links (id, tenant_id, provider, entity_type, local_id, external_id, payload_hash, synced_at)
     VALUES (@id, @tenantId, @provider, @entityType, @localId, @externalId, @hash, @now)
     ON CONFLICT (tenant_id, provider, entity_type, local_id)
     DO UPDATE SET external_id = @externalId, payload_hash = @hash, synced_at = @now`,
    { id: randomUUID(), provider, entityType, localId, externalId, hash, now: new Date().toISOString() },
  );
}

// --- outbox ----------------------------------------------------------------

const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];

function enqueue(db: TenantDb, provider: string, entityType: string, localId: string, operation: string, payload: unknown, error: string): void {
  const now = new Date();
  const existing = db.get<{ id: string; attempts: number }>(
    `SELECT id, attempts FROM gtm_crm_outbox
     WHERE tenant_id = @tenantId AND provider = @provider AND entity_type = @entityType
       AND local_id = @localId AND operation = @operation`,
    { provider, entityType, localId, operation },
  );

  if (existing) {
    const attempts = existing.attempts + 1;
    const backoff = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 3_600_000;
    db.run(
      `UPDATE gtm_crm_outbox SET attempts = @attempts, last_error = @error, status = 'pending',
         payload_json = @payload, next_attempt_at = @next
       WHERE tenant_id = @tenantId AND id = @id`,
      { id: existing.id, attempts, error, payload: JSON.stringify(payload), next: new Date(now.getTime() + backoff).toISOString() },
    );
    return;
  }

  db.run(
    `INSERT INTO gtm_crm_outbox (id, tenant_id, provider, entity_type, local_id, operation, payload_json,
       status, attempts, last_error, next_attempt_at, created_at)
     VALUES (@id, @tenantId, @provider, @entityType, @localId, @operation, @payload,
       'pending', 1, @error, @next, @now)`,
    {
      id: randomUUID(), provider, entityType, localId, operation,
      payload: JSON.stringify(payload), error,
      next: new Date(now.getTime() + (BACKOFF_MS[0] ?? 60_000)).toISOString(),
      now: now.toISOString(),
    },
  );
}

function clearOutbox(db: TenantDb, provider: string, entityType: string, localId: string, operation: string): void {
  db.run(
    `UPDATE gtm_crm_outbox SET status = 'done', completed_at = @now, last_error = NULL
     WHERE tenant_id = @tenantId AND provider = @provider AND entity_type = @entityType
       AND local_id = @localId AND operation = @operation AND status = 'pending'`,
    { provider, entityType, localId, operation, now: new Date().toISOString() },
  );
}

export interface OutboxEntry {
  id: string;
  provider: string;
  entityType: string;
  localId: string;
  operation: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
}

export function pendingOutbox(db: TenantDb, limit = 100): OutboxEntry[] {
  return db
    .all<{ id: string; provider: string; entity_type: string; local_id: string; operation: string; attempts: number; last_error: string | null; next_attempt_at: string }>(
      `SELECT id, provider, entity_type, local_id, operation, attempts, last_error, next_attempt_at
       FROM gtm_crm_outbox WHERE tenant_id = @tenantId AND status = 'pending'
       ORDER BY next_attempt_at ASC LIMIT @limit`,
      { limit },
    )
    .map((r) => ({
      id: r.id, provider: r.provider, entityType: r.entity_type, localId: r.local_id,
      operation: r.operation, attempts: r.attempts, lastError: r.last_error, nextAttemptAt: r.next_attempt_at,
    }));
}

// --- adapter selection -----------------------------------------------------

export interface CrmTargets {
  /** Always present. The engine's own record — never optional. */
  local: LocalCrmAdapter;
  /** The customer's CRM, when one is connected. */
  external: CrmAdapter | null;
}

export function crmTargets(db: TenantDb, transportOverride?: ConstructorParameters<typeof HubspotCrmAdapter>[1]): CrmTargets {
  const local = new LocalCrmAdapter(db);
  let external: CrmAdapter | null = null;
  try {
    const config = getSecret<HubspotCrmConfig>(db, CRM_CREDENTIAL_REF);
    if (config?.accessToken) external = new HubspotCrmAdapter(config, transportOverride);
  } catch {
    // Vault unconfigured or undecryptable: no external CRM. Local still works.
    external = null;
  }
  return { local, external };
}

// --- the write path --------------------------------------------------------

type Op = 'company' | 'contact' | 'deal' | 'activity' | 'task';

async function writeOne(
  db: TenantDb,
  adapter: CrmAdapter,
  entityType: Op,
  localId: string,
  payload: unknown,
  invoke: (externalId: string | null, companyExternalId: string | null) => Promise<{ externalId: string; action: CrmWriteAction }>,
  companyLocalId: string | null,
): Promise<SyncOutcome> {
  const hash = payloadHash(payload);
  const link = getLink(db, adapter.provider, entityType, localId);

  if (link && link.payloadHash === hash) {
    return { entityType, localId, provider: adapter.provider, action: 'unchanged', externalId: link.externalId };
  }

  const companyExternalId = companyLocalId
    ? getLink(db, adapter.provider, 'company', companyLocalId)?.externalId ?? null
    : null;

  try {
    const result = await invoke(link?.externalId ?? null, companyExternalId);
    putLink(db, adapter.provider, entityType, localId, result.externalId, hash);
    clearOutbox(db, adapter.provider, entityType, localId, entityType);
    return { entityType, localId, provider: adapter.provider, action: result.action, externalId: result.externalId };
  } catch (err) {
    const error = err instanceof CrmError ? err : new CrmError((err as Error).message, true);
    if (error.retryable) {
      enqueue(db, adapter.provider, entityType, localId, entityType, payload, error.message);
      return { entityType, localId, provider: adapter.provider, action: 'queued', externalId: null, error: error.message };
    }
    audit(db, {
      actor: 'agent:crm', actorKind: 'agent', action: 'gtm.crm.rejected',
      subjectType: entityType, subjectId: localId,
      detail: { provider: adapter.provider, error: error.message },
    });
    return { entityType, localId, provider: adapter.provider, action: 'failed', externalId: null, error: error.message };
  }
}

/** Fan a write out to the local record and, when connected, the customer's CRM. */
async function writeAll(
  db: TenantDb,
  targets: CrmTargets,
  entityType: Op,
  localId: string,
  payload: unknown,
  invoke: (a: CrmAdapter, externalId: string | null, companyExternalId: string | null) => Promise<{ externalId: string; action: CrmWriteAction }>,
  companyLocalId: string | null,
): Promise<SyncOutcome[]> {
  const out: SyncOutcome[] = [];
  out.push(await writeOne(db, targets.local, entityType, localId, payload, (e, c) => invoke(targets.local, e, c), companyLocalId));
  if (targets.external) {
    out.push(await writeOne(db, targets.external, entityType, localId, payload, (e, c) => invoke(targets.external as CrmAdapter, e, c), companyLocalId));
  }
  return out;
}

// --- the meaningful actions ------------------------------------------------

/**
 * An account enters the CRM when it stops being a research candidate. A
 * candidate the engine is still thinking about is not a commercial record.
 */
export async function syncAccount(db: TenantDb, targets: CrmTargets, account: GtmAccount): Promise<SyncOutcome[]> {
  if (account.synthetic) return [];
  if (account.status === 'candidate' || account.status === 'rejected') return [];

  const payload = {
    localId: account.id,
    name: account.name,
    domain: account.domain,
    properties: {
      aigogo_priority_score: Math.round(account.priorityScore),
      aigogo_status: account.status,
      // The archetype, not the first scoring component — which is always 'Size fit'.
      aigogo_archetype: account.scores?.primary?.name ?? null,
    } as Record<string, string | number | null>,
  };

  return writeAll(db, targets, 'company', account.id, payload, (a, e) => a.upsertCompany(payload, e), null);
}

export async function syncContact(db: TenantDb, targets: CrmTargets, contact: GtmContact, account: GtmAccount): Promise<SyncOutcome[]> {
  if (account.synthetic) return [];
  // A contact with no email and no LinkedIn is a role we inferred, not a person.
  if (!contact.email && !contact.linkedin) return [];

  const payload = {
    localId: contact.id,
    companyLocalId: account.id,
    name: contact.name,
    email: contact.email,
    role: contact.role,
    linkedin: contact.linkedin,
  };
  return writeAll(db, targets, 'contact', contact.id, payload, (a, e, c) => a.upsertContact(payload, e, c), account.id);
}

export async function syncOpportunity(db: TenantDb, targets: CrmTargets, opp: GtmOpportunity): Promise<SyncOutcome[]> {
  const account = getAccount(db, opp.accountId);
  if (!account || account.synthetic) return [];

  const payload = {
    localId: opp.id,
    companyLocalId: opp.accountId,
    name: opp.name,
    stage: opp.stage,
    valueGbp: opp.valueGbp,
    probability: opp.probability,
    closeDate: opp.closeDate,
    owner: opp.owner,
    nextAction: opp.nextAction,
    nextActionAt: opp.nextActionAt,
  };
  const outcomes = await writeAll(db, targets, 'deal', opp.id, payload, (a, e, c) => a.upsertDeal(payload, e, c), opp.accountId);

  const external = outcomes.find((o) => o.provider !== 'local' && o.externalId);
  const chosen = external ?? outcomes[0];
  if (chosen?.externalId && chosen.externalId !== opp.crmId) {
    db.run(
      `UPDATE gtm_opportunities SET crm_id = @crmId, updated_at = @now WHERE tenant_id = @tenantId AND id = @id`,
      { id: opp.id, crmId: chosen.externalId, now: new Date().toISOString() },
    );
  }
  return outcomes;
}

/** Only messages that actually went out. A draft is not an activity. */
export async function syncOutreach(db: TenantDb, targets: CrmTargets, message: OutreachMessage): Promise<SyncOutcome[]> {
  if (message.status !== 'sent') return [];
  const account = getAccount(db, message.accountId);
  if (!account || account.synthetic) return [];

  const payload = {
    localId: message.id,
    companyLocalId: message.accountId,
    contactLocalId: message.contactId,
    dealLocalId: null,
    kind: message.channel === 'call' ? ('call' as const) : ('email' as const),
    subject: message.subject ?? `Outreach step ${message.step}`,
    body: `${message.body}\n\n---\nReason for contact: ${message.reasonForContact}\nEvidence: ${message.evidence.map((e) => e.statement).join('; ')}`,
    occurredAt: message.sentAt ?? message.createdAt,
  };
  return writeAll(db, targets, 'activity', message.id, payload, (a, e, c) => a.logActivity(payload, e, c), message.accountId);
}

export async function syncMeeting(db: TenantDb, targets: CrmTargets, meeting: GtmMeeting): Promise<SyncOutcome[]> {
  const account = getAccount(db, meeting.accountId);
  if (!account || account.synthetic) return [];

  const payload = {
    localId: meeting.id,
    companyLocalId: meeting.accountId,
    contactLocalId: meeting.contactId,
    dealLocalId: meeting.opportunityId,
    kind: 'meeting' as const,
    subject: `Meeting with ${account.name}`,
    body: meeting.notes ?? '',
    occurredAt: meeting.scheduledFor,
  };
  return writeAll(db, targets, 'activity', meeting.id, payload, (a, e, c) => a.logActivity(payload, e, c), meeting.accountId);
}

/** A task is how the engine hands work to a person it cannot do itself. */
export async function syncTask(
  db: TenantDb,
  targets: CrmTargets,
  input: { localId: string; accountId: string; opportunityId: string | null; subject: string; body: string; dueAt: string; assignee: string | null },
): Promise<SyncOutcome[]> {
  const account = getAccount(db, input.accountId);
  if (!account || account.synthetic) return [];

  const payload = {
    localId: input.localId,
    companyLocalId: input.accountId,
    dealLocalId: input.opportunityId,
    subject: input.subject,
    body: input.body,
    dueAt: input.dueAt,
    assignee: input.assignee,
  };
  return writeAll(db, targets, 'task', input.localId, payload, (a, e, c) => a.createTask(payload, e, c), input.accountId);
}

// --- reconciliation --------------------------------------------------------

export interface ReconcileReport {
  accounts: number;
  contacts: number;
  opportunities: number;
  activities: number;
  created: number;
  updated: number;
  unchanged: number;
  queued: number;
  failed: number;
  externalProvider: string | null;
  notes: string[];
}

function tally(report: ReconcileReport, outcomes: SyncOutcome[]): void {
  for (const o of outcomes) {
    if (o.action === 'created') report.created++;
    else if (o.action === 'updated') report.updated++;
    else if (o.action === 'unchanged') report.unchanged++;
    else if (o.action === 'queued') report.queued++;
    else report.failed++;
  }
}

/**
 * Bring the CRM up to date with everything meaningful. Safe to run repeatedly —
 * the second run should report only 'unchanged', which is the test that proves
 * idempotency rather than a comment claiming it.
 */
export async function reconcile(db: TenantDb, targets: CrmTargets): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    accounts: 0, contacts: 0, opportunities: 0, activities: 0,
    created: 0, updated: 0, unchanged: 0, queued: 0, failed: 0,
    externalProvider: targets.external?.provider ?? null,
    notes: [],
  };

  if (!targets.external) {
    report.notes.push('No external CRM is connected. Writes are recorded against the local system of record only.');
  }

  const accounts = db.all<{ id: string }>(
    `SELECT id FROM gtm_accounts WHERE tenant_id = @tenantId AND synthetic = 0
       AND status NOT IN ('candidate','rejected')`,
    {},
  );
  for (const row of accounts) {
    const account = getAccount(db, row.id);
    if (!account) continue;
    tally(report, await syncAccount(db, targets, account));
    report.accounts++;
    for (const contact of listContacts(db, account.id)) {
      const outcomes = await syncContact(db, targets, contact, account);
      if (outcomes.length) report.contacts++;
      tally(report, outcomes);
    }
  }

  for (const opp of listOpportunities(db, { limit: 1000 })) {
    const outcomes = await syncOpportunity(db, targets, opp);
    if (outcomes.length) report.opportunities++;
    tally(report, outcomes);
  }

  for (const message of listOutreach(db, { status: 'sent', limit: 1000 })) {
    const outcomes = await syncOutreach(db, targets, message);
    if (outcomes.length) report.activities++;
    tally(report, outcomes);
  }

  audit(db, {
    actor: 'agent:crm', actorKind: 'agent', action: 'gtm.crm.reconciled',
    subjectType: 'crm', subjectId: targets.external?.provider ?? 'local',
    detail: { ...report },
  });

  return report;
}

/** Drain queued writes whose backoff has elapsed. Called by the pipeline autopilot. */
export async function drainOutbox(db: TenantDb, targets: CrmTargets, now = new Date()): Promise<{ drained: number; stillQueued: number }> {
  const due = db.all<{ id: string; entity_type: string; local_id: string }>(
    `SELECT id, entity_type, local_id FROM gtm_crm_outbox
     WHERE tenant_id = @tenantId AND status = 'pending' AND next_attempt_at <= @now LIMIT 50`,
    { now: now.toISOString() },
  );

  let drained = 0;
  for (const row of due) {
    // Re-derive the payload from live state rather than replaying a stale one:
    // the CRM should end up matching what is true now, not what was true then.
    if (row.entity_type === 'company') {
      const account = getAccount(db, row.local_id);
      if (account) { await syncAccount(db, targets, account); drained++; }
    } else if (row.entity_type === 'deal') {
      const opp = getOpportunity(db, row.local_id);
      if (opp) { await syncOpportunity(db, targets, opp); drained++; }
    } else if (row.entity_type === 'activity') {
      const msg = getOutreach(db, row.local_id);
      if (msg) { await syncOutreach(db, targets, msg); drained++; }
    }
  }

  const stillQueued = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM gtm_crm_outbox WHERE tenant_id = @tenantId AND status = 'pending'`, {},
  )?.n ?? 0;

  return { drained, stillQueued };
}
