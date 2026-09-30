/**
 * Narrative coverage for the SaleSonic demonstration dataset.
 *
 * The requirement is non-negotiable: every assertion in the source document
 * ("SaleSonic Data Requirements for Demonstration") must be present in the
 * app. This module is the check. It is deliberately dumb — normalise the
 * text, look for the phrase — because a clever matcher would eventually
 * report coverage that a reader of the screen would not agree with.
 *
 * It runs against two things:
 *   1. the demo dataset (tests/salesonic-narrative-coverage.test.ts), so the
 *      data we hand to the Repl can never drift from the document;
 *   2. a rendered dump of the deployed Repl (scripts/salesonic-check-repl.ts),
 *      so the running app can be re-checked on demand.
 */

import manifest from '../../../data/salesonic/narrative-manifest.json';

export interface NarrativeGroup {
  id: string;
  label: string;
  phrases: string[];
}

export interface CoverageMiss {
  groupId: string;
  groupLabel: string;
  phrase: string;
}

export interface CoverageReport {
  total: number;
  present: number;
  missing: CoverageMiss[];
  byGroup: Array<{ id: string; label: string; total: number; present: number }>;
  coveragePct: number;
}

export const narrativeGroups: NarrativeGroup[] = manifest.groups as NarrativeGroup[];

export const narrativePhraseCount: number = narrativeGroups.reduce((n, g) => n + g.phrases.length, 0);

/**
 * Word-processor punctuation, currency symbols and arrows are the usual reason
 * a phrase that is plainly on the screen fails a literal match, so they are
 * flattened on both sides before comparing.
 */
export function normalise(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[→⇒]/g, '->')
    .replace(/[£€$]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Flatten any structure (dataset JSON, rendered HTML) into searchable text. */
export function flatten(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' · ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${flatten(v)}`)
      .join(' · ');
  }
  return '';
}

export function checkCoverage(haystack: unknown): CoverageReport {
  const text = normalise(flatten(haystack));
  const missing: CoverageMiss[] = [];
  const byGroup: CoverageReport['byGroup'] = [];

  for (const group of narrativeGroups) {
    let present = 0;
    for (const phrase of group.phrases) {
      if (text.includes(normalise(phrase))) {
        present += 1;
      } else {
        missing.push({ groupId: group.id, groupLabel: group.label, phrase });
      }
    }
    byGroup.push({ id: group.id, label: group.label, total: group.phrases.length, present });
  }

  const total = narrativePhraseCount;
  const present = total - missing.length;
  return {
    total,
    present,
    missing,
    byGroup,
    coveragePct: total === 0 ? 100 : Math.round((present / total) * 1000) / 10,
  };
}

export function formatReport(report: CoverageReport, title: string): string {
  const lines: string[] = [];
  lines.push(`${title}`);
  lines.push(`Narrative coverage: ${report.present}/${report.total} (${report.coveragePct}%)`);
  lines.push('');
  for (const g of report.byGroup) {
    const mark = g.present === g.total ? 'OK  ' : 'GAP ';
    lines.push(`${mark} ${g.present}/${g.total}  ${g.label}`);
  }
  if (report.missing.length > 0) {
    lines.push('');
    lines.push('Missing narrative:');
    for (const m of report.missing) lines.push(`  [${m.groupId}] ${m.phrase}`);
  }
  return lines.join('\n');
}
