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
}

const FINANCIAL_CONNECTORS = ['accounting', 'banking', 'erp'];
const CRM_CONNECTORS = ['crm', 'psa'];
const LICENCE_CONNECTORS = ['microsoft-365', 'licence-portal'];

export function buildContext(twin: CompanyTwin): AnalysisContext {
  const sectors = (valueOf(twin.sectors) as string[] | null) ?? [];
  const segments = (valueOf(twin.customerSegments) as string[] | null) ?? [];
  const technology = (valueOf(twin.technologyEstate) as TechnologyItem[] | null) ?? [];
  const connectedSources = twin.dataSources;
  const mult = sectorMultiplier(sectors);

  const observedEmployees = valueOf(twin.employeesEstimate) as number | null;
  const observedTurnover = valueOf(twin.turnoverEstimate) as number | null;

  // Employees: observed, else inferred from turnover, else a stated default.
  let employees: AnalysisContext['employees'];
  if (observedEmployees && observedEmployees > 0) {
    employees = {
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
    turnover = {
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
    hasFinancialData: connectedSources.some((s) => FINANCIAL_CONNECTORS.includes(s)),
    hasCrmData: connectedSources.some((s) => CRM_CONNECTORS.includes(s)),
    hasLicenceData: connectedSources.some((s) => LICENCE_CONNECTORS.includes(s)),
    itSpendEstimate,
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
