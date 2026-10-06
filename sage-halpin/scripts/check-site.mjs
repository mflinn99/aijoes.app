// Checks the public website (site/) before it is published. No dependencies.
//
//  - Every page's HTML tags open and close in order.
//  - Every local link, script, stylesheet, image and video points at a file that exists.
//  - Every #anchor points at an id on the page it targets.
//  - The Contact Us section, its email and its phone number are in place, and
//    the address in contact.js matches the one shown on the page.
//  - No "Talk to Us" wording is left anywhere.
//  - Sign in and Create account link to the platform.
//
// Run with: npm run check:site
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
  // SVG elements that are always written self-closing or empty here
  'path', 'use', 'circle', 'ellipse', 'stop', 'rect', 'line', 'polyline', 'polygon']);
const problems = [];
const fail = (file, msg) => problems.push(`${path.relative(SITE, file) || file}: ${msg}`);

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? pages(p) : e.name.endsWith('.html') ? [p] : [];
  });
}

// Strip comments, and the bodies of <script> and <style>, which are not markup.
function markup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
}

function checkTags(file, html) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, rawName, selfClose] = m;
    const name = rawName.toLowerCase();
    if (name === '!doctype' || VOID.has(name) || selfClose) continue;
    const line = html.slice(0, m.index).split('\n').length;
    if (!closing) { stack.push([name, line]); continue; }
    const top = stack.pop();
    if (!top || top[0] !== name) { fail(file, `line ${line}: </${name}> closes ${top ? `<${top[0]}> from line ${top[1]}` : 'nothing'}`); return; }
  }
  const left = stack.filter(([n]) => !['html', 'head', 'body'].includes(n));
  if (left.length) fail(file, `unclosed <${left[0][0]}> from line ${left[0][1]}`);
}

const idsCache = new Map();
function idsOf(file) {
  if (!idsCache.has(file)) idsCache.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
  return idsCache.get(file);
}

function resolveLocal(fromFile, ref) {
  const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
  let target = clean ? path.resolve(path.dirname(fromFile), clean) : fromFile;
  if (!target.startsWith(SITE)) return { target, outside: true };
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  return { target, exists: fs.existsSync(target) };
}

function checkRefs(file, html) {
  const re = /\s(href|src|poster|cite)="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[2].trim();
    if (!ref || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(ref)) continue;
    if (ref.startsWith('/')) { fail(file, `root-relative link "${ref}" breaks on the github.io address; use a relative link`); continue; }
    const { target, exists, outside } = resolveLocal(file, ref);
    if (outside) { fail(file, `"${ref}" points outside the site`); continue; }
    if (!exists) { fail(file, `"${ref}" points at a file that does not exist`); continue; }
    const hash = ref.includes('#') ? ref.split('#')[1] : '';
    if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) fail(file, `"${ref}" points at #${hash}, which is not on that page`);
  }
}

for (const file of pages(SITE)) {
  const html = fs.readFileSync(file, 'utf8');
  checkTags(file, markup(html));
  checkRefs(file, markup(html));
  if (/talk to us/i.test(html)) fail(file, 'still says "Talk to Us"; use "Contact Us"');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(file, 'has no <title>');
}

// Contact Us: the section, the details, and one email address everywhere.
const home = path.join(SITE, 'index.html');
const homeHtml = fs.readFileSync(home, 'utf8');
const contactJs = fs.readFileSync(path.join(SITE, 'contact.js'), 'utf8');
const jsEmail = (contactJs.match(/email:\s*'([^']+)'/) || [])[1];
if (!idsOf(home).has('contact')) fail(home, 'has no #contact section');
if (!/class="nav-cta" href="#contact">Contact Us</.test(homeHtml)) fail(home, 'the header pill does not read "Contact Us"');
if (!jsEmail) fail(path.join(SITE, 'contact.js'), 'has no email setting');
else if (!homeHtml.includes(`mailto:${jsEmail}`)) fail(home, `does not show ${jsEmail}, the address contact.js sends to`);
if (!homeHtml.includes('tel:+442081291416')) fail(home, 'is missing the contact phone number');
for (const path of ['/signin', '/signup']) if (!homeHtml.includes(`data-app-path="${path}"`)) fail(home, `has no ${path} link to the platform`);
// Sign in and Create account sit on the header's one line, beside the navigation.
const topLine = (homeHtml.match(/<div class="wrap top-inner">([\s\S]*?)<details class="menu">/) || [])[1] ?? '';
for (const path of ['/signin', '/signup']) if (!topLine.includes(`data-app-path="${path}"`)) fail(home, `has no ${path} link on the header's top line`);
if (!fs.existsSync(path.join(SITE, 'app-links.js'))) fail(home, 'app-links.js, which points Sign in and Create account at the platform, is missing');

if (problems.length) {
  console.error(`Site check failed (${problems.length}):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`Site check passed: ${pages(SITE).length} pages, every link, file and anchor resolves.`);
