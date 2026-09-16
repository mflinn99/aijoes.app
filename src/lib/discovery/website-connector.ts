/**
 * Website connector — the primary public-information source (§4).
 *
 * Crawls the homepage plus a small number of high-value internal pages, and
 * emits claims with honest confidence. Where it is guessing, it says so by
 * emitting `method: 'inferred'` and a sub-0.6 confidence, which is what keeps
 * the understanding score truthful (§23).
 */

import type { CompanyDataConnector, CompanyIdentity, DiscoveryResult, NormalisedRecord, SourceRecord } from './connector';
import { claim } from '../core/provenance';
import { fetchText, normaliseDomain } from './http';
import { extractSignals, detectTechnology, rankCandidatePages, type PageSignals } from './html';

const MAX_PAGES = 6;

interface PagePayload {
  url: string;
  signals: PageSignals;
  technology: { name: string; category: string; indicator: string }[];
  html_length: number;
}

const SECTOR_TERMS: { sector: string; test: RegExp }[] = [
  { sector: 'Managed IT services', test: /\bmanaged (it|service)|msp\b|it support\b/i },
  { sector: 'Software', test: /\bsoftware|saas\b|platform\b|application development/i },
  { sector: 'Manufacturing', test: /\bmanufactur|fabricat|production line|machining|foundry/i },
  { sector: 'Engineering', test: /\bengineering|mechanical|electrical design|cad\b/i },
  { sector: 'Construction', test: /\bconstruction|contractor|civils|groundwork/i },
  { sector: 'Professional services', test: /\bconsultan|advisory|accountan|solicitor|legal services/i },
  { sector: 'Healthcare', test: /\bhealthcare|clinic|patient|medical|nhs\b/i },
  { sector: 'Logistics', test: /\blogistics|haulage|freight|warehous|distribution/i },
  { sector: 'Retail', test: /\bretail|ecommerce|e-commerce|store|shop online/i },
  { sector: 'Financial services', test: /\bfinancial services|insurance|mortgage|wealth manage|fintech/i },
  { sector: 'Education', test: /\beducation|school|academy|training provider|college/i },
  { sector: 'Recruitment', test: /\brecruitment|talent acquisition|staffing|headhunt/i },
  { sector: 'Energy', test: /\benergy|renewable|solar|wind farm|utilities/i },
  { sector: 'Property', test: /\bproperty|estate agen|lettings|facilities management/i },
];

const SEGMENT_TERMS: { segment: string; test: RegExp }[] = [
  { segment: 'SME', test: /\bsme\b|small business|small and medium/i },
  { segment: 'Enterprise', test: /\benterprise\b|large organisation|blue.chip/i },
  { segment: 'Public sector', test: /\bpublic sector|local authority|council|government|nhs\b/i },
  { segment: 'Education', test: /\bschools?\b|academies|multi.academy trust|university/i },
  { segment: 'Consumer', test: /\bconsumer|homeowner|domestic customer/i },
];

const ACCREDITATIONS: { name: string; test: RegExp }[] = [
  { name: 'ISO 9001', test: /iso\s*9001/i },
  { name: 'ISO 27001', test: /iso\s*27001/i },
  { name: 'Cyber Essentials', test: /cyber essentials/i },
  { name: 'Cyber Essentials Plus', test: /cyber essentials plus/i },
  { name: 'Microsoft Partner', test: /microsoft (gold |solutions )?partner/i },
  { name: 'Investors in People', test: /investors in people/i },
];

export class WebsiteConnector implements CompanyDataConnector {
  readonly id = 'website';
  readonly name = 'Company website';
  readonly category = 'public-web' as const;
  readonly authType = 'none' as const;
  readonly understandingUplift = 32;

  async discover(): Promise<DiscoveryResult> {
    return {
      status: 'available',
      detail: 'Public web fetching is available.',
      expectedUnderstandingUplift: this.understandingUplift,
    };
  }

  async fetch(identity: CompanyIdentity): Promise<SourceRecord[]> {
    const domain = identity.domain ?? normaliseDomain(identity.input);
    if (!domain) return [];

    const origin = `https://${domain}`;
    const home = await fetchText(origin);
    if (!home.ok || !home.body) {
      const fallback = await fetchText(`https://www.${domain}`);
      if (!fallback.ok || !fallback.body) return [];
      return this.crawlFrom(fallback.finalUrl, fallback.body);
    }
    return this.crawlFrom(home.finalUrl, home.body);
  }

