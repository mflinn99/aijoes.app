/**
 * Seed an MSP tenant with users, a synthetic customer estate, and a full
 * analysis of each synthetic company (Directive §18, §27).
 *
 * Passwords come from the environment where set; otherwise a random one is
 * generated and printed once. The seed never ships a known default password.
 */

import { randomBytes } from 'node:crypto';
import { getDb } from '../src/lib/db/client';
import { TenantDb } from '../src/lib/db/tenant';
import { DEMO_TENANT_ID } from '../src/lib/session';
import { SYNTHETIC_COMPANIES } from '../src/lib/fixtures/synthetic';
import { upsertCustomer, saveGrant, setConnectorConfig } from '../src/lib/db/repositories/tenant-data';
import { analyseCompany } from '../src/lib/analysis/pipeline';
import { AutonomyLevel } from '../src/lib/core/autonomy';
import { createUser, getUserByEmail, setPassword } from '../src/lib/auth/users';
import type { Role } from '../src/lib/auth/rbac';

function generatedPassword(): string {
  return randomBytes(12).toString('base64url');
}

interface SeedUser {
  email: string;
  name: string;
  role: Role;
  envVar: string;
}

const USERS: SeedUser[] = [
  { email: 'mike@aigogo.ai', name: 'Mike Flinn', role: 'MSP_ADMIN', envVar: 'METAMSP_ADMIN_PASSWORD' },
  { email: 'operator@aigogo.ai', name: 'Operations User', role: 'MSP_USER', envVar: 'METAMSP_USER_PASSWORD' },
  { email: 'viewer@aigogo.ai', name: 'Read Only', role: 'READ_ONLY', envVar: 'METAMSP_VIEWER_PASSWORD' },
];

async function main() {
  const raw = getDb();
  const now = new Date().toISOString();

  raw
    .prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?) ON CONFLICT(id) DO NOTHING`)
    .run(DEMO_TENANT_ID, 'Onward (reference MSP)', now);

  const credentials: { email: string; role: Role; password: string | null }[] = [];

  for (const user of USERS) {
    const supplied = process.env[user.envVar];
    const password = supplied ?? generatedPassword();
    const existing = getUserByEmail(user.email, raw);

    if (existing) {
      if (supplied) await setPassword(existing.id, password, raw);
      credentials.push({ email: user.email, role: user.role, password: supplied ? password : null });
      continue;
    }

    await createUser({ tenantId: DEMO_TENANT_ID, email: user.email, name: user.name, role: user.role, password }, raw);
    credentials.push({ email: user.email, role: user.role, password });
  }

  const admin = getUserByEmail(USERS[0]!.email, raw)!;
  const db = new TenantDb({ tenantId: DEMO_TENANT_ID, userId: admin.id, role: 'MSP_ADMIN' }, raw);

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
      renewalDate: new Date(Date.now() + 86_400_000 * (60 + SYNTHETIC_COMPANIES.indexOf(company) * 45))
        .toISOString()
        .slice(0, 10),
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

  console.log(`\nSeeded tenant ${DEMO_TENANT_ID} with ${SYNTHETIC_COMPANIES.length} companies.\n`);
  console.log('Sign in at http://localhost:3000/login\n');

  for (const c of credentials) {
    if (c.password) {
      console.log(`  ${c.email.padEnd(24)} ${c.role.padEnd(10)} ${c.password}`);
    } else {
      console.log(`  ${c.email.padEnd(24)} ${c.role.padEnd(10)} (unchanged — set ${USERS.find((u) => u.email === c.email)!.envVar} to reset)`);
    }
  }
  console.log('\nThese passwords are shown once. Change them after first sign-in.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
