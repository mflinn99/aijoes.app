/**
 * Directive §27 and §30: the complete loop, proven against all three synthetic
 * companies.
 *
 *   UNDERSTAND → FIND VALUE → START → EXECUTE → MEASURE → EXPAND
 *
 * "A static mock-up is not sufficient. A button that simply changes a database
 * status is not sufficient."
 */

import { describe, it, expect } from 'vitest';
import { harness, seedGrant, seedCustomer } from './helpers';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';
import { analyseCompany, STAGES } from '@/lib/analysis/pipeline';
import { getTwin, listOpportunities, listSuppliers, getOpportunity } from '@/lib/db/repositories/company';
import { listGrants } from '@/lib/db/repositories/tenant-data';
import { planExecution, authorisePlan, runExecution, approveTask } from '@/lib/execution/engine';
import { getBenefitByOpportunity, listBenefits, summariseLedger } from '@/lib/benefits/ledger';
import { nextBestActionAcrossEstate, askJojo, parseObjective } from '@/lib/jojo/orchestrator';
import { startAvailable } from '@/lib/core/opportunity';
import { AutonomyLevel } from '@/lib/core/autonomy';
import { understandingScore } from '@/lib/core/company-twin';
import { summariseSupplyChain } from '@/lib/analysis/supply-chain';

describe.each(SYNTHETIC_COMPANIES)('full loop: $name', (fixture) => {
  it('completes UNDERSTAND → FIND VALUE → START → EXECUTE → MEASURE → EXPAND', async () => {
    const h = harness(`tenant-${fixture.key}`);
    seedGrant(h, AutonomyLevel.RECOMMEND);
    seedCustomer(h, `cust-${fixture.key}`, fixture.name, fixture.domain, fixture.currentMrr);

    // 1–4. Company identified, twin built, understanding measured.
    const result = await analyseCompany(h.db, fixture.domain, {
      customerId: `cust-${fixture.key}`,
      offline: true,
      seedRecords: fixture.records,
      userSupplied: fixture.userSupplied,
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.stages).toHaveLength(STAGES.length);
    expect(result.run.stages.every((s) => s.status !== 'pending')).toBe(true);

    const twin = getTwin(h.db, result.twin.id)!;
    expect(twin).toBeTruthy();
    expect(understandingScore(twin)).toBeGreaterThan(20);
    expect(twin.dataSources).toContain('website');

    // 5–7. All three opportunity classes present.
    const opportunities = listOpportunities(h.db, twin.id);
    expect(opportunities.filter((o) => o.category === 'MAKE_MORE').length).toBeGreaterThan(0);
    expect(opportunities.filter((o) => o.category === 'SPEND_LESS').length).toBeGreaterThan(0);
    expect(opportunities.filter((o) => o.category === 'MSP_EXPAND').length).toBeGreaterThan(0);

    // Ranked by score, descending.
    const scores = opportunities.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // Supply chain graph built.
    const suppliers = listSuppliers(h.db, twin.id);
    expect(suppliers.length).toBeGreaterThan(0);
    expect(summariseSupplyChain(suppliers).totalSavingsPotential).toBeGreaterThan(0);

    // 8–10. An opportunity explains itself and carries a value.
    const opportunity = opportunities.find((o) => startAvailable(o).available)!;
    expect(opportunity).toBeTruthy();
    expect(opportunity.evidence.length).toBeGreaterThan(0);
    expect(opportunity.reasoningSummary.length).toBeGreaterThan(20);
    expect(opportunity.estimatedAnnualValue).toBeGreaterThan(0);

    // Benefit opens as theoretical.
    expect(getBenefitByOpportunity(h.db, opportunity.id)!.stage).toBe('THEORETICAL');

    // 11–12. START produces a genuine execution plan.
    const preview = planExecution(h.db, {
      opportunity,
      grants: listGrants(h.db),
      connectedIntegrations: ['website'],
      userId: h.ctx.userId,
    });
    expect(preview.plan.blockers).toEqual([]);
    expect(preview.plan.tasks.length).toBeGreaterThan(1);
    expect(preview.plan.status).toBe('AWAITING_AUTHORISATION');

    // 13. Authorisation by a named human.
    const authorised = authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'end-to-end test');
    expect(authorised.status).toBe('AUTHORISED');
    expect(authorised.authorisedBy).toBe(h.ctx.userId);
    expect(getBenefitByOpportunity(h.db, opportunity.id)!.stage).toBe('APPROVED');

    // 14–15. Tasks routed to capabilities, with status.
    let run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    expect(run.plan.tasks.some((t) => t.status === 'COMPLETED')).toBe(true);

    let guard = 0;
    while (run.awaitingApproval.length > 0 && guard++ < 20) {
      approveTask(h.db, preview.plan.id, run.awaitingApproval[0]!.id, h.ctx.userId, 'APPROVED', 'approved');
      run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    }

    // 16. An outcome is recorded.
    expect(run.plan.status).toBe('COMPLETED');
    expect(run.measuredValueGbp).toBeGreaterThan(0);
    const executed = getOpportunity(h.db, opportunity.id)!;
    expect(executed.executionStatus).toBe('COMPLETED');
    expect(executed.realisedValue).toBeGreaterThan(0);

    // 17. The Benefits Ledger updates.
    const benefit = getBenefitByOpportunity(h.db, opportunity.id)!;
    expect(benefit.stage).toBe('REALISED');
    expect(benefit.realisedValue).toBe(executed.realisedValue);
    expect(summariseLedger(listBenefits(h.db)).realised).toBeGreaterThan(0);

    // 18–19. The estate's next best action changes as a result.
    const next = nextBestActionAcrossEstate(h.db);
    expect(next).not.toBeNull();
    expect(next!.opportunity.id).not.toBe(opportunity.id);
  });
});

