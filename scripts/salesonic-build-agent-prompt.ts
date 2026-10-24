/**
 * Generate the paste-into-Replit-Agent prompt from the demo dataset.
 *
 * Generated rather than hand-written so the prompt cannot drift from the data,
 * and so the same coverage check that guards the dataset can be run against
 * the prompt itself — a prompt missing a sentence would build an app missing
 * that sentence.
 */

import { writeFileSync } from 'node:fs';
import dataset from '../data/salesonic/salesonic-demo-data.json';

type Deal = (typeof dataset)['deals'][number];

const out: string[] = [];
const w = (line = '') => out.push(line);

w('# Replit Agent prompt — populate the SaleSonic personas app');
w();
w('Paste everything below this line into the SaleSonic Repl’s Agent.');
w();
w('---');
w();
w('Populate this app with the SaleSonic demonstration dataset below. This is real');
w('demo content, not placeholder text: load it exactly as written. Do not summarise,');
w('paraphrase or replace any quoted sentence with generic sales copy — the specific');
w('names, figures and quotes are the whole point of the demo.');
w();
w('Build three role-specific dashboards (Salesman, Sales Manager, Sales Director /');
w('Executive) over one shared set of deal data. ' + dataset.dashboardSummary.designPrinciple);
w();

w('## Commercial DNA (the foundation — entered once, calibrates everything)');
w();
const dna = dataset.commercialDNA;
w(dna.description);
w();
w(`- Annual/quarterly targets: ${dna.annualTarget.display}`);
w(`- Products/services & average deal size: ${dna.productsAndAverageDealSize.display}`);
w(`- Compensation plans: ${dna.compensationPlans.display}`);
w(`- Sales methodology: ${dna.salesMethodology.display}`);
w(`- Ideal Customer Profile: ${dna.idealCustomerProfile.display}`);
w(`- Average sales cycle: ${dna.averageSalesCycle.display}`);
w(`- Target margins: ${dna.targetMargins.display}`);
w(`- Geographic coverage/territories: ${dna.geographicCoverage.display}`);
w(`- Historical win rates: ${dna.historicalWinRates.display}`);
w(`- Stage conversion rates: ${dna.stageConversionRates.display}`);
w(`- Data sources: ${dna.dataSources}`);
w();

w('## The six deals');
w();
w(dataset.meta.premise);
w();
w('| Client | Account Manager | Deal Name | Value | Stage / Status | Close Date | Probability |');
w('|---|---|---|---|---|---|---|');
for (const d of dataset.deals as Deal[]) {
  w(`| ${d.client} | ${d.accountManager} | ${d.dealName} | ${d.valueDisplay} | ${d.statusLabel} | ${d.closeDateDisplay} | ${d.probabilityDisplay} |`);
}
w();
w('Each deal below carries all six contact roles, its dated activity history, and one');
w('anecdote. Attach the history as activity records against the deal, and show the');
w('anecdote on the deal record — it is what makes the recommendations specific.');
w();

for (const d of dataset.deals as Deal[]) {
  w(`### ${d.headline}`);
  w();
  w(`Account Manager: ${d.accountManager}`);
  w();
  w('Key contacts:');
  for (const c of d.contacts) {
    const q = 'qualifier' in c && c.qualifier ? ` (${c.qualifier})` : '';
    w(`- ${c.role} (${c.roleCode}): ${c.name} – ${c.title}${q}`);
  }
  w();
  w(`${d.historyWindow}:`);
  for (const h of d.history) w(`- ${h.period}: ${h.note}`);
  w();
  w(`Anecdotal information: “${d.anecdote}”`);
  if ('blocker' in d && d.blocker) w(`\nCurrent blocker: ${d.blocker}`);
  if ('lossReason' in d && d.lossReason) w(`\nLoss reason: ${d.lossReason}`);
  if ('lossLearning' in d && d.lossLearning) w(`Loss learning: ${d.lossLearning}`);
  if ('competitive' in d && d.competitive) {
    w(`\nCompetitive: ${d.competitive.competitor} — ${d.competitive.pricePosition} — ${d.competitive.outcome}`);
  }
  if ('riskFlags' in d && d.riskFlags) w(`\nRisk flags: ${d.riskFlags.join('; ')}`);
  w();
}

