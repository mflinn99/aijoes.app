/**
 * Shared analysis context. Derives the handful of numbers every engine needs,
 * once, with provenance intact — so a turnover figure inferred from headcount is
 * labelled as such everywhere it is used, not just where it was derived.
 */

import type { CompanyTwin } from '../core/company-twin';
import { valueOf, confidenceOf } from '../core/provenance';
import type { TechnologyItem } from '../core/company-twin';
import { BENCHMARKS, sectorMultiplier } from './benchmarks';
import type { FinancialLine } from '../core/opportunity';
import type { ConnectedFacts } from '../db/repositories/facts';

export interface AnalysisContext {
  twin: CompanyTwin;
  employees: { value: number; confidence: number; basis: FinancialLine['basis']; note: string };
  turnover: { value: number; confidence: number; basis: FinancialLine['basis']; note: string };
  sectors: string[];
  segments: string[];
  technology: TechnologyItem[];
  /** Connectors that contributed at least one claim. */
  connectedSources: string[];
  /** True once a financial system is attached — promotes hypotheses (§8). */
  hasFinancialData: boolean;
  hasCrmData: boolean;
  hasLicenceData: boolean;
  itSpendEstimate: number;
  /**
   * Counted figures from connected systems. When these are present an engine
   * uses them in place of its benchmark, which is what turns a hypothesis into
   * an inferred fact without any rule needing to know about promotion.
   */
  facts: ConnectedFacts;
}

const FINANCIAL_CONNECTORS = ['accounting', 'banking', 'erp'];
const CRM_CONNECTORS = ['crm', 'psa'];
const LICENCE_CONNECTORS = ['microsoft-365', 'licence-portal'];

export function buildContext(twin: CompanyTwin, facts: ConnectedFacts = {}): AnalysisContext {
  const sectors = (valueOf(twin.sectors) as string[] | null) ?? [];
  const segments = (valueOf(twin.customerSegments) as string[] | null) ?? [];
  const technology = (valueOf(twin.technologyEstate) as TechnologyItem[] | null) ?? [];
  const connectedSources = twin.dataSources;
  const mult = sectorMultiplier(sectors);

  const observedEmployees = facts.licence?.enabledUsers ?? (valueOf(twin.employeesEstimate) as number | null);
  const observedTurnover = facts.financial?.turnover ?? (valueOf(twin.turnoverEstimate) as number | null);

  // Employees: observed, else inferred from turnover, else a stated default.
  let employees: AnalysisContext['employees'];
  if (observedEmployees && observedEmployees > 0) {
    employees = facts.licence
      ? {
          value: facts.licence.enabledUsers,
          confidence: 0.96,
          basis: 'connected',
          note: `Counted from the connected Microsoft 365 tenant: ${facts.licence.enabledUsers} enabled account(s).`,
        }
      : {
          value: observedEmployees,
          confidence: confidenceOf(twin.employeesEstimate),
          basis: 'observed',
          note: 'Headcount from company data.',
        };
  } else if (observedTurnover && observedTurnover > 0) {
    const perHead = BENCHMARKS.turnoverPerEmployee.value * mult.turnoverPerEmployee;
    employees = {
      value: Math.max(1, Math.round(observedTurnover / perHead)),
      confidence: 0.35,
      basis: 'benchmark',
      note: `Inferred from turnover at £${Math.round(perHead).toLocaleString('en-GB')} turnover per employee.`,
    };
  } else {
    employees = {
      value: 25,
      confidence: 0.15,
      basis: 'assumption',
      note: 'No headcount signal found. 25 employees assumed as a planning placeholder — connect HR, M365 or accounting to replace it.',
    };
  }

  // Turnover: observed, else inferred from headcount.
  let turnover: AnalysisContext['turnover'];
  if (observedTurnover && observedTurnover > 0) {
    turnover = facts.financial
      ? {
          value: facts.financial.turnover,
          confidence: 0.95,
          basis: 'connected',
          note: `Counted from connected accounting data for ${facts.financial.periodStart} to ${facts.financial.periodEnd}.`,
        }
      : {
          value: observedTurnover,
          confidence: confidenceOf(twin.turnoverEstimate),
          basis: 'observed',
          note: 'Turnover from company data or filings.',
        };
  } else {
    const perHead = BENCHMARKS.turnoverPerEmployee.value * mult.turnoverPerEmployee;
    turnover = {
      value: Math.round(employees.value * perHead),
      confidence: Math.min(0.4, employees.confidence + 0.1),
      basis: employees.basis === 'observed' ? 'benchmark' : 'assumption',
      note: `Inferred from ${employees.value} employees × £${Math.round(perHead).toLocaleString('en-GB')} ${BENCHMARKS.turnoverPerEmployee.label.toLowerCase()}${sectors.length ? ` (${sectors[0]} adjusted)` : ''}.`,
    };
  }

  const itSpendEstimate = Math.round(turnover.value * BENCHMARKS.itSpendPctOfTurnover.value * mult.itSpend);

  return {
    twin,
    employees,
    turnover,
    sectors,
    segments,
    technology,
    connectedSources,
    hasFinancialData: Boolean(facts.financial) || connectedSources.some((s) => FINANCIAL_CONNECTORS.includes(s)),
    hasCrmData: connectedSources.some((s) => CRM_CONNECTORS.includes(s)),
    hasLicenceData: Boolean(facts.licence) || connectedSources.some((s) => LICENCE_CONNECTORS.includes(s)),
    itSpendEstimate,
    facts,
  };
}

/** Confidence ceiling for anything resting on an assumed figure. */
export function cap(confidence: number, ctx: AnalysisContext): number {
  const floorBasis = Math.min(
    ctx.turnover.basis === 'assumption' ? 0.45 : 1,
    ctx.employees.basis === 'assumption' ? 0.5 : 1,
  );
  return Math.min(confidence, floorBasis === 1 ? confidence : floorBasis);
}
