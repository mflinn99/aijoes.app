/**
 * Demo companies sourced from documents rather than websites.
 *
 * Separate from the synthetic fixtures on purpose: a synthetic company is
 * invented page content exercising the website connector, and a demo company
 * is real figures from a real document with no website at all. They need
 * different provenance, so they get different registries.
 */

import {
  PROJECT_ROCK_KEY, ROCK, ROCK_FINANCIAL_FACTS, ROCK_SOURCE, ROCK_USER_SUPPLIED,
} from './project-rock';
import type { FinancialFacts } from '../db/repositories/facts';

export interface DemoCompany {
  key: string;
  /** What a person types, and what the analysis is keyed on. There is no domain. */
  input: string;
  name: string;
  description: string;
  userSupplied: Record<string, unknown>;
  source: { label: string; locator?: string; confidence?: number };
  financialFacts: { connectorId: string; facts: FinancialFacts };
  /** Shown in the UI so nobody mistakes a confidential document for public data. */
  notice: string;
}

export const DEMO_COMPANIES: DemoCompany[] = [
  {
    key: PROJECT_ROCK_KEY,
    input: ROCK.name,
    name: ROCK.name,
    description: ROCK.description,
    userSupplied: ROCK_USER_SUPPLIED,
    source: { ...ROCK_SOURCE },
    financialFacts: { connectorId: 'acquisition-teaser', facts: ROCK_FINANCIAL_FACTS },
    notice:
      'Figures come from a confidential acquisition teaser supplied by the user. The company is anonymised: ' +
      'there is no name, domain or named contact, and none is inferred. It cannot be contacted.',
  },
];

export function getDemoCompany(key: string): DemoCompany | undefined {
  const needle = key.trim().toLowerCase();
  return DEMO_COMPANIES.find((c) => c.key === needle || c.input.toLowerCase() === needle);
}
