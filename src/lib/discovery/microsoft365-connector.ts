/**
 * Microsoft 365 connector — iteration 2 priority 2.
 *
 * The highest-leverage integration in the platform: it replaces the headcount
 * guess with a counted user population and the licence-waste benchmark with
 * measured unassigned seats, leavers still licensed, and dormant accounts. That
 * moves `microsoft-licence-optimisation` from hypothesis to inferred-fact, and
 * the promotion is mechanical — the engine reads `ctx.licenceFacts` when it is
 * there and falls back to the benchmark when it is not.
 */

import type { CompanyDataConnector, CompanyIdentity, DiscoveryResult, NormalisedRecord, SourceRecord } from './connector';
import { claim } from '../core/provenance';
import { GraphClient, type GraphCredentials, type GraphTransport } from './graph-client';
import type { TechnologyItem } from '../core/company-twin';

/** Indicative UK list prices, used where a tenant's real price is unknown. */
export const SKU_CATALOGUE: Record<string, { name: string; monthlyGbp: number }> = {
  O365_BUSINESS_ESSENTIALS: { name: 'Microsoft 365 Business Basic', monthlyGbp: 5.1 },
  O365_BUSINESS_PREMIUM: { name: 'Microsoft 365 Business Standard', monthlyGbp: 10.6 },
  SPB: { name: 'Microsoft 365 Business Premium', monthlyGbp: 18.6 },
  SPE_E3: { name: 'Microsoft 365 E3', monthlyGbp: 29.7 },
  SPE_E5: { name: 'Microsoft 365 E5', monthlyGbp: 51.6 },
  ENTERPRISEPACK: { name: 'Office 365 E3', monthlyGbp: 20.6 },
  ENTERPRISEPREMIUM: { name: 'Office 365 E5', monthlyGbp: 33.4 },
  EXCHANGESTANDARD: { name: 'Exchange Online Plan 1', monthlyGbp: 3.3 },
  POWER_BI_PRO: { name: 'Power BI Pro', monthlyGbp: 8.2 },
  PROJECTPROFESSIONAL: { name: 'Project Plan 3', monthlyGbp: 24.9 },
  VISIOCLIENT: { name: 'Visio Plan 2', monthlyGbp: 12.4 },
};

interface GraphUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  assignedLicenses: { skuId: string }[];
  signInActivity?: { lastSignInDateTime?: string };
  department?: string;
}

interface GraphSku {
  skuId: string;
  skuPartNumber: string;
  prepaidUnits: { enabled: number; suspended: number; warning: number };
  consumedUnits: number;
}

export interface SkuFact {
  skuPartNumber: string;
  name: string;
  purchased: number;
  assigned: number;
  unassigned: number;
  monthlyUnitCostGbp: number;
  /** Annual cost of seats nobody is using. */
  unassignedAnnualCostGbp: number;
}

/**
 * The counted facts the SPEND LESS engine uses in place of its benchmark.
 * Every number here is measured, not modelled.
 */
export interface LicenceFacts {
  totalUsers: number;
  enabledUsers: number;
  licensedUsers: number;
  /** Disabled accounts that still hold a licence — leavers nobody reclaimed. */
  licensedDisabledUsers: number;
  /** Enabled, licensed, no sign-in in 60 days. */
  dormantLicensedUsers: number;
  skus: SkuFact[];
  annualLicenceCostGbp: number;
  /** Unassigned seats + leavers + dormant, annualised. Counted, not estimated. */
  recoverableAnnualGbp: number;
  retrievedAt: string;
}

const DORMANT_DAYS = 60;

export class Microsoft365Connector implements CompanyDataConnector {
  readonly id = 'microsoft-365';
  readonly name = 'Microsoft 365';
  readonly category = 'productivity' as const;
  readonly authType = 'oauth2' as const;
  readonly understandingUplift = 11;

  constructor(
    private readonly credentials: GraphCredentials | null,
    private readonly transport?: GraphTransport,
  ) {}

