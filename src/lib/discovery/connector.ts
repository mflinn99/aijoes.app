/**
 * Connector interface — Directive §4.
 *
 * "Design the ingestion layer so connected systems can be added later without
 * changing the Company Twin contract." A connector's only job is to produce
 * NormalisedRecords; it never writes to the twin directly and never makes
 * analytical judgements. That is what keeps adding a vendor cheap.
 */

import type { Claim } from '../core/provenance';
import type { TwinFieldKey } from '../core/company-twin';

export type ConnectorCategory =
  | 'public-web'
  | 'registry'
  | 'productivity'
  | 'crm'
  | 'psa'
  | 'rmm'
  | 'accounting'
  | 'banking'
  | 'procurement'
  | 'licensing'
  | 'cloud'
  | 'telecoms'
  | 'hr'
  | 'support'
  | 'erp'
  | 'supplier';

export type ConnectorStatus = 'available' | 'not-configured' | 'unavailable' | 'error';

export interface DiscoveryResult {
  status: ConnectorStatus;
  detail: string;
  /** Understanding percentage points this connector is expected to add (§23). */
  expectedUnderstandingUplift: number;
}

export interface SourceRecord {
  connectorId: string;
  label: string;
  locator?: string;
  retrievedAt: string;
  payload: unknown;
}

/** A connector's output: claims destined for named twin fields. */
export interface NormalisedRecord {
  field: TwinFieldKey;
  claim: Claim<unknown>;
}

export interface CompanyIdentity {
  /** Whatever the user typed. */
  input: string;
  name?: string;
  domain?: string;
  companyNumber?: string;
}

export interface CompanyDataConnector {
  id: string;
  name: string;
  category: ConnectorCategory;
  authType: 'none' | 'api-key' | 'oauth2';
  /** Understanding uplift shown on the "connect this next" list (§23). */
  understandingUplift: number;
  discover(): Promise<DiscoveryResult>;
  fetch(identity: CompanyIdentity): Promise<SourceRecord[]>;
  normalise(records: SourceRecord[]): Promise<NormalisedRecord[]>;
}
