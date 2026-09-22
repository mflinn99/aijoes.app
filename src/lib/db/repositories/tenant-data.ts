import type { TenantDb } from '../tenant';
import type { AutonomyGrant } from '../../core/autonomy';

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  domain: string | null;
  currentMrr: number;
  relationshipNote: string | null;
  renewalDate: string | null;
  /** Service ids the MSP already sells this customer. */
  currentServices: string[];
}

export function listCustomers(db: TenantDb): Customer[] {
  return db
    .all<{ id: string; name: string; domain: string | null; current_mrr: number; relationship_note: string | null; renewal_date: string | null; current_services: string | null }>(
      `SELECT id, name, domain, current_mrr, relationship_note, renewal_date, current_services
       FROM customers WHERE tenant_id = @tenantId ORDER BY current_mrr DESC`,
    )
    .map((r) => ({
      id: r.id,
      tenantId: db.ctx.tenantId,
      name: r.name,
      domain: r.domain,
      currentMrr: r.current_mrr,
      relationshipNote: r.relationship_note,
      renewalDate: r.renewal_date,
      currentServices: parseServices(r.current_services),
    }));
}

function parseServices(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function getCustomer(db: TenantDb, id: string): Customer | null {
  return listCustomers(db).find((c) => c.id === id) ?? null;
}

export function upsertCustomer(db: TenantDb, c: Omit<Customer, 'tenantId' | 'currentServices'> & { currentServices?: string[] }): void {
  db.run(
    `INSERT INTO customers (id, tenant_id, name, domain, current_mrr, relationship_note, renewal_date, current_services, created_at)
     VALUES (@id, @tenantId, @name, @domain, @currentMrr, @note, @renewalDate, @services, @createdAt)
     ON CONFLICT(id) DO UPDATE SET name = @name, domain = @domain, current_mrr = @currentMrr,
       relationship_note = @note, renewal_date = @renewalDate, current_services = @services`,
    {
      id: c.id,
      name: c.name,
      domain: c.domain,
      currentMrr: c.currentMrr,
      note: c.relationshipNote,
      renewalDate: c.renewalDate,
      services: JSON.stringify(c.currentServices ?? []),
      createdAt: new Date().toISOString(),
    },
  );
}

export function setCustomerServices(db: TenantDb, customerId: string, services: string[]): void {
  db.run(
    `UPDATE customers SET current_services = @services WHERE tenant_id = @tenantId AND id = @id`,
    { id: customerId, services: JSON.stringify(services) },
  );
}

export function listGrants(db: TenantDb): AutonomyGrant[] {
  return db
    .all<{
      id: string; user_id: string | null; action_type: string | null; capability_id: string | null;
      level: number; monetary_threshold: number; max_risk: string; granted_by: string;
      granted_at: string; expires_at: string | null;
    }>(`SELECT * FROM autonomy_grants WHERE tenant_id = @tenantId`)
    .map((r) => ({
      id: r.id,
      tenantId: db.ctx.tenantId,
      userId: r.user_id,
      actionType: r.action_type,
      capabilityId: r.capability_id,
      level: r.level,
      monetaryThreshold: r.monetary_threshold,
      maxRisk: r.max_risk as AutonomyGrant['maxRisk'],
      grantedBy: r.granted_by,
      grantedAt: r.granted_at,
      expiresAt: r.expires_at,
    }));
}

export function saveGrant(db: TenantDb, g: AutonomyGrant): void {
  db.run(
    `INSERT INTO autonomy_grants
       (id, tenant_id, user_id, action_type, capability_id, level, monetary_threshold, max_risk, granted_by, granted_at, expires_at)
     VALUES (@id, @tenantId, @userId, @actionType, @capabilityId, @level, @threshold, @maxRisk, @grantedBy, @grantedAt, @expiresAt)
     ON CONFLICT(id) DO UPDATE SET level = @level, monetary_threshold = @threshold, max_risk = @maxRisk`,
    {
      id: g.id,
      userId: g.userId,
      actionType: g.actionType,
      capabilityId: g.capabilityId,
      level: g.level,
      threshold: g.monetaryThreshold,
      maxRisk: g.maxRisk,
      grantedBy: g.grantedBy,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
    },
  );
}

/** Directive §12: drop this tenant to Observe in one step. */
export function haltTenant(db: TenantDb): number {
  const grants = listGrants(db);
  for (const g of grants) saveGrant(db, { ...g, level: 0 });
  return grants.length;
}

export function listAudit(db: TenantDb, limit = 100): {
  id: string; actor: string; actorKind: string; action: string; subjectType: string; subjectId: string; detail: unknown; at: string;
}[] {
  return db
    .all<{ id: string; actor: string; actor_kind: string; action: string; subject_type: string; subject_id: string; detail_json: string; at: string }>(
      `SELECT * FROM audit_log WHERE tenant_id = @tenantId ORDER BY at DESC LIMIT ${Math.min(limit, 500)}`,
    )
    .map((r) => ({
      id: r.id,
      actor: r.actor,
      actorKind: r.actor_kind,
      action: r.action,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      detail: JSON.parse(r.detail_json),
      at: r.at,
    }));
}

export function listAgentEvents(db: TenantDb, limit = 100) {
  return db.all<{
    id: string; company_id: string | null; objective: string; capability_id: string | null;
    status: string; started_at: string; duration_ms: number | null; cost_gbp: number;
    benefit_gbp: number; failure: string | null; retry_count: number;
  }>(`SELECT id, company_id, objective, capability_id, status, started_at, duration_ms, cost_gbp,
             benefit_gbp, failure, retry_count
      FROM agent_events WHERE tenant_id = @tenantId ORDER BY started_at DESC LIMIT ${Math.min(limit, 500)}`);
}

export function listConnectorConfigs(db: TenantDb): { connectorId: string; enabled: boolean; status: string }[] {
  return db
    .all<{ connector_id: string; enabled: number; status: string }>(
      `SELECT connector_id, enabled, status FROM connector_configs WHERE tenant_id = @tenantId`,
    )
    .map((r) => ({ connectorId: r.connector_id, enabled: r.enabled === 1, status: r.status }));
}

export function setConnectorConfig(db: TenantDb, connectorId: string, enabled: boolean, status: string): void {
  db.run(
    `INSERT INTO connector_configs (id, tenant_id, connector_id, enabled, status, config_json, updated_at)
     VALUES (@id, @tenantId, @connectorId, @enabled, @status, '{}', @now)
     ON CONFLICT(tenant_id, connector_id) DO UPDATE SET enabled = @enabled, status = @status, updated_at = @now`,
    {
      id: `${db.ctx.tenantId}-${connectorId}`,
      connectorId,
      enabled: enabled ? 1 : 0,
      status,
      now: new Date().toISOString(),
    },
  );
}