const personaOrder = [dataset.personas.salesman, dataset.personas.manager, dataset.personas.director];
w('## The three dashboards');
w();
for (const [i, p] of personaOrder.entries()) {
  w(`### ${i + 1}. ${p.dashboardTitle}`);
  w();
  w(`Who: ${p.who}`);
  w(`Purpose: ${p.purpose}`);
  w(`Lens: ${p.lens}`);
  w();
  w('Sections:');
  for (const s of p.sections) {
    const place = 'placement' in s && s.placement ? ` (${s.placement})` : '';
    w(`- **${s.title}**${place} — ${s.description}`);
  }
  w();
  w('Today’s Priorities (show these verbatim, in this order):');
  for (const t of p.todaysPriorities) {
    const owner = 'owner' in t && t.owner ? `${t.owner} — ` : '';
    const label = 'dealLabel' in t && t.dealLabel ? `${t.dealLabel}: ` : '';
    w(`${t.rank}. ${owner}${label}“${t.action}”`);
  }
  w();

  if ('recommendations' in p) {
    w('Per-deal recommendations (show against each deal):');
    for (const r of p.recommendations) {
      w(`- ${r.summary}`);
      w(`  → “${r.recommendation}”`);
    }
    w();
    w(`One-click actions: ${p.quickActions.join(', ')}.`);
    w();
  }
  if ('highlights' in p) {
    w('What the dashboard highlights:');
    for (const h of p.highlights) w(`- ${h.label}: ${h.detail}`);
    w();
    w(`Pipeline gap: ${p.pipelineGapDisplay} of high-confidence opportunities needed this quarter.`);
    w(`Tools: ${p.tools.join('; ')}.`);
    w();
  }
  if ('calibratedForecast' in p) {
    w('Calibrated forecast (use these exact bands and figures):');
    for (const b of p.calibratedForecast) w(`- ${b.label}`);
    w();
    w(p.revenueGapNote);
    w();
    w('Executive dashboard forecast summary:');
    for (const b of p.calibratedForecast) w(`- ${b.executiveDashboardLabel}`);
    w();
    w(`War Room: ${p.warRoomRecommendation.scope}. ${p.warRoomRecommendation.mechanism}.`);
    w(`Example logged recommendation: “${p.warRoomRecommendation.example}”`);
    w();
    w(`Board-ready narrative: “${p.boardNarrative}”`);
    w();
  }
  w(`What this person controls from here: ${p.controls}`);
  w();
}

w('### How the three dashboards work together');
w();
for (const l of dataset.dashboardSummary.lines) w(`- ${l}`);
w();
w(dataset.dashboardSummary.principle);
w();

w('## Why the recommendations are specific, not academic');
w();
w('Because the data gives the model:');
for (const b of dataset.howSaleSonicUsesTheData.because) w(`- ${b}`);
w();
w('SaleSonic can generate recommendations such as:');
for (const r of dataset.howSaleSonicUsesTheData.nonAcademicRecommendations) w(`- “${r}”`);
w();
w(dataset.howSaleSonicUsesTheData.difference);
w();

w('## Capability catalogue (reference section — what SaleSonic does)');
w();
for (const c of dataset.capabilities) {
  const sub = c.subtitle ? ` (${c.subtitle})` : '';
  w(`### ${c.number}. ${c.name}${sub}`);
  w();
  w(`What it does: ${c.whatItDoes}`);
  if (c.infoNeeded.length > 0) {
    w();
    w('Info needed:');
    for (const i of c.infoNeeded) w(`- ${i}`);
  }
  if (c.dataSources) w(`\nData sources: ${c.dataSources}`);
  if (c.notes.length > 0) {
    w();
    w('Notes:');
    for (const n of c.notes) w(`- ${n}`);
  }
  w();
}

w('## Diagnostic signals SaleSonic surfaces');
w();
w('| Signal | What it often means | Data that triggers it |');
w('|---|---|---|');
for (const s of dataset.diagnosticSignals) w(`| ${s.signal} | ${s.meaning} | ${s.trigger} |`);
w();
w('Short form for the dashboard:');
for (const s of dataset.diagnosticSignalsShortForm) w(`- ${s}`);
w();

w('## Data sources SaleSonic relies on');
w();
for (const s of dataset.dataSourceSummary) w(`- ${s}`);
w();

w(`## ${dataset.dataRequirementsChecklist.title}`);
w();
for (const section of dataset.dataRequirementsChecklist.sections) {
  w(`### ${section.number}. ${section.title}`);
  w();
  w('| Data Item | Example / Notes | Source | Priority |');
  w('|---|---|---|---|');
  for (const r of section.rows) w(`| ${r.dataItem} | ${r.example} | ${r.source} | ${r.priority} |`);
  w();
}

w(`### ${dataset.minimumViableData.title}`);
w();
for (const i of dataset.minimumViableData.items) w(`- ${i}`);
w();
w(dataset.minimumViableData.outcome);
w();

w('## How to use this data');
w();
for (const h of dataset.meta.howToUseThisData) w(`- ${h}`);
w();
w(dataset.meta.bottomLine);
w();

w('## Two fidelity rules');
w();
w('- Asda at 65% of £250K is £162.5K, but the source states £160K. Use £160K.');
w('- TFL’s weighting is described only as “heavily discounted”. Show that label; the');
w('  arithmetic value is £52,500.');
w();
w('Every name, figure and quoted sentence above must be visible somewhere in the');
w('finished app. Do not drop content to make a layout tidier — add a section instead.');

writeFileSync('docs/salesonic/REPLIT-AGENT-PROMPT.md', out.join('\n') + '\n', 'utf-8');
console.log(`wrote docs/salesonic/REPLIT-AGENT-PROMPT.md (${out.length} lines)`);
