/**
 * The local CRM of record.
 *
 * Onward has no CRM credentials in this environment (see BLOCKERS.md), and the
 * directive is explicit that the loop must close anyway. So the platform ships
 * its own system of record implementing the same adapter interface. When a real
 * CRM is connected the sync layer writes to both, and the local copy becomes the
 * reconciliation source rather than dead weight.
 *
 * It is a genuine adapter, not a stub: it persists, it is idempotent, and it
 * reports created/updated/unchanged from the stored payload hash.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { TenantDb } from '../../db/tenant';
import type {
  CrmAdapter, CrmActivity, CrmCompany, CrmContact, CrmDeal, CrmTask, CrmWriteResult,
} from './types';

export const LOCAL_PROVIDER = 'local';

function hash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

interface Row { external_id: string; payload_hash: string }

export class LocalCrmAdapter implements CrmAdapter {
  readonly provider = LOCAL_PROVIDER;
  readonly name = 'AIGoGo local system of record';
  readonly configured = true;

  constructor(private readonly db: TenantDb) {}

  private write(entityType: string, localId: string, payload: unknown): CrmWriteResult {
    const h = hash(payload);
    const existing = this.db.get<Row>(
      `SELECT external_id, payload_hash FROM gtm_crm_records
       WHERE tenant_id = @tenantId AND entity_type = @entityType AND local_id = @localId`,
      { entityType, localId },
    );

    if (existing) {
      if (existing.payload_hash === h) return { externalId: existing.external_id, action: 'unchanged' };
      this.db.run(
        `UPDATE gtm_crm_records SET payload_json = @payload, payload_hash = @hash, updated_at = @now
         WHERE tenant_id = @tenantId AND entity_type = @entityType AND local_id = @localId`,
        { entityType, localId, payload: JSON.stringify(payload), hash: h, now: new Date().toISOString() },
      );
      return { externalId: existing.external_id, action: 'updated' };
    }

    const externalId = `loc_${entityType}_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO gtm_crm_records
         (id, tenant_id, entity_type, local_id, external_id, payload_json, payload_hash, created_at, updated_at)
       VALUES (@id, @tenantId, @entityType, @localId, @externalId, @payload, @hash, @now, @now)`,
      { id: randomUUID(), entityType, localId, externalId, payload: JSON.stringify(payload), hash: h, now },
    );
    return { externalId, action: 'created' };
  }

  async upsertCompany(input: CrmCompany): Promise<CrmWriteResult> {
    return this.write('company', input.localId, input);
  }

  async upsertContact(input: CrmContact): Promise<CrmWriteResult> {
    return this.write('contact', input.localId, input);
  }

  async upsertDeal(input: CrmDeal): Promise<CrmWriteResult> {
    return this.write('deal', input.localId, input);
  }

  async logActivity(input: CrmActivity): Promise<CrmWriteResult> {
    return this.write('activity', input.localId, input);
  }

  async createTask(input: CrmTask): Promise<CrmWriteResult> {
    return this.write('task', input.localId, input);
  }
}

/** Reads the local CRM back — the UI and the tests both need this. */
export function readLocalRecords<T>(db: TenantDb, entityType: string): { localId: string; externalId: string; payload: T }[] {
  return db
    .all<{ local_id: string; external_id: string; payload_json: string }>(
      `SELECT local_id, external_id, payload_json FROM gtm_crm_records
       WHERE tenant_id = @tenantId AND entity_type = @entityType ORDER BY updated_at DESC`,
      { entityType },
    )
    .map((r) => ({ localId: r.local_id, externalId: r.external_id, payload: JSON.parse(r.payload_json) as T }));
}
