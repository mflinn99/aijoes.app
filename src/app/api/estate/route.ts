import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { parseImport, applyImport } from '@/lib/estate/import';
import { audit } from '@/lib/observability/events';
import { rateLimit, ANALYSIS_LIMIT } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 500;

type Body =
  | { action: 'preview'; input: string }
  | { action: 'import'; input: string; analyse: boolean };

export async function POST(request: Request) {
  const guard = await guardRoute(request, 'analyse');
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.input?.trim()) {
    return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 });
  }

  const parsed = parseImport(body.input);

  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That is ${parsed.rows.length} customers. Import at most ${MAX_ROWS} at a time.` },
      { status: 400 },
    );
  }

  // Previewing is free; importing costs an analysis per row.
  if (body.action === 'preview') {
    return NextResponse.json({ ...parsed, willQueue: parsed.rows.length });
  }

  if (body.action === 'import') {
    if (body.analyse) {
      const limit = rateLimit(`estate-import:${session.context.tenantId}`, ANALYSIS_LIMIT);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: 'Import rate limit reached. Please wait a moment.' },
          { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
        );
      }
    }

    const result = applyImport(database, parsed, { analyse: body.analyse });

    audit(database, {
      actor: session.email,
      actorKind: 'human',
      action: 'estate.imported',
      subjectType: 'tenant',
      subjectId: session.context.tenantId,
      detail: {
        created: result.created,
        updated: result.updated,
        queued: result.queued,
        skipped: result.skipped.length,
      },
    });

    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
