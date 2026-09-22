/**
 * Analysis pipeline — Directive §2.
 *
 * The eleven stages are real units of work, not a progress animation: each one
 * records its own status, duration and what it actually found, so the user is
 * watching the analysis rather than a spinner. A stage that finds nothing says
 * so and the run continues (§23 — fail gracefully, never invent a business).
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { createEmptyTwin, understandingScore, type CompanyTwin, type TwinFieldKey } from '../core/company-twin';
import { addClaim, claim, type ProvenancedField } from '../core/provenance';
import { connectorsFor, recommendedConnections } from '../discovery/registry';
import { computeLicenceFacts } from '../discovery/microsoft365-connector';
import { computeFinancialFacts } from '../discovery/xero-connector';
import { computeCrmFacts } from '../discovery/hubspot-connector';
import { getFacts, putFacts } from '../db/repositories/facts';
import { scheduleRefresh } from './refresh';
import { normaliseDomain, looksLikeDomain } from '../discovery/http';
import type { CompanyIdentity, SourceRecord } from '../discovery/connector';
import { buildContext } from './context';
import { makeMoreOpportunities } from './engines/make-more';
import { spendLessOpportunities } from './engines/spend-less';
import { mspExpandOpportunities } from './engines/msp-expand';
import { buildSupplyChain } from './supply-chain';
import { saveTwin, saveOpportunities, saveSuppliers, saveSourceRecords, findTwinByDomain } from '../db/repositories/company';
import { audit, recordEvent } from '../observability/events';
import { createBenefit } from '../benefits/ledger';
import type { Opportunity } from '../core/opportunity';

export const STAGES = [
  { id: 'identify', name: 'Identifying company' },
  { id: 'profile', name: 'Building company profile' },
  { id: 'market', name: 'Analysing market' },
  { id: 'customers', name: 'Analysing customers and propositions' },
  { id: 'competitors', name: 'Analysing competitors' },
  { id: 'growth', name: 'Assessing sales and growth opportunities' },
  { id: 'supply-chain', name: 'Building supply-chain hypothesis' },
  { id: 'technology', name: 'Assessing technology estate' },
  { id: 'cost', name: 'Assessing cost optimisation' },
  { id: 'msp', name: 'Assessing MSP expansion opportunity' },
  { id: 'plan', name: 'Building prioritised opportunity plan' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface StageState {
  id: StageId;
  name: string;
  status: StageStatus;
  detail: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AnalysisRun {
  id: string;
  tenantId: string;
  companyId: string | null;
  input: string;
  status: 'running' | 'completed' | 'failed';
  stages: StageState[];
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

function initialStages(): StageState[] {
  return STAGES.map((s) => ({ id: s.id, name: s.name, status: 'pending', detail: '', startedAt: null, completedAt: null }));
}

export function createRun(db: TenantDb, input: string): AnalysisRun {
  const run: AnalysisRun = {
    id: randomUUID(),
    tenantId: db.ctx.tenantId,
    companyId: null,
    input,
    status: 'running',
    stages: initialStages(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  persistRun(db, run);
  return run;
}

function persistRun(db: TenantDb, run: AnalysisRun): void {
  db.run(
    `INSERT INTO analysis_runs (id, tenant_id, company_id, input, status, stages_json, started_at, completed_at, error)
     VALUES (@id, @tenantId, @companyId, @input, @status, @stagesJson, @startedAt, @completedAt, @error)
     ON CONFLICT(id) DO UPDATE SET company_id = @companyId, status = @status, stages_json = @stagesJson,
       completed_at = @completedAt, error = @error`,
    {
      id: run.id,
      companyId: run.companyId,
      input: run.input,
      status: run.status,
      stagesJson: JSON.stringify(run.stages),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
    },
  );
}

export function getRun(db: TenantDb, runId: string): AnalysisRun | null {
  const row = db.get<{ id: string; company_id: string | null; input: string; status: string; stages_json: string; started_at: string; completed_at: string | null; error: string | null }>(
    `SELECT * FROM analysis_runs WHERE tenant_id = @tenantId AND id = @id`,
    { id: runId },
  );
  if (!row) return null;
  return {
    id: row.id,
    tenantId: db.ctx.tenantId,
    companyId: row.company_id,
    input: row.input,
    status: row.status as AnalysisRun['status'],
    stages: JSON.parse(row.stages_json) as StageState[],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

export interface AnalysisResult {
  run: AnalysisRun;
  twin: CompanyTwin;
  understanding: number;
  opportunities: Opportunity[];
  recommendedConnections: { id: string; name: string; understandingUplift: number; unlocks: string }[];
}

export interface AnalyseOptions {
  customerId?: string | null;
  /** Skip network calls. Used by tests and by the synthetic company fixtures. */
  offline?: boolean;
  /** Pre-supplied records, used to analyse a synthetic company deterministically. */
  seedRecords?: SourceRecord[];
  /** Facts the user supplied directly, e.g. a known headcount. */
  userSupplied?: Partial<Record<TwinFieldKey, unknown>>;
  /** Continue an already-created run, so a caller can poll it while this works. */
  runId?: string;
}

