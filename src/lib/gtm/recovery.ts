/**
 * Autonomous recovery — Directive 02 Phase 12.
 *
 * The rule the directive sets is that the engine should not stop and wait for a
 * human every time something goes wrong. Most failures in a GTM system are not
 * emergencies: a source is rate limited, a page moved, an API token expired, a
 * search returns nothing. Each of those has an obvious next thing to try.
 *
 * What is deliberately NOT recoverable: anything where continuing would mean
 * inventing data or contacting someone we should not. Those escalate rather
 * than retry, because "recover" would mean "guess".
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { audit } from '../observability/events';

export type FailureKind =
  | 'rate-limited'
  | 'auth-expired'
  | 'source-unavailable'
  | 'egress-blocked'
  | 'not-found'
  | 'parse-failed'
  | 'empty-result'
  | 'timeout'
  | 'quota-exhausted'
  | 'permission-denied'
  | 'data-conflict'
  | 'unknown';

export type RecoveryAction =
  | 'retry-with-backoff'
  | 'switch-source'
  | 'degrade-and-continue'
  | 'skip-record'
  | 'reduce-batch-size'
  | 'refresh-credential'
  | 'escalate'
  | 'halt';

export interface RecoveryRule {
  kind: FailureKind;
  action: RecoveryAction;
  /** How many times this failure may be recovered from before it escalates. */
  maxAttempts: number;
  /** Why this is the right response — so the behaviour can be argued with. */
  rationale: string;
  /** True when the run continues with less data rather than stopping. */
  continues: boolean;
}

export const RECOVERY_RULES: RecoveryRule[] = [
  {
    kind: 'rate-limited', action: 'retry-with-backoff', maxAttempts: 5, continues: true,
    rationale: 'A rate limit is the source asking for patience, not refusing. Back off and come back.',
  },
  {
    kind: 'timeout', action: 'retry-with-backoff', maxAttempts: 3, continues: true,
    rationale: 'A timeout is usually transient. Three attempts, then treat the record as unavailable rather than guessing at it.',
  },
  {
    kind: 'quota-exhausted', action: 'switch-source', maxAttempts: 1, continues: true,
    rationale: 'A spent quota will not refill within the run. Use another source for the same fact and record which one answered.',
  },
  {
    kind: 'source-unavailable', action: 'switch-source', maxAttempts: 2, continues: true,
    rationale: 'One source being down is not a reason to stop researching. Fall back and lower the confidence accordingly.',
  },
  {
    kind: 'egress-blocked', action: 'degrade-and-continue', maxAttempts: 1, continues: true,
    rationale: 'Network policy is not a transient fault, so retrying is pointless. Continue with what is reachable and state plainly which fields are therefore unknown.',
  },
  {
    kind: 'not-found', action: 'skip-record', maxAttempts: 1, continues: true,
    rationale: 'A company that cannot be found is a company we know nothing about. Skipping is correct; inventing a profile is not.',
  },
  {
    kind: 'parse-failed', action: 'skip-record', maxAttempts: 2, continues: true,
    rationale: 'A page we cannot parse yields no facts. One retry in case of a partial fetch, then move on rather than half-reading it.',
  },
  {
    kind: 'empty-result', action: 'degrade-and-continue', maxAttempts: 1, continues: true,
    rationale: 'An empty result is a finding — the absence of a signal — not an error to retry until something appears.',
  },
  {
    kind: 'auth-expired', action: 'refresh-credential', maxAttempts: 2, continues: true,
    rationale: 'Refresh once. If refreshing fails the credential needs a human, and the run continues without that connector.',
  },
  {
    kind: 'permission-denied', action: 'escalate', maxAttempts: 1, continues: true,
    rationale: 'A permission we do not have is not something to retry around. It needs granting, and grinding at it looks like an attack.',
  },
  {
    kind: 'data-conflict', action: 'escalate', maxAttempts: 1, continues: true,
    rationale: 'Two sources disagreeing is exactly the case where guessing is worst. Keep both claims and let a person settle it.',
  },
  {
    kind: 'unknown', action: 'escalate', maxAttempts: 1, continues: false,
    rationale: 'An unclassified failure is the one case where continuing is genuinely unsafe, because we cannot say what state we are in.',
  },
];

