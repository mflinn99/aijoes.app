import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { guardRoute } from '@/lib/session';
import { createRun } from '@/lib/analysis/pipeline';
import { getSynthetic } from '@/lib/fixtures/synthetic';
import { upsertCustomer, listCustomers } from '@/lib/db/repositories/tenant-data';
import { normaliseDomain } from '@/lib/discovery/http';
import { rateLimit, ANALYSIS_LIMIT } from '@/lib/rate-limit';
import { enqueueAnalysis } from '@/lib/jobs/queue';

export const dynamic = 'force-dynamic';

/**
 * Starts an analysis and returns immediately with the run id. The client polls
 * /api/analyse/[runId] so the eleven stages are visible as they complete (§2),
 * rather than the user waiting on a blank screen.
 */
export async function POST(request: Request) {
  const guard = await guardRoute(request, 'analyse');
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;

  // Analysis fetches third-party websites; an unbounded endpoint makes this
  // platform a nuisance to other people's servers as well as to itself.
  const limit = rateLimit(`analyse:${session.context.tenantId}`, ANALYSIS_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Analysis rate limit reached. Please wait a moment.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { input?: string; customerId?: string };
  const input = body.input?.trim();
  if (!input) return NextResponse.json({ error: 'input is required' }, { status: 400 });

  const synthetic = getSynthetic(input);
  const run = createRun(database, input);

  // Re-analysing a company the MSP already has must not create a second
  // customer record for it; the twin would attach to the first one and the new
  // record would sit in the estate for ever as "never analysed".
  const domain = synthetic?.domain ?? normaliseDomain(input);
  const existing = listCustomers(database).find(
    (c) => (domain && c.domain === domain) || c.name.toLowerCase() === input.toLowerCase(),
  );

  const customerId = body.customerId ?? existing?.id ?? `cust-${randomUUID().slice(0, 8)}`;
  if (!body.customerId && !existing) {
    upsertCustomer(database, {
      id: customerId,
      name: synthetic?.name ?? input,
      domain: domain ?? null,
      currentMrr: synthetic?.currentMrr ?? 0,
      relationshipNote: 'Added via company analysis',
      renewalDate: null,
    });
  }

  // Queued rather than fired and forgotten: the job survives a restart and the
  // run's stage states remain the progress channel.
  enqueueAnalysis(database, {
    runId: run.id,
    input,
    customerId,
    offline: Boolean(synthetic),
    syntheticKey: synthetic?.key ?? null,
  });

  return NextResponse.json({ runId: run.id });
}
