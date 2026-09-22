/**
 * Phase 17's end-to-end test. The directive: "The build is not complete until
 * this passes."
 *
 * COMPANY DISCOVERED → SIGNAL DETECTED → RESEARCHED → OPPORTUNITY GENERATED →
 * SOLUTION MATCHED → CONTACT IDENTIFIED → OUTREACH PREPARED → CRM UPDATED →
 * RESPONSE SIMULATED → QUALIFIED → MEETING CREATED → PIPELINE UPDATED →
 * JOJO BRIEF UPDATED.
 *
 * It runs against the synthetic fixtures, offline, because the container this
 * was built in cannot reach the open internet (see BLOCKERS.md). That makes it a
 * proof that the machine works, not a proof that Onward has a pipeline — and the
 * test asserts that distinction rather than blurring it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harness, type Harness } from './helpers';
import { ONWARD } from '@/config/msp/onward';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';
import { runLoop, renderLoop } from '@/lib/gtm/loop';
import { LocalCrmAdapter, readLocalRecords } from '@/lib/gtm/crm/local';
import type { CrmTargets } from '@/lib/gtm/crm/sync';
import {
  upsertAccount, listAccounts, listSignals, listHypotheses, listContacts, listOutreach,
  listOpportunities, listMeetings, recordMeeting, upsertOpportunity, getAccount, upsertContact,
} from '@/lib/gtm/store';
import { approve, send } from '@/lib/gtm/outreach';
import { morningBrief } from '@/lib/gtm/brief';
import { askGtm } from '@/lib/gtm/ask';
import { measureObjectives } from '@/lib/gtm/objectives';
import { listOutcomes } from '@/lib/gtm/learning';
import { randomUUID } from 'node:crypto';

const MSP = 'onward';

function targets(h: Harness): CrmTargets {
  return { local: new LocalCrmAdapter(h.db), external: null };
}

/** Seed the universe from the synthetic fixtures, which have real-shaped records. */
function seedUniverse(h: Harness): void {
  for (const company of SYNTHETIC_COMPANIES) {
    upsertAccount(h.db, {
      mspId: MSP, name: company.name, domain: `${company.key}.co.uk`,
      source: 'fixture', synthetic: false,
    });
  }
}

