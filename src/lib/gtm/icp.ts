/**
 * ICP engine — Directive Phase 3.
 *
 * Not one generic ICP: fifteen opportunity archetypes, each with its own fit
 * rules and its own evidence requirements. An account can match several, and
 * the archetype that matches decides which service is proposed and what the
 * message is about.
 *
 * Every score returns its own breakdown. There is no opaque number anywhere in
 * this file — a salesperson has to be able to say why an account is on the list.
 */

import type { CompanyTwin, TechnologyItem, Signal } from '../core/company-twin';
import { valueOf, confidenceOf, clamp01 } from '../core/provenance';
import type { MspProfile, ServiceLine } from './profile';
import { sellableServices } from './profile';

export type ArchetypeId =
  | 'microsoft-cloud-optimisation'
  | 'cyber-security'
  | 'infrastructure-modernisation'
  | 'ai-readiness'
  | 'ai-implementation'
  | 'ps-augmentation'
  | 'it-transformation'
  | 'managed-it'
  | 'application-infrastructure-project'
  | 'public-sector'
  | 'ma-change-event'
  | 'rapid-growth'
  | 'technology-migration'
  | 'cost-optimisation'
  | 'supplier-consolidation';

export interface ArchetypeMatch {
  archetype: ArchetypeId;
  name: string;
  /** 0..1 — how well this account matches this archetype. */
  fit: number;
  /** The concrete observations that produced the fit, quoted. */
  evidence: string[];
  /** Onward service ids this archetype sells. */
  serviceIds: string[];
  /** Why this archetype, in one sentence a salesperson could say aloud. */
  rationale: string;
}

export interface Archetype {
  id: ArchetypeId;
  name: string;
  description: string;
  serviceIds: string[];
  /** Personas who typically own this problem. */
  buyerRoles: string[];
  /** Returns 0..1 fit plus the evidence that produced it. */
  match: (ctx: IcpContext) => { fit: number; evidence: string[] };
}

export interface IcpContext {
  twin: CompanyTwin;
  profile: MspProfile;
  employees: number | null;
  turnover: number | null;
  sectors: string[];
  segments: string[];
  technology: TechnologyItem[];
  signals: Signal[];
  /** Lower-cased blob of every text claim, for keyword matching. */
  haystack: string;
  /** How much of the twin is actually populated, 0..100. */
  understanding: number;
}

// --- helpers ---------------------------------------------------------------

function hits(ctx: IcpContext, terms: string[]): string[] {
  return terms.filter((t) => ctx.haystack.includes(t.toLowerCase()));
}

function tech(ctx: IcpContext, pattern: RegExp): TechnologyItem[] {
  return ctx.technology.filter((t) => pattern.test(`${t.name} ${t.category}`));
}

function signalsMatching(ctx: IcpContext, pattern: RegExp): Signal[] {
  return ctx.signals.filter((s) => pattern.test(s.summary));
}

function sizeBand(employees: number | null): 'micro' | 'small' | 'mid' | 'large' | 'unknown' {
  if (employees === null) return 'unknown';
  if (employees < 10) return 'micro';
  if (employees < 50) return 'small';
  if (employees < 250) return 'mid';
  return 'large';
}

/** Onward's sweet spot: big enough to need help, small enough to buy it quickly. */
function sizeFit(employees: number | null): { score: number; note: string } {
  const band = sizeBand(employees);
  switch (band) {
    case 'micro': return { score: 0.15, note: `${employees} employees — likely too small to fund professional services` };
    case 'small': return { score: 0.8, note: `${employees} employees — in range, typically no internal specialist` };
    case 'mid': return { score: 1, note: `${employees} employees — core range` };
    case 'large': return { score: 0.55, note: `${employees} employees — may have internal capability or an incumbent` };
    default: return { score: 0.3, note: 'Headcount unknown' };
  }
}

// --- the archetypes --------------------------------------------------------

