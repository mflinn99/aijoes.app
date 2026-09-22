/**
 * Connector registry — Directive §4 and §23.
 *
 * Every connector the platform expects to support is declared, including the
 * ones not yet implemented. That is what lets §23 answer "connect accounting →
 * +21% understanding" honestly rather than inventing the list at render time.
 */

import type { CompanyDataConnector, ConnectorCategory } from './connector';
import { WebsiteConnector } from './website-connector';
import { CompaniesHouseConnector } from './companies-house-connector';
import { Microsoft365Connector } from './microsoft365-connector';
import { XeroConnector, type XeroCredentials } from './xero-connector';
import type { GraphCredentials } from './graph-client';
import type { TenantDb } from '../db/tenant';
import { getSecret } from '../secrets/vault';

export interface PlannedConnector {
  id: string;
  name: string;
  category: ConnectorCategory;
  authType: 'none' | 'api-key' | 'oauth2';
  understandingUplift: number;
  implemented: boolean;
  /** What this connection unlocks, in the user's language. */
  unlocks: string;
}

/**
 * Uplift figures are the sum of the FIELD_WEIGHTS this connector can populate,
 * expressed as a percentage of the total twin weight. They are estimates, and
 * the UI labels them as such.
 */
export const CONNECTOR_CATALOGUE: PlannedConnector[] = [
  { id: 'website', name: 'Company website', category: 'public-web', authType: 'none', understandingUplift: 32, implemented: true, unlocks: 'Proposition, services, sectors, technology indicators' },
  { id: 'companies-house', name: 'Companies House', category: 'registry', authType: 'api-key', understandingUplift: 14, implemented: true, unlocks: 'Legal identity, SIC codes, filing history, officers' },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'productivity', authType: 'oauth2', understandingUplift: 11, implemented: true, unlocks: 'Counted licence seats and waste, real user population, actual tenant configuration' },
  { id: 'accounting', name: 'Accounting (Xero)', category: 'accounting', authType: 'oauth2', understandingUplift: 21, implemented: true, unlocks: 'Counted turnover, margin, supplier spend and customer base — promotes savings hypotheses to quantified opportunities' },
  { id: 'crm', name: 'CRM', category: 'crm', authType: 'oauth2', understandingUplift: 18, implemented: false, unlocks: 'Pipeline, dormant accounts, conversion rates, customer concentration' },
  { id: 'psa', name: 'PSA', category: 'psa', authType: 'api-key', understandingUplift: 17, implemented: false, unlocks: 'Current MSP services, contract values, ticket themes' },
  { id: 'rmm', name: 'RMM', category: 'rmm', authType: 'api-key', understandingUplift: 12, implemented: false, unlocks: 'Device estate, patch posture, endpoint counts' },
  { id: 'banking', name: 'Bank transaction feed', category: 'banking', authType: 'oauth2', understandingUplift: 15, implemented: false, unlocks: 'Actual supplier payments, maverick spend, duplicate subscriptions' },
  { id: 'procurement', name: 'Procurement system', category: 'procurement', authType: 'api-key', understandingUplift: 9, implemented: false, unlocks: 'Contract register, renewal dates, procurement compliance' },
  { id: 'licence-portal', name: 'Licence portals', category: 'licensing', authType: 'api-key', understandingUplift: 8, implemented: false, unlocks: 'Licence assignment vs. consumption, unused seats' },
  { id: 'azure', name: 'Microsoft Azure', category: 'cloud', authType: 'oauth2', understandingUplift: 10, implemented: false, unlocks: 'Cloud spend, idle resources, reservation opportunities' },
  { id: 'aws', name: 'AWS', category: 'cloud', authType: 'api-key', understandingUplift: 10, implemented: false, unlocks: 'Cloud spend, idle resources, savings plans' },
  { id: 'telecoms', name: 'Telecoms', category: 'telecoms', authType: 'api-key', understandingUplift: 5, implemented: false, unlocks: 'Line and mobile inventory, unused connections' },
  { id: 'hr', name: 'HR system', category: 'hr', authType: 'oauth2', understandingUplift: 7, implemented: false, unlocks: 'Headcount, departments, joiners and leavers driving licence waste' },
  { id: 'support', name: 'Customer support', category: 'support', authType: 'oauth2', understandingUplift: 6, implemented: false, unlocks: 'Service themes, churn risk, automation candidates' },
  { id: 'erp', name: 'ERP', category: 'erp', authType: 'api-key', understandingUplift: 13, implemented: false, unlocks: 'Operational process data, inventory, order flow' },
  { id: 'supplier-portal', name: 'Supplier portals', category: 'supplier', authType: 'api-key', understandingUplift: 6, implemented: false, unlocks: 'Contract terms and pricing directly from suppliers' },
];

/** Connectors that need no per-tenant credential. */
const GLOBAL: CompanyDataConnector[] = [new WebsiteConnector(), new CompaniesHouseConnector()];

export const SECRET_REFS = {
  microsoft365: 'connector:microsoft-365',
  accounting: 'connector:accounting',
} as const;

/**
 * Connectors available to one tenant. Credentialled connectors are constructed
 * from the vault, so a tenant that has not connected Microsoft 365 simply does
 * not get one — rather than getting one that quietly reads someone else's
 * credentials from the environment.
 */
export function connectorsFor(db: TenantDb): CompanyDataConnector[] {
  const out: CompanyDataConnector[] = [...GLOBAL];

  const graph = getSecret<GraphCredentials>(db, SECRET_REFS.microsoft365);
  if (graph) out.push(new Microsoft365Connector(graph));

  const xero = getSecret<XeroCredentials>(db, SECRET_REFS.accounting);
  if (xero) out.push(new XeroConnector(xero));

  return out;
}

/** Connectors with no tenant context — used where only the interface matters. */
export function activeConnectors(): CompanyDataConnector[] {
  return GLOBAL;
}

export function getConnector(id: string): CompanyDataConnector | undefined {
  return GLOBAL.find((c) => c.id === id);
}

/**
 * Directive §23: the ranked "connect this next" list. Connectors already
 * contributing are excluded, and the list is ordered by the understanding each
 * would add.
 */
export function recommendedConnections(alreadyConnected: string[]): PlannedConnector[] {
  return CONNECTOR_CATALOGUE.filter((c) => !alreadyConnected.includes(c.id)).sort(
    (a, b) => b.understandingUplift - a.understandingUplift,
  );
}
