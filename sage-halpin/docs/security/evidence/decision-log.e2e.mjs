// The decision log: every decision logged, saved on the server and reusable.
// Built app on :3001, mock AI. Run with SP=<scratchpad>.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const APP = 'http://localhost:3001', SP = process.env.SP;
const results = []; let step = '';
const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); if (!cond) console.log('FAIL:', name, info); };
const b = await chromium.launch();
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(`${step}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.|Failed to load resource.*(401|404|ERR_FAILED)/.test(m.text())) errors.push(`${step}: ${m.text()}`); }); p.on('dialog', (d) => d.accept()); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
const p = await ctx.newPage(); watch(p);
const email = `log${Date.now()}@harrowvale.co.uk`, PASSWORD = 'harrow and vale board 2026';
const entries = () => p.getByTestId('decision-entry');

try {
  step = 'legacy entry in the browser';
  await p.goto(APP + '/');
  // A scenario-analysis decision saved only in this browser, the old way.
  await p.evaluate(() => localStorage.setItem('sagehalpin_anon_decision_log', JSON.stringify([{ id: '2026-09-01T10:00:00.000Z', lockedAt: '2026-09-01T10:00:00.000Z', challenge: 'reduce_payroll', challengeLabel: 'Reduce Payroll', calibration: { risk: 0.2, ambition: 0.5, time: 0.5, cost: 0.8 }, decision: 'DONT_DO', rationale: 'Mock verdict: evidence insufficient.', feedbackRound: 0, outcome: 'not_implemented' }])));

  step = 'sign up';
  await p.goto(APP + '/signup');
  const f = p.getByTestId('form-signup');
  await f.locator('input').first().fill('Jo Reyes'); await f.locator('input[type=email]').fill(email); await f.locator('input[type=password]').fill(PASSWORD);
  await Promise.all([p.waitForURL((u) => u.pathname === '/organisation', { timeout: 15000 }), f.locator('button[type=submit]').click()]);
  await p.getByTestId('input-org-name').fill('Harrow & Vale');
  await p.waitForTimeout(1500);

  step = 'decision log';
  await p.goto(APP + '/log');
  await p.getByTestId('log-notice').waitFor({ timeout: 15000 });
  ok('the browser-only analysis decision is saved to the log', /1 decision from the scenario analysis/.test(await p.getByTestId('log-notice').innerText()));
  await entries().first().waitFor();
  const legacy = entries().first();
  ok('it shows as a scenario-analysis decision, with calibration and status', (await legacy.getAttribute('data-source')) === 'analysis' && /Reduce Payroll/.test(await legacy.innerText()) && /Don't do it/.test(await legacy.innerText()) && /Status: Not implemented/.test(await legacy.innerText()));
  await p.reload(); await entries().first().waitFor();
  ok('it is saved once, not again on reload', (await entries().count()) === 1 && (await p.getByTestId('log-notice').count()) === 0);

  step = 'log by hand';
  await p.getByTestId('button-log-decision').click();
  await p.getByTestId('input-decision-question').fill('Renew the Leeds lease?');
  await p.getByTestId('input-decision-decision').fill('Renew for five years with a break at year three');
  await p.selectOption('#d-position', 'support_with_conditions');
  await p.fill('#d-date', '2026-09-30');
  await p.fill('#d-rationale', 'Cheaper than moving.');
  await p.fill('#d-plan', 'CFO signs by 1 November');
  await p.getByTestId('button-save-decision').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=decision-entry]').length === 2, null, { timeout: 10000 });
  const manual = entries().filter({ hasText: 'Renew the Leeds lease?' });
  ok('a decision taken elsewhere is logged, dated, with its plan', (await manual.getAttribute('data-source')) === 'manual' && /CFO signs by 1 November/.test(await manual.innerText()) && /Support with conditions/.test(await manual.innerText()));

  step = 'board question';
  await p.goto(APP + '/questions/new'); await p.getByTestId('input-question').waitFor();
  await p.getByTestId('input-question').fill('Should we open a second factory?');
  await p.fill('#q-context', 'Demand is up 30%.');
  await p.getByTestId('input-question-docs').setInputFiles({ name: 'site-survey.txt', mimeType: 'text/plain', buffer: Buffer.from('Site B floods every five years.') });
  await p.getByTestId('mode-agents').click();
  await Promise.all([p.waitForURL((u) => /\/questions\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/new'), { timeout: 30000 }), p.getByTestId('button-send').click()]);
  const questionUrl = p.url();
  await p.getByTestId('button-convene').click();
  await p.getByText('Convened', { exact: false }).first().waitFor({ timeout: 20000 });
  await p.locator('textarea[aria-label="The decision"]').fill('Open the second factory at site A');
  await p.getByTestId('input-plan').fill('Lease signed by March');
  await p.getByTestId('button-decide').click();
  await p.getByTestId('decision-recorded').waitFor({ timeout: 15000 });
  ok('the question says the decision is saved in the decision log', await p.getByTestId('link-decision-log').isVisible());
  await Promise.all([p.waitForURL((u) => u.pathname === '/log'), p.getByTestId('link-decision-log').click()]);
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=decision-entry]').length === 3, null, { timeout: 10000 });
  const board = entries().filter({ hasText: 'Should we open a second factory?' });
  await board.locator('summary', { hasText: 'Context' }).click();
  const boardText = await board.innerText();
  ok('the board question\'s decision is in the log with its context, the chair\'s recommendation and documents', (await board.getAttribute('data-source')) === 'question' && /Demand is up 30%/.test(boardText) && /Shadow board chair:/.test(boardText) && /site-survey\.txt/.test(boardText) && /Lease signed by March/.test(boardText));
  ok('newest first', /second factory/.test(await entries().first().innerText()));

  step = 'search and filter';
  await p.getByTestId('input-search-decisions').fill('leeds');
  ok('search finds decisions by any of their text', (await entries().count()) === 1 && /Leeds/.test(await entries().first().innerText()));
  await p.getByTestId('input-search-decisions').fill('');
  await p.selectOption('[data-testid=filter-source]', 'question');
  ok('filter by source', (await entries().count()) === 1 && (await entries().first().getAttribute('data-source')) === 'question');
  await p.selectOption('[data-testid=filter-source]', 'all');

  step = 'outcomes';
  await board.locator('select[aria-label="How it turned out"]').selectOption('worse');
  await board.locator('input[aria-label="What happened"]').fill('Costs ran 20% over');
  await board.getByTestId('button-record-outcome').click();
  await board.getByTestId('decision-outcome').waitFor({ timeout: 15000 });
  ok('the outcome is recorded on the decision', /Worse than expected · Costs ran 20% over/.test(await board.getByTestId('decision-outcome').innerText()));
  ok('the agents propose lessons from it', /The agents proposed \d+ lesson/.test(await board.innerText()) || /lesson/.test(await board.innerText()));
  await p.selectOption('[data-testid=filter-outcome]', 'awaiting');
  ok('filter by awaiting outcome', (await entries().count()) === 2);
  await p.selectOption('[data-testid=filter-outcome]', 'all');

  step = 'edit and delete';
  await manual.getByTestId('button-edit-decision').click();
  await p.getByTestId('input-decision-decision').fill('Renew for three years');
  await p.getByTestId('button-save-decision').click();
  await p.waitForFunction(() => document.body.innerText.includes('Renew for three years'), null, { timeout: 10000 });
  ok('a logged decision can be edited', /updated/.test(await entries().filter({ hasText: 'Renew for three years' }).innerText()));
  await board.getByTestId('button-edit-decision').click();
  ok('a board question\'s decision stays as recorded (only notes can be added)', (await p.getByTestId('input-decision-decision').count()) === 0 && /stays as recorded/.test(await p.getByTestId('decision-form').innerText()));
  await p.getByRole('button', { name: 'Cancel' }).click();
  ok('a board question\'s decision has no Delete', (await board.getByTestId('button-delete-decision').count()) === 0);

  step = 'export';
  const [csv] = await Promise.all([p.waitForEvent('download'), p.getByTestId('button-export-csv').click()]);
  const csvPath = `${SP}/log-${Date.now()}.csv`; await csv.saveAs(csvPath);
  const csvText = readFileSync(csvPath, 'utf8');
  ok('export to CSV: every decision, with outcome', csvText.split('\r\n').length === 4 && csvText.includes('Should we open a second factory?') && csvText.includes('Worse than expected') && csvText.includes('Renew for three years'));
  const [json] = await Promise.all([p.waitForEvent('download'), p.getByTestId('button-export-json').click()]);
  const jsonPath = `${SP}/log-${Date.now()}.json`; await json.saveAs(jsonPath);
  ok('export to JSON', JSON.parse(readFileSync(jsonPath, 'utf8')).length === 3);

  step = 'revisit';
  await Promise.all([p.waitForURL((u) => u.pathname === '/questions/new'), board.getByTestId('button-revisit').click()]);
  await p.getByTestId('revisit-banner').waitFor({ timeout: 10000 });
  ok('revisit starts a new question from the decision', (await p.getByTestId('input-question').inputValue()) === 'Should we open a second factory?');
  const ctxText = await p.inputValue('#q-context');
  ok('with what was decided, why, and how it turned out', /Revisiting the board's decision/.test(ctxText) && /Open the second factory at site A/.test(ctxText) && /Worse than expected: Costs ran 20% over/.test(ctxText));

  step = 'second device';
  await p.waitForTimeout(3000);
  const B = await b.newContext({ viewport: { width: 1280, height: 900 } }); await B.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort()); const q = await B.newPage(); watch(q);
  await q.goto(APP + '/signin');
  const g = q.getByTestId('form-signin');
  await g.locator('input[type=email]').fill(email); await g.locator('input[type=password]').fill(PASSWORD);
  await Promise.all([q.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 }), g.locator('button[type=submit]').click()]);
  await q.goto(APP + '/log');
  await q.waitForFunction(() => document.querySelectorAll('[data-testid=decision-entry]').length === 3, null, { timeout: 15000 }).catch(() => {});
  ok('the whole log is there on another device', (await q.getByTestId('decision-entry').count()) === 3 && /Worse than expected/.test(await q.locator('main').innerText()));
  await q.goto(questionUrl);
  await B.close();

  step = 'delete';
  await p.goto(APP + '/log'); await entries().first().waitFor();
  await entries().filter({ hasText: 'Renew for three years' }).getByTestId('button-delete-decision').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=decision-entry]').length === 2, null, { timeout: 10000 });
  ok('a logged decision can be deleted', true);
  await p.screenshot({ path: `${SP}/decision-log.png`, fullPage: true });

  step = 'phone';
  await p.setViewportSize({ width: 390, height: 844 }); await p.reload(); await entries().first().waitFor();
  ok('phone: no sideways scroll', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
} catch (e) {
  ok(`journey stopped at "${step}"`, false, e.message.split('\n')[0]);
  await p.screenshot({ path: `${SP}/decisions-fail.png`, fullPage: true }).catch(() => {});
}
ok('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
for (const [s, n, i] of results) console.log(s, n, i ? `— ${i}` : '');
console.log(`${results.filter((r) => r[0] === 'FAIL').length} failed of ${results.length}`);
