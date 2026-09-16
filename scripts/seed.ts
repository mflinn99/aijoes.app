/**
 * Seed the platform with an MSP tenant, a synthetic customer estate, and a full
 * analysis of each synthetic company (Directive §18, §27).
 */

import { getDb } from '../src/lib/db/client';
import { TenantDb } from '../src/lib/db/tenant';
import { DEMO_TENANT_ID, DEMO_USER_ID } from '../src/lib/session';
import { SYNTHETIC_COMPANIES } from '../src/lib/fixtures/synthetic';
import { upsertCustomer, saveGrant, setConnectorConfig } from '../src/lib/db/repositories/tenant-data';
import { analyseCompany } from '../src/lib/analysis/pipeline';
import { AutonomyLevel } from '../src/lib/core/autonomy';
import { randomUUID } from 'node:crypto';

async function main() {
  const raw = getDb();
  const now = new Date().toISOString();

  raw.prepare(
    `INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(DEMO_TENANT_ID, 'Onward (reference MSP)', now);

  raw.prepare(
    `INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, 'MSP_ADMIN', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(DEMO_USER_ID, DEMO_TENANT_ID, 'mike@aigogo.ai', 'Mike Flinn', now);

  const db = new TenantDb({ tenantId: DEMO_TENANT_ID, userId: DEMO_USER_ID, role: 'MSP_ADMIN' }, raw);

  // Directive §12: a newly-provisioned tenant starts at RECOMMEND. Nothing is
  // granted EXECUTE by default — that is a deliberate decision a human makes.
  saveGrant(db, {
    id: `${DEMO_TENANT_ID}-default`,
    tenantId: DEMO_TENANT_ID,
    userId: null,
    actionType: null,
    capabilityId: null,
    level: AutonomyLevel.RECOMMEND,
    monetaryThreshold: 0,
    maxRisk: 'low',
    grantedBy: 'system',
    grantedAt: now,
    expiresAt: null,
  });
  // A narrow PREPARE grant so analysis-side capabilities can produce artefacts.
  saveGrant(db, {
    id: `${DEMO_TENANT_ID}-prepare-analysis`,
    tenantId: DEMO_TENANT_ID,
    userId: null,
    actionType: 'analyse-company',
    capabilityId: 'toleron',
    level: AutonomyLevel.PREPARE,
    monetaryThreshold: 5_000,
    maxRisk: 'low',
    grantedBy: 'system',
    grantedAt: now,
    expiresAt: null,
  });

  setConnectorConfig(db, 'website', true, 'available');
  setConnectorConfig(db, 'companies-house', false, process.env.COMPANIES_HOUSE_API_KEY ? 'available' : 'not-configured');

  for (const company of SYNTHETIC_COMPANIES) {
    const customerId = `cust-${company.key}`;
    upsertCustomer(db, {
      id: customerId,
      name: company.name,
      domain: company.domain,
      currentMrr: company.currentMrr,
      relationshipNote: company.description,
      renewalDate: new Date(Date.now() + 86_400_000 * (60 + SYNTHETIC_COMPANIES.indexOf(company) * 45)).toISOString().slice(0, 10),
    });

    const result = await analyseCompany(db, company.domain, {
      customerId,
      offline: true,
      seedRecords: company.records,
      userSupplied: company.userSupplied,
    });

    console.log(
      `${company.name.padEnd(34)} understanding ${String(result.understanding).padStart(3)}%  ` +
        `${String(result.opportunities.length).padStart(2)} opportunities  ` +
        `£${result.opportunities.reduce((s, o) => s + o.estimatedAnnualValue, 0).toLocaleString('en-GB')}`,
    );
  }

  console.log(`\nSeeded tenant ${DEMO_TENANT_ID} with ${SYNTHETIC_COMPANIES.length} companies.`);
  void randomUUID;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
