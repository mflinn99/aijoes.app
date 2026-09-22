/**
 * Directive 02 Phase 18 — run it.
 *
 * Two runs, deliberately:
 *
 *  A. Against real, named UK companies. This proves what the engine does when it
 *     cannot reach its sources — which in this environment is every source. The
 *     expected and correct outcome is that research fails, no hypothesis is
 *     generated and nothing is contacted. An engine that produced a target list
 *     here would be fabricating.
 *
 *  B. Against the synthetic fixtures, offline. This proves the machine itself:
 *     every stage from discovery to brief, with real records flowing through.
 *
 * Neither run can send anything.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['METAMSP_DB_PATH'] = join(mkdtempSync(join(tmpdir(), 'gtm-run-')), 'run.db');
process.env['METAMSP_DISABLE_WORKER'] = '1';

import { createTestDb } from '../src/lib/db/client';
import { TenantDb } from '../src/lib/db/tenant';
import { ONWARD } from '../src/config/msp/onward';
import { SYNTHETIC_COMPANIES } from '../src/lib/fixtures/synthetic';
import { runLoop, renderLoop } from '../src/lib/gtm/loop';
import { upsertAccount, listAccounts, listHypotheses, listOutreach } from '../src/lib/gtm/store';
import { morningBrief, renderBrief } from '../src/lib/gtm/brief';
import { askGtm } from '../src/lib/gtm/ask';
import { listFailures } from '../src/lib/gtm/recovery';
import { LocalCrmAdapter } from '../src/lib/gtm/crm/local';

/**
 * Real UK companies whose public profile fits an Onward archetype. These are
 * identities only — names and domains. Nothing here asserts a need, a signal or
 * a reason for contact, because none has been observed. That is exactly the
 * point of run A.
 */
const REAL_TARGETS = [
  { name: 'Krome Technologies', domain: 'krome.co.uk' },
  { name: 'Transparity Solutions', domain: 'transparity.com' },
  { name: 'Phoenix Software', domain: 'phoenixs.co.uk' },
  { name: 'DSP Group', domain: 'dsp.co.uk' },
  { name: 'ANS Group', domain: 'ans.co.uk' },
  { name: 'Circle Cloud', domain: 'circlecloud.co.uk' },
];

function bar(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

async function main(): Promise<void> {
  const raw = createTestDb();
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?) ON CONFLICT(id) DO NOTHING`)
    .run('tenant-onward', 'Onward Professional Services', now);
  raw.prepare(`INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('user-run', 'tenant-onward', 'run@onwardps.co.uk', 'Run', 'MSP_ADMIN', now);

  const db = new TenantDb({ tenantId: 'tenant-onward', userId: 'user-run', role: 'MSP_ADMIN' }, raw);
  const targets = { local: new LocalCrmAdapter(db), external: null };

  // ---- RUN A: real companies, live research ------------------------------
  bar('RUN A — real UK companies, live research attempted');
  for (const t of REAL_TARGETS) {
    upsertAccount(db, { mspId: ONWARD.id, name: t.name, domain: t.domain, source: 'analyst-seed', synthetic: false });
  }

  const runA = await runLoop(db, {
    mspId: ONWARD.id, profile: ONWARD, targets,
    offline: false, discover: 0, research: REAL_TARGETS.length, outreach: 10,
  });
  console.log(renderLoop(runA));

  console.log('\nWhat the engine holds about these companies:');
  for (const account of listAccounts(db, { mspId: ONWARD.id, limit: 50 })) {
    console.log(`  ${account.name.padEnd(26)} research=${account.researchState.padEnd(16)} score=${Math.round(account.priorityScore)}`);
  }
  console.log(`\n  Hypotheses generated: ${listHypotheses(db, { limit: 500 }).length}`);
  console.log(`  Messages composed:    ${listOutreach(db, { limit: 500 }).length}`);
  console.log('\nRecorded failures:');
  for (const f of listFailures(db, { limit: 20 })) {
    console.log(`  ${f.component}/${f.operation} → ${f.kind} (${f.action}): ${f.message.slice(0, 90)}`);
  }

  // ---- RUN B: synthetic fixtures, offline --------------------------------
  const rawB = createTestDb();
  rawB.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?) ON CONFLICT(id) DO NOTHING`)
    .run('tenant-onward', 'Onward Professional Services', now);
  rawB.prepare(`INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('user-run', 'tenant-onward', 'run@onwardps.co.uk', 'Run', 'MSP_ADMIN', now);
  const dbB = new TenantDb({ tenantId: 'tenant-onward', userId: 'user-run', role: 'MSP_ADMIN' }, rawB);
  const targetsB = { local: new LocalCrmAdapter(dbB), external: null };

  bar('RUN B — synthetic fixtures, offline research');
  for (const company of SYNTHETIC_COMPANIES) {
    upsertAccount(dbB, { mspId: ONWARD.id, name: company.name, domain: `${company.key}.co.uk`, source: 'fixture', synthetic: false });
  }
  const runB = await runLoop(dbB, {
    mspId: ONWARD.id, profile: ONWARD, targets: targetsB,
    offline: true, discover: 0, research: 20, outreach: 10,
  });
  console.log(renderLoop(runB));

  bar('RUN B — second cycle, to prove nothing duplicates');
  const before = {
    accounts: listAccounts(dbB, { mspId: ONWARD.id, limit: 500 }).length,
    hypotheses: listHypotheses(dbB, { limit: 500 }).length,
    outreach: listOutreach(dbB, { limit: 500 }).length,
  };
  const runB2 = await runLoop(dbB, {
    mspId: ONWARD.id, profile: ONWARD, targets: targetsB,
    offline: true, discover: 0, research: 20, outreach: 10,
  });
  const after = {
    accounts: listAccounts(dbB, { mspId: ONWARD.id, limit: 500 }).length,
    hypotheses: listHypotheses(dbB, { limit: 500 }).length,
    outreach: listOutreach(dbB, { limit: 500 }).length,
  };
  console.log(`  before: ${JSON.stringify(before)}`);
  console.log(`  after:  ${JSON.stringify(after)}`);
  console.log(`  identical: ${JSON.stringify(before) === JSON.stringify(after)}`);
  console.log(`  CRM: ${runB2.crm!.created} created, ${runB2.crm!.updated} updated, ${runB2.crm!.unchanged} unchanged`);

  bar('RUN B — the morning brief');
  console.log(renderBrief(morningBrief(dbB, ONWARD.id)));

  bar('RUN B — ASK JOJO');
  for (const q of ['Who should we approach?', "What's in the pipeline?", 'What is it blocked on?', 'Is it working?']) {
    const answer = askGtm(dbB, q, ONWARD.id);
    console.log(`\nQ: ${q}\n${answer.answer}\n   [basis] ${answer.basis}`);
  }
}

void main();
