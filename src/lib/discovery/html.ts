/**
 * HTML signal extraction. Deliberately dependency-free and conservative: it
 * reports what it can see, at honest confidence, and stays silent otherwise.
 */

export interface PageSignals {
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
  links: { href: string; text: string }[];
  emails: string[];
  phones: string[];
  scripts: string[];
  generator: string | null;
  socials: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSignals(html: string, baseUrl: string): PageSignals {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1];
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;

  const headings: string[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = stripTags(m[1] ?? '');
    if (text && text.length < 200) headings.push(text);
  }

  const links: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1] ?? '';
    const text = stripTags(m[2] ?? '');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    try {
      links.push({ href: new URL(href, baseUrl).toString(), text });
    } catch {
      /* unparseable href — ignore */
    }
  }

  const scripts: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (src) scripts.push(src);
  }

  const text = stripTags(html);
  const emails = [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])];
  const phones = [...new Set(text.match(/(?:\+44|0)\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g) ?? [])].slice(0, 5);

  const socials = [...new Set(links.map((l) => l.href).filter((h) => /linkedin|twitter|x\.com|facebook|youtube/i.test(h)))];

  return {
    title: title ? decodeEntities(stripTags(title)) : null,
    description: description ? decodeEntities(description) : null,
    headings: headings.slice(0, 40),
    text: text.slice(0, 40_000),
    links: links.slice(0, 300),
    emails: emails.slice(0, 10),
    phones,
    scripts: scripts.slice(0, 60),
    generator,
    socials: socials.slice(0, 10),
  };
}

/** Technology fingerprints inferable from public markup. Indicator is recorded. */
export const TECH_FINGERPRINTS: { name: string; category: string; test: RegExp }[] = [
  { name: 'HubSpot', category: 'CRM / Marketing', test: /hs-scripts\.com|hubspot/i },
  { name: 'Salesforce', category: 'CRM', test: /salesforce|pardot|force\.com/i },
  { name: 'Microsoft Dynamics', category: 'CRM / ERP', test: /dynamics\.com|crm\d*\.dynamics/i },
  { name: 'Google Analytics', category: 'Analytics', test: /googletagmanager|google-analytics|gtag\(/i },
  { name: 'WordPress', category: 'CMS', test: /wp-content|wp-includes|wordpress/i },
  { name: 'Shopify', category: 'E-commerce', test: /cdn\.shopify|shopify/i },
  { name: 'Wix', category: 'CMS', test: /wix\.com|wixstatic/i },
  { name: 'Squarespace', category: 'CMS', test: /squarespace/i },
  { name: 'Webflow', category: 'CMS', test: /webflow/i },
  { name: 'Cloudflare', category: 'CDN / Security', test: /cloudflare|cdnjs\.cloudflare/i },
  { name: 'Intercom', category: 'Customer support', test: /intercom/i },
  { name: 'Zendesk', category: 'Customer support', test: /zendesk|zdassets/i },
  { name: 'Microsoft 365', category: 'Productivity', test: /outlook\.office|sharepoint\.com|office365/i },
  { name: 'Google Workspace', category: 'Productivity', test: /googleusercontent|gstatic\.com\/accounts/i },
  { name: 'Xero', category: 'Accounting', test: /xero\.com/i },
  { name: 'Sage', category: 'Accounting / ERP', test: /sage\.com|sageone/i },
  { name: 'Mailchimp', category: 'Marketing', test: /mailchimp|list-manage\.com/i },
  { name: 'Calendly', category: 'Sales tooling', test: /calendly/i },
  { name: 'Stripe', category: 'Payments', test: /js\.stripe\.com|stripe\.com/i },
  { name: 'React', category: 'Web framework', test: /react(?:-dom)?(?:\.production)?\.min\.js|__NEXT_DATA__/i },
];

export function detectTechnology(html: string, signals: PageSignals): { name: string; category: string; indicator: string }[] {
  const haystack = `${html.slice(0, 400_000)} ${signals.scripts.join(' ')} ${signals.generator ?? ''}`;
  const found: { name: string; category: string; indicator: string }[] = [];
  for (const fp of TECH_FINGERPRINTS) {
    if (fp.test.test(haystack)) {
      found.push({ name: fp.name, category: fp.category, indicator: 'Public page markup / script reference' });
    }
  }
  return found;
}

/** Candidate internal pages worth crawling, ranked by analytical value. */
export const PAGE_HINTS: { key: string; test: RegExp; weight: number }[] = [
  { key: 'about', test: /\/(about|who-we-are|our-story|company)\b/i, weight: 5 },
  { key: 'services', test: /\/(services|what-we-do|solutions|products|capabilities)\b/i, weight: 5 },
  { key: 'sectors', test: /\/(sectors|industries|markets)\b/i, weight: 4 },
  { key: 'case-studies', test: /\/(case-stud|customers|clients|success)/i, weight: 4 },
  { key: 'team', test: /\/(team|people|leadership|management)\b/i, weight: 3 },
  { key: 'careers', test: /\/(careers|jobs|vacancies|work-with-us)\b/i, weight: 4 },
  { key: 'partners', test: /\/(partners|accreditations|alliances)\b/i, weight: 3 },
  { key: 'contact', test: /\/(contact|get-in-touch|locations)\b/i, weight: 2 },
  { key: 'pricing', test: /\/(pricing|plans|packages)\b/i, weight: 3 },
];

export function rankCandidatePages(links: { href: string; text: string }[], origin: string): string[] {
  const scored = new Map<string, number>();
  for (const { href } of links) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp|ico|css|js)$/i.test(url.pathname)) continue;
    const hint = PAGE_HINTS.find((h) => h.test.test(url.pathname));
    if (!hint) continue;
    const clean = `${url.origin}${url.pathname}`.replace(/\/$/, '');
    scored.set(clean, Math.max(scored.get(clean) ?? 0, hint.weight));
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}