export const ARCHETYPES: Archetype[] = [
  {
    id: 'microsoft-cloud-optimisation',
    name: 'Microsoft / cloud optimisation',
    description: 'A Microsoft estate that has grown without anybody owning its cost or configuration.',
    serviceIds: ['managed-it', 'cloud-hosting', 'azure-virtual-desktop'],
    buyerRoles: ['IT Manager', 'IT Director', 'Finance Director', 'Operations Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const ms = tech(ctx, /microsoft|office ?365|azure|sharepoint|outlook/i);
      if (ms.length > 0) evidence.push(`Microsoft estate indicated: ${ms.map((t) => t.name).join(', ')}`);
      const terms = hits(ctx, ['microsoft 365', 'office 365', 'azure', 'sharepoint', 'teams']);
      if (terms.length > 0) evidence.push(`Public references to ${terms.join(', ')}`);
      const size = sizeFit(ctx.employees);
      if (ctx.employees !== null) evidence.push(size.note);

      const base = ms.length > 0 ? 0.7 : terms.length > 0 ? 0.5 : 0.2;
      return { fit: clamp01(base * size.score), evidence };
    },
  },
  {
    id: 'cyber-security',
    name: 'Cyber security',
    description: 'A business carrying data obligations without visible security certification.',
    serviceIds: ['cyber-security'],
    buyerRoles: ['IT Director', 'Managing Director', 'Compliance Manager', 'Operations Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const certs = hits(ctx, ['iso 27001', 'cyber essentials', 'soc 2']);
      const obligations = hits(ctx, ['gdpr', 'data protection', 'client data', 'confidential', 'regulated', 'fca', 'nhs', 'patient']);
      const incidents = signalsMatching(ctx, /breach|ransomware|incident|attack/i);

      if (certs.length === 0 && obligations.length > 0) {
        evidence.push(`Handles sensitive data (${obligations.join(', ')}) with no public security certification`);
      }
      if (certs.length > 0) evidence.push(`Already references ${certs.join(', ')} — a renewal or uplift conversation rather than a first certification`);
      if (incidents.length > 0) evidence.push(`Security event signal: ${incidents[0]!.summary}`);

      const tenderish = hits(ctx, ['tender', 'framework', 'public sector', 'local authority', 'nhs']);
      if (tenderish.length > 0 && certs.length === 0) {
        evidence.push('Sells into buyers who typically require certification, and holds none publicly');
      }

      let fit = 0.25;
      if (obligations.length > 0 && certs.length === 0) fit = 0.8;
      if (tenderish.length > 0 && certs.length === 0) fit = 0.9;
      if (incidents.length > 0) fit = 0.95;
      if (certs.length > 0 && obligations.length > 0) fit = 0.5;

      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'infrastructure-modernisation',
    name: 'Infrastructure modernisation',
    description: 'On-premises or ageing infrastructure approaching a decision point.',
    serviceIds: ['cloud-hosting', 'azure-virtual-desktop', 'it-consultancy'],
    buyerRoles: ['IT Manager', 'IT Director', 'Finance Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const legacy = hits(ctx, ['on-premises', 'on premise', 'server room', 'data centre', 'colocation', 'citrix', 'terminal server', 'remote desktop', 'vmware']);
      if (legacy.length > 0) evidence.push(`Legacy infrastructure indicators: ${legacy.join(', ')}`);
      const endOfLife = hits(ctx, ['windows server 2012', 'windows server 2016', 'windows 10', 'end of life', 'end of support']);
      if (endOfLife.length > 0) evidence.push(`End-of-support pressure: ${endOfLife.join(', ')}`);
      const multiSite = (valueOf(ctx.twin.locations) as string[] | null)?.length ?? 0;
      if (multiSite > 1) evidence.push(`${multiSite} locations — infrastructure decisions multiply across sites`);

      const fit = legacy.length > 0 ? 0.85 : endOfLife.length > 0 ? 0.7 : multiSite > 1 ? 0.4 : 0.2;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'ai-readiness',
    name: 'AI readiness',
    description: 'Interest in AI without the data, identity and policy groundwork to use it safely.',
    serviceIds: ['ai-readiness', 'cyber-security'],
    buyerRoles: ['Managing Director', 'IT Director', 'Operations Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const aiTalk = hits(ctx, ['artificial intelligence', ' ai ', 'copilot', 'machine learning', 'automation']);
      const governance = hits(ctx, ['ai policy', 'ai governance', 'responsible ai']);
      if (aiTalk.length > 0) evidence.push(`Public AI intent: ${aiTalk.map((t) => t.trim()).join(', ')}`);
      if (aiTalk.length > 0 && governance.length === 0) evidence.push('No AI policy or governance referenced alongside that intent');

      const fit = aiTalk.length > 0 && governance.length === 0 ? 0.75 : aiTalk.length > 0 ? 0.4 : 0.15;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'ai-implementation',
    name: 'AI implementation',
    description: 'Committed to AI and needs it built, not advised on.',
    serviceIds: ['ai-readiness'],
    buyerRoles: ['IT Director', 'Head of Data', 'Operations Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const hiring = signalsMatching(ctx, /ai|data scientist|machine learning|data engineer/i);
      const committed = hits(ctx, ['copilot', 'ai platform', 'ai product', 'ai-powered']);
      if (hiring.length > 0) evidence.push(`Recruiting into AI/data roles: ${hiring.slice(0, 2).map((s) => s.summary).join('; ')}`);
      if (committed.length > 0) evidence.push(`Committed AI language on site: ${committed.join(', ')}`);

      const fit = hiring.length > 0 && committed.length > 0 ? 0.8 : hiring.length > 0 || committed.length > 0 ? 0.45 : 0.1;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'ps-augmentation',
    name: 'Professional-services augmentation',
    description: 'An IT firm or software business that needs delivery capacity it does not want to employ.',
    serviceIds: ['white-label-delivery', 'resource-augmentation'],
    buyerRoles: ['Managing Director', 'Delivery Director', 'Operations Director', 'Head of Service'],
    match: (ctx) => {
      const evidence: string[] = [];
      const isItFirm = hits(ctx, ['it consultancy', 'it services', 'software development', 'systems integrator', 'managed service provider', 'msp', 'saas', 'software house', 'technology partner']);
      if (isItFirm.length > 0) evidence.push(`Appears to be an IT or software business: ${isItFirm.join(', ')} — Onward's white-label route targets exactly this`);
      const hiringDelivery = signalsMatching(ctx, /engineer|consultant|support|technician|infrastructure/i);
      if (hiringDelivery.length > 0) evidence.push(`Recruiting delivery roles: ${hiringDelivery.slice(0, 3).map((s) => s.summary).join('; ')}`);

      let fit = 0.05;
      if (isItFirm.length > 0) fit = 0.75;
      if (isItFirm.length > 0 && hiringDelivery.length > 0) fit = 0.92;
      return { fit, evidence };
    },
  },
  {
    id: 'it-transformation',
    name: 'IT transformation',
    description: 'A stated change programme that needs technology leadership behind it.',
    serviceIds: ['it-consultancy', 'cloud-hosting'],
    buyerRoles: ['Managing Director', 'Finance Director', 'Transformation Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const terms = hits(ctx, ['transformation', 'modernisation', 'digital strategy', 'change programme', 'roadmap']);
      if (terms.length > 0) evidence.push(`Transformation language on site: ${terms.join(', ')}`);
      const leadership = signalsMatching(ctx, /cto|cio|it director|head of it|transformation/i);
      if (leadership.length > 0) evidence.push(`Leadership signal: ${leadership[0]!.summary}`);
      const fit = terms.length > 0 && leadership.length > 0 ? 0.8 : terms.length > 0 ? 0.5 : 0.15;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'managed-it',
    name: 'Managed IT',
    description: 'No visible internal IT function for an estate that clearly needs one.',
    serviceIds: ['managed-it'],
    buyerRoles: ['Managing Director', 'Finance Director', 'Operations Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const internalIt = signalsMatching(ctx, /it manager|it director|head of it|systems administrator|it support/i);
      const size = sizeFit(ctx.employees);

      if (ctx.employees !== null && ctx.employees >= 20 && internalIt.length === 0) {
        evidence.push(`${ctx.employees} employees with no internal IT role visible in recruitment or leadership signals`);
      }
      if (internalIt.length > 0) {
        evidence.push(`Internal IT capability indicated (${internalIt[0]!.summary}) — a co-sourcing conversation rather than full outsourcing`);
      }
      const multiSite = (valueOf(ctx.twin.locations) as string[] | null)?.length ?? 0;
      if (multiSite > 1) evidence.push(`${multiSite} sites to support`);

      let fit = 0.3;
      if (ctx.employees !== null && ctx.employees >= 20 && internalIt.length === 0) fit = 0.85;
      if (internalIt.length > 0) fit = 0.4;
      return { fit: clamp01(fit * size.score), evidence };
    },
  },
  {
    id: 'application-infrastructure-project',
    name: 'Application / infrastructure project',
    description: 'A named project needing hands rather than advice.',
    serviceIds: ['cloud-hosting', 'resource-augmentation', 'azure-virtual-desktop'],
    buyerRoles: ['IT Manager', 'Programme Manager', 'IT Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const projects = hits(ctx, ['migration', 'rollout', 'implementation', 'upgrade', 'deployment', 'go-live']);
      if (projects.length > 0) evidence.push(`Project language: ${projects.join(', ')}`);
      const fit = projects.length >= 2 ? 0.7 : projects.length === 1 ? 0.45 : 0.15;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'public-sector',
    name: 'Public sector',
    description: 'A public body reachable through frameworks Onward is already on.',
    serviceIds: ['azure-virtual-desktop', 'cyber-security', 'managed-it'],
    buyerRoles: ['Head of ICT', 'Digital Lead', 'Procurement Manager'],
    match: (ctx) => {
      const evidence: string[] = [];
      const publicish = hits(ctx, ['local authority', 'council', 'nhs', 'public sector', 'government', 'academy trust', 'school', 'university', 'housing association', 'charity']);
      if (publicish.length > 0) evidence.push(`Public sector indicators: ${publicish.join(', ')}`);
      if (publicish.length > 0) evidence.push('Onward holds a G-Cloud listing, which is a route in without a full tender');
      return { fit: publicish.length > 0 ? 0.8 : 0.05, evidence };
    },
  },
  {
    id: 'ma-change-event',
    name: 'M&A / change event',
    description: 'An acquisition or ownership change, which forces estate decisions on a deadline.',
    serviceIds: ['it-consultancy', 'cloud-hosting', 'managed-it'],
    buyerRoles: ['Finance Director', 'Managing Director', 'Integration Lead'],
    match: (ctx) => {
      const evidence: string[] = [];
      const events = signalsMatching(ctx, /acquisition|acquired|merger|merged|investment|private equity|mbo|takeover/i);
      const terms = hits(ctx, ['acquisition', 'acquired', 'merger', 'private equity', 'group of companies']);
      if (events.length > 0) evidence.push(`Change event signal: ${events[0]!.summary}`);
      if (terms.length > 0) evidence.push(`Corporate change language: ${terms.join(', ')}`);
      // The strongest timing signal there is: two estates and a deadline.
      const fit = events.length > 0 ? 0.95 : terms.length > 0 ? 0.6 : 0.05;
      return { fit, evidence };
    },
  },
  {
    id: 'rapid-growth',
    name: 'Rapid growth',
    description: 'Headcount growing faster than the infrastructure supporting it.',
    serviceIds: ['managed-it', 'cloud-hosting', 'azure-virtual-desktop'],
    buyerRoles: ['Operations Director', 'Finance Director', 'Managing Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const roles = signalsMatching(ctx, /./);
      const growthTerms = hits(ctx, ['growing', 'expansion', 'new office', 'scaling', 'fastest growing', 'recruiting']);
      if (roles.length >= 4) evidence.push(`${roles.length} open roles visible — hiring at a rate that outpaces most IT estates`);
      if (growthTerms.length > 0) evidence.push(`Growth language: ${growthTerms.join(', ')}`);
      const fit = roles.length >= 4 ? 0.75 : growthTerms.length > 0 ? 0.45 : 0.1;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'technology-migration',
    name: 'Technology migration',
    description: 'A platform move already under way or clearly imminent.',
    serviceIds: ['cloud-hosting', 'azure-virtual-desktop', 'resource-augmentation'],
    buyerRoles: ['IT Manager', 'IT Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const migration = hits(ctx, ['migration', 'migrating', 'moving to azure', 'moving to the cloud', 'replatform', 'cloud journey']);
      if (migration.length > 0) evidence.push(`Migration in progress or planned: ${migration.join(', ')}`);
      const competing = tech(ctx, /aws|google cloud|rackspace/i);
      if (competing.length > 0) evidence.push(`Non-Microsoft cloud present (${competing.map((t) => t.name).join(', ')}) — a consolidation conversation`);
      const fit = migration.length > 0 ? 0.8 : competing.length > 0 ? 0.4 : 0.1;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'cost-optimisation',
    name: 'Cost optimisation',
    description: 'Cost pressure that IT spend can answer.',
    serviceIds: ['managed-it', 'cloud-hosting'],
    buyerRoles: ['Finance Director', 'Managing Director'],
    match: (ctx) => {
      const evidence: string[] = [];
      const costTerms = hits(ctx, ['cost reduction', 'efficiency', 'value for money', 'cost savings', 'budget pressure']);
      if (costTerms.length > 0) evidence.push(`Cost language on site: ${costTerms.join(', ')}`);
      if (ctx.turnover !== null) evidence.push(`Estimated turnover ${Math.round(ctx.turnover).toLocaleString('en-GB')} — IT spend is a material line at this scale`);
      const fit = costTerms.length > 0 ? 0.65 : 0.25;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
  {
    id: 'supplier-consolidation',
    name: 'Supplier consolidation',
    description: 'Too many technology suppliers for the size of the business.',
    serviceIds: ['managed-it', 'it-consultancy'],
    buyerRoles: ['Finance Director', 'Operations Director', 'IT Manager'],
    match: (ctx) => {
      const evidence: string[] = [];
      const suppliers = (valueOf(ctx.twin.suppliers) as string[] | null) ?? [];
      const toolCount = ctx.technology.length;
      if (suppliers.length >= 4) evidence.push(`${suppliers.length} suppliers identified`);
      if (toolCount >= 6) evidence.push(`${toolCount} distinct technologies visible from public signals alone`);
      const fit = suppliers.length >= 4 ? 0.7 : toolCount >= 6 ? 0.5 : 0.15;
      return { fit: clamp01(fit * sizeFit(ctx.employees).score), evidence };
    },
  },
];

// --- scoring ---------------------------------------------------------------

export interface ScoreComponent {
  label: string;
  weight: number;
  input: number;
  contribution: number;
  why: string;
}

export interface ExplainedScore {
  value: number;
  components: ScoreComponent[];
  summary: string;
}

export interface AccountScores {
  icp: ExplainedScore;
  timing: ExplainedScore;
  need: ExplainedScore;
  value: ExplainedScore;
  evidence: ExplainedScore;
  contactability: ExplainedScore;
  deliveryFit: ExplainedScore;
  priority: ExplainedScore;
  matches: ArchetypeMatch[];
  /** The archetype driving the recommendation. */
  primary: ArchetypeMatch | null;
}

function score(components: Omit<ScoreComponent, 'contribution'>[], summary: string): ExplainedScore {
  const withContribution = components.map((c) => ({ ...c, contribution: c.weight * c.input }));
  const totalWeight = components.reduce((s, c) => s + Math.abs(c.weight), 0);
  const raw = withContribution.reduce((s, c) => s + c.contribution, 0);
  return {
    value: totalWeight > 0 ? clamp01(raw / totalWeight) : 0,
    components: withContribution,
    summary,
  };
}

export function buildIcpContext(twin: CompanyTwin, profile: MspProfile, understanding: number): IcpContext {
  const textBits: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') textBits.push(v);
    else if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === 'object') textBits.push(JSON.stringify(v));
  };

  for (const key of ['valuePropositions', 'services', 'products', 'sectors', 'industries', 'customerSegments', 'markets', 'partners', 'suppliers'] as const) {
    push(valueOf(twin[key]));
  }
  const signals = [
    ...((valueOf(twin.recruitmentSignals) as Signal[] | null) ?? []),
    ...((valueOf(twin.strategicSignals) as Signal[] | null) ?? []),
    ...((valueOf(twin.externalEvents) as Signal[] | null) ?? []),
    ...((valueOf(twin.operationalSignals) as Signal[] | null) ?? []),
    ...((valueOf(twin.cyberIndicators) as Signal[] | null) ?? []),
    ...((valueOf(twin.financialSignals) as Signal[] | null) ?? []),
  ];
  signals.forEach((s) => textBits.push(s.summary));

  const technology = [
    ...((valueOf(twin.technologyEstate) as TechnologyItem[] | null) ?? []),
    ...((valueOf(twin.softwareEstate) as TechnologyItem[] | null) ?? []),
    ...((valueOf(twin.cloudEstate) as TechnologyItem[] | null) ?? []),
  ];
  technology.forEach((t) => textBits.push(`${t.name} ${t.category} ${t.indicator}`));

  return {
    twin,
    profile,
    employees: valueOf(twin.employeesEstimate) as number | null,
    turnover: valueOf(twin.turnoverEstimate) as number | null,
    sectors: (valueOf(twin.sectors) as string[] | null) ?? [],
    segments: (valueOf(twin.customerSegments) as string[] | null) ?? [],
    technology,
    signals,
    haystack: ` ${textBits.join(' ').toLowerCase()} `,
    understanding,
  };
}

export function matchArchetypes(ctx: IcpContext): ArchetypeMatch[] {
  return ARCHETYPES.map((a) => {
    const { fit, evidence } = a.match(ctx);
    return {
      archetype: a.id,
      name: a.name,
      fit,
      evidence,
      serviceIds: a.serviceIds,
      rationale: evidence[0] ?? 'No specific evidence — matched on general profile only.',
    };
  })
    .filter((m) => m.fit > 0.2)
    .sort((a, b) => b.fit - a.fit);
}

export function scoreAccount(ctx: IcpContext, contactCount: number): AccountScores {
  const matches = matchArchetypes(ctx);
  const primary = matches[0] ?? null;
  const sellable = sellableServices(ctx.profile);
  const size = sizeFit(ctx.employees);

  // ICP: does this look like a company Onward should sell to at all?
  const sectorFit = ctx.sectors.some((s) =>
    ctx.profile.sectors.value.some((p) => p.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(p.toLowerCase())),
  );
  const icp = score(
    [
      { label: 'Size fit', weight: 35, input: size.score, why: size.note },
      { label: 'Sector fit', weight: 25, input: sectorFit ? 1 : ctx.sectors.length > 0 ? 0.35 : 0.2, why: sectorFit ? `Sector (${ctx.sectors.join(', ')}) is one Onward states it serves` : ctx.sectors.length > 0 ? `Sector (${ctx.sectors.join(', ')}) is outside Onward's stated sectors` : 'Sector not determined' },
      { label: 'Archetype coverage', weight: 25, input: clamp01(matches.length / 4), why: `${matches.length} opportunity archetype(s) matched` },
      { label: 'Geography', weight: 15, input: 1, why: 'UK targeting assumed for this campaign' },
    ],
    primary ? `Fits the ${primary.name} archetype` : 'No archetype matched strongly',
  );

  // TIMING: is there a reason to contact now rather than ever?
  const changeEvent = matches.find((m) => m.archetype === 'ma-change-event');
  const hiring = ctx.signals.filter((s) => s.kind === 'open-role').length;
  const migration = matches.find((m) => m.archetype === 'technology-migration');
  const timing = score(
    [
      { label: 'Change event', weight: 40, input: changeEvent ? changeEvent.fit : 0, why: changeEvent ? changeEvent.rationale : 'No acquisition, merger or ownership change detected' },
      { label: 'Hiring activity', weight: 25, input: clamp01(hiring / 6), why: hiring > 0 ? `${hiring} open role(s) visible` : 'No recruitment signals' },
      { label: 'Migration in flight', weight: 20, input: migration ? migration.fit : 0, why: migration ? migration.rationale : 'No migration signal' },
      { label: 'Recency of evidence', weight: 15, input: ctx.understanding > 0 ? 0.6 : 0, why: 'Signals are as fresh as the last analysis of this account' },
    ],
    changeEvent ? 'A change event is the strongest reason to contact now' : hiring > 0 ? 'Hiring is the main timing signal' : 'No strong timing signal — this is a nurture account, not a call today',
  );

  // NEED: how badly do they appear to need what Onward sells?
  const topFit = primary?.fit ?? 0;
  const secondFit = matches[1]?.fit ?? 0;
  const need = score(
    [
      { label: 'Primary archetype strength', weight: 55, input: topFit, why: primary ? `${primary.name} at ${Math.round(topFit * 100)}% fit` : 'No archetype matched' },
      { label: 'Corroborating archetype', weight: 25, input: secondFit, why: matches[1] ? `${matches[1].name} also matched` : 'Only one archetype matched' },
      { label: 'Evidence count', weight: 20, input: clamp01((primary?.evidence.length ?? 0) / 3), why: `${primary?.evidence.length ?? 0} evidence item(s) behind the primary match` },
    ],
    primary ? primary.rationale : 'No demonstrated need',
  );

  // VALUE: what is this worth if it lands?
  const services = (primary?.serviceIds ?? []).map((id) => sellable.find((s) => s.id === id)).filter((s): s is ServiceLine => Boolean(s));
  const dealMid = services.length > 0
    ? services.reduce((sum, s) => sum + (s.commercials.typicalDealLowGbp + s.commercials.typicalDealHighGbp) / 2, 0) / services.length
    : 0;
  const scaledDeal = dealMid * (size.score || 0.3);
  const value = score(
    [
      { label: 'Typical deal size for the matched service', weight: 60, input: clamp01(dealMid / 150_000), why: services.length > 0 ? `${services.map((s) => s.name).join(', ')} typically £${Math.round(dealMid).toLocaleString('en-GB')}` : 'No sellable service matched' },
      { label: 'Account size multiplier', weight: 25, input: size.score, why: size.note },
      { label: 'Recurring revenue', weight: 15, input: services.some((s) => s.commercials.recurring) ? 1 : 0.3, why: services.some((s) => s.commercials.recurring) ? 'Matched service is recurring' : 'Matched service is one-off' },
    ],
    `Indicative value £${Math.round(scaledDeal).toLocaleString('en-GB')}`,
  );

  // EVIDENCE: how much of this rests on something we actually observed?
  const evidenceCount = matches.reduce((sum, m) => sum + m.evidence.length, 0);
  const evidence = score(
    [
      { label: 'Account understanding', weight: 45, input: clamp01(ctx.understanding / 60), why: `Company Twin is ${ctx.understanding}% populated` },
      { label: 'Observed evidence items', weight: 35, input: clamp01(evidenceCount / 6), why: `${evidenceCount} concrete observation(s) across all matched archetypes` },
      { label: 'Technology signals', weight: 20, input: clamp01(ctx.technology.length / 5), why: `${ctx.technology.length} technology indicator(s)` },
    ],
    ctx.understanding < 25 ? 'Too little is known about this account to contact it' : 'Evidence base is workable',
  );

  // CONTACTABILITY: can we actually reach the right person?
  const contactability = score(
    [
      { label: 'Named contacts held', weight: 60, input: clamp01(contactCount / 2), why: contactCount > 0 ? `${contactCount} contact(s) identified` : 'No contacts identified yet' },
      { label: 'Buyer role clarity', weight: 25, input: primary ? 1 : 0.2, why: primary ? `Likely owner: ${ARCHETYPES.find((a) => a.id === primary.archetype)?.buyerRoles.slice(0, 2).join(' or ')}` : 'Problem owner unclear' },
      { label: 'Public contact route', weight: 15, input: (valueOf(ctx.twin.urls) as string[] | null)?.length ? 1 : 0, why: 'Website reachable' },
    ],
    contactCount === 0 ? 'No route to a named person yet' : 'Contactable',
  );

  // DELIVERY FIT: can Onward actually deliver this if it lands?
  const capacityKnown = ctx.profile.capacity.value.consultantsAvailable !== null;
  const constrained = services.filter((s) => s.deliveryCapacity === 'constrained');
  const deliveryFit = score(
    [
      { label: 'Service is sellable now', weight: 50, input: services.length > 0 ? 1 : 0, why: services.length > 0 ? `${services.length} matched service(s) are deliverable` : 'No deliverable service matched' },
      { label: 'Capacity headroom', weight: 30, input: capacityKnown ? 1 : 0.5, why: capacityKnown ? 'Delivery capacity known' : 'Delivery capacity not supplied — assumed adequate, which is a stated risk' },
      { label: 'Not constrained', weight: 20, input: constrained.length === 0 ? 1 : 0.4, why: constrained.length > 0 ? `Constrained: ${constrained.map((s) => s.name).join(', ')}` : 'No constrained services in this match' },
    ],
    services.length === 0 ? 'Nothing Onward sells fits this account' : 'Deliverable',
  );

  // PRIORITY: the one number that orders the worklist.
  const priority = score(
    [
      { label: 'ICP', weight: 20, input: icp.value, why: icp.summary },
      { label: 'Need', weight: 20, input: need.value, why: need.summary },
      { label: 'Timing', weight: 18, input: timing.value, why: timing.summary },
      { label: 'Value', weight: 15, input: value.value, why: value.summary },
      { label: 'Evidence', weight: 15, input: evidence.value, why: evidence.summary },
      { label: 'Contactability', weight: 7, input: contactability.value, why: contactability.summary },
      { label: 'Delivery fit', weight: 5, input: deliveryFit.value, why: deliveryFit.summary },
    ],
    primary
      ? `${primary.name}: ${primary.rationale}`
      : 'No archetype matched — this account should not be worked',
  );

  return { icp, timing, need, value, evidence, contactability, deliveryFit, priority, matches, primary };
}

export function archetypeById(id: ArchetypeId): Archetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}
