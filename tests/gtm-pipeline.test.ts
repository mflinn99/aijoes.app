/**
 * Phase 10 — the pipeline autopilot, and Phase 11 — commercial objectives.
 *
 * The claim being tested is the directive's: "No qualified opportunity should
 * become dormant simply because a human forgot it." So the tests drive the clock
 * forward and check that something actually happened to the deal — and, just as
 * importantly, that running the autopilot twice in a day does not chase twice.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harness, type Harness } from './helpers';
import { ONWARD } from '@/config/msp/onward';
import {
  upsertAccount, updateAccount, getAccount, upsertOpportunity, saveHypothesis,
  recordMeeting, listOpportunities, upsertContact, addSuppression,
} from '@/lib/gtm/store';
import { runAutopilot, evaluateRules, pipelineHealth, listPipelineActions, RULES } from '@/lib/gtm/pipeline';
import { LocalCrmAdapter } from '@/lib/gtm/crm/local';
import type { CrmTargets } from '@/lib/gtm/crm/sync';
import { measureObjectives, seedObjectives, setTarget, getTargets, OBJECTIVES } from '@/lib/gtm/objectives';
import { listDecisions, DEFAULT_POLICY } from '@/lib/gtm/governance';
import type { GtmAccount, GtmOpportunity, OpportunityHypothesis, PipelineStage } from '@/lib/gtm/types';

const MSP = 'onward';
const DAY = 86_400_000;

function targets(h: Harness): CrmTargets {
  return { local: new LocalCrmAdapter(h.db), external: null };
}

function seedAccount(h: Harness, name: string, domain: string): GtmAccount {
  const a = upsertAccount(h.db, { mspId: MSP, name, domain, source: 'test' });
  updateAccount(h.db, a.id, { status: 'opportunity', researchState: 'researched' });
  return getAccount(h.db, a.id)!;
}

function seedHypothesis(h: Harness, account: GtmAccount, overrides: Partial<OpportunityHypothesis> = {}): OpportunityHypothesis {
  const now = new Date().toISOString();
  const hypothesis: OpportunityHypothesis = {
    id: `hyp-${account.id}`,
    accountId: account.id,
    archetype: 'managed-it',
    serviceIds: ['managed-it'],
    headline: 'Managed IT — no internal team',
    whatIsHappening: 'Headcount grew 40% with no IT hire.',
    whyItMatters: 'Support load grows with headcount whether or not anyone owns it.',
    whatProblemMayExist: 'No one owns IT support.',
    evidence: [
      { statement: 'Companies House filing shows employee count up from 40 to 56', source: 'companies-house', confidence: 0.85 },
      { statement: 'No IT roles on the careers page', source: 'website', confidence: 0.6 },
    ],
    whatOnwardCouldDo: 'Managed IT',
    whatAigogoAdds: null,
    whoOwnsTheProblem: ['Managing Director', 'Finance Director'],
    whyContactNow: 'The growth is recent.',
    commercialValue: { low: 20_000, high: 60_000, point: 36_000, basis: 'headcount × seat price', recurring: true },
    whatToSay: 'Who picks it up when something breaks?',
    nextAction: 'First approach',
    confidence: 0.7,
    quality: 'workable',
    status: 'approved',
    rejectionReasons: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  saveHypothesis(h.db, hypothesis);
  return hypothesis;
}

function seedOpportunity(
  h: Harness, account: GtmAccount, hypothesis: OpportunityHypothesis,
  overrides: Partial<GtmOpportunity> = {},
): GtmOpportunity {
  const now = new Date().toISOString();
  return upsertOpportunity(h.db, {
    id: `opp-${account.id}`,
    accountId: account.id,
    hypothesisId: hypothesis.id,
    name: `${account.name} — ${hypothesis.headline}`,
    stage: 'qualified' as PipelineStage,
    valueGbp: 36_000,
    probability: 0,
    owner: 'mark',
    nextAction: 'Scope the work',
    nextActionAt: new Date(Date.now() + 3 * DAY).toISOString(),
    lastActionAt: now,
    closeDate: null,
    source: 'test',
    crmId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('autopilot rules', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('sets a concrete next action when an opportunity has none', async () => {
    const account = seedAccount(h, 'Harlow Foods', 'harlowfoods.co.uk');
    const hyp = seedHypothesis(h, account);
    seedOpportunity(h, account, hyp, { nextAction: null, nextActionAt: null });

    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });

    expect(report.fired.some((f) => f.rule === 'no-next-action')).toBe(true);
    const opp = listOpportunities(h.db, { open: true })[0]!;
    expect(opp.nextAction).toContain('Harlow Foods');
    expect(opp.nextActionAt).not.toBeNull();
  });

  it('moves a ninety-day silence to stalled so the forecast stops counting it', async () => {
    const account = seedAccount(h, 'Northbank Legal', 'northbank.legal');
    const hyp = seedHypothesis(h, account);
    const stale = new Date(Date.now() - 120 * DAY).toISOString();
    seedOpportunity(h, account, hyp, { lastActionAt: stale, updatedAt: stale, nextAction: 'Chase' });

    const before = pipelineHealth(h.db).weightedGbp;
    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });

    expect(report.stagesChanged).toHaveLength(1);
    expect(report.stagesChanged[0]!.to).toBe('stalled');
    expect(pipelineHealth(h.db).weightedGbp).toBeLessThan(before);
  });

  it('does not chase the same opportunity twice in one day', async () => {
    const account = seedAccount(h, 'Harlow Foods', 'harlowfoods.co.uk');
    const hyp = seedHypothesis(h, account);
    seedOpportunity(h, account, hyp, { nextAction: null, nextActionAt: null });

    await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });
    const afterFirst = listPipelineActions(h.db).length;
    const second = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });

    expect(second.fired).toHaveLength(0);
    expect(listPipelineActions(h.db)).toHaveLength(afterFirst);
  });

  it('re-dates a close date that has already passed and says a human must confirm it', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const hyp = seedHypothesis(h, account);
    seedOpportunity(h, account, hyp, { closeDate: new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10) });

    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });
    const action = report.fired.find((f) => f.rule === 'close-date-passed');
    expect(action).toBeDefined();
    expect(action!.requiresHuman).toBe(true);
    expect(action!.detail).toContain('cannot know the real date');
  });

  it('raises a dated CRM task for a meeting whose outcome was never recorded', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const hyp = seedHypothesis(h, account);
    const opp = seedOpportunity(h, account, hyp, { stage: 'meeting-booked' });
    recordMeeting(h.db, {
      accountId: account.id, opportunityId: opp.id, contactId: null,
      scheduledFor: new Date(Date.now() - 2 * DAY).toISOString(), status: 'booked', notes: null,
    });

    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });
    expect(report.tasksRaised).toBeGreaterThan(0);
    expect(report.fired.some((f) => f.rule === 'meeting-booked-not-held' && f.requiresHuman)).toBe(true);
  });

  it('never touches a won or lost deal', () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const hyp = seedHypothesis(h, account);
    const stale = new Date(Date.now() - 400 * DAY).toISOString();
    const won = seedOpportunity(h, account, hyp, { stage: 'won', lastActionAt: stale, updatedAt: stale });
    expect(evaluateRules(h.db, won, DEFAULT_POLICY, new Date())).toEqual([]);
    expect(evaluateRules(h.db, { ...won, stage: 'lost' }, DEFAULT_POLICY, new Date())).toEqual([]);
  });

  it('will not fabricate a follow-up to an account on the suppression list', async () => {
    const account = seedAccount(h, 'Do Not Contact Ltd', 'dnc.co.uk');
    addSuppression(h.db, 'domain', 'dnc.co.uk', 'Opted out', 'mark');
    const hyp = seedHypothesis(h, account);
    upsertContact(h.db, {
      accountId: account.id, name: 'A Person', role: 'IT Director', email: 'a@dnc.co.uk',
      linkedin: null, source: 'test', confidence: 0.8, consentBasis: 'legitimate-interest', suppressed: false,
    });
    const stale = new Date(Date.now() - 20 * DAY).toISOString();
    seedOpportunity(h, account, hyp, { stage: 'contacted', lastActionAt: stale, updatedAt: stale });

    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });
    expect(report.followUpsComposed).toBe(0);
    expect(report.followUpsRefused.some((r) => r.rule.includes('suppressed'))).toBe(true);
  });

  it('respects the follow-up cap instead of mailing the whole pipeline at once', async () => {
    const stale = new Date(Date.now() - 20 * DAY).toISOString();
    for (let i = 0; i < 5; i++) {
      const account = seedAccount(h, `Company ${i}`, `company-${i}.co.uk`);
      const hyp = seedHypothesis(h, account);
      upsertContact(h.db, {
        accountId: account.id, name: `Person ${i}`, role: 'Managing Director', email: `p${i}@company-${i}.co.uk`,
        linkedin: null, source: 'test', confidence: 0.8, consentBasis: 'legitimate-interest', suppressed: false,
      });
      seedOpportunity(h, account, hyp, { stage: 'contacted', lastActionAt: stale, updatedAt: stale });
    }

    const report = await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h), maxFollowUps: 2 });
    expect(report.followUpsComposed).toBeLessThanOrEqual(2);
    expect(report.blocked.join(' ')).toContain('Follow-up cap');
  });

  it('escalates a high-value opportunity once, not on every run', async () => {
    const account = seedAccount(h, 'Big Co', 'bigco.co.uk');
    const hyp = seedHypothesis(h, account, {
      commercialValue: { low: 100_000, high: 400_000, point: 250_000, basis: 'programme', recurring: false },
    });
    seedOpportunity(h, account, hyp, { valueGbp: 250_000 });

    await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });
    await runAutopilot(h.db, { mspId: MSP, profile: ONWARD, targets: targets(h) });

    const open = listDecisions(h.db, 'open').filter((d) => d.subjectId.startsWith('opp-'));
    expect(open).toHaveLength(1);
    // The escalation carries a recommendation, not raw data.
    expect(open[0]!.recommendation.length).toBeGreaterThan(0);
    expect(open[0]!.proposedAction.length).toBeGreaterThan(0);
    expect(open[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('every rule states what it does in language a salesperson can argue with', () => {
    for (const rule of RULES) {
      expect(rule.description.length).toBeGreaterThan(20);
      expect(rule.stages.length).toBeGreaterThan(0);
    }
  });
});

describe('pipeline health', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('surfaces deals nobody has touched for a month, largest first', () => {
    const stale = new Date(Date.now() - 45 * DAY).toISOString();
    const small = seedAccount(h, 'Small Co', 'small.co.uk');
    const big = seedAccount(h, 'Big Co', 'big.co.uk');
    seedOpportunity(h, small, seedHypothesis(h, small), { valueGbp: 10_000, lastActionAt: stale, updatedAt: stale });
    seedOpportunity(h, big, seedHypothesis(h, big), { valueGbp: 200_000, lastActionAt: stale, updatedAt: stale });

    const health = pipelineHealth(h.db);
    expect(health.atRisk).toHaveLength(2);
    expect(health.atRisk[0]!.name).toContain('Big Co');
    expect(health.atRisk[0]!.idleDays).toBeGreaterThanOrEqual(45);
  });
});

describe('commercial objectives', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('seeds the directive targets and lets them be changed', () => {
    seedObjectives(h.db, MSP);
    expect(getTargets(h.db, MSP)['accounts-researched']).toBe(250);

    setTarget(h.db, MSP, 'accounts-researched', 100);
    expect(getTargets(h.db, MSP)['accounts-researched']).toBe(100);

    // Re-seeding must not undo a deliberate change.
    seedObjectives(h.db, MSP);
    expect(getTargets(h.db, MSP)['accounts-researched']).toBe(100);
  });

  it('counts progress from the pipeline tables, not from a tally of its own', () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const hyp = seedHypothesis(h, account);
    seedOpportunity(h, account, hyp, { stage: 'qualified', valueGbp: 36_000 });
    recordMeeting(h.db, {
      accountId: account.id, opportunityId: null, contactId: null,
      scheduledFor: new Date().toISOString(), status: 'booked', notes: null,
    });

    const report = measureObjectives(h.db, MSP);
    const by = new Map(report.progress.map((p) => [p.key, p]));
    expect(by.get('accounts-researched')!.actual).toBe(1);
    expect(by.get('hypotheses-evidence-backed')!.actual).toBe(1);
    expect(by.get('opportunities-qualified')!.actual).toBe(1);
    expect(by.get('meetings-booked')!.actual).toBe(1);
    expect(by.get('weighted-pipeline-gbp')!.actual).toBe(Math.round(36_000 * 0.35));
  });

  it('does not count synthetic accounts towards a commercial target', () => {
    const synth = upsertAccount(h.db, { mspId: MSP, name: 'Synthetic 001', domain: 'synth-001.example', source: 'synthetic', synthetic: true });
    updateAccount(h.db, synth.id, { researchState: 'researched' });

    const report = measureObjectives(h.db, MSP);
    expect(report.progress.find((p) => p.key === 'accounts-researched')!.actual).toBe(0);
    expect(measureObjectives(h.db, MSP, { excludeSynthetic: false }).progress.find((p) => p.key === 'accounts-researched')!.actual).toBe(1);
  });

  it('names the objective furthest from target rather than an average', () => {
    seedObjectives(h.db, MSP);
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    seedHypothesis(h, account);
    const report = measureObjectives(h.db, MSP);
    expect(report.allMet).toBe(false);
    expect(report.worst).not.toBeNull();
  });

  it('states exactly what each objective counts so a disputed number can be settled', () => {
    for (const def of OBJECTIVES) {
      expect(def.countedAs.length).toBeGreaterThan(30);
    }
  });
});
