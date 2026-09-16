import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/session';
import { analyseCompany, createRun } from '@/lib/analysis/pipeline';
import { getSynthetic } from '@/lib/fixtures/synthetic';
import { upsertCustomer } from '@/lib/db/repositories/tenant-data';

export const dynamic = 'force-dynamic';

/**
 * Starts an analysis and returns immediately with the run id. The client polls
 * /api/analyse/[runId] so the eleven stages are visible as they complete (§2),
 * rather than the user waiting on a blank screen.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { input?: string; customerId?: string };
  const input = body.input?.trim();
  if (!input) return NextResponse.json({ error: 'input is required' }, { status: 400 });

  const database = db();

  // A synthetic fixture is analysed offline and deterministically.
  const synthetic = getSynthetic(input);
  const run = createRun(database, input);

  const customerId = body.customerId ?? `cust-${randomUUID().slice(0, 8)}`;
  if (!body.customerId) {
    upsertCustomer(database, {
      id: customerId,
      name: synthetic?.name ?? input,
      domain: synthetic?.domain ?? null,
      currentMrr: synthetic?.currentMrr ?? 0,
      relationshipNote: 'Added via company analysis',
      renewalDate: null,
    });
  }

  // Fire and forget: the run's stage states are the progress channel.
  void analyseCompany(database, input, {
    customerId,
    offline: Boolean(synthetic),
    seedRecords: synthetic?.records,
    userSupplied: synthetic?.userSupplied,
    runId: run.id,
  }).catch(() => {
    /* failure is recorded on the run itself */
  });

  return NextResponse.json({ runId: run.id });
}
