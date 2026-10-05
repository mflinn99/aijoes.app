/**
 * Loading a demo company that came from a document rather than a website.
 *
 * Kept separate from the synthetic fixtures because the two are different
 * kinds of thing: a synthetic company is invented page content exercising the
 * website connector, and a demo company like Project ROCK is real figures from
 * a real document with no website at all. Conflating them would let invented
 * data and supplied data share a provenance label.
 */

import type { TenantDb } from '../db/tenant';
import { analyseCompany, type AnalysisResult } from '../analysis/pipeline';
import { upsertCustomer } from '../db/repositories/tenant-data';
import {
  ROCK, ROCK_FINANCIAL_FACTS, ROCK_SOURCE, ROCK_USER_SUPPLIED, PROJECT_ROCK_KEY,
} from './project-rock';
import type { TwinFieldKey } from '../core/company-twin';

export interface DemoLoadResult {
  customerId: string;
  companyId: string;
  analysis: AnalysisResult;
}

/**
 * Create the customer, run the analysis, and attach the counted financials.
 *
 * Idempotent on the customer id, so loading the demo twice does not leave two
 * Project ROCKs in the estate.
 */
export async function loadProjectRock(db: TenantDb): Promise<DemoLoadResult> {
  const customerId = `cust-${PROJECT_ROCK_KEY}`;

  upsertCustomer(db, {
    id: customerId,
    name: ROCK.name,
    // No domain: the teaser is anonymised and guessing one would be inventing
    // an identity for a company in a confidential sale process.
    domain: null,
    currentMrr: 0,
    relationshipNote: 'Acquisition target under review. Figures from the confidential teaser.',
    renewalDate: null,
  });

  const analysis = await analyseCompany(db, ROCK.name, {
    customerId,
    // There is nothing to fetch. Attempting it would only produce a blocked
    // connector and a misleading failure record.
    offline: true,
    userSupplied: ROCK_USER_SUPPLIED as Partial<Record<TwinFieldKey, unknown>>,
    userSuppliedSource: { ...ROCK_SOURCE },
    // Supplied up front, not written afterwards: the engines have to see the
    // counted customer base and margin on this run, not the next one.
    suppliedFinancialFacts: { connectorId: 'acquisition-teaser', facts: ROCK_FINANCIAL_FACTS },
  });

  return { customerId, companyId: analysis.twin.id, analysis };
}
