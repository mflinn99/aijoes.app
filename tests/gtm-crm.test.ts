/**
 * Phase 9 — the CRM closed loop, proved rather than claimed.
 *
 * The directive's requirement is "avoid duplicate records, build idempotent
 * integration". The test for that is not that the code contains an upsert; it is
 * that a second identical run writes nothing at all.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harness, type Harness } from './helpers';
import { upsertAccount, updateAccount, upsertContact, upsertOpportunity, saveOutreach, getAccount } from '@/lib/gtm/store';
import { LocalCrmAdapter, readLocalRecords } from '@/lib/gtm/crm/local';
import { HubspotCrmAdapter } from '@/lib/gtm/crm/hubspot';
import { CrmError } from '@/lib/gtm/crm/types';
import {
  reconcile, syncAccount, syncOpportunity, syncOutreach, getLink, pendingOutbox, drainOutbox,
  type CrmTargets,
} from '@/lib/gtm/crm/sync';
import type { GtmAccount, GtmOpportunity, OutreachMessage } from '@/lib/gtm/types';

const MSP = 'onward';

function seedAccount(h: Harness, name: string, domain: string, synthetic = false): GtmAccount {
  const a = upsertAccount(h.db, { mspId: MSP, name, domain, source: 'test', synthetic });
  updateAccount(h.db, a.id, { status: 'qualified-target' });
  return getAccount(h.db, a.id)!;
}

function seedOpportunity(h: Harness, account: GtmAccount, valueGbp = 40_000): GtmOpportunity {
  const now = new Date().toISOString();
  return upsertOpportunity(h.db, {
    id: `opp-${account.id}`,
    accountId: account.id,
    hypothesisId: `hyp-${account.id}`,
    name: `${account.name} — AVD estate`,
    stage: 'qualified',
    valueGbp,
    probability: 0,
    owner: null,
    nextAction: 'Scope the work',
    nextActionAt: null,
    lastActionAt: now,
    closeDate: null,
    source: 'test',
    crmId: null,
    createdAt: now,
    updatedAt: now,
  });
}

function localOnly(h: Harness): CrmTargets {
  return { local: new LocalCrmAdapter(h.db), external: null };
}

describe('local CRM of record', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('creates once, updates on change, and reports unchanged on a replay', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const targets = localOnly(h);

    const first = await syncAccount(h.db, targets, account);
    expect(first.map((o) => o.action)).toEqual(['created']);

    const replay = await syncAccount(h.db, targets, account);
    expect(replay.map((o) => o.action)).toEqual(['unchanged']);
    expect(replay[0]!.externalId).toBe(first[0]!.externalId);

    updateAccount(h.db, account.id, { status: 'engaged' });
    const changed = await syncAccount(h.db, targets, getAccount(h.db, account.id)!);
    expect(changed.map((o) => o.action)).toEqual(['updated']);
    expect(changed[0]!.externalId).toBe(first[0]!.externalId);
  });

  it('never creates a second record for the same account', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const targets = localOnly(h);
    for (let i = 0; i < 5; i++) await syncAccount(h.db, targets, account);
    expect(readLocalRecords(h.db, 'company')).toHaveLength(1);
  });

  it('refuses to put synthetic accounts into a commercial record', async () => {
    const account = seedAccount(h, 'Synthetic Manufacturing 001', 'synth-001.example', true);
    const outcomes = await syncAccount(h.db, localOnly(h), account);
    expect(outcomes).toEqual([]);
    expect(readLocalRecords(h.db, 'company')).toHaveLength(0);
  });

  it('keeps research candidates out of the CRM', async () => {
    const a = upsertAccount(h.db, { mspId: MSP, name: 'Merely A Candidate', domain: 'candidate.co.uk', source: 'test' });
    const outcomes = await syncAccount(h.db, localOnly(h), getAccount(h.db, a.id)!);
    expect(outcomes).toEqual([]);
  });

  it('writes the CRM id back onto the opportunity', async () => {
    const account = seedAccount(h, 'Northbank Legal', 'northbank.legal');
    const opp = seedOpportunity(h, account);
    const targets = localOnly(h);
    await syncAccount(h.db, targets, account);
    await syncOpportunity(h.db, targets, opp);

    const stored = h.db.get<{ crm_id: string | null }>(
      `SELECT crm_id FROM gtm_opportunities WHERE tenant_id = @tenantId AND id = @id`, { id: opp.id },
    );
    expect(stored?.crm_id).toMatch(/^loc_deal_/);
  });

  it('logs sent outreach and ignores drafts', async () => {
    const account = seedAccount(h, 'Harlow Foods', 'harlowfoods.co.uk');
    const targets = localOnly(h);
    await syncAccount(h.db, targets, account);

    const base: OutreachMessage = {
      id: 'msg-1', accountId: account.id, hypothesisId: 'hyp-1', contactId: null,
      channel: 'email', step: 1, subject: 'Your Manchester move', body: 'Body',
      status: 'draft', reasonForContact: 'Planning application for a new site',
      evidence: [{ statement: 'Planning application granted', source: 'council', confidence: 0.8 }],
      approvedBy: null, sentAt: null, blockedReason: null, createdAt: new Date().toISOString(),
    };
    saveOutreach(h.db, base);
    expect(await syncOutreach(h.db, targets, base)).toEqual([]);

    const sent: OutreachMessage = { ...base, status: 'sent', sentAt: new Date().toISOString(), approvedBy: 'mark' };
    saveOutreach(h.db, sent);
    const outcomes = await syncOutreach(h.db, targets, sent);
    expect(outcomes.map((o) => o.action)).toEqual(['created']);

    const activity = readLocalRecords<{ body: string }>(h.db, 'activity')[0];
    // The reason for contact travels with the activity, so a salesperson opening
    // the record can see why the company was approached.
    expect(activity?.payload.body).toContain('Reason for contact: Planning application for a new site');
  });
});

describe('reconcile', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('is a no-op the second time it runs', async () => {
    const targets = localOnly(h);
    const a = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const b = seedAccount(h, 'Northbank Legal', 'northbank.legal');
    seedOpportunity(h, a);
    seedOpportunity(h, b);
    upsertContact(h.db, {
      accountId: a.id, name: 'A Person', role: 'IT Director', email: 'person@crosbygroup.co.uk',
      linkedin: null, source: 'test', confidence: 0.7, consentBasis: 'legitimate-interest', suppressed: false,
    });

    const first = await reconcile(h.db, targets);
    expect(first.created).toBeGreaterThan(0);
    expect(first.failed).toBe(0);

    const second = await reconcile(h.db, targets);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(first.created);
  });

  it('says plainly when no external CRM is connected rather than implying one is', async () => {
    const report = await reconcile(h.db, localOnly(h));
    expect(report.externalProvider).toBeNull();
    expect(report.notes.join(' ')).toContain('No external CRM is connected');
  });

  it('leaves contacts with no reachable identity out of the CRM', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    upsertContact(h.db, {
      accountId: account.id, name: null, role: 'IT Director', email: null,
      linkedin: null, source: 'inferred-role', confidence: 0.4, consentBasis: null, suppressed: false,
    });
    const report = await reconcile(h.db, localOnly(h));
    expect(report.contacts).toBe(0);
  });
});

describe('HubSpot write adapter', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  const config = {
    accessToken: 'pat-test',
    pipelineId: 'default',
    stageMap: { qualified: 'presentationscheduled', identified: 'appointmentscheduled' },
  };

  function respond(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('searches before creating so a record a human made is adopted, not duplicated', async () => {
    const calls: { url: string; method: string }[] = [];
    const adapter = new HubspotCrmAdapter(config, async (url, init) => {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url.includes('/search')) return respond({ total: 1, results: [{ id: '55' }] });
      return respond({ id: '55' });
    });

    const result = await adapter.upsertCompany(
      { localId: 'a1', name: 'Crosby Group', domain: 'crosbygroup.co.uk', properties: {} }, null,
    );

    expect(calls[0]?.url).toContain('/crm/v3/objects/companies/search');
    expect(calls[1]?.method).toBe('PATCH');
    expect(result).toEqual({ externalId: '55', action: 'updated' });
  });

  it('refuses to write a deal into a stage nobody mapped', async () => {
    const adapter = new HubspotCrmAdapter(config, async () => respond({ id: '1' }));
    await expect(
      adapter.upsertDeal(
        { localId: 'o1', companyLocalId: 'a1', name: 'Deal', stage: 'proposal', valueGbp: 1000, probability: 0.5, closeDate: null, owner: null, nextAction: null, nextActionAt: null },
        null, null,
      ),
    ).rejects.toThrow(/No HubSpot stage is mapped for 'proposal'/);
  });

  it('treats a 429 as retryable and a 400 as a rejection', async () => {
    const rateLimited = new HubspotCrmAdapter(config, async () => respond({}, 429));
    await expect(rateLimited.upsertCompany({ localId: 'a', name: 'X', domain: null, properties: {} }, 'ext'))
      .rejects.toMatchObject({ retryable: true });

    const rejected = new HubspotCrmAdapter(config, async () => new Response('bad property', { status: 400 }));
    await expect(rejected.upsertCompany({ localId: 'a', name: 'X', domain: null, properties: {} }, 'ext'))
      .rejects.toMatchObject({ retryable: false });
  });

  it('reports itself unconfigured without a token instead of pretending', () => {
    expect(new HubspotCrmAdapter(null).configured).toBe(false);
  });
});

describe('outbox durability', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('queues a write when the CRM is unreachable and drains it when it returns', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    let up = false;
    const external = new HubspotCrmAdapter(
      { accessToken: 'pat', pipelineId: 'p', stageMap: {} },
      async (url) => {
        if (!up) throw new Error('ECONNREFUSED');
        if (url.includes('/search')) return new Response(JSON.stringify({ total: 0, results: [] }), { status: 200 });
        return new Response(JSON.stringify({ id: 'hs-9' }), { status: 200 });
      },
    );
    const targets: CrmTargets = { local: new LocalCrmAdapter(h.db), external };

    const outcomes = await syncAccount(h.db, targets, account);
    expect(outcomes.find((o) => o.provider === 'hubspot')?.action).toBe('queued');
    expect(pendingOutbox(h.db)).toHaveLength(1);
    // The local record still succeeded — a CRM outage does not stop the engine.
    expect(outcomes.find((o) => o.provider === 'local')?.action).toBe('created');

    up = true;
    const later = new Date(Date.now() + 10 * 60_000);
    const drain = await drainOutbox(h.db, targets, later);
    expect(drain.drained).toBe(1);
    expect(drain.stillQueued).toBe(0);
    expect(getLink(h.db, 'hubspot', 'company', account.id)?.externalId).toBe('hs-9');
  });

  it('backs off rather than hammering a CRM that keeps failing', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const external = new HubspotCrmAdapter(
      { accessToken: 'pat', pipelineId: 'p', stageMap: {} },
      async () => { throw new Error('ECONNREFUSED'); },
    );
    const targets: CrmTargets = { local: new LocalCrmAdapter(h.db), external };

    await syncAccount(h.db, targets, account);
    const firstAttempt = pendingOutbox(h.db)[0]!;

    // A second failure must extend the wait, not reset it.
    await drainOutbox(h.db, targets, new Date(Date.now() + 10 * 60_000));
    const secondAttempt = pendingOutbox(h.db)[0]!;
    expect(secondAttempt.attempts).toBeGreaterThan(firstAttempt.attempts);
    expect(new Date(secondAttempt.nextAttemptAt).getTime()).toBeGreaterThan(new Date(firstAttempt.nextAttemptAt).getTime());
    expect(secondAttempt.lastError).toContain('unreachable');
  });

  it('does not queue a rejection the CRM will reject again', async () => {
    const account = seedAccount(h, 'Crosby Group', 'crosbygroup.co.uk');
    const external = new HubspotCrmAdapter(
      { accessToken: 'pat', pipelineId: 'p', stageMap: {} },
      async () => new Response('property does not exist', { status: 400 }),
    );
    const targets: CrmTargets = { local: new LocalCrmAdapter(h.db), external };

    const outcomes = await syncAccount(h.db, targets, account);
    expect(outcomes.find((o) => o.provider === 'hubspot')?.action).toBe('failed');
    expect(pendingOutbox(h.db)).toHaveLength(0);

    const failure = h.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = @tenantId AND action = 'gtm.crm.rejected'`, {},
    );
    expect(failure?.n).toBe(1);
  });

  it('CrmError carries whether the caller should try again', () => {
    expect(new CrmError('down', true).retryable).toBe(true);
    expect(new CrmError('bad request', false, 400).status).toBe(400);
  });
});
