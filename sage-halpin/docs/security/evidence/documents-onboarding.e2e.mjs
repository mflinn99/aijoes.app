// Uploads at any stage, Sentinel instructions, board-question documents,
// skippable onboarding (contact details required) and missing-data notes.
// Built app on :3001, memory store, mock AI.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
const APP = 'http://localhost:3001', SP = process.env.SP;
const results = []; let step = '';
const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); if (!cond) console.log('FAIL:', name, info); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(`${step}: ${e.message}`));
p.on('console', m => { if (m.type() === 'error' && !/fonts\.|Failed to load resource.*(401|404|ERR_FAILED)/.test(m.text())) errors.push(`${step}: ${m.text()}`); });
p.on('dialog', d => d.accept());

// Test files
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content), data = deflateRawSync(raw), n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc32(raw), 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); centrals.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(entries).length, 8); e.writeUInt16LE(Object.keys(entries).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}
writeFileSync(`${SP}/Strategy 2027.docx`, zip({ 'word/document.xml': '<w:document><w:p><w:t>Strategy 2027: grow margin to 18%</w:t></w:p></w:document>' }));
writeFileSync(`${SP}/board-pack.pdf`, '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
writeFileSync(`${SP}/site-survey.txt`, 'Site B floods every five years.');
writeFileSync(`${SP}/cv-jo.pdf`, '%PDF-1.4\nCV of Jo Reyes\n%%EOF\n');
writeFileSync(`${SP}/agm.mp4`, Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4]));

