// A Download button on every page, offering what is relevant to that page.
// Built app on :3001, memory store, mock AI. Run with SP=<scratchpad>.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const APP = 'http://localhost:3001', SP = process.env.SP;
const results = []; let step = '';
const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); if (!cond) console.log('FAIL:', name, info); };
const b = await chromium.launch();
const errors = [];
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(`${step}: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.|Failed to load resource.*(401|404|ERR_FAILED)/.test(m.text())) errors.push(`${step}: ${m.text()}`); });
p.on('dialog', (d) => d.accept());

const menuItems = async () => { await p.getByTestId('button-download').click(); await p.getByTestId('download-menu').waitFor(); return p.getByTestId('download-item').allInnerTexts(); };
const closeMenu = () => p.keyboard.press('Escape');
/** Clicks a menu item and returns the downloaded file's name and text. */
async function grab(label, path) {
  if (path) { await p.goto(APP + path); await p.waitForTimeout(800); }
  if (!(await p.getByTestId('download-menu').isVisible().catch(() => false))) await p.getByTestId('button-download').click();
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.getByTestId('download-item').filter({ hasText: label }).first().click()]);
  const to = `${SP}/dl-${Date.now()}-${d.suggestedFilename()}`; await d.saveAs(to);
  return { name: d.suggestedFilename(), text: readFileSync(to, 'utf8') };
}

try {
  step = 'signed out';
  await p.goto(APP + '/signin'); await p.waitForTimeout(500);
  ok('no Download button on sign-in', (await p.getByTestId('button-download').count()) === 0);
  await p.goto(APP + '/'); await p.waitForTimeout(800);
  ok('the home page has the Download button', await p.getByTestId('button-download').isVisible());
  const home = await grab('This page as a Word document');
  ok('the page itself downloads as a Word document, without buttons or scripts', /\.doc$/.test(home.name) && home.text.startsWith('<!doctype html>') && !/<button|<script/i.test(home.text) && home.text.length > 500);

  step = 'sign up';
  await p.goto(APP + '/signup');
  const f = p.getByTestId('form-signup');
  await f.locator('input').first().fill('Jo Reyes'); await f.locator('input[type=email]').fill(`dl${Date.now()}@harrowvale.co.uk`); await f.locator('input[type=password]').fill('harrow and vale board 2026');
  await Promise.all([p.waitForURL((u) => u.pathname === '/organisation', { timeout: 15000 }), f.locator('button[type=submit]').click()]);
  await p.getByTestId('input-org-name').fill('Harrow & Vale');
  await p.fill('#org-sector', 'Instruments'); await p.fill('#org-profile', '120 people making precision instruments.');
  await p.getByTestId('button-add-person').click();
  await p.fill('#p-name', 'Sam Patel'); await p.fill('#p-role', 'Fractional CFO'); await p.fill('#p-email', 'sam@example.com');
  await p.getByTestId('button-save-person').click();
  await p.waitForTimeout(1500);

  step = 'organisation';
  const orgItems = await menuItems();
  ok('Your board offers the board, the people and the data', orgItems.some((t) => /The board: organisation/.test(t)) && orgItems.some((t) => /^The people/.test(t)) && orgItems.some((t) => /The board as data/.test(t)) && orgItems.some((t) => /Print or save as PDF/.test(t)), orgItems.join(' | '));
  const board = await grab('The board: organisation');
  ok('the board document has the organisation, people and agents', /Harrow &amp; Vale/.test(board.text) && /Sam Patel/.test(board.text) && /The shadow board/.test(board.text));
  const people = await grab('The people');
  ok('the people as CSV', people.text.includes('Name,Role,Email') && people.text.includes('Sam Patel,Fractional CFO,sam@example.com'));
  const orgJson = await grab('The board as data');
  const parsed = JSON.parse(orgJson.text);
  ok('the board as data, without the workspace access token', parsed.name === 'Harrow & Vale' && !('workspace' in parsed) && !/adminToken/.test(orgJson.text));
  await closeMenu();

  step = 'board question';
  await p.goto(APP + '/questions/new'); await p.getByTestId('input-question').waitFor();
  await p.getByTestId('input-question').fill('Should we open a second factory?');
  await p.fill('#q-context', 'Demand is up 30%.');
  await p.getByTestId('input-question-docs').setInputFiles({ name: 'site-survey.txt', mimeType: 'text/plain', buffer: Buffer.from('Site B floods every five years.') });
  await Promise.all([p.waitForURL((u) => /\/questions\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/new'), { timeout: 30000 }), p.getByTestId('button-send').click()]);
  const questionUrl = p.url();
  await p.locator('a', { hasText: 'Email them' }).first().waitFor({ timeout: 15000 }).catch(() => {});
  const mailtos = await p.locator('a[href^="mailto:"]').evaluateAll((as) => as.map((a) => a.href));
  const link = mailtos.map((m) => (decodeURIComponent(m).match(/https?:\/\/\S+\/respond\/[A-Za-z0-9_-]+/) || [])[0]).find(Boolean);
  await p.getByTestId('tab-agents').click(); await p.getByTestId('button-convene').click();
  await p.getByText('Convened', { exact: false }).first().waitFor({ timeout: 20000 });
  await p.locator('textarea[aria-label="The decision"]').fill('Open the second factory at site A');
  await p.getByTestId('input-plan').fill('Lease signed by March');
  if (await p.getByTestId('confirm-without-permanent').count()) await p.getByTestId('confirm-without-permanent').check();
  await p.getByTestId('button-decide').click(); await p.getByTestId('decision-recorded').waitFor({ timeout: 15000 });
  const qItems = await menuItems();
  ok('a board question offers its record, answers, data and its documents', qItems.some((t) => /full record/.test(t)) && qItems.some((t) => /people's answers/.test(t)) && qItems.some((t) => /This question's documents: every file/.test(t)), qItems.join(' | '));
  const record = await grab('This board question: the full record');
  ok('the board question record has the question, context, shadow board and decision', /Should we open a second factory\?/.test(record.text) && /Demand is up 30%/.test(record.text) && /The shadow board/.test(record.text) && /Open the second factory at site A/.test(record.text) && /Lease signed by March/.test(record.text));
  const answers = await grab("The people's answers");
  ok("the people's answers as CSV", answers.text.startsWith('﻿Name,Role,Permanent,Answered') && answers.text.includes('Sam Patel'));
  const qJson = await grab('The full record as data');
  ok('the record as data, with no access tokens', JSON.parse(qJson.text).decision.decision === 'Open the second factory at site A' && !/adminToken|tokenHash/.test(qJson.text));
  const sentinel = await grab("This question's documents: what Sentinel said");
  ok("the question's documents: what Sentinel said", /site-survey\.txt/.test(sentinel.text) && /Mock: Sentinel has read the file/.test(sentinel.text));
  const file = await grab("This question's documents: every file");
  ok('and the files themselves', file.name === 'site-survey.txt' && file.text === 'Site B floods every five years.');
  await closeMenu();

  step = 'decision log';
  await p.goto(APP + '/log'); await p.getByTestId('decision-entry').first().waitFor({ timeout: 10000 });
  const logCsv = await grab('The decision log');
  ok('the decision log as CSV', logCsv.text.includes('Open the second factory at site A'));
  const logDoc = await grab('The decision log as a document');
  ok('the decision log as a Word document', /\.doc$/.test(logDoc.name) && /Open the second factory at site A/.test(logDoc.text) && /Lease signed by March/.test(logDoc.text));
  await closeMenu();

  step = 'documents';
  await p.goto(APP + '/documents'); await p.getByTestId('attach-panel').waitFor({ timeout: 10000 });
  await p.getByTestId('attach-panel').getByTestId('input-files').setInputFiles({ name: 'policy.txt', mimeType: 'text/plain', buffer: Buffer.from('No debt above 2x EBITDA.') });
  await p.getByTestId('button-attach').click(); await p.getByTestId('document-card').first().waitFor({ timeout: 15000 });
  const list = await grab('Company documents: list');
  ok('the company documents as a list', list.text.includes('policy.txt') && list.text.includes('Latest instruction'));
  const all = await grab('Company documents: every file');
  ok('every company document downloads', all.name === 'policy.txt' && all.text === 'No debt above 2x EBITDA.');
  await closeMenu();

  step = 'other pages';
  for (const [path, want] of [['/agents', 'What the agents have learned'], ['/checkpoint', 'The checkpoint history'], ['/questions', 'Board questions asked'], ['/dashboard', 'Workspace dashboard data']]) {
    await p.goto(APP + path); await p.waitForTimeout(1500);
    const items = await menuItems();
    ok(`${path} offers ${want}`, items.some((t) => t.includes(want)), items.join(' | '));
    const got = await grab(want);
    ok(`${path}: ${want} downloads`, got.text.length > 20, got.name);
    await closeMenu();
  }
  for (const path of ['/horizon', '/boardroom', '/analysis', '/organisation', '/documents', '/questions/new']) {
    await p.goto(APP + path); await p.waitForTimeout(800);
    ok(`${path} has the Download button`, await p.getByTestId('button-download').isVisible());
  }

  step = 'shadow board session';
  await p.goto(APP + '/boardroom'); await p.waitForTimeout(800);
  await p.locator('textarea').first().fill('Should we raise prices by 5%?');
  await p.locator('textarea').first().press('Enter');
  await p.waitForFunction(() => /Mock/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  const session = await grab('This shadow board session');
  ok('a shadow board session downloads with the question and every reply', /raise prices by 5%/.test(session.text) && /Mock/.test(session.text));
  await closeMenu();

  step = 'questionnaire';
  if (link) {
    await p.goto(link.replace(/^.*?\/respond\//, APP + '/respond/')); await p.waitForTimeout(1500);
    const q = await grab('This questionnaire and my answers');
    ok('the person asked can download the questionnaire with their answers', /Should we open a second factory\?/.test(q.text) && /What is your position\?|position/i.test(q.text));
    await closeMenu();
  } else ok('a questionnaire link exists', false);

  step = 'phone';
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(APP + '/log'); await p.waitForTimeout(800);
  const box = await p.getByTestId('button-download').boundingBox();
  ok('phone: the button is on screen, no sideways scroll', !!box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844 && (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, JSON.stringify(box));
  await p.getByTestId('button-download').click();
  const menuBox = await p.getByTestId('download-menu').boundingBox();
  ok('phone: the menu fits the screen', !!menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, JSON.stringify(menuBox));
  await p.screenshot({ path: `${SP}/download-phone.png` });
} catch (e) {
  ok(`journey stopped at "${step}"`, false, e.message.split('\n')[0]);
  await p.screenshot({ path: `${SP}/download-fail.png`, fullPage: true }).catch(() => {});
}
ok('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
for (const [s, n, i] of results) console.log(s, n, i ? `— ${i}` : '');
console.log(`${results.filter((r) => r[0] === 'FAIL').length} failed of ${results.length}`);
