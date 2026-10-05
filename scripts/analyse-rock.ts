/**
 * Analyse Project ROCK with the real engines.
 *
 * Two questions, because the company is an MSP and that makes it both:
 *   A. As a company to analyse — what do the MAKE MORE / SPEND LESS / MSP
 *      EXPAND engines find in it?
 *   B. As a GTM target for Onward — does it clear the evidence bar, and what
 *      does the outreach layer do about it?
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['METAMSP_DB_PATH'] = join(mkdtempSync(join(tmpdir(), 'rock-')), 'rock.db');
process.env['METAMSP_DISABLE_WORKER'] = '1';

import { createTestDb } from '../src/lib/db/client';
import { TenantDb } from '../src/lib/db/tenant';
import { loadProjectRock } from '../src/lib/fixtures/demo-loader';
import { ROCK, rockFindings } from '../src/lib/fixtures/project-rock';
import { understandingScore } from '../src/lib/core/company-twin';
import { valueOf } from '../src/lib/core/provenance';
import { ONWARD } from '../src/config/msp/onward';
import { upsertAccount, updateAccount, listHypotheses, listContacts, listOutreach } from '../src/lib/gtm/store';
import { accountIntelligenceAgent, opportunityAgent, contactAgent } from '../src/lib/gtm/agents';
import { compose } from '../src/lib/gtm/outreach';
import { getAccount } from '../src/lib/gtm/store';

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
function bar(t: string) { console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`); }

async function main(): Promise<void> {
  const raw = createTestDb();
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO tenants (id,name,kind,created_at) VALUES (?,?,'MSP',?)`).run('t', 'Onward', now);
  raw.prepare(`INSERT INTO users (id,tenant_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)`)
    .run('u', 't', 'mark@onwardps.co.uk', 'Mark', 'MSP_ADMIN', now);
  const db = new TenantDb({ tenantId: 't', userId: 'u', role: 'MSP_ADMIN' }, raw);

  bar('A. PROJECT ROCK AS A COMPANY — what the teaser’s own numbers say');
  for (const f of rockFindings()) {
    const tag = f.direction === 'risk' ? 'RISK    ' : f.direction === 'strength' ? 'STRENGTH' : 'NEUTRAL ';
    console.log(`\n[${tag}] ${f.headline}`);
    console.log(`           ${f.workings}`);
    console.log(`           → ${f.soWhat}`);
    if (f.valueGbp !== null) console.log(`           Money: ${gbp(f.valueGbp)}`);
  }

  bar('B. THE PLATFORM’S OWN ANALYSIS');
  const loaded = await loadProjectRock(db);
  const twin = loaded.analysis.twin;
  console.log(`Understanding: ${understandingScore(twin)}%`);
  console.log(`Turnover:      ${gbp((valueOf(twin.turnoverEstimate) as number) ?? 0)} (${twin.turnoverEstimate.current?.method}, confidence ${twin.turnoverEstimate.current?.confidence})`);
  console.log(`Source:        ${twin.turnoverEstimate.current?.sources.map((s) => s.label).join(', ')}`);
  console.log(`Employees:     ${valueOf(twin.employeesEstimate)}`);
  console.log(`\nOpportunities the engines produced: ${loaded.analysis.opportunities.length}`);
  for (const o of loaded.analysis.opportunities) {
    console.log(`\n  [${o.category}] ${o.title}`);
    console.log(`     ${gbp(o.estimatedAnnualValue)}/yr · confidence ${Math.round(o.confidence * 100)}% · ${o.epistemics}`);
    console.log(`     ${o.summary}`);
    console.log(`     ${o.reasoningSummary.slice(0, 260)}`);
  }
  console.log('\nConnections that would improve this:');
  for (const c of loaded.analysis.recommendedConnections.slice(0, 5)) {
    console.log(`  +${c.understandingUplift}%  ${c.name} — ${c.unlocks}`);
  }

  bar('C. PROJECT ROCK AS AN OUTREACH TARGET FOR ONWARD');
  const account = upsertAccount(db, {
    mspId: ONWARD.id, name: ROCK.name, domain: null, source: 'acquisition-teaser', synthetic: false,
  });
  updateAccount(db, account.id, { companyId: loaded.companyId, researchState: 'researched' });

  console.log(accountIntelligenceAgent(db, { mspId: ONWARD.id, profile: ONWARD }).notes.join(' '));
  const opps = opportunityAgent(db, { mspId: ONWARD.id, profile: ONWARD });
  console.log(opps.notes.join(' '));
  console.log(contactAgent(db, { mspId: ONWARD.id }).notes.join(' '));

  const scored = getAccount(db, account.id)!;
  console.log(`\nPriority score: ${Math.round(scored.priorityScore)}/100`);
  if (scored.scores) {
    for (const c of scored.scores.priority.components) {
      console.log(`  ${c.label.padEnd(16)} ${String(Math.round(c.input * 100)).padStart(3)}%  ${c.why}`);
    }
  }

  const hyps = listHypotheses(db, { limit: 50 });
  console.log(`\nHypotheses: ${hyps.length}`);
  for (const h of hyps) {
    console.log(`  [${h.quality.padEnd(9)}] ${h.headline} — ${gbp(h.commercialValue.point)}`);
    if (h.rejectionReasons.length > 0) console.log(`              rejected: ${h.rejectionReasons.join(' | ')}`);
  }

  bar('D. WHAT THE OUTREACH ENGINE DOES');
  const contacts = listContacts(db, account.id);
  const workable = hyps.find((h) => h.quality === 'strong' || h.quality === 'workable') ?? hyps[0];
  if (!workable) {
    console.log('No hypothesis exists, so there is nothing to compose from.');
  } else {
    const result = compose(db, {
      account: scored, hypothesis: workable, contact: contacts[0] ?? null, profile: ONWARD,
    });
    if (result.composed) {
      console.log('COMPOSED:\n');
      console.log(result.message.body);
    } else {
      console.log(`REFUSED (${result.rule})`);
      console.log(`  ${result.reason}`);
    }
  }
  console.log(`\nMessages actually in the database: ${listOutreach(db, { limit: 20 }).length}`);
}

void main();