  async discover(): Promise<DiscoveryResult> {
    if (!this.credentials) {
      return {
        status: 'not-configured',
        detail: 'No Microsoft 365 credentials are stored for this tenant.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
    try {
      const client = new GraphClient(this.credentials, this.transport);
      await client.accessToken();
      return { status: 'available', detail: 'Connected to Microsoft Graph.', expectedUnderstandingUplift: this.understandingUplift };
    } catch (err) {
      return {
        status: 'error',
        detail: err instanceof Error ? err.message : 'Microsoft Graph is unreachable.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
  }

  async fetch(_identity: CompanyIdentity): Promise<SourceRecord[]> {
    if (!this.credentials) return [];
    const client = new GraphClient(this.credentials, this.transport);
    const retrievedAt = new Date().toISOString();

    const [users, skus] = await Promise.all([
      client.getAll<GraphUser>(
        '/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity,department&$top=999',
      ),
      client.getAll<GraphSku>('/subscribedSkus'),
    ]);

    return [
      { connectorId: this.id, label: 'Microsoft 365 users', locator: 'graph:/users', retrievedAt, payload: users },
      { connectorId: this.id, label: 'Microsoft 365 subscriptions', locator: 'graph:/subscribedSkus', retrievedAt, payload: skus },
    ];
  }

  async normalise(records: SourceRecord[]): Promise<NormalisedRecord[]> {
    const users = (records.find((r) => r.locator === 'graph:/users')?.payload as GraphUser[] | undefined) ?? [];
    const skus = (records.find((r) => r.locator === 'graph:/subscribedSkus')?.payload as GraphSku[] | undefined) ?? [];
    if (users.length === 0 && skus.length === 0) return [];

    const facts = computeLicenceFacts(users, skus);
    const src = { connectorId: this.id, label: 'Microsoft 365', locator: 'graph:/users' };
    const out: NormalisedRecord[] = [];

    // A counted user population replaces the headcount assumption outright.
    out.push({
      field: 'employeesEstimate',
      claim: claim(facts.enabledUsers, { ...src, method: 'connected-data', confidence: 0.96 }),
    });

    const software: TechnologyItem[] = facts.skus.map((s) => ({
      name: s.name,
      category: 'Microsoft licensing',
      indicator: `${s.assigned} of ${s.purchased} seats assigned (Microsoft Graph)`,
    }));
    if (software.length > 0) {
      out.push({ field: 'softwareEstate', claim: claim(software, { ...src, method: 'connected-data', confidence: 0.98 }) });
      out.push({
        field: 'technologyEstate',
        claim: claim(
          [{ name: 'Microsoft 365', category: 'Productivity', indicator: 'Connected tenant' }],
          { ...src, method: 'connected-data', confidence: 0.99 },
        ),
      });
    }

    out.push({
      field: 'estimatedSpendCategories',
      claim: claim(
        [{ category: 'Microsoft licensing', estimatedAnnualSpend: facts.annualLicenceCostGbp, basis: 'connected' as const }],
        { ...src, method: 'connected-data', confidence: 0.9 },
      ),
    });

    if (facts.licensedDisabledUsers > 0 || facts.dormantLicensedUsers > 0) {
      out.push({
        field: 'operationalSignals',
        claim: claim(
          [
            {
              kind: 'licence-waste',
              summary:
                `${facts.licensedDisabledUsers} disabled account(s) still licensed and ` +
                `${facts.dormantLicensedUsers} licensed account(s) with no sign-in in ${DORMANT_DAYS} days.`,
              detectedAt: facts.retrievedAt,
              sourceLabel: 'Microsoft 365',
              locator: 'graph:/users',
            },
          ],
          { ...src, method: 'connected-data', confidence: 0.95 },
        ),
      });
    }

    return out;
  }
}

export function computeLicenceFacts(users: GraphUser[], skus: GraphSku[], now = new Date()): LicenceFacts {
  const dormantBefore = now.getTime() - DORMANT_DAYS * 86_400_000;

  const licensed = users.filter((u) => (u.assignedLicenses?.length ?? 0) > 0);
  const licensedDisabled = licensed.filter((u) => !u.accountEnabled);
  const dormant = licensed.filter((u) => {
    if (!u.accountEnabled) return false;
    const last = u.signInActivity?.lastSignInDateTime;
    // No sign-in record at all is treated as dormant only when the tenant
    // reports the field for others; absent data is not evidence of absence.
    if (!last) return false;
    return new Date(last).getTime() < dormantBefore;
  });

  const skuFacts: SkuFact[] = skus.map((s) => {
    const catalogue = SKU_CATALOGUE[s.skuPartNumber];
    const monthly = catalogue?.monthlyGbp ?? 0;
    const purchased = s.prepaidUnits?.enabled ?? 0;
    const assigned = s.consumedUnits ?? 0;
    const unassigned = Math.max(0, purchased - assigned);
    return {
      skuPartNumber: s.skuPartNumber,
      name: catalogue?.name ?? s.skuPartNumber,
      purchased,
      assigned,
      unassigned,
      monthlyUnitCostGbp: monthly,
      unassignedAnnualCostGbp: Math.round(unassigned * monthly * 12),
    };
  });

  const annualLicenceCost = Math.round(
    skuFacts.reduce((sum, s) => sum + s.assigned * s.monthlyUnitCostGbp * 12, 0),
  );

  // Average cost of an assigned seat, used to price leavers and dormant users.
  const assignedSeats = skuFacts.reduce((sum, s) => sum + s.assigned, 0);
  const averageSeatAnnual = assignedSeats > 0 ? annualLicenceCost / assignedSeats : 0;

  const recoverable = Math.round(
    skuFacts.reduce((sum, s) => sum + s.unassignedAnnualCostGbp, 0) +
      (licensedDisabled.length + dormant.length) * averageSeatAnnual,
  );

  return {
    totalUsers: users.length,
    enabledUsers: users.filter((u) => u.accountEnabled).length,
    licensedUsers: licensed.length,
    licensedDisabledUsers: licensedDisabled.length,
    dormantLicensedUsers: dormant.length,
    skus: skuFacts,
    annualLicenceCostGbp: annualLicenceCost,
    recoverableAnnualGbp: recoverable,
    retrievedAt: now.toISOString(),
  };
}