const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000, 600_000];

export interface RecoveryDecision {
  kind: FailureKind;
  action: RecoveryAction;
  attempt: number;
  waitMs: number;
  continues: boolean;
  rationale: string;
  /** Set when the rule's attempts are spent and the failure is being escalated. */
  exhausted: boolean;
}

/** Classify a thrown error. Unrecognised is 'unknown', never optimistically mapped. */
export function classify(error: unknown): FailureKind {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const status = typeof (error as { status?: number })?.status === 'number' ? (error as { status: number }).status : null;

  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) return 'rate-limited';
  if (status === 401 || message.includes('token expired') || message.includes('invalid_grant')) return 'auth-expired';
  if (status === 403 && message.includes('egress')) return 'egress-blocked';
  if (status === 403 || message.includes('permission denied') || message.includes('forbidden')) return 'permission-denied';
  if (status === 404 || message.includes('not found')) return 'not-found';
  if (message.includes('egress_blocked') || message.includes('enotfound') || message.includes('econnrefused') || message.includes('proxy')) return 'egress-blocked';
  if (message.includes('timeout') || message.includes('etimedout') || message.includes('aborted')) return 'timeout';
  if (message.includes('quota')) return 'quota-exhausted';
  if (message.includes('unexpected token') || message.includes('json') || message.includes('parse')) return 'parse-failed';
  if (status !== null && status >= 500) return 'source-unavailable';
  if (message.includes('unavailable') || message.includes('service down')) return 'source-unavailable';
  if (message.includes('conflict')) return 'data-conflict';
  return 'unknown';
}

export function ruleFor(kind: FailureKind): RecoveryRule {
  return RECOVERY_RULES.find((r) => r.kind === kind) ?? RECOVERY_RULES[RECOVERY_RULES.length - 1]!;
}

/** What to do about this failure, given how many times it has already happened. */
export function decide(kind: FailureKind, attempt: number): RecoveryDecision {
  const rule = ruleFor(kind);
  const exhausted = attempt > rule.maxAttempts;

  if (exhausted) {
    return {
      kind, action: 'escalate', attempt, waitMs: 0,
      continues: rule.continues,
      rationale: `${rule.rationale} After ${rule.maxAttempts} attempts this is no longer transient.`,
      exhausted: true,
    };
  }

  const waitMs = rule.action === 'retry-with-backoff' ? (BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 600_000) : 0;
  return { kind, action: rule.action, attempt, waitMs, continues: rule.continues, rationale: rule.rationale, exhausted: false };
}

export interface FailureRecord {
  id: string;
  component: string;
  operation: string;
  subjectId: string | null;
  kind: FailureKind;
  message: string;
  attempt: number;
  action: RecoveryAction;
  resolved: boolean;
  createdAt: string;
}