export async function analyseCompany(
  db: TenantDb,
  input: string,
  options: AnalyseOptions = {},
): Promise<AnalysisResult> {
  const existingRun = options.runId ? getRun(db, options.runId) : null;
  const run = existingRun ?? createRun(db, input);
  const startedAt = Date.now();

  const mark = (id: StageId, status: StageStatus, detail: string) => {
    const stage = run.stages.find((s) => s.id === id);
    if (!stage) return;
    stage.status = status;
    stage.detail = detail;
    if (status === 'running') stage.startedAt = new Date().toISOString();
    else stage.completedAt = new Date().toISOString();
    persistRun(db, run);
  };

  try {
    // ---- Stage 1: identify -------------------------------------------------
    mark('identify', 'running', '');
    const domain = normaliseDomain(input);
    const identity: CompanyIdentity = {
      input,
      ...(domain ? { domain } : { name: input.trim() }),
    };

    const existing = domain ? findTwinByDomain(db, domain) : null;
    const twin = existing ?? createEmptyTwin(randomUUID(), db.ctx.tenantId);
    run.companyId = twin.id;

    mark(
      'identify',
      'done',
      looksLikeDomain(input)
        ? `Resolved to domain ${domain}.`
        : `Treated "${input.trim()}" as a company name. Providing the website URL would materially improve the analysis.`,
    );

    // ---- Stage 2: profile (run connectors) ---------------------------------
    mark('profile', 'running', '');
    const allRecords: SourceRecord[] = [...(options.seedRecords ?? [])];
    const contributingConnectors = new Set<string>(allRecords.map((r) => r.connectorId));

    const connectors = connectorsFor(db);

    if (!options.offline) {
      for (const connector of connectors) {
        const discovery = await connector.discover();
        if (discovery.status !== 'available') continue;
        try {
          const records = await connector.fetch(identity);
          if (records.length > 0) {
            allRecords.push(...records);
            contributingConnectors.add(connector.id);
          }
        } catch {
          /* a connector failure degrades understanding; it does not stop the run */
        }
      }
    }

    // Normalise every record into claims and fold them into the twin.
    for (const connector of connectors) {
      const mine = allRecords.filter((r) => r.connectorId === connector.id);
      if (mine.length === 0) continue;
      const normalised = await connector.normalise(mine);
      for (const n of normalised) {
        const field = twin[n.field] as ProvenancedField<unknown>;
        (twin as unknown as Record<string, unknown>)[n.field] = addClaim(field, n.claim);
      }
    }

    // User-supplied facts outrank inference but not registry data.
    for (const [key, value] of Object.entries(options.userSupplied ?? {})) {
      if (value === undefined || value === null) continue;
      const field = twin[key as TwinFieldKey] as ProvenancedField<unknown>;
      (twin as unknown as Record<string, unknown>)[key] = addClaim(
        field,
        claim(value, {
          connectorId: 'user',
          label: 'Supplied by user',
          method: 'user-supplied',
          confidence: 0.9,
        }),
      );
    }

    twin.dataSources = [...new Set([...twin.dataSources, ...contributingConnectors])];
    twin.lastUpdatedAt = new Date().toISOString();

    // The twin row must exist before source records can reference it.
    saveTwin(db, twin, options.customerId ?? null);
    if (allRecords.length > 0) saveSourceRecords(db, twin.id, allRecords);

    const understanding = understandingScore(twin);
    mark(
      'profile',
      allRecords.length > 0 ? 'done' : 'skipped',
      allRecords.length > 0
        ? `${allRecords.length} source record(s) from ${[...contributingConnectors].join(', ')}. Understanding ${understanding}%.`
        : 'No public information could be retrieved. Understanding stays low rather than being filled in with assumptions.',
    );

    // Counted figures from connected systems are stored separately from the
    // twin's claims, because an engine consumes the whole structure rather than
    // a single value with a confidence.
    const m365Users = allRecords.find((r) => r.locator === 'graph:/users');
    const m365Skus = allRecords.find((r) => r.locator === 'graph:/subscribedSkus');
    if (m365Users && m365Skus) {
      putFacts(
        db,
        twin.id,
        'licence',
        'microsoft-365',
        computeLicenceFacts(m365Users.payload as never, m365Skus.payload as never),
      );
    }

    const financialFacts = computeFinancialFacts(allRecords);
    if (financialFacts) putFacts(db, twin.id, 'financial', 'accounting', financialFacts);

    const crmFacts = computeCrmFacts(allRecords);
    if (crmFacts) putFacts(db, twin.id, 'crm', 'crm', crmFacts);

    // ---- Stages 3–5: market, customers, competitors ------------------------
    const ctx = buildContext(twin, getFacts(db, twin.id));

    mark('market', 'done', ctx.sectors.length > 0
      ? `Sectors identified: ${ctx.sectors.join(', ')}.`
      : 'No sector could be determined from available sources.');

    mark('customers', 'done', ctx.segments.length > 0
      ? `Customer segments: ${ctx.segments.join(', ')}.`
      : 'No customer segment signals found.');

    // Competitor discovery needs a market intelligence connector; it is declared
    // rather than faked (§29).
    mark('competitors', 'skipped', 'Competitor analysis requires a market intelligence connector. Not available in this environment — the Toleron capability is registered but mocked.');

    // ---- Stages 6–10: the three engines ------------------------------------
    mark('growth', 'running', '');
    const makeMore = makeMoreOpportunities(ctx);
    mark('growth', 'done', `${makeMore.length} revenue opportunities identified.`);

    mark('supply-chain', 'running', '');
    const suppliers = buildSupplyChain(ctx);
    saveSuppliers(db, twin.id, suppliers);
    mark('supply-chain', 'done', `${suppliers.length} supplier relationships modelled${ctx.hasFinancialData ? ' from connected spend data' : ' as benchmark hypotheses'}.`);

    mark('technology', 'done', ctx.technology.length > 0
      ? `${ctx.technology.length} technologies detected: ${ctx.technology.slice(0, 5).map((t) => t.name).join(', ')}.`
      : 'No technology indicators visible from public sources.');

    mark('cost', 'running', '');
    const spendLess = spendLessOpportunities(ctx);
    mark('cost', 'done', `${spendLess.length} cost opportunities identified${ctx.hasFinancialData ? '' : ' (benchmark-led hypotheses)'}.`);

    mark('msp', 'running', '');
    const mspExpand = mspExpandOpportunities(ctx);
    mark('msp', 'done', `${mspExpand.length} MSP expansion opportunities identified.`);

    // ---- Stage 11: prioritise and persist ----------------------------------
    mark('plan', 'running', '');
    const opportunities = [...makeMore, ...spendLess, ...mspExpand].sort((a, b) => b.score - a.score);

    saveTwin(db, twin, options.customerId ?? null);
    saveOpportunities(db, twin.id, opportunities);

    // Every opportunity enters the Benefits Ledger as THEORETICAL (§16).
    for (const o of opportunities) {
      createBenefit(db, {
        companyId: twin.id,
        opportunityId: o.id,
        type: o.category === 'MSP_EXPAND' ? 'ARR' : o.category === 'SPEND_LESS' ? 'SAVING' : 'REVENUE',
        stage: 'THEORETICAL',
        forecastValue: o.estimatedAnnualValue,
        realisedValue: 0,
        verifiedValue: 0,
        measurementPeriod: null,
        baseline: null,
        measurementMethod: o.financialModel.formula,
        evidence: o.evidence,
        confidence: o.confidence,
        attributedCapabilities: [],
      });
    }

    mark('plan', 'done', `${opportunities.length} opportunities ranked. Top: ${opportunities[0]?.title ?? 'none'}.`);

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    persistRun(db, run);

    // Directive §22: a twin that is never re-read decays quietly, and a stale
    // figure still renders at full confidence. Every analysed company goes on
    // an interval from here.
    if (!options.offline) scheduleRefresh(db, twin.id);

    recordEvent(db, {
      tenantId: db.ctx.tenantId,
      companyId: twin.id,
      objective: `Analyse ${input}`,
      capabilityId: 'toleron',
      executionId: null,
      status: 'succeeded',
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: Date.now() - startedAt,
      // Analysis cost is real compute, charged even with no LLM in the loop.
      costGbp: 0.08,
      inputTokens: 0,
      outputTokens: 0,
      benefitGbp: 0,
      failure: null,
      retryCount: 0,
      detail: { opportunities: opportunities.length, understanding: understandingScore(twin) },
    });

    audit(db, {
      actor: db.ctx.userId,
      actorKind: 'human',
      action: 'company.analysed',
      subjectType: 'company',
      subjectId: twin.id,
      detail: { input, opportunities: opportunities.length, understanding: understandingScore(twin) },
    });

    return {
      run,
      twin,
      understanding: understandingScore(twin),
      opportunities,
      recommendedConnections: recommendedConnections([...contributingConnectors])
        .slice(0, 5)
        .map((c) => ({ id: c.id, name: c.name, understandingUplift: c.understandingUplift, unlocks: c.unlocks })),
    };
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
    run.completedAt = new Date().toISOString();
    persistRun(db, run);
    throw err;
  }
}
