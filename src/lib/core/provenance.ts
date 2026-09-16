/**
 * Provenance — Directive §3 and §21.
 *
 * "Every populated field should where practicable preserve: value, source,
 * timestamp, confidence, method." and "Do not simply overwrite conflicting
 * facts. Preserve provenance."
 *
 * Pure. No I/O. Nothing in this module may import from outside core/.
 */

export type EvidenceMethod = 'observed' | 'inferred' | 'user-supplied' | 'connected-data';

/**
 * Directive §1: "The platform must distinguish clearly between facts, inferred
 * facts, hypotheses, recommendations and executable actions. Never fabricate
 * certainty."
 */
export type Epistemics = 'fact' | 'inferred-fact' | 'hypothesis' | 'recommendation' | 'executable-action';

export interface SourceRef {
  /** Stable connector id that produced this, e.g. "website" or "companies-house". */
  connectorId: string;
  /** Human-readable label shown in the evidence view. */
  label: string;
  /** URL or record locator, when one exists. */
  locator?: string;
  retrievedAt: string;
}

export interface Claim<T> {
  value: T;
  method: EvidenceMethod;
  epistemics: Epistemics;
  /** 0..1 */
  confidence: number;
  sources: SourceRef[];
  observedAt: string;
}

/**
 * A field that keeps every claim ever made about it, in descending confidence
 * order. Conflicting facts are retained, never overwritten.
 */
export interface ProvenancedField<T> {
  /** The currently-believed value: the highest-confidence non-stale claim. */
  current: Claim<T> | null;
  /** Every claim, including superseded and conflicting ones. */
  claims: Claim<T>[];
}

export function emptyField<T>(): ProvenancedField<T> {
  return { current: null, claims: [] };
}

export function claim<T>(
  value: T,
  opts: {
    connectorId: string;
    label: string;
    locator?: string;
    method: EvidenceMethod;
    epistemics?: Epistemics;
    confidence: number;
    at?: string;
  },
): Claim<T> {
  const at = opts.at ?? new Date().toISOString();
  return {
    value,
    method: opts.method,
    epistemics: opts.epistemics ?? (opts.method === 'inferred' ? 'inferred-fact' : 'fact'),
    confidence: clamp01(opts.confidence),
    observedAt: at,
    sources: [{ connectorId: opts.connectorId, label: opts.label, locator: opts.locator, retrievedAt: at }],
  };
}

/**
 * Add a claim without destroying what was there. If an equal value already
 * exists, the sources are merged and confidence takes the higher of the two —
 * two independent sources agreeing is stronger evidence than either alone.
 */
export function addClaim<T>(field: ProvenancedField<T>, next: Claim<T>): ProvenancedField<T> {
  const claims = [...field.claims];
  const sameIdx = claims.findIndex((c) => deepEqual(c.value, next.value));

  if (sameIdx >= 0) {
    const existing = claims[sameIdx]!;
    const mergedSources = dedupeSources([...existing.sources, ...next.sources]);
    claims[sameIdx] = {
      ...existing,
      sources: mergedSources,
      // Independent corroboration lifts confidence, but never to certainty.
      confidence: corroborate(existing.confidence, next.confidence, mergedSources.length > existing.sources.length),
      observedAt: laterOf(existing.observedAt, next.observedAt),
      epistemics: strongerEpistemics(existing.epistemics, next.epistemics),
    };
  } else {
    claims.push(next);
  }

  // Highest confidence wins; ties break toward the more recently observed claim.
  const sorted = [...claims].sort(
    (a, b) => b.confidence - a.confidence || new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );
  return { current: sorted[0] ?? null, claims: sorted };
}

/** True when the field holds two materially different values that both look credible. */
export function isConflicted<T>(field: ProvenancedField<T>, threshold = 0.5): boolean {
  const credible = field.claims.filter((c) => c.confidence >= threshold);
  if (credible.length < 2) return false;
  const first = credible[0]!;
  return credible.some((c) => !deepEqual(c.value, first.value));
}

export function valueOf<T>(field: ProvenancedField<T> | undefined): T | null {
  return field?.current?.value ?? null;
}

export function confidenceOf<T>(field: ProvenancedField<T> | undefined): number {
  return field?.current?.confidence ?? 0;
}

/** Directive §22: "Flag stale evidence." */
export function isStale<T>(field: ProvenancedField<T>, maxAgeDays: number, now = new Date()): boolean {
  if (!field.current) return true;
  const ageMs = now.getTime() - new Date(field.current.observedAt).getTime();
  return ageMs > maxAgeDays * 86_400_000;
}

// --- helpers ---------------------------------------------------------------

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function corroborate(a: number, b: number, independent: boolean): number {
  const best = Math.max(a, b);
  if (!independent) return best;
  // Two agreeing sources: close half the remaining gap to 1, capped at 0.95.
  return clamp01(Math.min(0.95, best + (1 - best) * 0.5));
}

function strongerEpistemics(a: Epistemics, b: Epistemics): Epistemics {
  const rank: Record<Epistemics, number> = {
    hypothesis: 0,
    recommendation: 1,
    'executable-action': 2,
    'inferred-fact': 3,
    fact: 4,
  };
  return rank[a] >= rank[b] ? a : b;
}

function laterOf(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sources) {
    const key = `${s.connectorId}::${s.locator ?? s.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
