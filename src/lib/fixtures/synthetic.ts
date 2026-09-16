/**
 * Synthetic companies — Directive §27.
 *
 * Three fixtures the full pipeline can be run against without network access:
 * a small professional services firm, a manufacturer, and a 100-user
 * Microsoft-heavy SME. They are expressed as website connector source records,
 * so they exercise the real normalisation path rather than bypassing it.
 */

import type { SourceRecord } from '../discovery/connector';
import type { PageSignals } from '../discovery/html';

interface PagePayload {
  url: string;
  signals: PageSignals;
  technology: { name: string; category: string; indicator: string }[];
  html_length: number;
}

function signals(partial: Partial<PageSignals>): PageSignals {
  return {
    title: null,
    description: null,
    headings: [],
    text: '',
    links: [],
    emails: [],
    phones: [],
    scripts: [],
    generator: null,
    socials: [],
    ...partial,
  };
}

function page(url: string, label: string, s: Partial<PageSignals>, tech: PagePayload['technology'] = []): SourceRecord {
  return {
    connectorId: 'website',
    label,
    locator: url,
    retrievedAt: '2026-09-16T09:00:00.000Z',
    payload: { url, signals: signals(s), technology: tech, html_length: 42_000 } satisfies PagePayload,
  };
}

export interface SyntheticCompany {
  key: string;
  name: string;
  domain: string;
  description: string;
  /** Facts a user would supply that public sources cannot give. */
  userSupplied: Record<string, unknown>;
  records: SourceRecord[];
  currentMrr: number;
}

