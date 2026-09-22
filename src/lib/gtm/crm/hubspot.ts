/**
 * HubSpot CRM write adapter (Phase 9).
 *
 * The read-side HubSpot connector already exists in src/lib/discovery — this is
 * deliberately separate because reading facts for analysis and writing the
 * commercial record are different trust levels. Reads are safe to run
 * unattended; writes mutate a customer's CRM.
 *
 * Idempotency has two layers. The link table gives us the external id for a
 * local record, so a replay is an update. When no link exists we still do not
 * blind-create: we search HubSpot first (by domain for companies, email for
 * contacts) so a record created by a human is adopted rather than duplicated.
 *
 * NOT EXERCISED AGAINST A LIVE TENANT. No HubSpot token exists in this
 * environment and outbound egress to api.hubapi.com is blocked, so every path
 * below is covered by transport-level tests only. See BLOCKERS.md.
 */

import type {
  CrmAdapter, CrmActivity, CrmCompany, CrmContact, CrmDeal, CrmTask, CrmWriteResult,
} from './types';
import { CrmError } from './types';

const API = 'https://api.hubapi.com';

export type HubspotTransport = (url: string, init: RequestInit) => Promise<Response>;

/** HubSpot deal stages vary per pipeline, so the mapping is configuration, not a guess. */
export interface HubspotStageMap {
  [ourStage: string]: string;
}

export interface HubspotCrmConfig {
  accessToken: string;
  pipelineId: string;
  stageMap: HubspotStageMap;
  ownerId?: string;
}

interface HsSearchResponse { total: number; results: { id: string }[] }
interface HsObject { id: string }

export class HubspotCrmAdapter implements CrmAdapter {
  readonly provider = 'hubspot';
  readonly name = 'HubSpot';
  readonly configured: boolean;

  constructor(
    private readonly config: HubspotCrmConfig | null,
    private readonly transport: HubspotTransport = (url, init) => fetch(url, init),
  ) {
    this.configured = config !== null && config.accessToken.length > 0;
  }

  private cfg(): HubspotCrmConfig {
    if (!this.config) throw new CrmError('HubSpot is not configured', false);
    return this.config;
  }

  private async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.transport(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg().accessToken}`,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      // Network-level failure: the CRM may be fine, we just could not reach it.
      throw new CrmError(`HubSpot unreachable: ${(err as Error).message}`, true);
    }

    if (res.status === 429 || res.status >= 500) {
      throw new CrmError(`HubSpot returned ${res.status}`, true, res.status);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CrmError(`HubSpot rejected the write (${res.status}): ${text.slice(0, 300)}`, false, res.status);
    }
    return (await res.json()) as T;
  }

  /** Adopt a record a human already created rather than making a second one. */
  private async findBy(object: string, property: string, value: string): Promise<string | null> {
    const body = {
      filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }],
      limit: 1,
      properties: ['hs_object_id'],
    };
    const res = await this.call<HsSearchResponse>(`/crm/v3/objects/${object}/search`, 'POST', body);
    return res.results[0]?.id ?? null;
  }

  private async put(object: string, externalId: string | null, properties: Record<string, unknown>): Promise<CrmWriteResult> {
    if (externalId) {
      await this.call<HsObject>(`/crm/v3/objects/${object}/${externalId}`, 'PATCH', { properties });
      return { externalId, action: 'updated' };
    }
    const created = await this.call<HsObject>(`/crm/v3/objects/${object}`, 'POST', { properties });
    return { externalId: created.id, action: 'created' };
  }

  private async associate(fromObject: string, fromId: string, toObject: string, toId: string, typeId: number): Promise<void> {
    await this.call(
      `/crm/v4/objects/${fromObject}/${fromId}/associations/${toObject}/${toId}`,
      'PUT',
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }],
    );
  }

  async upsertCompany(input: CrmCompany, externalId: string | null): Promise<CrmWriteResult> {
    let id = externalId;
    if (!id && input.domain) id = await this.findBy('companies', 'domain', input.domain);

    const properties: Record<string, unknown> = { name: input.name };
    if (input.domain) properties.domain = input.domain;
    for (const [k, v] of Object.entries(input.properties)) if (v !== null) properties[k] = v;

    return this.put('companies', id, properties);
  }

  async upsertContact(input: CrmContact, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult> {
    let id = externalId;
    if (!id && input.email) id = await this.findBy('contacts', 'email', input.email);

    const properties: Record<string, unknown> = {};
    if (input.email) properties.email = input.email;
    if (input.name) {
      const parts = input.name.trim().split(/\s+/);
      properties.firstname = parts[0] ?? '';
      if (parts.length > 1) properties.lastname = parts.slice(1).join(' ');
    }
    if (input.role) properties.jobtitle = input.role;
    if (input.linkedin) properties.hs_linkedin_url = input.linkedin;

    const result = await this.put('contacts', id, properties);
    if (companyExternalId) await this.associate('contacts', result.externalId, 'companies', companyExternalId, 1);
    return result;
  }

  async upsertDeal(input: CrmDeal, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult> {
    const cfg = this.cfg();
    const stage = cfg.stageMap[input.stage];
    if (!stage) {
      // Refusing beats writing a deal into a stage we guessed.
      throw new CrmError(`No HubSpot stage is mapped for '${input.stage}'. Configure the stage map.`, false);
    }

    const properties: Record<string, unknown> = {
      dealname: input.name,
      pipeline: cfg.pipelineId,
      dealstage: stage,
      amount: String(Math.round(input.valueGbp)),
    };
    if (input.closeDate) properties.closedate = input.closeDate;
    if (cfg.ownerId) properties.hubspot_owner_id = cfg.ownerId;

    const result = await this.put('deals', externalId, properties);
    if (companyExternalId) await this.associate('deals', result.externalId, 'companies', companyExternalId, 5);
    return result;
  }

  async logActivity(input: CrmActivity, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult> {
    if (externalId) return { externalId, action: 'unchanged' }; // activities are immutable facts
    const properties: Record<string, unknown> = {
      hs_timestamp: input.occurredAt,
      hs_note_body: `${input.subject}\n\n${input.body}`,
    };
    const result = await this.put('notes', null, properties);
    if (companyExternalId) await this.associate('notes', result.externalId, 'companies', companyExternalId, 190);
    return result;
  }

  async createTask(input: CrmTask, externalId: string | null, companyExternalId: string | null): Promise<CrmWriteResult> {
    const properties: Record<string, unknown> = {
      hs_timestamp: input.dueAt,
      hs_task_subject: input.subject,
      hs_task_body: input.body,
      hs_task_status: 'NOT_STARTED',
    };
    if (this.cfg().ownerId) properties.hubspot_owner_id = this.cfg().ownerId;
    const result = await this.put('tasks', externalId, properties);
    if (companyExternalId) await this.associate('tasks', result.externalId, 'companies', companyExternalId, 192);
    return result;
  }
}
