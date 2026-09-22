/**
 * Phases 12, 14 and 15 — recovery, the brief, and the learning loop.
 *
 * The directive's binding constraint on Phase 15 is "do not permit uncontrolled
 * model self-modification". The tests below are mostly about what the engine
 * refuses to do to itself.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harness, type Harness } from './helpers';
import {
  classify, decide, recordFailure, resolveFailures, listFailures, health, withRecovery, RECOVERY_RULES, ruleFor,
} from '@/lib/gtm/recovery';
import {
  activeStrategy, saveStrategy, activateStrategy, rollbackStrategy, listStrategies,
  recordOutcome, listOutcomes, analyse, propose, harvestOutcomes,
  MIN_OUTCOMES_TO_PROPOSE, MIN_OUTCOMES_PER_SEGMENT,
} from '@/lib/gtm/learning';
import { DEFAULT_PRIORITY_WEIGHTS } from '@/lib/gtm/icp';
import { morningBrief, renderBrief } from '@/lib/gtm/brief';
import { askGtm, classifyQuestion } from '@/lib/gtm/ask';
import { upsertAccount, updateAccount, saveHypothesis, upsertOpportunity, getAccount } from '@/lib/gtm/store';
import type { OpportunityHypothesis } from '@/lib/gtm/types';

const MSP = 'onward';

function seedHypothesis(h: Harness, accountId: string, id: string, overrides: Partial<OpportunityHypothesis> = {}): OpportunityHypothesis {
  const now = new Date().toISOString();
  const hypothesis: OpportunityHypothesis = {
    id, accountId, archetype: 'managed-it', serviceIds: ['managed-it'],
    headline: 'Managed IT', whatIsHappening: 'Growth', whyItMatters: 'Support load',
    whatProblemMayExist: 'No owner', evidence: [{ statement: 'Filing', source: 'companies-house', confidence: 0.8 }],
    whatOnwardCouldDo: 'Managed IT', whatAigogoAdds: null, whoOwnsTheProblem: ['Managing Director'],
    whyContactNow: 'Recent', commercialValue: { low: 10_000, high: 50_000, point: 30_000, basis: 'seats', recurring: true },
    whatToSay: 'Who fixes it?', nextAction: 'Approach', confidence: 0.7, quality: 'workable',
    status: 'approved', rejectionReasons: [], createdAt: now, updatedAt: now, ...overrides,
  };
  saveHypothesis(h.db, hypothesis);
  return hypothesis;
}

describe('failure classification', () => {
  it('maps the failures a GTM engine actually hits', () => {
    expect(classify(new Error('429 Too Many Requests'))).toBe('rate-limited');
    expect(classify(Object.assign(new Error('nope'), { status: 401 }))).toBe('auth-expired');
    expect(classify(new Error('EGRESS_BLOCKED by proxy'))).toBe('egress-blocked');
    expect(classify(Object.assign(new Error('no'), { status: 404 }))).toBe('not-found');
    expect(classify(new Error('ETIMEDOUT'))).toBe('timeout');
    expect(classify(new Error('quota exceeded for today'))).toBe('quota-exhausted');
    expect(classify(Object.assign(new Error('boom'), { status: 503 }))).toBe('source-unavailable');
  });

  it('calls an unrecognised failure unknown rather than guessing it is transient', () => {
    expect(classify(new Error('something nobody anticipated'))).toBe('unknown');
    // And unknown is the one kind that does not let the run continue.
    expect(ruleFor('unknown').continues).toBe(false);
  });

  it('escalates rather than retrying where retrying would mean guessing', () => {
    for (const kind of ['permission-denied', 'data-conflict'] as const) {
      expect(ruleFor(kind).action).toBe('escalate');
    }
    // Two sources disagreeing is exactly where an engine must not pick one.
    expect(ruleFor('data-conflict').rationale).toContain('guessing is worst');
  });

  it('does not retry a network policy block, because it is not transient', () => {
    expect(ruleFor('egress-blocked').action).toBe('degrade-and-continue');
    expect(decide('egress-blocked', 1).waitMs).toBe(0);
  });

  it('backs off further on each successive attempt and then gives up', () => {
    const first = decide('rate-limited', 1);
    const third = decide('rate-limited', 3);
    expect(third.waitMs).toBeGreaterThan(first.waitMs);
    expect(decide('rate-limited', 99).exhausted).toBe(true);
    expect(decide('rate-limited', 99).action).toBe('escalate');
  });

  it('every rule explains itself', () => {
    for (const rule of RECOVERY_RULES) expect(rule.rationale.length).toBeGreaterThan(30);
  });
});

describe('recovery in use', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('records every recovered failure, because silent recovery hides decay', async () => {
    recordFailure(h.db, { component: 'research', operation: 'fetch-site', subjectId: 'a1', error: new Error('ETIMEDOUT') });
    expect(listFailures(h.db)).toHaveLength(1);

    const audited = h.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = @tenantId AND action = 'gtm.failure.recovered'`, {},
    );
    expect(audited?.n).toBe(1);
  });

  it('counts repeated failures of the same operation and eventually escalates', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure(h.db, { component: 'research', operation: 'fetch-site', subjectId: 'a1', error: new Error('ETIMEDOUT') });
    }
    const last = listFailures(h.db)[0]!;
    expect(last.attempt).toBe(4);
    expect(last.action).toBe('escalate');
  });

  it('resets the counter once the operation succeeds', async () => {
    let fail = true;
    const result = await withRecovery(
      h.db,
      { component: 'research', operation: 'fetch-site', subjectId: 'a1', sleep: async () => {} },
      async () => {
        if (fail) { fail = false; throw new Error('ETIMEDOUT'); }
        return 'the page';
      },
    );
    expect(result.value).toBe('the page');
    expect(listFailures(h.db, { unresolvedOnly: true })).toHaveLength(0);
  });

  it('stops retrying a failure the rules say not to retry', async () => {
    let calls = 0;
    const result = await withRecovery(
      h.db,
      { component: 'crm', operation: 'write', sleep: async () => {} },
      async () => { calls++; throw Object.assign(new Error('forbidden'), { status: 403 }); },
    );
    expect(calls).toBe(1);
    expect(result.value).toBeNull();
    expect(result.decisions[0]!.action).toBe('escalate');
  });

  it('reports itself degraded when something needs a person', () => {
    recordFailure(h.db, { component: 'crm', operation: 'write', error: Object.assign(new Error('forbidden'), { status: 403 }) });
    const summary = health(h.db);
    expect(summary.needsHuman).toHaveLength(1);
    // A permission failure still lets the rest of the engine run.
    expect(summary.operational).toBe(true);

    recordFailure(h.db, { component: 'x', operation: 'y', error: new Error('a thing nobody classified') });
    expect(health(h.db).operational).toBe(false);
  });

  it('clears resolved failures out of the health summary', () => {
    recordFailure(h.db, { component: 'research', operation: 'fetch', error: new Error('ETIMEDOUT') });
    resolveFailures(h.db, 'research', 'fetch');
    expect(health(h.db).unresolved).toBe(0);
  });
});

describe('learning loop', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  function seedOutcomes(count: number, outcome: 'won' | 'no-response' = 'won', archetype = 'managed-it'): void {
    for (let i = 0; i < count; i++) {
      const account = upsertAccount(h.db, { mspId: MSP, name: `Co ${archetype} ${i}`, domain: `${archetype}-${i}.co.uk`, source: 'test' });
      const hyp = seedHypothesis(h, account.id, `hyp-${archetype}-${i}`, { archetype: archetype as OpportunityHypothesis['archetype'] });
      recordOutcome(h.db, { accountId: account.id, hypothesisId: hyp.id, outcome, valueGbp: 30_000 });
    }
  }

  it('starts from a stated judgement, not a pretended measurement', () => {
    const strategy = activeStrategy(h.db);
    expect(strategy.version).toBe('v1-baseline');
    expect(strategy.weights).toEqual(DEFAULT_PRIORITY_WEIGHTS);
    expect(strategy.note).toContain('judgement, not a measurement');
  });

  it('refuses to propose anything from a small sample, and says how small', () => {
    seedOutcomes(5);
    const report = analyse(h.db);
    expect(report.proposal).toBeNull();
    expect(report.withheldBecause).toContain(String(MIN_OUTCOMES_TO_PROPOSE));
    expect(propose(h.db)).toBeNull();
  });

  it('reports no conversion rate at all for a segment below the sample floor', () => {
    seedOutcomes(MIN_OUTCOMES_PER_SEGMENT - 1);
    const report = analyse(h.db);
    const segment = report.byArchetype[0]!;
    expect(segment.rate).toBeNull();
    expect(segment.verdict).toContain('more needed before this means anything');
  });

  it('gives a rate once the segment is large enough', () => {
    seedOutcomes(MIN_OUTCOMES_PER_SEGMENT + 2);
    const segment = analyse(h.db).byArchetype[0]!;
    expect(segment.rate).not.toBeNull();
    expect(segment.rate).toBeGreaterThan(0);
  });

  it('never activates a strategy it proposed to itself', () => {
    const proposed = saveStrategy(h.db, 'v2-test', { ...DEFAULT_PRIORITY_WEIGHTS, timing: 30 }, 'Proposed');
    expect(proposed.active).toBe(false);
    expect(activeStrategy(h.db).version).toBe('v1-baseline');
  });

  it('activates only against a named person, and records who', () => {
    saveStrategy(h.db, 'v2-test', { ...DEFAULT_PRIORITY_WEIGHTS, timing: 30 }, 'Proposed');
    activateStrategy(h.db, 'v2-test', 'mark@onwardps.co.uk', 'Timing is clearly the stronger signal');

    expect(activeStrategy(h.db).version).toBe('v2-test');
    const entry = h.db.get<{ actor: string; actor_kind: string }>(
      `SELECT actor, actor_kind FROM audit_log WHERE tenant_id = @tenantId AND action = 'gtm.strategy.activated'`, {},
    );
    expect(entry?.actor).toBe('mark@onwardps.co.uk');
    expect(entry?.actor_kind).toBe('human');
  });

  it('rolls back to any earlier version in one call', () => {
    saveStrategy(h.db, 'v2-test', { ...DEFAULT_PRIORITY_WEIGHTS, timing: 30 }, 'Proposed');
    saveStrategy(h.db, 'v1-baseline', DEFAULT_PRIORITY_WEIGHTS, 'The original');
    activateStrategy(h.db, 'v2-test', 'mark', 'trying it');

    rollbackStrategy(h.db, 'v1-baseline', 'mark', 'Response rate fell');
    expect(activeStrategy(h.db).version).toBe('v1-baseline');
    expect(listStrategies(h.db).filter((s) => s.active)).toHaveLength(1);

    const rolled = h.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = @tenantId AND action = 'gtm.strategy.rolledback'`, {},
    );
    expect(rolled?.n).toBe(1);
  });

  it('refuses to activate a version that does not exist', () => {
    expect(() => activateStrategy(h.db, 'v99-imaginary', 'mark', 'why not')).toThrow(/No strategy version/);
  });

  it('counts the same outcome once however often it is harvested', () => {
    const account = upsertAccount(h.db, { mspId: MSP, name: 'Crosby', domain: 'crosby.co.uk', source: 'test' });
    const hyp = seedHypothesis(h, account.id, 'hyp-1');
    const now = new Date().toISOString();
    upsertOpportunity(h.db, {
      id: 'opp-1', accountId: account.id, hypothesisId: hyp.id, name: 'Deal', stage: 'won',
      valueGbp: 30_000, probability: 0, owner: null, nextAction: null, nextActionAt: null,
      lastActionAt: now, closeDate: null, source: 'test', crmId: null, createdAt: now, updatedAt: now,
    });

    harvestOutcomes(h.db);
    harvestOutcomes(h.db);
    harvestOutcomes(h.db);
    expect(listOutcomes(h.db).filter((o) => o.outcome === 'won')).toHaveLength(1);
  });

  it('records which strategy version an outcome happened under', () => {
    saveStrategy(h.db, 'v2-test', DEFAULT_PRIORITY_WEIGHTS, 'x');
    activateStrategy(h.db, 'v2-test', 'mark', 'x');
    const account = upsertAccount(h.db, { mspId: MSP, name: 'Crosby', domain: 'crosby.co.uk', source: 'test' });
    recordOutcome(h.db, { accountId: account.id, outcome: 'won', valueGbp: 1000 });
    expect(listOutcomes(h.db)[0]!.strategyVersion).toBe('v2-test');
  });

  it('leaves the weighting alone when the data does not contradict it', () => {
    // Every positive outcome here came from the same website signal, so neither
    // adjustment condition is met and the honest answer is "change nothing".
    for (let i = 0; i < MIN_OUTCOMES_TO_PROPOSE + 5; i++) {
      const account = upsertAccount(h.db, { mspId: MSP, name: `Co ${i}`, domain: `co-${i}.co.uk`, source: 'test' });
      const hyp = seedHypothesis(h, account.id, `hyp-${i}`, {
        evidence: [{ statement: 'Careers page', source: 'website', confidence: 0.6 }],
        commercialValue: { low: 0, high: 0, point: 0, basis: 'none', recurring: false },
      });
      recordOutcome(h.db, { accountId: account.id, hypothesisId: hyp.id, outcome: 'won', valueGbp: 0 });
    }
    const report = analyse(h.db);
    expect(report.proposal).toBeNull();
    expect(report.withheldBecause).toContain('leaving it alone is the right answer');
  });
});

describe('morning brief', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('says plainly when nothing happened rather than padding', () => {
    const brief = morningBrief(h.db, MSP);
    expect(brief.overnight[0]!.headline).toBe('Nothing happened overnight.');
    expect(brief.overnight[0]!.detail).toContain('quiet night or a stopped engine');
  });

  it('holds itself to three headlines', () => {
    const brief = morningBrief(h.db, MSP);
    expect(brief.headlines).toHaveLength(3);
  });

  it('gives one recommendation, not five', () => {
    const account = upsertAccount(h.db, { mspId: MSP, name: 'Big Co', domain: 'bigco.co.uk', source: 'test' });
    updateAccount(h.db, account.id, { status: 'opportunity', researchState: 'researched' });
    const hyp = seedHypothesis(h, account.id, 'hyp-big');
    const stale = new Date(Date.now() - 60 * 86_400_000).toISOString();
    upsertOpportunity(h.db, {
      id: 'opp-big', accountId: account.id, hypothesisId: hyp.id, name: 'Big Co — AVD', stage: 'qualified',
      valueGbp: 120_000, probability: 0, owner: null, nextAction: null, nextActionAt: null,
      lastActionAt: stale, closeDate: null, source: 'test', crmId: null, createdAt: stale, updatedAt: stale,
    });

    const brief = morningBrief(h.db, MSP);
    expect(brief.oneThing).not.toBeNull();
    expect(brief.oneThing!.because.length).toBeGreaterThan(20);
  });

  it('every line names what it was derived from', () => {
    const account = upsertAccount(h.db, { mspId: MSP, name: 'Crosby', domain: 'crosby.co.uk', source: 'test' });
    updateAccount(h.db, account.id, { researchState: 'researched' });
    const brief = morningBrief(h.db, MSP);
    for (const item of [...brief.overnight, ...brief.needsYou]) {
      expect(item.basis.length).toBeGreaterThan(5);
    }
  });

  it('renders to plain text without losing the objectives', () => {
    const text = renderBrief(morningBrief(h.db, MSP));
    expect(text).toContain('MORNING BRIEF');
    expect(text).toContain('OBJECTIVES');
    expect(text).toContain('Weighted professional services pipeline');
  });
});

describe('ASK JOJO over GTM', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('routes the definition-of-done questions', () => {
    expect(classifyQuestion('What has the system found?').question).toBe('what-has-it-found');
    expect(classifyQuestion('Who should we approach this week?').question).toBe('who-should-we-approach');
    expect(classifyQuestion('What has been sent?').question).toBe('what-has-been-sent');
    expect(classifyQuestion('What came back?').question).toBe('what-came-back');
    expect(classifyQuestion("What's in the pipeline?").question).toBe('whats-in-the-pipeline');
    expect(classifyQuestion('What is the forecast?').question).toBe('whats-the-forecast');
    expect(classifyQuestion('What needs my decision?').question).toBe('what-needs-my-decision');
    expect(classifyQuestion('What is it blocked on?').question).toBe('whats-it-blocked-on');
    expect(classifyQuestion('Is it working?').question).toBe('is-it-working');
    expect(classifyQuestion('What did it do overnight?').question).toBe('what-did-it-do-overnight');
  });

  it('extracts the company from "why did we contact X"', () => {
    const { question, subject } = classifyQuestion('Why did we contact Crosby Group?');
    expect(question).toBe('why-this-company');
    expect(subject).toBe('Crosby Group');
  });

  it('answers "nothing yet" with the reason rather than an empty list', () => {
    const answer = askGtm(h.db, 'What has the system found?', MSP);
    expect(answer.answer).toContain('Nothing');
    expect(answer.basis).toContain('gtm_accounts');
  });

  it('gives the full evidence chain for a contacted company', () => {
    const account = upsertAccount(h.db, { mspId: MSP, name: 'Crosby Group', domain: 'crosbygroup.co.uk', source: 'test' });
    updateAccount(h.db, account.id, { researchState: 'researched' });
    seedHypothesis(h, account.id, 'hyp-crosby');

    const answer = askGtm(h.db, 'Why did we contact Crosby Group?', MSP);
    expect(answer.answer).toContain('Evidence:');
    expect(answer.answer).toContain('companies-house');
    expect(answer.answer).toContain('Nothing has been sent.');
  });

  it('says a company is not in the universe rather than inventing a reason', () => {
    const answer = askGtm(h.db, 'Why did we contact Imaginary Holdings?', MSP);
    expect(answer.answer).toContain('not in the target universe');
  });

  it('is honest that the engine is untested when nothing has been contacted', () => {
    const answer = askGtm(h.db, 'Is it working?', MSP);
    expect(answer.answer).toContain('has not yet been tested against reality');
  });

  it('lists what it can answer when the question is not one of them', () => {
    const answer = askGtm(h.db, 'What is the capital of France?', MSP);
    expect(answer.question).toBe('unknown');
    expect(answer.answer).toContain('I can answer');
  });
});