/** Count of prior unresolved failures of this kind for this operation. */
function priorAttempts(db: TenantDb, component: string, operation: string, subjectId: string | null, kind: FailureKind): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM gtm_failures
     WHERE tenant_id = @tenantId AND component = @component AND operation = @operation
       AND kind = @kind AND resolved = 0
       AND (@subjectId IS NULL OR subject_id = @subjectId)`,
    { component, operation, subjectId, kind },
  );
  return row?.n ?? 0;
}

/**
 * Record a failure and get the decision. The recording is the point: a system
 * that recovers silently is a system whose degradation nobody notices.
 */
export function recordFailure(
  db: TenantDb,
  input: { component: string; operation: string; subjectId?: string | null; error: unknown },
): RecoveryDecision & { recordId: string } {
  const kind = classify(input.error);
  const subjectId = input.subjectId ?? null;
  const attempt = priorAttempts(db, input.component, input.operation, subjectId, kind) + 1;
  const decision = decide(kind, attempt);
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const id = randomUUID();

  db.run(
    `INSERT INTO gtm_failures (id, tenant_id, component, operation, subject_id, kind, message,
       attempt, action, resolved, created_at)
     VALUES (@id, @tenantId, @component, @operation, @subjectId, @kind, @message, @attempt, @action, 0, @now)`,
    {
      id, component: input.component, operation: input.operation, subjectId, kind,
      message: message.slice(0, 500), attempt, action: decision.action, now: new Date().toISOString(),
    },
  );

  audit(db, {
    actor: `agent:${input.component}`, actorKind: 'agent', action: 'gtm.failure.recovered',
    subjectType: 'operation', subjectId: `${input.component}:${input.operation}`,
    detail: { kind, attempt, action: decision.action, exhausted: decision.exhausted },
  });

  return { ...decision, recordId: id };
}

/** Mark the operation healthy again, so the attempt counter starts from zero next time. */
export function resolveFailures(db: TenantDb, component: string, operation: string, subjectId: string | null = null): void {
  db.run(
    `UPDATE gtm_failures SET resolved = 1
     WHERE tenant_id = @tenantId AND component = @component AND operation = @operation AND resolved = 0
       AND (@subjectId IS NULL OR subject_id = @subjectId)`,
    { component, operation, subjectId },
  );
}

export function listFailures(db: TenantDb, opts: { unresolvedOnly?: boolean; limit?: number } = {}): FailureRecord[] {
  const clauses = ['tenant_id = @tenantId'];
  if (opts.unresolvedOnly ?? true) clauses.push('resolved = 0');
  return db
    .all<{ id: string; component: string; operation: string; subject_id: string | null; kind: string; message: string; attempt: number; action: string; resolved: number; created_at: string }>(
      // rowid breaks the tie: several failures of the same operation land in the
      // same millisecond, and "most recent" has to mean the last one inserted.
      `SELECT * FROM gtm_failures WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ${Math.min(opts.limit ?? 100, 500)}`,
    )
    .map((r) => ({
      id: r.id, component: r.component, operation: r.operation, subjectId: r.subject_id,
      kind: r.kind as FailureKind, message: r.message, attempt: r.attempt,
      action: r.action as RecoveryAction, resolved: r.resolved === 1, createdAt: r.created_at,
    }));
}

/**
 * Run an operation with the recovery rules applied. Returns the value, or null
 * when the failure was not recoverable — the caller decides whether a null means
 * "continue without this" or "stop", because only the caller knows.
 */
export async function withRecovery<T>(
  db: TenantDb,
  input: { component: string; operation: string; subjectId?: string | null; sleep?: (ms: number) => Promise<void> },
  fn: () => Promise<T>,
): Promise<{ value: T | null; decisions: RecoveryDecision[] }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const decisions: RecoveryDecision[] = [];

  for (;;) {
    try {
      const value = await fn();
      resolveFailures(db, input.component, input.operation, input.subjectId ?? null);
      return { value, decisions };
    } catch (error) {
      const decision = recordFailure(db, { ...input, error });
      decisions.push(decision);

      if (decision.action === 'retry-with-backoff' && !decision.exhausted) {
        await sleep(decision.waitMs);
        continue;
      }
      return { value: null, decisions };
    }
  }
}

export interface HealthSummary {
  unresolved: number;
  byKind: { kind: FailureKind; count: number; action: RecoveryAction }[];
  /** Components where an unrecoverable failure is waiting on a person. */
  needsHuman: { component: string; operation: string; kind: FailureKind; message: string }[];
  /** True when nothing is broken that stops the engine running. */
  operational: boolean;
}

export function health(db: TenantDb): HealthSummary {
  const failures = listFailures(db, { unresolvedOnly: true, limit: 500 });
  const byKind = new Map<FailureKind, number>();
  for (const f of failures) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);

  const needsHuman = failures
    .filter((f) => f.action === 'escalate' || f.action === 'halt' || f.action === 'refresh-credential')
    .map((f) => ({ component: f.component, operation: f.operation, kind: f.kind, message: f.message }));

  return {
    unresolved: failures.length,
    byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count, action: ruleFor(kind).action })).sort((a, b) => b.count - a.count),
    needsHuman: needsHuman.slice(0, 20),
    operational: !failures.some((f) => ruleFor(f.kind).continues === false),
  };
}
