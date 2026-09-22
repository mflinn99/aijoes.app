import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../tenant';
import type { LicenceFacts } from '../../discovery/microsoft365-connector';
import type { CrmFacts } from '../../discovery/hubspot-connector';

export type FactKind = 'licence' | 'financial' | 'crm';

export interface ConnectedFacts {
  licence?: LicenceFacts;
  financial?: FinancialFacts;
  crm?: CrmFacts;
}

/** Counted figures from an accounting or banking connector. */
export interface FinancialFacts {
  turnover: number;
  grossMargin: number | null;
  periodStart: string;
  periodEnd: string;
  supplierSpend: { supplier: string; category: string; annualSpend: number }[];
  softwareSubscriptions: { supplier: string; annualSpend: number; lastCharged: string }[];
  customerCount: number | null;
  averageCustomerValue: number | null;
  retrievedAt: string;
}

export function putFacts(db: TenantDb, companyId: string, kind: FactKind, connectorId: string, facts: unknown): void {
  db.run(
    `INSERT INTO connected_facts (id, tenant_id, company_id, kind, connector_id, facts_json, retrieved_at)
     VALUES (@id, @tenantId, @companyId, @kind, @connectorId, @factsJson, @retrievedAt)
     ON CONFLICT(tenant_id, company_id, kind) DO UPDATE SET
       connector_id = @connectorId, facts_json = @factsJson, retrieved_at = @retrievedAt`,
    {
      id: randomUUID(),
      companyId,
      kind,
      connectorId,
      factsJson: JSON.stringify(facts),
      retrievedAt: new Date().toISOString(),
    },
  );
}

export function getFacts(db: TenantDb, companyId: string): ConnectedFacts {
  const rows = db.all<{ kind: string; facts_json: string }>(
    `SELECT kind, facts_json FROM connected_facts WHERE tenant_id = @tenantId AND company_id = @companyId`,
    { companyId },
  );

  const out: ConnectedFacts = {};
  for (const row of rows) {
    if (row.kind === 'licence') out.licence = JSON.parse(row.facts_json) as LicenceFacts;
    if (row.kind === 'financial') out.financial = JSON.parse(row.facts_json) as FinancialFacts;
    if (row.kind === 'crm') out.crm = JSON.parse(row.facts_json) as CrmFacts;
  }
  return out;
}