  private async crawlFrom(finalUrl: string, html: string): Promise<SourceRecord[]> {
    const origin = new URL(finalUrl).origin;
    const records: SourceRecord[] = [];
    const now = () => new Date().toISOString();

    const homeSignals = extractSignals(html, finalUrl);
    records.push({
      connectorId: this.id,
      label: 'Homepage',
      locator: finalUrl,
      retrievedAt: now(),
      payload: {
        url: finalUrl,
        signals: homeSignals,
        technology: detectTechnology(html, homeSignals),
        html_length: html.length,
      } satisfies PagePayload,
    });

    const candidates = rankCandidatePages(homeSignals.links, origin).slice(0, MAX_PAGES);
    const pages = await Promise.all(candidates.map((url) => fetchText(url)));

    for (const page of pages) {
      if (!page.ok || !page.body) continue;
      const signals = extractSignals(page.body, page.finalUrl);
      records.push({
        connectorId: this.id,
        label: labelFor(page.finalUrl),
        locator: page.finalUrl,
        retrievedAt: now(),
        payload: {
          url: page.finalUrl,
          signals,
          technology: detectTechnology(page.body, signals),
          html_length: page.body.length,
        } satisfies PagePayload,
      });
    }

    return records;
  }

  async normalise(records: SourceRecord[]): Promise<NormalisedRecord[]> {
    const out: NormalisedRecord[] = [];
    if (records.length === 0) return out;

    const pages = records.map((r) => r.payload as PagePayload);
    const home = pages[0]!;
    const homeRecord = records[0]!;
    const src = { connectorId: this.id, label: homeRecord.label, locator: homeRecord.locator };
    const allText = pages.map((p) => p.signals.text).join(' \n ');

    // --- identity -----------------------------------------------------------
    const domain = new URL(home.url).hostname.replace(/^www\./, '');
    out.push({ field: 'domain', claim: claim(domain, { ...src, method: 'observed', confidence: 0.98 }) });
    out.push({
      field: 'urls',
      claim: claim(pages.map((p) => p.url), { ...src, method: 'observed', confidence: 0.95 }),
    });

    const name = companyNameFrom(home.signals, domain);
    if (name) {
      out.push({ field: 'legalName', claim: claim(name.value, { ...src, method: 'inferred', confidence: name.confidence }) });
    }

    // --- proposition --------------------------------------------------------
    if (home.signals.description) {
      out.push({
        field: 'valuePropositions',
        claim: claim([home.signals.description], { ...src, method: 'observed', confidence: 0.72 }),
      });
    }

    const services = servicesFrom(pages);
    if (services.length > 0) {
      out.push({
        field: 'services',
        claim: claim(services, { ...src, method: 'inferred', confidence: services.length >= 4 ? 0.7 : 0.5 }),
      });
    }

    // --- sector / market ----------------------------------------------------
    const sectors = SECTOR_TERMS.filter((s) => s.test.test(allText)).map((s) => s.sector);
    if (sectors.length > 0) {
      out.push({
        field: 'sectors',
        claim: claim(sectors.slice(0, 4), { ...src, method: 'inferred', confidence: sectors.length === 1 ? 0.7 : 0.55 }),
      });
    }

    const segments = SEGMENT_TERMS.filter((s) => s.test.test(allText)).map((s) => s.segment);
    if (segments.length > 0) {
      out.push({
        field: 'customerSegments',
        claim: claim(segments, { ...src, method: 'inferred', confidence: 0.55 }),
      });
    }

    // --- locations ----------------------------------------------------------
    const postcodes = [...new Set(allText.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/g) ?? [])];
    if (postcodes.length > 0) {
      out.push({
        field: 'headquarters',
        claim: claim(postcodes[0]!, { ...src, method: 'observed', confidence: 0.6 }),
      });
      if (postcodes.length > 1) {
        out.push({
          field: 'locations',
          claim: claim(postcodes.slice(0, 8), { ...src, method: 'inferred', confidence: 0.45 }),
        });
      }
    }

    // --- technology ---------------------------------------------------------
    const tech = dedupeTech(pages.flatMap((p) => p.technology));
    if (tech.length > 0) {
      out.push({
        field: 'technologyEstate',
        claim: claim(tech, { ...src, method: 'observed', confidence: 0.75 }),
      });
      const crm = tech.filter((t) => /CRM/i.test(t.category));
      if (crm.length > 0) {
        out.push({ field: 'crmIndicators', claim: claim(crm, { ...src, method: 'observed', confidence: 0.7 }) });
      }
      const cloud = tech.filter((t) => /Productivity|CDN|Payments/i.test(t.category));
      if (cloud.length > 0) {
        out.push({ field: 'cloudEstate', claim: claim(cloud, { ...src, method: 'inferred', confidence: 0.5 }) });
      }
      const software = tech.filter((t) => /CMS|Accounting|Marketing|support|Analytics|Sales/i.test(t.category));
      if (software.length > 0) {
        out.push({ field: 'softwareEstate', claim: claim(software, { ...src, method: 'observed', confidence: 0.65 }) });
      }
    }

