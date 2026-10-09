// Create account and sign in, thoroughly, in production mode (PostgreSQL,
// __Host- cookie). Server on :3011. Run with SP=<scratchpad>.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const APP = process.env.APP ?? 'http://localhost:3011';
const results = []; let step = '';
const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); if (!cond) console.log('FAIL:', name, info); };
const b = await chromium.launch();
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(`${step}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.|Failed to load resource.*(401|404|409|422|429|ERR_FAILED)/.test(m.text())) errors.push(`${step}: ${m.text()}`); }); };
const context = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 }, ...opts }); await c.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort()); return c; };
const email = `auth${Date.now()}@harrowvale.co.uk`, PASSWORD = 'harrow and vale board 2026';
const fieldError = (p, id) => p.locator(`#${id}-error`).textContent().catch(() => null);

try {
  const ctx = await context(); const p = await ctx.newPage(); watch(p);

  step = 'sign-up page';
  await p.goto(APP + '/signup'); await p.getByTestId('form-signup').waitFor();
  ok('Create account page opens with name, email and password', (await p.locator('#name').count()) === 1 && (await p.locator('#email').count()) === 1 && (await p.locator('#password').count()) === 1);
  await p.getByTestId('button-signup').click();
  ok('empty form: each field says what is needed', /Enter your name/.test(await fieldError(p, 'name')) && /valid email/.test(await fieldError(p, 'email')) && /at least 12/.test(await fieldError(p, 'password')));
  await p.fill('#name', 'Jo Reyes'); await p.fill('#email', 'not-an-email'); await p.fill('#password', 'short');
  await p.getByTestId('button-signup').click();
  ok('invalid email and short password are explained', /valid email/.test(await fieldError(p, 'email')) && /at least 12/.test(await fieldError(p, 'password')));
  await p.fill('#email', email); await p.fill('#password', 'password1234');
  await p.getByTestId('button-signup').click(); await p.waitForTimeout(1200);
  ok('a common password is refused with a reason', /too common/.test((await fieldError(p, 'password')) ?? '') || /too common/.test(await p.locator('body').innerText()));
  ok('still on the sign-up page, nothing created', new URL(p.url()).pathname === '/signup');

  step = 'create account';
  await p.fill('#password', PASSWORD);
  await Promise.all([p.waitForURL((u) => u.pathname === '/organisation', { timeout: 15000 }), p.getByTestId('button-signup').click()]);
  ok('a valid sign-up creates the account and opens Your board', new URL(p.url()).pathname === '/organisation');
  const cookies = await ctx.cookies();
  ok('signed in with a secure session cookie', cookies.some((c) => c.name === '__Host-s8_session' && c.httpOnly && c.secure));
  ok('the account shows in the header', /Jo Reyes/.test(await p.locator('header').innerText()));
  ok('contact details start from the account', (await p.getByTestId('input-lead-name').inputValue()) === 'Jo Reyes' && (await p.getByTestId('input-lead-email').inputValue()) === email);
  await p.getByTestId('input-org-name').fill('Harrow & Vale');
  await p.waitForTimeout(2500);
  await p.reload(); await p.getByTestId('input-org-name').waitFor();
  ok('still signed in after a reload, with the details kept', /Jo Reyes/.test(await p.locator('header').innerText()) && (await p.getByTestId('input-org-name').inputValue()) === 'Harrow & Vale');
  await p.goto(APP + '/signup'); await p.waitForURL((u) => u.pathname !== '/signup', { timeout: 10000 }).catch(() => {});
  ok('signed in: the sign-up page moves on instead of showing the form', new URL(p.url()).pathname !== '/signup', p.url());

  step = 'duplicate account';
  const other = await context(); const q = await other.newPage(); watch(q);
  await q.goto(APP + '/signup'); await q.getByTestId('form-signup').waitFor();
  await q.fill('#name', 'Someone Else'); await q.fill('#email', email.toUpperCase()); await q.fill('#password', 'a different long passphrase');
  await q.getByTestId('button-signup').click(); await q.waitForTimeout(1200);
  ok('the same email (any case) cannot create a second account', /already exists/i.test(await q.locator('body').innerText()) && new URL(q.url()).pathname === '/signup');
  ok('and it offers Sign in instead', (await q.getByRole('link', { name: /sign in/i }).count()) > 0);

  step = 'sign in errors';
  await q.goto(APP + '/signin'); await q.getByTestId('form-signin').waitFor();
  await q.fill('#email', email); await q.fill('#password', 'not the right password');
  await q.getByTestId('button-signin').click(); await q.waitForTimeout(1200);
  const wrong = await q.getByTestId('auth-error').textContent().catch(() => '');
  ok('a wrong password is refused with a clear message', /don't match an account/.test(wrong ?? ''), wrong ?? '');
  await q.fill('#email', `nobody${Date.now()}@harrowvale.co.uk`); await q.fill('#password', 'not the right password');
  await q.getByTestId('button-signin').click(); await q.waitForTimeout(1200);
  ok('an unknown email gets the same message (no account fishing)', (await q.getByTestId('auth-error').textContent().catch(() => '')) === wrong);
  ok('nothing signed in after failures', !(await other.cookies()).some((c) => c.name === '__Host-s8_session'));

  step = 'sign in';
  await q.fill('#email', `  ${email.toUpperCase()}  `); await q.fill('#password', PASSWORD);
  await Promise.all([q.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 }), q.getByTestId('button-signin').click()]);
  ok('signs in with the right password (email in any case, spaces trimmed)', !new URL(q.url()).pathname.startsWith('/signin'), q.url());
  ok('a company with contact details lands on the workspace', new URL(q.url()).pathname === '/dashboard', q.url());
  await q.goto(APP + '/organisation'); await q.getByTestId('input-org-name').waitFor();
  ok('the second device sees the same organisation', (await q.getByTestId('input-org-name').inputValue()) === 'Harrow & Vale');

  step = 'sign out';
  await p.goto(APP + '/organisation'); await p.waitForTimeout(800);
  const signOut = p.getByRole('button', { name: /sign out/i });
  if (!(await signOut.count())) await p.locator('header').getByRole('button').filter({ hasText: /JR|Jo/ }).first().click().catch(() => {});
  await p.getByRole('button', { name: /sign out/i }).first().click();
  await p.waitForTimeout(1500);
  ok('sign out ends the session', !(await ctx.cookies()).some((c) => c.name === '__Host-s8_session' && c.value));
  const me = await p.request.get(APP + '/api/auth/me');
  ok('and the server no longer recognises it', me.status() === 401);
  ok('the other device stays signed in', (await q.request.get(APP + '/api/auth/me')).status() === 200);

  step = 'next link';
  await p.goto(APP + '/signin?next=%2Flog'); await p.getByTestId('form-signin').waitFor();
  await p.fill('#email', email); await p.fill('#password', PASSWORD);
  await Promise.all([p.waitForURL((u) => u.pathname === '/log', { timeout: 15000 }).catch(() => {}), p.getByTestId('button-signin').click()]);
  ok('sign in returns to the page it was asked from', new URL(p.url()).pathname === '/log', p.url());
  await p.goto(APP + '/signin?next=https%3A%2F%2Fevil.example%2F'); await p.waitForTimeout(1500);
  ok('it never sends you to another site afterwards', new URL(p.url()).host === new URL(APP).host, p.url());

  step = 'phone';
  const phone = await context({ viewport: { width: 390, height: 844 } }); const m = await phone.newPage(); watch(m);
  for (const path of ['/signup', '/signin']) {
    await m.goto(APP + path); await m.waitForTimeout(600);
    const btn = await m.getByTestId(path === '/signup' ? 'button-signup' : 'button-signin').boundingBox();
    ok(`phone: ${path} fits the screen`, !!btn && btn.x >= 0 && btn.x + btn.width <= 390 && (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  }
  await phone.close(); await other.close(); await ctx.close();
} catch (e) {
  ok(`journey stopped at "${step}"`, false, e.message.split('\n')[0]);
}
ok('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
for (const [s, n, i] of results) console.log(s, n, i ? `— ${i}` : '');
console.log(`${results.filter((r) => r[0] === 'FAIL').length} failed of ${results.length}`);
