/**
 * Bulk customer import.
 *
 * An MSP has fifty to five hundred customers; adding them one analysis at a
 * time is not a workflow. This takes a CSV or a pasted list, validates it
 * strictly, reports every problem with its line number, and queues one analysis
 * per accepted customer.
 *
 * Parsing is deliberately forgiving about shape and strict about content: a
 * misplaced column is a normal export quirk, a malformed domain is a data error
 * the MSP should see rather than have silently dropped.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { normaliseDomain } from '../discovery/http';
import { upsertCustomer, listCustomers } from '../db/repositories/tenant-data';
import { enqueueAnalysis } from '../jobs/queue';
import { createRun } from '../analysis/pipeline';

export interface ImportRow {
  line: number;
  name: string;
  domain: string | null;
  currentMrr: number;
  renewalDate: string | null;
  note: string | null;
  /** Service ids the MSP already sells, so expansion does not re-propose them. */
  currentServices: string[];
}

export interface ImportProblem {
  line: number;
  raw: string;
  reason: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  problems: ImportProblem[];
  headers: string[] | null;
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  name: 'name', customer: 'name', company: 'name', 'customer name': 'name', 'company name': 'name', client: 'name',
  domain: 'domain', website: 'domain', url: 'domain', site: 'domain',
  mrr: 'currentMrr', 'current mrr': 'currentMrr', 'monthly revenue': 'currentMrr', revenue: 'currentMrr',
  renewal: 'renewalDate', 'renewal date': 'renewalDate', 'contract end': 'renewalDate',
  note: 'note', notes: 'note', comment: 'note',
  services: 'currentServices', 'current services': 'currentServices', 'services held': 'currentServices',
};

// Appended, never inserted: changing the meaning of an existing column would
// silently mis-import a file that worked yesterday.
const POSITIONAL: (keyof ImportRow)[] = ['name', 'domain', 'currentMrr', 'renewalDate', 'note', 'currentServices'];

/** Splits a CSV line, honouring quoted fields that contain commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === '\t') {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

/** Services arrive as "managed-microsoft; backup-continuity" or with pipes. */
function parseServices(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
}

function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace(/[£$€,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (uk) return `${uk[3]}-${uk[2]!.padStart(2, '0')}-${uk[1]!.padStart(2, '0')}`;
  return null;
}

export function parseImport(input: string): ParsedImport {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  if (lines.length === 0) return { rows, problems, headers: null };

  const firstCells = splitCsvLine(lines[0]!).map((c) => c.toLowerCase());
  const looksLikeHeader = firstCells.length > 1 && firstCells.every((c) => c in HEADER_ALIASES);
  const headers = looksLikeHeader ? firstCells : null;

  const columnFor = (index: number): keyof ImportRow | null =>
    headers ? (HEADER_ALIASES[headers[index] ?? ''] ?? null) : (POSITIONAL[index] ?? null);

  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();

  lines.forEach((line, index) => {
    if (headers && index === 0) return;
    const lineNumber = index + 1;
    const cells = splitCsvLine(line);
    const row: ImportRow = { line: lineNumber, name: '', domain: null, currentMrr: 0, renewalDate: null, note: null, currentServices: [] };

    if (cells.length === 1 && cells[0]) {
      // A bare name, or a bare domain.
      const asDomain = normaliseDomain(cells[0]);
      row.name = cells[0];
      row.domain = asDomain;
    } else {
      cells.forEach((cell, i) => {
        const field = columnFor(i);
        if (!field || !cell) return;
        if (field === 'name') row.name = cell;
        else if (field === 'domain') row.domain = normaliseDomain(cell);
        else if (field === 'currentMrr') row.currentMrr = parseMoney(cell);
        else if (field === 'renewalDate') row.renewalDate = parseDate(cell);
        else if (field === 'note') row.note = cell;
        else if (field === 'currentServices') row.currentServices = parseServices(cell);
      });

      // A cell that was meant to be a domain but is not one is a data error
      // worth surfacing, rather than a customer silently imported without a site.
      const domainIndex = headers ? headers.findIndex((h) => HEADER_ALIASES[h] === 'domain') : 1;
      const rawDomain = domainIndex >= 0 ? cells[domainIndex] : undefined;
      if (rawDomain && !row.domain && /\./.test(rawDomain)) {
        problems.push({ line: lineNumber, raw: line, reason: `"${rawDomain}" is not a usable domain.` });
        return;
      }
    }

    if (!row.name && !row.domain) {
      problems.push({ line: lineNumber, raw: line, reason: 'No customer name or domain on this line.' });
      return;
    }
    if (!row.name && row.domain) row.name = row.domain;

    const nameKey = row.name.toLowerCase();
    if ((row.domain && seenDomains.has(row.domain)) || (!row.domain && seenNames.has(nameKey))) {
      problems.push({ line: lineNumber, raw: line, reason: 'Duplicate of an earlier line in this import.' });
      return;
    }
    if (row.domain) seenDomains.add(row.domain);
    else seenNames.add(nameKey);

    rows.push(row);
  });

  return { rows, problems, headers };
}

export interface ImportResult {
  created: number;
  updated: number;
  queued: number;
  skipped: ImportProblem[];
  customerIds: string[];
}

/**
 * Create or update each customer and queue one analysis apiece. Analyses go
 * through the durable queue, so importing three hundred customers neither ties
 * up a request nor loses its place on a restart.
 */
export function applyImport(
  db: TenantDb,
  parsed: ParsedImport,
  options: { analyse: boolean } = { analyse: true },
): ImportResult {
  const existing = listCustomers(db);
  const result: ImportResult = { created: 0, updated: 0, queued: 0, skipped: [...parsed.problems], customerIds: [] };

  for (const row of parsed.rows) {
    const match = existing.find(
      (c) => (row.domain && c.domain === row.domain) || c.name.toLowerCase() === row.name.toLowerCase(),
    );
    const id = match?.id ?? `cust-${randomUUID().slice(0, 12)}`;

    upsertCustomer(db, {
      id,
      name: row.name,
      domain: row.domain,
      currentMrr: row.currentMrr || match?.currentMrr || 0,
      relationshipNote: row.note ?? match?.relationshipNote ?? null,
      renewalDate: row.renewalDate ?? match?.renewalDate ?? null,
      currentServices: row.currentServices.length > 0 ? row.currentServices : (match?.currentServices ?? []),
    });

    if (match) result.updated++;
    else result.created++;
    result.customerIds.push(id);

    if (options.analyse) {
      const input = row.domain ?? row.name;
      const run = createRun(db, input);
      enqueueAnalysis(db, { runId: run.id, input, customerId: id, offline: false, syntheticKey: null });
      result.queued++;
    }
  }

  return result;
}