export const SYNTHETIC_COMPANIES: SyntheticCompany[] = [
  {
    key: 'northbridge',
    name: 'Northbridge Advisory',
    domain: 'northbridge-advisory.co.uk',
    description: 'Small professional services company — 18 people, two service lines, no outbound motion.',
    currentMrr: 1_450,
    userSupplied: { employeesEstimate: 18, turnoverEstimate: 2_100_000 },
    records: [
      page(
        'https://northbridge-advisory.co.uk',
        'Homepage',
        {
          title: 'Northbridge Advisory | Financial and operational consulting',
          description: 'Financial and operational consulting for ambitious mid-market businesses across the North of England.',
          headings: ['Financial and operational consulting', 'How we help', 'Our clients'],
          text:
            'Northbridge Advisory provides consultancy and advisory services to SME and mid-market clients. ' +
            'We work with professional services firms, manufacturers and privately owned businesses. ' +
            'Registered office LS1 4AP. ISO 9001 certified. Our consultants deliver financial planning, operational improvement and transformation programmes.',
          emails: ['hello@northbridge-advisory.co.uk'],
          socials: ['https://www.linkedin.com/company/northbridge-advisory'],
          links: [
            { href: 'https://northbridge-advisory.co.uk/services', text: 'Services' },
            { href: 'https://northbridge-advisory.co.uk/about', text: 'About' },
            { href: 'https://northbridge-advisory.co.uk/careers', text: 'Careers' },
          ],
        },
        [
          { name: 'WordPress', category: 'CMS', indicator: 'Public page markup / script reference' },
          { name: 'Google Analytics', category: 'Analytics', indicator: 'Public page markup / script reference' },
          { name: 'Microsoft 365', category: 'Productivity', indicator: 'Public page markup / script reference' },
        ],
      ),
      page('https://northbridge-advisory.co.uk/services', 'Services', {
        title: 'Services | Northbridge Advisory',
        headings: ['Financial planning and analysis', 'Operational improvement', 'Transformation programmes', 'Interim leadership'],
        text: 'Our services span financial planning, operational improvement, transformation and interim leadership for SME clients.',
      }),
      page('https://northbridge-advisory.co.uk/careers', 'Careers', {
        title: 'Careers | Northbridge Advisory',
        headings: ['Senior Consultant', 'Business Development Manager', 'Finance Analyst'],
        text: 'We are hiring a Senior Consultant, a Business Development Manager and a Finance Analyst.',
      }),
    ],
  },
  {
    key: 'halewood',
    name: 'Halewood Precision Engineering',
    domain: 'halewood-precision.co.uk',
    description: 'Manufacturing company — 64 people, heavy plant, low IT intensity, fragmented supplier base.',
    currentMrr: 2_900,
    userSupplied: { employeesEstimate: 64, turnoverEstimate: 8_200_000 },
    records: [
      page(
        'https://halewood-precision.co.uk',
        'Homepage',
        {
          title: 'Halewood Precision Engineering — CNC machining and fabrication',
          description: 'Precision CNC machining, fabrication and assembly for aerospace, automotive and energy customers.',
          headings: ['Precision manufacturing since 1987', 'Capabilities', 'Quality and accreditation'],
          text:
            'Halewood Precision Engineering delivers CNC machining, fabrication and production line assembly. ' +
            'We serve aerospace, automotive and energy customers across the UK and Europe. ' +
            'ISO 9001 and ISO 27001 certified. Cyber Essentials accredited. Registered office WA8 8TZ. ' +
            'Our enterprise customers rely on consistent tolerances and full traceability.',
          phones: ['0151 424 8800'],
          socials: ['https://www.linkedin.com/company/halewood-precision'],
          links: [
            { href: 'https://halewood-precision.co.uk/capabilities', text: 'Capabilities' },
            { href: 'https://halewood-precision.co.uk/sectors', text: 'Sectors' },
            { href: 'https://halewood-precision.co.uk/about', text: 'About' },
          ],
        },
        [
          { name: 'WordPress', category: 'CMS', indicator: 'Public page markup / script reference' },
          { name: 'Sage', category: 'Accounting / ERP', indicator: 'Public page markup / script reference' },
        ],
      ),
      page('https://halewood-precision.co.uk/capabilities', 'Capabilities', {
        title: 'Capabilities | Halewood Precision',
        headings: ['5-axis CNC machining', 'Sheet metal fabrication', 'Assembly and integration', 'Inspection and metrology', 'Prototyping'],
        text: 'Capabilities include 5-axis CNC machining, sheet metal fabrication, assembly, inspection and prototyping.',
      }),
      page('https://halewood-precision.co.uk/sectors', 'Sectors', {
        title: 'Sectors | Halewood Precision',
        headings: ['Aerospace', 'Automotive', 'Energy'],
        text: 'We serve enterprise customers in aerospace, automotive and energy. Large organisation supply chains require full traceability.',
      }),
    ],
  },
  {
    key: 'crosby',
    name: 'Crosby Group Services',
    domain: 'crosbygroupservices.co.uk',
    description: '100-user SME with a Microsoft-heavy estate, multiple sites, and an existing MSP relationship.',
    currentMrr: 4_800,
    userSupplied: {
      employeesEstimate: 104,
      turnoverEstimate: 11_500_000,
      currentMSPServices: ['managed-microsoft', 'device-management'],
      knownMSPRelationship: 'Existing managed services customer',
    },
    records: [
      page(
        'https://crosbygroupservices.co.uk',
        'Homepage',
        {
          title: 'Crosby Group Services | Facilities and property services',
          description: 'Integrated facilities management and property services for commercial, public sector and education clients.',
          headings: ['Integrated facilities management', 'Sectors we serve', 'Why Crosby'],
          text:
            'Crosby Group Services provides facilities management, property services and maintenance. ' +
            'We work with public sector, local authority, schools and commercial clients across the North West. ' +
            'Offices at L3 9AG, M1 2WD and CH41 1AG. ISO 9001 certified. Microsoft Partner. ' +
            'Our service desk handles thousands of requests each month for our enterprise and public sector customers.',
          emails: ['enquiries@crosbygroupservices.co.uk'],
          phones: ['0151 236 7000'],
          socials: ['https://www.linkedin.com/company/crosby-group-services', 'https://x.com/crosbygroup'],
          links: [
            { href: 'https://crosbygroupservices.co.uk/services', text: 'Services' },
            { href: 'https://crosbygroupservices.co.uk/sectors', text: 'Sectors' },
            { href: 'https://crosbygroupservices.co.uk/careers', text: 'Careers' },
            { href: 'https://crosbygroupservices.co.uk/partners', text: 'Partners' },
          ],
        },
        [
          { name: 'Microsoft 365', category: 'Productivity', indicator: 'Public page markup / script reference' },
          { name: 'Microsoft Dynamics', category: 'CRM / ERP', indicator: 'Public page markup / script reference' },
          { name: 'Cloudflare', category: 'CDN / Security', indicator: 'Public page markup / script reference' },
          { name: 'HubSpot', category: 'CRM / Marketing', indicator: 'Public page markup / script reference' },
          { name: 'Mailchimp', category: 'Marketing', indicator: 'Public page markup / script reference' },
          { name: 'Zendesk', category: 'Customer support', indicator: 'Public page markup / script reference' },
        ],
      ),
      page('https://crosbygroupservices.co.uk/services', 'Services', {
        title: 'Services | Crosby Group Services',
        headings: ['Hard facilities management', 'Soft facilities management', 'Planned maintenance', 'Reactive maintenance', 'Compliance and statutory', 'Energy management', 'Project works'],
        text: 'Services include hard and soft FM, planned and reactive maintenance, compliance, energy management and project works.',
      }),
      page('https://crosbygroupservices.co.uk/careers', 'Careers', {
        title: 'Careers | Crosby Group Services',
        headings: ['Contract Manager', 'Mobile Engineer', 'Helpdesk Coordinator', 'Bid Writer', 'Compliance Officer'],
        text: 'Current vacancies: Contract Manager, Mobile Engineer, Helpdesk Coordinator, Bid Writer, Compliance Officer.',
      }),
      page('https://crosbygroupservices.co.uk/partners', 'Partners', {
        title: 'Partners | Crosby Group Services',
        headings: ['Microsoft Partner', 'Safecontractor', 'CHAS', 'Constructionline'],
        text: 'Accreditations and partners: Microsoft Partner, Safecontractor, CHAS, Constructionline.',
      }),
    ],
  },
];

export function getSynthetic(key: string): SyntheticCompany | undefined {
  return SYNTHETIC_COMPANIES.find((c) => c.key === key || c.domain === key);
}
