import { describe, expect, it } from "vitest";
import { verifyQuote, settleStatus, normalise, contentWords } from "../server/evidence";
import type { Source } from "../shared/types";

const source = (id: string, text: string, extra: Partial<Source> = {}): Source => ({
  id,
  url: `https://${id}.test/`,
  kind: "prospect-site",
  title: null,
  retrievedAt: "2026-10-01T00:00:00.000Z",
  publishedAt: null,
  contentHash: "x",
  text,
  ...extra,
});

describe("quote verification", () => {
  const sources = new Map([
    ["s1", source("s1", "Northbridge   Freight is opening a\nnew bonded warehouse in Felixstowe this spring.")],
  ]);

  it("accepts a quote present in the source, ignoring whitespace and case", () => {
    expect(verifyQuote({ sourceId: "s1", quote: "opening a new Bonded warehouse in Felixstowe" }, sources)).toBe(true);
  });

  it("rejects a quote that is not in the source (model recollection)", () => {
    expect(verifyQuote({ sourceId: "s1", quote: "is opening three warehouses in Leeds" }, sources)).toBe(false);
  });

  it("rejects a quote attributed to a source that does not exist", () => {
    expect(verifyQuote({ sourceId: "missing", quote: "opening a new bonded warehouse" }, sources)).toBe(false);
  });

  it("rejects a quote too short to be evidence", () => {
    expect(verifyQuote({ sourceId: "s1", quote: "Freight" }, sources)).toBe(false);
  });

  it("normalises typographic quotes and dashes", () => {
    const s = new Map([["s2", source("s2", "We’re the UK’s — only — provider")]]);
    expect(verifyQuote({ sourceId: "s2", quote: "We're the UK's - only - provider" }, s)).toBe(true);
    expect(normalise("A B")).toBe("a b");
  });
});

describe("epistemic status", () => {
  const sources = new Map([["s1", source("s1", "Our platform automates customs declarations for freight forwarders.")]]);

  it("keeps FACT when at least one quote verifies", () => {
    const r = settleStatus(
      { status: "FACT", evidence: [{ sourceId: "s1", quote: "automates customs declarations for freight forwarders" }], basis: null },
      sources,
    );
    expect(r.status).toBe("FACT");
    expect(r.evidence).toHaveLength(1);
  });

  it("downgrades an unevidenced FACT with a basis to INFERENCE, and says why", () => {
    const r = settleStatus(
      { status: "FACT", evidence: [{ sourceId: "s1", quote: "reduces clearance time by 60%" }], basis: "Automation usually speeds clearance" },
      sources,
    );
    expect(r.status).toBe("INFERENCE");
    expect(r.evidence).toHaveLength(0);
    expect(r.note).toMatch(/not found/i);
  });

  it("downgrades an unevidenced FACT without a basis to UNKNOWN", () => {
    const r = settleStatus({ status: "FACT", evidence: [], basis: null }, sources);
    expect(r.status).toBe("UNKNOWN");
  });

  it("does not let an INFERENCE without a basis stand", () => {
    const r = settleStatus({ status: "INFERENCE", evidence: [], basis: "" }, sources);
    expect(r.status).toBe("UNKNOWN");
  });

  it("never upgrades UNKNOWN", () => {
    const r = settleStatus(
      { status: "UNKNOWN", evidence: [{ sourceId: "s1", quote: "automates customs declarations for freight forwarders" }], basis: null },
      sources,
    );
    expect(r.status).toBe("UNKNOWN");
  });
});

describe("content words", () => {
  it("drops stopwords and short words", () => {
    expect(contentWords("The bonded warehouse in Felixstowe opens")).toEqual(["bonded", "warehouse", "felixstowe", "opens"]);
  });
});