try {
  step = 'sign up';
  const email = `admin${Date.now()}@harrowvale.co.uk`;
  await p.goto(APP + '/signup');
  const f = p.getByTestId('form-signup');
  await f.locator('input').first().fill('Jo Reyes');
  await f.locator('input[type=email]').fill(email);
  await f.locator('input[type=password]').fill('harrow and vale board 2026');
  await Promise.all([p.waitForURL(u => u.pathname === '/organisation', { timeout: 15000 }), f.locator('button[type=submit]').click()]);
  ok('sign-up lands on Your board to add contact details', new URL(p.url()).pathname === '/organisation');
  ok('contact details start from the account (name and email)', await p.getByTestId('input-lead-name').inputValue() === 'Jo Reyes' && await p.getByTestId('input-lead-email').inputValue() === email);
  ok('organisation name is marked required', await p.getByTestId('error-org-name').isVisible());

  step = 'onboarding';
  const s1 = p.getByTestId('onboarding-step-1');
  ok('step 1 is the contact details, required, with no Skip', /contact details/i.test(await s1.innerText()) && /Required/i.test(await s1.innerText()) && await s1.getByRole('button', { name: 'Skip' }).count() === 0);
  ok('every other step can be skipped', await p.getByTestId('button-skip-about').isVisible() && await p.getByTestId('button-skip-people').isVisible());
  await p.getByTestId('input-org-name').fill('Harrow & Vale');
  await p.waitForTimeout(300);
  ok('contact details complete: step 1 done, required error gone', await s1.getAttribute('data-done') === 'true' && !(await p.getByTestId('error-org-name').isVisible().catch(() => false)));
  ok('skipped sections show what is missing', await p.getByTestId('missing-badge-org-sector').isVisible() && await p.getByTestId('missing-badge-org-profile').isVisible());
  await p.getByTestId('button-skip-about').click();
  ok('a skipped step is marked Skipped and can be undone', await p.getByTestId('onboarding-step-2').getAttribute('data-skipped') === 'true' && await p.getByTestId('button-unskip-about').isVisible());
  await p.getByTestId('button-skip-rest').click();
  await p.waitForTimeout(200);
  const gs = p.getByTestId('getting-started');
  ok('"Skip the rest": setup folds away, saying what was skipped', await gs.getAttribute('data-complete') === 'true' && /steps skipped/.test(await gs.innerText()), await gs.innerText());
  ok('"Ask the board a question" is available with only contact details', await p.getByTestId('button-ask-question').isVisible());
  await p.reload(); await p.getByTestId('getting-started').waitFor();
  ok('skips are remembered', await p.getByTestId('getting-started').getAttribute('data-complete') === 'true');
  await p.screenshot({ path: `${SP}/docs-onboarding.png` });

  step = 'attach anywhere';
  await p.goto(APP + '/agents'); await p.getByTestId('button-attach-anywhere').waitFor();
  await p.getByTestId('missing-profile').waitFor({ timeout: 10000 }).catch(() => {});
  ok('missing information is pointed out where it is used (Agents)', await p.getByTestId('missing-profile').isVisible());
  await p.getByTestId('button-attach-anywhere').click();
  const dlg = p.getByRole('dialog');
  ok('Attach dialog says where the file is attached from', /Attached from Agents/.test(await dlg.innerText()));
  await dlg.getByTestId('input-files').setInputFiles(`${SP}/Strategy 2027.docx`);
  await dlg.getByTestId('input-instruction').fill('Pull out our targets');
  await dlg.getByTestId('button-attach').click();
  await dlg.getByTestId('sentinel-response').waitFor({ timeout: 15000 });
  await p.waitForFunction(() => /Mock: Sentinel has read/.test(document.querySelector('[role=dialog] [data-testid=sentinel-response]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const said = await dlg.getByTestId('sentinel-response').textContent();
  ok('Sentinel answers the instruction in the dialog', /Mock: Sentinel has read the file/.test(said) && /Pull out our targets/.test(said), said);
  await p.screenshot({ path: `${SP}/docs-attach-dialog.png` });
  await Promise.all([p.waitForURL(u => u.pathname === '/documents'), dlg.getByRole('link', { name: 'See all documents' }).click()]);

  step = 'documents page';
  await p.getByTestId('document-card').first().waitFor({ timeout: 10000 });
  ok('Documents lists the file, attached at Agents', /Strategy 2027\.docx/.test(await p.getByTestId('document-list').innerText()) && /at Agents/.test(await p.getByTestId('document-list').innerText()));
  await p.getByTestId('attach-panel').getByTestId('input-files').setInputFiles([`${SP}/board-pack.pdf`, `${SP}/agm.mp4`]);
  ok('several files at once', /2 files/.test(await p.getByTestId('button-attach').innerText()));
  await p.getByTestId('button-attach').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=document-card]').length === 3, null, { timeout: 20000 });
  const cards = p.getByTestId('document-card');
  const pdfCard = cards.filter({ hasText: 'board-pack.pdf' });
  const mp4Card = cards.filter({ hasText: 'agm.mp4' });
  ok('a PDF is sent to Sentinel as a document', /\(document attached\)/.test(await pdfCard.getByTestId('sentinel-response').innerText()));
  ok('any other type is kept, and Sentinel says it can\'t read it', /can't read this format/.test(await mp4Card.innerText()));
  await pdfCard.getByTestId('input-ask').fill('Draft three questions for the CFO');
  await pdfCard.getByTestId('button-ask').click();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-testid=document-card]')].some((c) => c.textContent.includes('Draft three questions for the CFO') && c.textContent.includes('Earlier instructions')), null, { timeout: 15000 });
  ok('further instructions about the same file, with history', /Earlier instructions \(1\)/.test(await pdfCard.innerText()));
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), pdfCard.getByRole('button', { name: 'Download' }).click()]);
  const saved = `${SP}/dl-${Date.now()}.pdf`; await download.saveAs(saved);
  ok('download returns the same file', download.suggestedFilename() === 'board-pack.pdf' && readFileSync(saved).toString().startsWith('%PDF-1.4'));
  await mp4Card.getByRole('button', { name: /Delete/ }).click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=document-card]').length === 2, null, { timeout: 10000 });
  ok('delete removes it', true);
  await p.screenshot({ path: `${SP}/docs-library.png`, fullPage: true });

  step = 'CV from a PDF';
  await p.goto(APP + '/organisation'); await p.getByTestId('button-add-person').click();
  await p.fill('#p-name', 'Sam Patel'); await p.fill('#p-role', 'Fractional CFO'); await p.fill('#p-email', 'sam@example.com');
  await p.getByTestId('input-cv-file').setInputFiles(`${SP}/cv-jo.pdf`);
  await p.waitForFunction(() => document.querySelector('#p-cv')?.value.includes('Mock: Sentinel has read the file'), null, { timeout: 15000 });
  ok('a PDF CV is read by Sentinel and the summary filled in', (await p.inputValue('#p-cv')).includes('Mock'));
  await p.getByTestId('button-save-person').click();
  ok('people missing details are highlighted', /Missing: expertise/.test(await p.getByTestId('people-list').innerText()));

  step = 'board question with documents';
  await p.goto(APP + '/questions/new'); await p.getByTestId('input-question').waitFor();
  ok('missing information on the question form (profile, sector, expertise)', await p.getByTestId('missing-profile').isVisible() && await p.getByTestId('missing-sector').isVisible() && await p.getByTestId('missing-expertise').isVisible());
  await p.getByTestId('input-question').fill('Should we open a second factory?');
  await p.getByTestId('input-question-docs').setInputFiles([`${SP}/site-survey.txt`, `${SP}/board-pack.pdf`]);
  ok('background documents listed before sending', (await p.getByTestId('pending-docs').locator('li').count()) === 2);
  await p.getByTestId('mode-collaborative').click();
  await Promise.all([p.waitForURL(u => /\/questions\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith('/new'), { timeout: 30000 }), p.getByTestId('button-send').click()]);
  await p.getByTestId('question-docs-section').getByTestId('document-card').first().waitFor({ timeout: 15000 });
  const qdocs = p.getByTestId('question-docs-section');
  ok('the question carries its documents, read by Sentinel, shared with the people', (await qdocs.getByTestId('document-card').count()) === 2 && /Shared with the people asked/.test(await qdocs.innerText()));
  ok('missing information shown on the decision', await p.getByTestId('missing-data').isVisible());
  await qdocs.getByTestId('attach-panel').getByTestId('input-files').setInputFiles(`${SP}/Strategy 2027.docx`);
  await qdocs.getByTestId('button-attach').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=question-docs-section] [data-testid=document-card]').length === 3, null, { timeout: 15000 });
  ok('more documents can be attached at any stage of the decision', true);
  await p.getByTestId('tab-agents').click(); await p.getByTestId('button-convene').click();
  await p.getByText('Convened', { exact: false }).first().waitFor({ timeout: 20000 });
  ok('the shadow board convenes with the documents', true);
  await p.screenshot({ path: `${SP}/docs-question.png`, fullPage: true });

  step = 'respondent';
  const mailtos = await p.locator('a[href^="mailto:"]').evaluateAll((as) => as.map((a) => a.href));
  const link = mailtos.map((m) => (decodeURIComponent(m).match(/https?:\/\/\S+\/respond\/[A-Za-z0-9_-]+/) || [])[0]).find(Boolean);
  ok('a questionnaire link exists', !!link, String(link));
  const r = await ctx.newPage();
  await r.goto(link.replace(/^.*?\/respond\//, APP + '/respond/'));
  await r.getByTestId('respond-documents').waitFor({ timeout: 10000 });
  ok('the people asked see the shared background documents', (await r.getByTestId('respond-documents').locator('a').count()) === 3);
  const [d2] = await Promise.all([r.waitForEvent('download', { timeout: 10000 }), r.getByTestId('respond-documents').getByRole('link', { name: 'site-survey.txt' }).click()]);
  const saved2 = `${SP}/dl2-${Date.now()}.txt`; await d2.saveAs(saved2);
  ok('and can open them', readFileSync(saved2, 'utf8') === 'Site B floods every five years.');

  step = 'phone';
  const phone = await b.newPage({ viewport: { width: 390, height: 844 } });
  await phone.context().addCookies(await ctx.cookies());
  await phone.goto(APP + '/documents');
  await phone.waitForTimeout(800);
  const box = await phone.getByTestId('button-attach-anywhere').boundingBox();
  const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
  ok('phone: Attach button on screen, no sideways scroll', !!box && box.x >= 0 && box.x + box.width <= 390 && sw <= 390, `box=${JSON.stringify(box)} sw=${sw}`);
} catch (e) {
  ok(`journey stopped at "${step}"`, false, e.message.split('\n')[0]);
  await p.screenshot({ path: `${SP}/docs-fail.png`, fullPage: true }).catch(() => {});
}
ok('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
for (const [s, n, i] of results) console.log(s, n, i ? `— ${i}` : '');
console.log(`${results.filter(r => r[0] === 'FAIL').length} failed of ${results.length}`);