describe('JoJo orchestration', () => {
  it('parses the directive\'s own example objectives into measurable outcomes', () => {
    const savings = parseObjective('JoJo, find £100k of addressable annual savings across this company.');
    expect(savings.kind).toBe('find-savings');
    expect(savings.financialTarget).toBe(100_000);

    const expansion = parseObjective('JoJo, show me the top five MSP expansion opportunities across my customer estate.');
    expect(expansion.kind).toBe('msp-expansion');
    expect(expansion.limit).toBe(5);

    const start = parseObjective('JoJo, start the top three low-risk opportunities.');
    expect(start.kind).toBe('start-opportunities');
    expect(start.limit).toBe(3);
    expect(start.riskFilter).toBe('low');

    const pipeline = parseObjective(
      'JoJo, review the SaleSonic pipeline. If fewer than 10 qualified sales appointments are booked for the target period, create and execute an approved outreach plan to restore the target to 10.',
    );
    expect(pipeline.kind).toBe('pipeline-target');
    expect(pipeline.countTarget).toEqual({ value: 10, unit: 'appointments' });

    const analyse = parseObjective('JoJo, analyse Claritas Solutions and tell me the best ways to increase turnover and cut cost.');
    expect(analyse.kind).toBe('analyse-company');
    expect(analyse.companyHint).toBe('Claritas Solutions');
  });

  it('says so plainly when it cannot turn a request into an outcome', () => {
    const h = harness();
    const r = askJojo(h.db, 'hello there');
    expect(r.achievable).toBe(false);
    expect(r.answer).toMatch(/could not turn that into a measurable outcome/);
  });

  it('reports an honest shortfall rather than inflating to hit a target', async () => {
    const h = harness();
    const fixture = SYNTHETIC_COMPANIES[0]!;
    seedCustomer(h, 'c1', fixture.name, fixture.domain);
    const result = await analyseCompany(h.db, fixture.domain, {
      customerId: 'c1', offline: true, seedRecords: fixture.records, userSupplied: fixture.userSupplied,
    });

    const r = askJojo(h.db, 'find £50,000,000 of addressable annual savings', result.twin.id);
    expect(r.achievable).toBe(false);
    expect(r.shortfall).toBeGreaterThan(0);
    expect(r.answer).toMatch(/shortfall/);
  });

  it('selects real opportunities for an achievable target', async () => {
    const h = harness();
    const fixture = SYNTHETIC_COMPANIES[2]!;
    seedCustomer(h, 'c1', fixture.name, fixture.domain);
    const result = await analyseCompany(h.db, fixture.domain, {
      customerId: 'c1', offline: true, seedRecords: fixture.records, userSupplied: fixture.userSupplied,
    });

    const r = askJojo(h.db, 'find £20,000 of addressable annual savings', result.twin.id);
    expect(r.achievable).toBe(true);
    expect(r.selected.length).toBeGreaterThan(0);
    expect(r.selected.every((o) => o.category === 'SPEND_LESS')).toBe(true);
  });

  it('only offers to start what is genuinely startable', async () => {
    const h = harness();
    const fixture = SYNTHETIC_COMPANIES[1]!;
    seedCustomer(h, 'c1', fixture.name, fixture.domain);
    const result = await analyseCompany(h.db, fixture.domain, {
      customerId: 'c1', offline: true, seedRecords: fixture.records, userSupplied: fixture.userSupplied,
    });

    const r = askJojo(h.db, 'start the top three low-risk opportunities', result.twin.id);
    expect(r.selected.every((o) => startAvailable(o).available && o.risk === 'low')).toBe(true);
  });
});
