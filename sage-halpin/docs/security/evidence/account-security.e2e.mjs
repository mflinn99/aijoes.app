// Account security in the browser, production mode (__Host- cookie, PostgreSQL).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = 'http://localhost:3011';
const results = []; const ok = (n, c, i = '') => results.push([c ? 'PASS' : 'FAIL', n, i]);
const b = await chromium.launch();
const email = `sec${Date.now()}@acme.example`; const pw1 = 'violet lantern harbour'; const pw2 = 'copper meadow sixteen';
const phone = await b.newContext(); const laptop = await b.newContext();
for (const c of [phone, laptop]) await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
const p = await phone.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => d.accept());
await p.goto(`${B}/signup`);
const form = p.getByTestId('form-signup');
await form.locator('input[autocomplete=name], input[name=name], #name').first().fill('Sam Security');
await form.locator('input[type=email]').fill(email);
await form.locator('input[type=password]').fill('password1234');
await form.locator('button[type=submit]').click();
await p.waitForTimeout(1000);
ok('sign-up refuses a common password with an explanation', /too common/i.test(await p.locator('body').innerText()));
await form.locator('input[type=password]').fill(pw1);
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/signup'), { timeout: 10000 }).catch(() => {}), form.locator('button[type=submit]').click()]);
const cookies = await phone.cookies();
ok('production cookie: __Host- prefix, HttpOnly, Secure, host-only, path /', cookies.some(c => c.name === '__Host-s8_session' && c.httpOnly && c.secure && c.path === '/' && !c.domain.startsWith('.')), JSON.stringify(cookies.map(c => c.name)));

async function signIn(page, password) {
  await page.goto(`${B}/signin`);
  const f = page.getByTestId('form-signin');
  await f.locator('input[type=email]').fill(email); await f.locator('input[type=password]').fill(password);
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/signin'), { timeout: 10000 }).catch(() => {}), f.locator('button[type=submit]').click()]);
}
const l = await laptop.newPage(); l.on('dialog', d => d.accept());
await signIn(l, pw1);
ok('second device signs in', (await l.request.get(`${B}/api/auth/me`)).status() === 200);

await p.goto(`${B}/organisation`); await p.getByTestId('form-change-password').waitFor({ timeout: 10000 });
ok('organisation page shows Sign-in and security', await p.getByRole('heading', { name: 'Sign-in and security' }).isVisible());
await p.getByLabel('Current password').fill('wrong password here'); await p.getByLabel('New password').fill(pw2);
await p.getByTestId('button-change-password').click(); await p.waitForTimeout(800);
ok('wrong current password is refused', /not correct/i.test(await p.getByTestId('form-change-password').innerText()));
await p.getByLabel('Current password').fill(pw1); await p.getByLabel('New password').fill(pw2);
await p.getByTestId('button-change-password').click(); await p.waitForTimeout(1200);
ok('password changes and says other devices were signed out', /Password changed/.test(await p.getByTestId('form-change-password').innerText()));
ok('this device stays signed in', (await p.request.get(`${B}/api/auth/me`)).status() === 200);
ok('the other device is signed out', (await l.request.get(`${B}/api/auth/me`)).status() === 401);
await signIn(l, pw2);
ok('new password signs in on the other device', (await l.request.get(`${B}/api/auth/me`)).status() === 200);
const stolen = (await laptop.cookies()).find(c => c.name === '__Host-s8_session');
await p.getByTestId('button-signout-everywhere').click();
await p.waitForURL(u => u.pathname.startsWith('/signin'), { timeout: 10000 }).catch(() => {});
ok('sign out everywhere lands on sign-in', new URL(p.url()).pathname === '/signin', p.url());
ok('the other device is signed out too', (await l.request.get(`${B}/api/auth/me`)).status() === 401);
const replay = await fetch(`${B}/api/auth/me`, { headers: { cookie: `${stolen.name}=${stolen.value}` } });
ok('a copied cookie is refused afterwards', replay.status === 401);
ok('no script errors', errs.length === 0, errs.join('; '));
await b.close();
for (const [s, n, i] of results) console.log(s, n, i ? `— ${i}` : '');
console.log(`${results.filter(r => r[0] === 'FAIL').length} failed of ${results.length}`);
