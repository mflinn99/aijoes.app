/**
 * Directive 02 Phase 9 — CRM closed loop.
 *
 * The CRM is the commercial system of record. The engine must be able to write
 * to it without ever creating a second copy of a company, contact or deal, and
 * must keep working when the CRM is unreachable. Those two requirements shape
 * this interface:
 *
 *  - every write is an upsert keyed on a *local* id, and the mapping from local
 *    id to external id is stored here rather than re-discovered by searching;
 *  - every write returns what actually happened, so 'unchanged' is a first
 *    class outcome and a replayed agent run is provably a no-op.
 */

export type CrmEntityType = 'company' | 'contact' | 'deal' | 'activity' | 'task';

export type CrmWriteAction = 'created' | 'updated' | 'unchanged';

export interface CrmWriteResult {
  externalId: string;
  action: CrmWriteAction;
}

export interface CrmCompany {
  localId: string;
  name: string;
  domain: string | null;
  /** Free-form, provider-mapped. Never invented — only fields we hold evidence for. */
  properties: Record<string, string | number | null>;
}

export interface CrmContact {
  localId: string;
  companyLocalId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  linkedin: string | null;
}

export interface CrmDeal {
  localId: string;
  companyLocalId: string;
  name: string;
  stage: string;
  valueGbp: number;
  probability: number;
  closeDate: string | null;
  owner: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
}

export interface CrmActivity {
  localId: string;
  companyLocalId: string;
  contactLocalId: string | null;
  dealLocalId: string | null;
  kind: 'email' | 'note' | 'meeting' | 'call';
  subject: string;
  body: string;
  occurredAt: string;
}

export interface CrmTask {
  localId: string;
  companyLocalId: string;
  dealLocalId: string | null;
  subject: string;
  body: string;
  dueAt: string;
  /** Tasks the engine cannot do itself and is handing to a person. */
  assignee: string | null;
}

/**
 * Raised when the CRM is reachable but rejected the write, or is unreachable.
 * The sync layer distinguishes the two: `retryable` queues, non-retryable stops.
 */
export class CrmError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = 'CrmError';
  }
}

export interface CrmAdapter {
  readonly provider: string;
  readonly name: string;
  /** False when credentials are absent — the sync layer then records the intent without claiming a write. */
  readonly configured: boolean;

  upsertCompany(input: CrmCompany, externalId: string | null): Promise<CrmWriteResult>;
  upsertContact(input: CrmContact, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult>;
  upsertDeal(input: CrmDeal, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult>;
  logActivity(input: CrmActivity, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult>;
  createTask(input: CrmTask, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult>;
}
