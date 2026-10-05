/**
 * Project ROCK — the first demo company whose figures are real.
 *
 * These tests exist mostly to pin down the defects this company exposed. Every
 * one of them is a case of the platform asserting something it had not
 * observed, which is the failure mode the directive is built to prevent, and
 * none of them was visible against the synthetic fixtures because those
 * companies all have websites and none of them is an MSP.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harness, type Harness } from './helpers';
import { loadProjectRock } from '@/lib/fixtures/demo-loader';
import { ROCK, ROCK_FINANCIAL_FACTS, ROCK_HISTORY, rockFindings } from '@/lib/fixtures/project-rock';
import { buildContext } from '@/lib/analysis/context';
import { mspExpandOpportunities } from '@/lib/analysis/engines/msp-expand';
import { getFacts } from '@/lib/db/repositories/facts';
import { valueOf } from '@/lib/core/provenance';
import { buildIcpContext, scoreAccount } from '@/lib/gtm/icp';
import { understandingScore } from '@/lib/core/company-twin';
import { ONWARD } from '@/config/msp/onward';
import { listCustomers } from '@/lib/db/repositories/tenant-data';

describe('Project ROCK figures', () => {
  it('reproduces the teaser exactly', () => {
    const latest = ROCK_HISTORY[ROCK_HISTORY.length - 1]!;
    expect(latest.revenue).toBe(833_000);
    expect(latest.ebitda).toBe(211_000);
    expect(ROCK.customers).toBe(43);
    expect(ROCK.devices).toBe(693);
    expect(ROCK.employees).toBe(5);
  });

  it('derives the customer value from the counted base rather than a ratio', () => {
    expect(ROCK_FINANCIAL_FACTS.customerCount).toBe(43);
    expect(ROCK_FINANCIAL_FACTS.averageCustomerValue).toBe(Math.round(833_000 / 43));
  });

  it('leaves supplier spend empty rather than inventing a breakdown', () => {
    // The teaser gives cost of sales only in aggregate. Splitting £573k into
    // named suppliers would be invention dressed as diligence.
    expect(ROCK_FINANCIAL_FACTS.supplierSpend).toEqual([]);
    expect(ROCK_FINANCIAL_FACTS.softwareSubscriptions).toEqual([]);
  });

  it('surfaces the margin erosion the teaser narrative does not mention', () => {
    const margin = rockFindings().find((f) => f.id === 'gross-margin-erosion')!;
    expect(margin.direction).toBe('risk');
    // 37.2% → 31.2% on £833k is about £50k of gross profit that did not arrive.
    expect(margin.valueGbp).toBeGreaterThan(45_000);
    expect(margin.valueGbp).toBeLessThan(55_000);
    expect(margin.workings).toContain('£297,000');
  });

  it('shows its arithmetic for every finding', () => {
    for (const f of rockFindings()) {
      expect(f.workings.length).toBeGreaterThan(30);
      expect(f.soWhat.length).toBeGreaterThan(40);
    }
  });

  it('does not report the recurring base as a risk or the margin fall as a strength', () => {
    const byId = new Map(rockFindings().map((f) => [f.id, f]));
    expect(byId.get('recurring-base')!.direction).toBe('strength');
    expect(byId.get('gross-margin-erosion')!.direction).toBe('risk');
  });
});

describe('loading Project ROCK', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('runs the real pipeline and attaches the counted financials', async () => {
    const loaded = await loadProjectRock(h.db);
    const facts = getFacts(h.db, loaded.companyId);
    expect(facts.financial?.turnover).toBe(833_000);
    expect(facts.financial?.customerCount).toBe(43);
  });

  it('cites the teaser rather than a generic "supplied by user"', async () => {
    const loaded = await loadProjectRock(h.db);
    const source = loaded.analysis.twin.turnoverEstimate.current?.sources[0];
    expect(source?.label).toContain('acquisition teaser');
    expect(loaded.analysis.twin.turnoverEstimate.current?.confidence).toBe(0.95);
  });

  it('invents no domain for an anonymised company', async () => {
    await loadProjectRock(h.db);
    const customer = listCustomers(h.db).find((c) => c.name === ROCK.name)!;
    expect(customer.domain).toBeNull();
  });

  it('does not create a second Project ROCK when loaded twice', async () => {
    await loadProjectRock(h.db);
    await loadProjectRock(h.db);
    expect(listCustomers(h.db).filter((c) => c.name === ROCK.name)).toHaveLength(1);
  });

  it('counts the customer base rather than estimating it from turnover', async () => {
    const loaded = await loadProjectRock(h.db);
    const dormancy = loaded.analysis.opportunities.find((o) => o.title.includes('Dormant'));
    // 43 is the counted figure. Deriving it from turnover gives 50.
    expect(dormancy?.summary).toContain('43');
    expect(dormancy?.summary).not.toContain(' 50 ');
  });
});

describe('what the engines must not assert', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('does not try to sell managed IT services to a managed services provider', async () => {
    const loaded = await loadProjectRock(h.db);
    const expand = loaded.analysis.opportunities.filter((o) => o.category === 'MSP_EXPAND');
    expect(expand).toEqual([]);

    const ctx = buildContext(loaded.analysis.twin, getFacts(h.db, loaded.companyId));
    expect(ctx.isItselfAnMsp).toBe(true);
    expect(mspExpandOpportunities(ctx)).toEqual([]);
  });

  it('does not call the proposition thin when it never read a website', async () => {
    const loaded = await loadProjectRock(h.db);
    const ctx = buildContext(loaded.analysis.twin, getFacts(h.db, loaded.companyId));
    expect(ctx.hasWebsiteData).toBe(false);
    expect(loaded.analysis.opportunities.find((o) => o.title.includes('proposition'))).toBeUndefined();
  });

  it('does not report missing security certification it never looked for', async () => {
    const loaded = await loadProjectRock(h.db);
    const text = loaded.analysis.opportunities.map((o) => `${o.title} ${o.summary} ${o.problem}`).join(' ');
    expect(text).not.toContain('Cyber Essentials');
    expect(text).not.toContain('found on the public website');
  });

  it('sizes the outbound motion to the people who would run it', async () => {
    const loaded = await loadProjectRock(h.db);
    const pipeline = loaded.analysis.opportunities.find((o) => o.title.includes('outbound pipeline'));
    expect(pipeline).toBeDefined();
    // Ten qualified meetings a month from a five-person service desk is not a
    // forecast, it is a different company.
    expect(pipeline!.summary).toContain('2 qualified meeting');
    expect(pipeline!.summary).toContain('no dedicated sales capacity');
    // And the whole thing must stay a sane share of an £833k business.
    expect(pipeline!.estimatedAnnualValue).toBeLessThan(833_000 * 0.1);
  });

  it('never states a modelled dormant count as an observation', async () => {
    const loaded = await loadProjectRock(h.db);
    const dormancy = loaded.analysis.opportunities.find((o) => o.title.includes('Dormant'))!;
    expect(dormancy.summary).toContain('If this base behaves like a typical one');
    expect(dormancy.summary).toContain('industry average');
  });
});

describe('who a company sells to is not who it is', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('does not match the public sector archetype on a supplier to the public sector', async () => {
    const loaded = await loadProjectRock(h.db);
    const twin = loaded.analysis.twin;
    const ctx = buildIcpContext(twin, ONWARD, understandingScore(twin));

    // ROCK's own customers include charity & public sector. ROCK is not a
    // public body, and a G-Cloud framework route does not reach it.
    expect(ctx.customerHaystack).toContain('public sector');
    expect(ctx.haystack).not.toContain('charity');

    const scores = scoreAccount(ctx, 0);
    const publicSector = scores.matches.find((m) => m.archetype === 'public-sector');
    expect(publicSector?.fit ?? 0).toBeLessThan(0.45);
  });

  it('reads the sale process rather than reporting no timing signal', async () => {
    const loaded = await loadProjectRock(h.db);
    const twin = loaded.analysis.twin;
    const scores = scoreAccount(buildIcpContext(twin, ONWARD, understandingScore(twin)), 0);

    // Having read that the company is being sold and then saying nothing is
    // happening would be the worst of both.
    expect(scores.timing.summary).toContain('share sale');
    expect(scores.timing.summary).not.toContain('No strong timing signal');
    expect(scores.timing.summary).toContain('corporate development conversation');
  });

  it('does not pitch services to a company that is being sold', async () => {
    const loaded = await loadProjectRock(h.db);
    const twin = loaded.analysis.twin;
    const scores = scoreAccount(buildIcpContext(twin, ONWARD, understandingScore(twin)), 0);

    // Buy-side and sell-side wear the same keywords and are opposite
    // situations. A company that acquired something wants delivery help; one
    // that is being sold wants a buyer.
    const ma = scores.matches.find((m) => m.archetype === 'ma-change-event');
    expect(ma?.fit ?? 0).toBeLessThan(0.45);
    expect(scores.timing.value).toBeLessThan(0.3);
  });

  it('matches the white-label delivery archetype instead, which is the real fit', async () => {
    const loaded = await loadProjectRock(h.db);
    const twin = loaded.analysis.twin;
    const scores = scoreAccount(buildIcpContext(twin, ONWARD, understandingScore(twin)), 0);
    expect(scores.primary?.archetype).toBe('ps-augmentation');
  });

  it('keeps customer segments on the twin — they are real, just not identity', async () => {
    const loaded = await loadProjectRock(h.db);
    const segments = valueOf(loaded.analysis.twin.customerSegments) as string[];
    expect(segments).toContain('Charity & public sector');
    expect(segments).toHaveLength(6);
  });
});
