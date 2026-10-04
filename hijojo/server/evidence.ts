// Provenance. A statement is a FACT only if a quotation from a stored, retrieved
// source supports it; the quotation is checked against the stored text, so a
// model cannot cite what it merely remembers or imagines.

import { createHash } from "node:crypto";
import type { Epistemic, EvidenceRef, Source } from "../shared/types";

export const MIN_QUOTE_CHARS = 12;

export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type SourceLookup = Map<string, Pick<Source, "text">> | ((id: string) => Pick<Source, "text"> | undefined);

function lookup(sources: SourceLookup, id: string) {
  return typeof sources === "function" ? sources(id) : sources.get(id);
}

export function verifyQuote(ref: EvidenceRef, sources: SourceLookup): boolean {
  const quote = normalise(ref.quote ?? "");
  if (quote.length < MIN_QUOTE_CHARS) return false;
  const src = lookup(sources, ref.sourceId);
  if (!src) return false;
  return normalise(src.text).includes(quote);
}

export interface Proposed {
  status: Epistemic;
  evidence: EvidenceRef[];
  basis: string | null;
}

export interface Settled {
  status: Epistemic;
  evidence: EvidenceRef[];
  basis: string | null;
  note: string | null;
}

/**
 * Decide the status a statement is entitled to. Only verified quotations are
 * kept. Status can be lowered, never raised.
 */
export function settleStatus(p: Proposed, sources: SourceLookup): Settled {
  const verified = p.evidence.filter((e) => verifyQuote(e, sources));
  const dropped = p.evidence.length - verified.length;
  const basis = p.basis && p.basis.trim() ? p.basis.trim() : null;
  const droppedNote = dropped > 0 ? `${dropped} cited quotation(s) not found in the stored source` : null;

  if (p.status === "UNKNOWN") return { status: "UNKNOWN", evidence: verified, basis, note: droppedNote };

  if (p.status === "FACT") {
    if (verified.length > 0) return { status: "FACT", evidence: verified, basis, note: droppedNote };
    if (basis) {
      return { status: "INFERENCE", evidence: [], basis, note: droppedNote ?? "No supporting quotation; held as inference" };
    }
    return { status: "UNKNOWN", evidence: [], basis: null, note: droppedNote ?? "No supporting quotation and no basis" };
  }

  // INFERENCE
  if (!basis) return { status: "UNKNOWN", evidence: verified, basis: null, note: "Inference given without a basis" };
  return { status: "INFERENCE", evidence: verified, basis, note: droppedNote };
}

const STOPWORDS = new Set(
  "about above after again against their there these those which while would could should where whose being because before below between during other under until within without into from with that this have has had were your yours ours ourselves them they then than what when will just more most some such only very also each both over same here".split(
    " ",
  ),
);

/** Distinctive words, used to judge whether a message is specific to its recipient. */
export function contentWords(text: string): string[] {
  return normalise(text)
    .replace(/[^a-z0-9' -]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
}
