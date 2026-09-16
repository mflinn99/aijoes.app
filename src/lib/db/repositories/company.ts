import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../tenant';
import type { CompanyTwin } from '../../core/company-twin';
import { understandingScore } from '../../core/company-twin';
import { valueOf } from '../../core/provenance';
import type { Opportunity } from '../../core/opportunity';
import type { SupplierRelationship } from '../../analysis/supply-chain';

export interface CompanyRow {
  id: string;
  customerId: string | null;
  displayName: string;
  domain: string | null;
  understanding: number;
  lastUpdatedAt: string;
}

export function saveTwin(db: TenantDb, twin: CompanyTwin, customerId: string | null): CompanyRow {
  const understanding = understandingScore(twin);
  const displayName = (valueOf(twin.legalName) as string | null) ?? (valueOf(twin.domain) as string | null) ?? twin.id;
  const domain = valueOf(twin.domain) as string | null;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO company_twins
       (id, tenant_id, customer_id, display_name, domain, understanding, twin_json, created_at, last_updated_at)
     VALUES (@id, @tenantId, @customerId, @displayName, @domain, @understanding, @twinJson, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       display_name = @displayName, domain = @domain, understanding = @understanding,
       twin_json = @twinJson, last_updated_at = @now, customer_id = COALESCE(@customerId, customer_id)`,
    { id: twin.id, customerId, displayName, domain, understanding, twinJson: JSON.stringify(twin), now },
  );

  return { id: twin.id, customerId, displayName, domain, understanding, lastUpdatedAt: now };
}

export function getTwin(db: TenantDb, companyId: string): CompanyTwin | null {
  const row = db.get<{ twin_json: string }>(
    `SELECT twin_json FROM company_twins WHERE tenant_id = @tenantId AND id = @id`,
    { id: companyId },
  );
  return row ? (JSON.parse(row.twin_json) as CompanyTwin) : null;
}

export function findTwinByDomain(db: TenantDb, domain: string): CompanyTwin | null {
  const row = db.get<{ twin_json: string }>(
    `SELECT twin_json FROM company_twins WHERE tenant_id = @tenantId AND domain = @domain LIMIT 1`,
    { domain },
  );
  return row ? (JSON.parse(row.twin_json) as CompanyTwin) : null;
}

export function listCompanies(db: TenantDb): CompanyRow[] {
  return db
    .all<{ id: string; customer_id: string | null; display_name: string; domain: string | null; understanding: number; last_updated_at: string }>(
      `SELECT id, customer_id, display_name, domain, understanding, last_updated_at
       FROM company_twins WHERE tenant_id = @tenantId ORDER BY last_updated_at DESC`,
    )
    .map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      displayName: r.display_name,
      domain: r.domain,
      understanding: r.understanding,
      lastUpdatedAt: r.last_updated_at,
    }));
}

export function saveSourceRecords(
  db: TenantDb,
  companyId: string,
  records: { connectorId: string; label: string; locator?: string; retrievedAt: string; payload: unknown }[],
): void {
  for (const r of records) {
    db.run(
      `INSERT INTO source_records (id, tenant_id, company_id, connector_id, locator, label, payload_json, retrieved_at)
       VALUES (@id, @tenantId, @companyId, @connectorId, @locator, @label, @payloadJson, @retrievedAt)`,
      {
        id: randomUUID(),
        companyId,
        connectorId: r.connectorId,
        locator: r.locator ?? null,
        label: r.label,
        payloadJson: JSON.stringify(r.payload),
        retrievedAt: r.retrievedAt,
      },
    );
  }
}

export function saveOpportunities(db: TenantDb, companyId: string, opportunities: Opportunity[]): void {
  db.run(`DELETE FROM opportunities WHERE tenant_id = @tenantId AND company_id = @companyId AND execution_status = 'NOT_STARTED'`, { companyId });
  for (const o of opportunities) {
    db.run(
      `INSERT INTO opportunities
         (id, tenant_id, company_id, category, subcategory, title, estimated_annual_value,
          implementation_cost, confidence, effort, risk, time_to_value, execution_readiness,
          execution_status, playbook_id, score, realised_value, opportunity_json, created_at)
       VALUES
         (@id, @tenantId, @companyId, @category, @subcategory, @title, @value, @cost, @confidence,
          @effort, @risk, @timeToValue, @readiness, @status, @playbookId, @score, @realisedValue,
          @json, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         estimated_annual_value = @value, confidence = @confidence, score = @score, opportunity_json = @json`,
      {
        id: o.id,
        companyId,
        category: o.category,
        subcategory: o.subcategory,
        title: o.title,
        value: o.estimatedAnnualValue,
        cost: o.implementationCost,
        confidence: o.confidence,
        effort: o.effort,
        risk: o.risk,
        timeToValue: o.timeToValue,
        readiness: o.executionReadiness,
        status: o.executionStatus,
        playbookId: o.playbookId,
        score: o.score,
        realisedValue: o.realisedValue,
        json: JSON.stringify(o),
        createdAt: o.createdAt,
      },
    );
  }
}

export function listOpportunities(db: TenantDb, companyId?: string): Opportunity[] {
  const rows = db.all<{ opportunity_json: string }>(
    companyId
      ? `SELECT opportunity_json FROM opportunities WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY score DESC`
      : `SELECT opportunity_json FROM opportunities WHERE tenant_id = @tenantId ORDER BY score DESC`,
    companyId ? { companyId } : {},
  );
  return rows.map((r) => JSON.parse(r.opportunity_json) as Opportunity);
}

export function getOpportunity(db: TenantDb, id: string): Opportunity | null {
  const row = db.get<{ opportunity_json: string }>(
    `SELECT opportunity_json FROM opportunities WHERE tenant_id = @tenantId AND id = @id`,
    { id },
  );
  return row ? (JSON.parse(row.opportunity_json) as Opportunity) : null;
}

export function saveSuppliers(db: TenantDb, companyId: string, suppliers: SupplierRelationship[]): void {
  db.run(`DELETE FROM supplier_relationships WHERE tenant_id = @tenantId AND company_id = @companyId`, { companyId });
  for (const s of suppliers) {
    db.run(
      `INSERT INTO supplier_relationships
         (id, tenant_id, company_id, supplier_name, category, annual_spend, spend_confidence,
          contract_end, renewal_date, criticality, switching_complexity, savings_potential,
          relationship_json, created_at)
       VALUES
         (@id, @tenantId, @companyId, @supplierName, @category, @annualSpend, @spendConfidence,
          @contractEnd, @renewalDate, @criticality, @switching, @savings, @json, @createdAt)`,
      {
        id: s.id,
        companyId,
        supplierName: s.supplierName,
        category: s.category,
        annualSpend: s.annualSpend,
        spendConfidence: s.spendConfidence,
        contractEnd: s.contractEnd,
        renewalDate: s.renewalDate,
        criticality: s.criticality,
        switching: s.switchingComplexity,
        savings: s.savingsPotential,
        json: JSON.stringify(s),
        createdAt: new Date().toISOString(),
      },
    );
  }
}

export function listSuppliers(db: TenantDb, companyId: string): SupplierRelationship[] {
  return db
    .all<{ relationship_json: string }>(
      `SELECT relationship_json FROM supplier_relationships WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY savings_potential DESC`,
      { companyId },
    )
    .map((r) => JSON.parse(r.relationship_json) as SupplierRelationship);
}
