/**
 * The non-negotiable check: the SaleSonic demo dataset must carry every
 * narrative assertion from the source document, and must not put words in the
 * document's mouth. Both directions are asserted here so the dataset cannot
 * drift in either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dataset from '../data/salesonic/salesonic-demo-data.json';
import {
  checkCoverage,
  formatReport,
  narrativeGroups,
  narrativePhraseCount,
  normalise,
} from '../src/lib/salesonic/narrative-coverage';

const sourceDocument = readFileSync(resolve(__dirname, '../docs/salesonic/SOURCE-DOCUMENT.txt'), 'utf-8');

describe('SaleSonic narrative coverage', () => {
  it('carries every narrative assertion from the source document', () => {
    const report = checkCoverage(dataset);
    if (report.missing.length > 0) {
      // The formatted report is the useful failure message: it names exactly
      // which sentence from the document has gone missing from the data.
      throw new Error(`\n${formatReport(report, 'SaleSonic demo dataset')}\n`);
    }
    expect(report.coveragePct).toBe(100);
  });

  it('asserts nothing the source document does not say', () => {
    const doc = normalise(sourceDocument);
    const fabricated = narrativeGroups.flatMap((g) =>
      g.phrases.filter((p) => !doc.includes(normalise(p))).map((p) => `[${g.id}] ${p}`),
    );
    expect(fabricated).toEqual([]);
  });

  it('covers all six deals, their contacts, history and anecdotes', () => {
    expect(dataset.deals).toHaveLength(6);
    for (const deal of dataset.deals) {
      expect(deal.contacts.length, `${deal.client} contacts`).toBe(6);
      expect(deal.history.length, `${deal.client} history`).toBeGreaterThanOrEqual(4);
      expect(deal.anecdote, `${deal.client} anecdote`).toBeTruthy();
      const roles = deal.contacts.map((c) => c.roleCode);
      expect(roles, `${deal.client} roles`).toEqual(
        expect.arrayContaining(['EB', 'TB', 'UB', 'Champion', 'Influencer', 'Approver']),
      );
    }
  });

  it('keeps the three personas and their Today’s Priorities', () => {
    for (const persona of [dataset.personas.salesman, dataset.personas.manager, dataset.personas.director]) {
      expect(persona.todaysPriorities.length).toBeGreaterThanOrEqual(4);
      expect(persona.sections.length).toBeGreaterThanOrEqual(5);
      expect(persona.purpose).toBeTruthy();
    }
  });

  it('keeps the document’s own forecast arithmetic', () => {
    const byId = Object.fromEntries(dataset.deals.map((d) => [d.id, d]));
    expect(byId['coors-enterprise-stores-rollout']!.valueGbp).toBe(600_000);
    expect(byId['barclays-core-banking-upgrade']!.weightedValueGbp).toBe(400_000);
    // 250K at 65% is 162.5K; the document states 160K, so the document wins.
    expect(byId['asda-enterprise-stores-rollout-phase-2']!.weightedValueGbp).toBe(160_000);
    expect(dataset.personas.manager.pipelineGapGbp).toBe(180_000);
    expect(dataset.commercialDNA.annualTarget.valueGbp).toBe(4_200_000);
  });

  it('lists all ten capabilities and all six diagnostic signals', () => {
    expect(dataset.capabilities).toHaveLength(10);
    expect(dataset.diagnosticSignals).toHaveLength(6);
    expect(dataset.diagnosticSignalsShortForm).toHaveLength(6);
  });

  it('keeps the Replit Agent prompt carrying the full narrative', () => {
    // The prompt is what actually builds the Repl. A prompt missing a sentence
    // builds an app missing that sentence, so it is held to the same bar.
    const prompt = readFileSync(resolve(__dirname, '../docs/salesonic/REPLIT-AGENT-PROMPT.md'), 'utf-8');
    const report = checkCoverage(prompt);
    if (report.missing.length > 0) {
      throw new Error(`\n${formatReport(report, 'Replit Agent prompt')}\n`);
    }
    expect(report.coveragePct).toBe(100);
  });

  it('tracks a meaningful number of required phrases', () => {
    expect(narrativePhraseCount).toBeGreaterThanOrEqual(250);
  });
});