    // --- cyber posture ------------------------------------------------------
    const accreds = ACCREDITATIONS.filter((a) => a.test.test(allText));
    if (accreds.length > 0) {
      out.push({
        field: 'cyberIndicators',
        claim: claim(
          accreds.map((a) => ({
            kind: 'accreditation',
            summary: `${a.name} referenced on the public website`,
            detectedAt: new Date().toISOString(),
            sourceLabel: 'Company website',
            locator: home.url,
          })),
          { ...src, method: 'observed', confidence: 0.7 },
        ),
      });
    }

    // --- hiring signals -----------------------------------------------------
    const careers = records.find((r) => /career|job/i.test(r.label));
    if (careers) {
      const careersPage = careers.payload as PagePayload;
      const roles = careersPage.signals.headings.filter((h) => h.length > 4 && h.length < 80).slice(0, 12);
      if (roles.length > 0) {
        out.push({
          field: 'recruitmentSignals',
          claim: claim(
            roles.map((r) => ({
              kind: 'open-role',
              summary: r,
              detectedAt: new Date().toISOString(),
              sourceLabel: 'Careers page',
              locator: careersPage.url,
            })),
            { connectorId: this.id, label: 'Careers page', locator: careersPage.url, method: 'observed', confidence: 0.8 },
          ),
        });
      }
    }

    // --- partners / accreditations -----------------------------------------
    const partnersPage = records.find((r) => /partner/i.test(r.label));
    if (partnersPage) {
      const p = partnersPage.payload as PagePayload;
      const partners = p.signals.headings.filter((h) => h.length > 2 && h.length < 60).slice(0, 15);
      if (partners.length > 0) {
        out.push({
          field: 'partners',
          claim: claim(partners, {
            connectorId: this.id,
            label: 'Partners page',
            locator: p.url,
            method: 'inferred',
            confidence: 0.5,
          }),
        });
      }
    }

    // --- channels -----------------------------------------------------------
    const channels: string[] = [];
    if (home.signals.socials.some((s) => /linkedin/i.test(s))) channels.push('LinkedIn');
    if (home.signals.socials.some((s) => /twitter|x\.com/i.test(s))) channels.push('X / Twitter');
    if (tech.some((t) => /Marketing/i.test(t.category))) channels.push('Email marketing');
    if (pages.some((p) => /\/blog|\/news|\/insights/i.test(p.url))) channels.push('Content / blog');
    if (channels.length > 0) {
      out.push({ field: 'marketingChannels', claim: claim(channels, { ...src, method: 'observed', confidence: 0.6 }) });
    }

    return out;
  }
}

function labelFor(url: string): string {
  const path = new URL(url).pathname.replace(/\/$/, '');
  const seg = path.split('/').filter(Boolean).pop() ?? 'page';
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Page';
}

function companyNameFrom(signals: PageSignals, domain: string): { value: string; confidence: number } | null {
  const title = signals.title;
  if (title) {
    // Titles are usually "Brand | Tagline" or "Tagline - Brand".
    const parts = title.split(/[|–—-]/).map((p) => p.trim()).filter(Boolean);
    const branded = parts.find((p) => p.length <= 45 && /[A-Za-z]/.test(p) && p.split(/\s+/).length <= 6);
    if (branded) {
      const looksLikeBrand = domain.replace(/\..*$/, '').toLowerCase().includes(
        branded.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6),
      );
      return { value: branded, confidence: looksLikeBrand ? 0.82 : 0.6 };
    }
  }
  const stem = domain.replace(/\..*$/, '').replace(/[-_]/g, ' ');
  if (!stem) return null;
  return { value: stem.replace(/\b\w/g, (c) => c.toUpperCase()), confidence: 0.4 };
}

function servicesFrom(pages: PagePayload[]): string[] {
  // Match the path, never the whole URL: a host like "crosbygroupservices.co.uk"
  // contains "services" and would otherwise make the homepage look like the
  // services page, so nav headings get reported as service lines.
  const servicePage = pages.find((p) => {
    try {
      return /service|solution|what-we-do|product|capabilit/i.test(new URL(p.url).pathname);
    } catch {
      return false;
    }
  });
  const source = servicePage ?? pages[0];
  if (!source) return [];
  const candidates = source.signals.headings
    .map((h) => h.trim())
    .filter((h) => h.length >= 4 && h.length <= 70)
    .filter((h) => !/^(home|contact|about|menu|search|cookie|privacy|copyright)/i.test(h))
    // Section headers and slogans are not service lines.
    .filter((h) => !/^(why|who|how|what we|our |sectors? we|meet the|latest|news|insights|testimonial|get in touch|find out)/i.test(h));
  return [...new Set(candidates)].slice(0, 12);
}

function dedupeTech(items: { name: string; category: string; indicator: string }[]) {
  const seen = new Set<string>();
  return items.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}