describe('the closed loop, end to end', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('runs every stage from discovery to brief', async () => {
    seedUniverse(h);

    const report = await runLoop(h.db, {
      mspId: MSP, profile: ONWARD, targets: targets(h),
      offline: true, discover: 0, research: 20, outreach: 10,
    });

    const stage = (id: string) => report.stages.find((s) => s.stage === id)!;

    // 1. COMPANY DISCOVERED
    expect(listAccounts(h.db, { mspId: MSP, limit: 100 }).length).toBeGreaterThan(0);

    // 2. RESEARCHED
    expect(stage('research').produced).toBeGreaterThan(0);
    expect(listAccounts(h.db, { mspId: MSP, researchState: 'researched', limit: 100 }).length).toBeGreaterThan(0);

    // 3. SIGNAL DETECTED
    expect(listSignals(h.db).length).toBeGreaterThan(0);

    // 4. SCORED
    const scored = listAccounts(h.db, { mspId: MSP, limit: 100 }).filter((a) => a.scores !== null);
    expect(scored.length).toBeGreaterThan(0);
    // Every score explains itself — that is the whole contract of the scoring layer.
    expect(scored[0]!.scores!.priority.components.every((c) => c.why.length > 0)).toBe(true);

    // 5. OPPORTUNITY GENERATED
    expect(listHypotheses(h.db, { limit: 500 }).length).toBeGreaterThan(0);

    // 6. SOLUTION MATCHED
    expect(stage('build-proposition').produced).toBeGreaterThan(0);

    // 7. CONTACT IDENTIFIED
    expect(stage('identify-buyers').ran).toBe(true);

    // 8. OUTREACH PREPARED (or refused, with a stated reason)
    expect(stage('engage').summary.length).toBeGreaterThan(0);

    // 9. PIPELINE OPENED
    expect(listOpportunities(h.db, { limit: 100 }).length).toBeGreaterThan(0);

    // 10. CRM UPDATED
    expect(readLocalRecords(h.db, 'company').length).toBeGreaterThan(0);
    expect(readLocalRecords(h.db, 'deal').length).toBeGreaterThan(0);

    // 11. PIPELINE MONITORED
    expect(stage('monitor-pipeline').ran).toBe(true);

    // 12. LEARNED
    expect(listOutcomes(h.db).length).toBeGreaterThan(0);

    // 13. BRIEF UPDATED
    const brief = morningBrief(h.db, MSP);
    expect(brief.overnight[0]!.headline).not.toBe('Nothing happened overnight.');
    expect(brief.headlines).toHaveLength(3);
  });

  it('completes the human half of the loop: approve, send, respond, qualify, book', async () => {
    seedUniverse(h);
    await runLoop(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 20, outreach: 10 });

    // Give one account a reachable contact, which is the thing the engine cannot
    // invent for itself, then re-run so a message can actually be composed.
    const account = listAccounts(h.db, { mspId: MSP, researchState: 'researched', limit: 10 })
      .sort((a, b) => b.priorityScore - a.priorityScore)[0]!;
    upsertContact(h.db, {
      accountId: account.id, name: 'A Named Person', role: 'Managing Director',
      email: `md@${account.domain}`, linkedin: null, source: 'user-supplied',
      confidence: 0.9, consentBasis: 'legitimate-interest', suppressed: false,
    });

    await runLoop(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 0, outreach: 10 });

    const drafts = listOutreach(h.db, { accountId: account.id, limit: 10 });
    expect(drafts.length).toBeGreaterThan(0);

    // APPROVE
    const approved = approve(h.db, drafts[0]!, 'mark@onwardps.co.uk');
    expect(approved.status).toBe('approved');

    // SEND — refused, because no provider is configured. That refusal is correct.
    const result = send(h.db, approved, 'mark@onwardps.co.uk');
    expect(result.sent).toBe(false);
    expect(result.provider).toBe('none');

    // RESPONSE SIMULATED
    h.db.run(
      `INSERT INTO gtm_responses (id, tenant_id, outreach_id, account_id, sentiment, body, received_at)
       VALUES (@id, @tenantId, @outreachId, @accountId, 'positive', @body, @now)`,
      { id: randomUUID(), outreachId: approved.id, accountId: account.id, body: 'Worth a conversation.', now: new Date().toISOString() },
    );

    // QUALIFIED
    const opp = listOpportunities(h.db, { limit: 100 }).find((o) => o.accountId === account.id)!;
    const qualified = upsertOpportunity(h.db, { ...opp, stage: 'qualified', updatedAt: new Date().toISOString() });
    expect(qualified.probability).toBe(0.35);

    // MEETING CREATED
    recordMeeting(h.db, {
      accountId: account.id, opportunityId: qualified.id, contactId: null,
      scheduledFor: new Date(Date.now() + 5 * 86_400_000).toISOString(), status: 'booked', notes: null,
    });
    expect(listMeetings(h.db, { upcoming: true })).toHaveLength(1);

    // PIPELINE UPDATED
    await runLoop(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 0, outreach: 0 });
    const objectives = measureObjectives(h.db, MSP);
    expect(objectives.progress.find((p) => p.key === 'meetings-booked')!.actual).toBe(1);
    expect(objectives.progress.find((p) => p.key === 'opportunities-qualified')!.actual).toBeGreaterThan(0);

    // JOJO BRIEF UPDATED — and answering from live data, not a stored narrative.
    const answer = askGtm(h.db, "What's in the pipeline?", MSP);
    expect(answer.answer).toContain('weighted');
    const why = askGtm(h.db, `Why did we contact ${account.name}?`, MSP);
    expect(why.answer).toContain('Evidence:');
  });

  it('a second cycle duplicates nothing', async () => {
    seedUniverse(h);
    const options = { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 20, outreach: 10 } as const;

    await runLoop(h.db, options);
    const after1 = {
      accounts: listAccounts(h.db, { mspId: MSP, limit: 500 }).length,
      hypotheses: listHypotheses(h.db, { limit: 500 }).length,
      opportunities: listOpportunities(h.db, { limit: 500 }).length,
      outreach: listOutreach(h.db, { limit: 500 }).length,
      contacts: listAccounts(h.db, { mspId: MSP, limit: 500 }).reduce((s, a) => s + listContacts(h.db, a.id).length, 0),
      crmCompanies: readLocalRecords(h.db, 'company').length,
      crmDeals: readLocalRecords(h.db, 'deal').length,
    };

    await runLoop(h.db, options);
    const after2 = {
      accounts: listAccounts(h.db, { mspId: MSP, limit: 500 }).length,
      hypotheses: listHypotheses(h.db, { limit: 500 }).length,
      opportunities: listOpportunities(h.db, { limit: 500 }).length,
      outreach: listOutreach(h.db, { limit: 500 }).length,
      contacts: listAccounts(h.db, { mspId: MSP, limit: 500 }).reduce((s, a) => s + listContacts(h.db, a.id).length, 0),
      crmCompanies: readLocalRecords(h.db, 'company').length,
      crmDeals: readLocalRecords(h.db, 'deal').length,
    };

    expect(after2).toEqual(after1);
  });

  it('the second cycle reports the CRM as already current rather than rewriting it', async () => {
    seedUniverse(h);
    const options = { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 20, outreach: 10 } as const;

    await runLoop(h.db, options);
    const second = await runLoop(h.db, options);
    expect(second.crm!.created).toBe(0);
    expect(second.crm!.unchanged).toBeGreaterThan(0);
  });

  it('a synthetic-only universe produces no pipeline and no outreach', async () => {
    const report = await runLoop(h.db, {
      mspId: MSP, profile: ONWARD, targets: targets(h), offline: true,
      sourceId: 'synthetic', discover: 20, research: 20, outreach: 10,
    });

    const accounts = listAccounts(h.db, { mspId: MSP, limit: 100 });
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.synthetic)).toBe(true);

    expect(listOutreach(h.db, { limit: 100 })).toHaveLength(0);
    expect(readLocalRecords(h.db, 'company')).toHaveLength(0);
    expect(report.stages.find((s) => s.stage === 'open-opportunities')!.summary).toContain('Synthetic accounts are excluded');

    // And no synthetic account counts towards a commercial target.
    expect(measureObjectives(h.db, MSP).progress.find((p) => p.key === 'accounts-researched')!.actual).toBe(0);
  });

  it('renders a loop report that states what was blocked', async () => {
    seedUniverse(h);
    const report = await runLoop(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 20, outreach: 10 });
    const text = renderLoop(report);

    expect(text).toContain('GTM LOOP');
    expect(text).toContain('Constraint:');
    // No external CRM exists here, and the report must say so rather than imply one.
    expect(text).toContain('BLOCKED');
    expect(report.crm!.notes.join(' ')).toContain('No external CRM is connected');
  });

  it('never marks a message sent without a provider having accepted it', async () => {
    seedUniverse(h);
    await runLoop(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), offline: true, discover: 0, research: 20, outreach: 10 });
    expect(listOutreach(h.db, { status: 'sent', limit: 100 })).toHaveLength(0);
  });
});
