/**
 * The AIGoGo capability mesh — Directive §5 and §31.
 *
 * Every opco named in the directive is registered here. None is reachable as a
 * live service from this environment, so each is `maturity: "mock"` with a
 * stated reason. Registering a live one is: implement CapabilityAdapter against
 * the same interface, set maturity/apiEndpoint, replace the entry. No
 * orchestration code changes (§14).
 */

import type { Capability, CapabilityAdapter, CapabilityAction } from './types';
import { createMockAdapter } from './adapters/mock-adapter';

const NOT_REACHABLE = 'No AIGoGo group service reachable from this environment — see docs/current-state.md';

function action(
  id: string,
  name: string,
  description: string,
  opts: Partial<CapabilityAction> = {},
): CapabilityAction {
  const external = opts.external ?? false;
  const declared = opts.requiredInputs ?? ['companyId'];
  // An action that reaches outside the platform cannot be invoked without an
  // approval id. Enforcing it here rather than per-action means a new external
  // action cannot be added without the gate (§11).
  const requiredInputs = external && !declared.includes('approvalId') ? [...declared, 'approvalId'] : declared;

  return {
    id,
    name,
    description,
    external,
    risk: opts.risk ?? 'low',
    unitCostGbp: opts.unitCostGbp ?? 0.5,
    requiredInputs,
    outputs: opts.outputs ?? ['result'],
  };
}

const CAPABILITIES: Capability[] = [
  {
    id: 'toleron',
    name: 'Toleron',
    opco: 'Toleron',
    type: 'intelligence',
    description: 'Company, market and competitor analysis. The analytical spine of company understanding.',
    supportedActions: [
      action('analyse-company', 'Analyse company', 'Build a structured company profile from public sources.', {
        outputs: ['profile', 'signals'],
      }),
      action('analyse-market', 'Analyse market', 'Assess market size, growth and positioning.'),
      action('analyse-competitors', 'Analyse competitors', 'Identify and profile close competitors.'),
      action('assess-technology', 'Assess technology estate', 'Infer the technology and software estate.'),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'synchronous',
    requiredInputs: ['companyId'],
    outputs: ['companyProfile'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.9,
    typicalDurationSec: 25,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'salesonic',
    name: 'SaleSonic',
    opco: 'SaleSonic',
    type: 'growth',
    description: 'Pipeline generation and sales execution: ICP, targeting, outreach, qualification, meeting booking.',
    supportedActions: [
      action('define-icp', 'Define ICP', 'Produce an ideal customer profile from the company twin.'),
      action('identify-targets', 'Identify target accounts', 'Build a target account list matching the ICP.', {
        outputs: ['accounts'],
      }),
      action('enrich-contacts', 'Enrich contacts', 'Attach decision-maker contacts to target accounts.', {
        risk: 'medium',
      }),
      action('generate-outreach', 'Generate outreach', 'Draft sequenced outreach for approval.'),
      action('execute-outreach', 'Execute approved outreach', 'Send approved outreach and handle replies.', {
        external: true,
        risk: 'high',
        unitCostGbp: 2.5,
        requiredInputs: ['companyId', 'approvalId'],
      }),
      action('qualify-leads', 'Qualify leads', 'Qualify inbound responses against the ICP.'),
      action('book-meetings', 'Book meetings', 'Book qualified meetings into the calendar.', {
        external: true,
        risk: 'medium',
      }),
      action('reactivate-dormant', 'Reactivate dormant accounts', 'Run a reactivation sequence on dormant records.', {
        external: true,
        risk: 'medium',
        unitCostGbp: 2.0,
      }),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['companyId'],
    outputs: ['pipeline', 'meetings'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.82,
    typicalDurationSec: 120,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'listeningpost',
    name: 'ListeningPost',
    opco: 'ListeningPost',
    type: 'intelligence',
    description: 'External signal monitoring: news, hiring, filings, trigger events.',
    supportedActions: [
      action('monitor-signals', 'Monitor signals', 'Watch a company for trigger events.'),
      action('detect-triggers', 'Detect buying triggers', 'Surface events that justify an approach.'),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['companyId'],
    outputs: ['signals'],
    owner: 'AIGoGo Group',
    health: 'unavailable',
    successRate: 0.88,
    typicalDurationSec: 30,
    mockReason: 'Repository mflinn99/listeningpost is empty — no service to call',
  },
  {
    id: 'sourcingai',
    name: 'SourcingAI',
    opco: 'SourcingAI',
    type: 'procurement',
    description: 'Supplier discovery, alternative sourcing and market pricing.',
    supportedActions: [
      action('find-alternatives', 'Find alternative suppliers', 'Identify credible alternative suppliers.'),
      action('benchmark-pricing', 'Benchmark pricing', 'Benchmark current pricing against the market.'),
      action('run-sourcing-event', 'Run sourcing event', 'Run a competitive sourcing event.', {
        external: true,
        risk: 'high',
        unitCostGbp: 8,
        requiredInputs: ['companyId', 'approvalId'],
      }),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['companyId'],
    outputs: ['suppliers', 'benchmarks'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.85,
    typicalDurationSec: 90,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'buyonic',
    name: 'Buyonic',
    opco: 'Buyonic',
    type: 'procurement',
    description: 'Spend analysis, contract and renewal management, procurement compliance.',
    supportedActions: [
      action('analyse-spend', 'Analyse spend', 'Break down spend by category and supplier.'),
      action('detect-duplication', 'Detect duplicate tooling', 'Find overlapping software and licences.'),
      action('renewal-calendar', 'Build renewal calendar', 'Map contract end and renewal dates.'),
      action('negotiate-renewal', 'Negotiate renewal', 'Run a supported renewal negotiation.', {
        external: true,
        risk: 'high',
        unitCostGbp: 12,
        requiredInputs: ['companyId', 'approvalId'],
      }),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['companyId'],
    outputs: ['spendAnalysis', 'savings'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.86,
    typicalDurationSec: 60,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'grothos',
    name: 'GrothOS',
    opco: 'GrothOS',
    type: 'growth',
    description: 'Growth strategy, proposition, pricing and packaging.',
    supportedActions: [
      action('proposition-review', 'Review proposition', 'Assess proposition clarity and differentiation.'),
      action('pricing-review', 'Review pricing', 'Model a pricing or margin uplift.'),
      action('productise-service', 'Productise service', 'Turn a bespoke service into a packaged offer.'),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'synchronous',
    requiredInputs: ['companyId'],
    outputs: ['recommendations'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.8,
    typicalDurationSec: 45,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'sixonic',
    name: 'Sixonic',
    opco: 'Sixonic',
    type: 'automation',
    description: 'Process automation and agent delivery.',
    supportedActions: [
      action('map-process', 'Map process', 'Map a manual business process.'),
      action('automate-process', 'Automate process', 'Build and deploy an automation.', {
        external: true,
        risk: 'medium',
        unitCostGbp: 15,
        requiredInputs: ['companyId', 'approvalId'],
      }),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['companyId'],
    outputs: ['automation'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.78,
    typicalDurationSec: 300,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'strata-metamsp',
    name: 'Strata / MetaMSP',
    opco: 'Strata',
    type: 'msp',
    description: 'MSP service design, packaging and delivery economics.',
    supportedActions: [
      action('design-service', 'Design managed service', 'Design a managed service offer for a customer.'),
      action('build-proposal', 'Build proposal', 'Produce a customer-ready proposal.', { unitCostGbp: 3 }),
      action('prepare-review', 'Prepare customer review', 'Assemble a customer business review pack.', {
        unitCostGbp: 3,
      }),
      action('start-delivery', 'Start delivery', 'Begin onboarding a new managed service.', {
        external: true,
        risk: 'high',
        unitCostGbp: 20,
        requiredInputs: ['companyId', 'approvalId'],
      }),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'mock',
    executionMode: 'human-in-loop',
    requiredInputs: ['companyId'],
    outputs: ['serviceDesign', 'proposal'],
    owner: 'AIGoGo Group',
    health: 'unknown',
    successRate: 0.91,
    typicalDurationSec: 60,
    mockReason: NOT_REACHABLE,
  },
  {
    id: 'onward',
    name: 'Onward',
    opco: 'Onward',
    type: 'msp',
    description: 'Reference MSP estate: customers, contracts, current services.',
    supportedActions: [
      action('sync-estate', 'Sync MSP estate', 'Pull customers, contracts and services.'),
      action('sync-tickets', 'Sync service desk', 'Pull ticket volumes and themes.'),
    ],
    apiEndpoint: null,
    authMethod: 'api-key',
    maturity: 'mock',
    executionMode: 'asynchronous',
    requiredInputs: ['tenantId'],
    outputs: ['customers', 'contracts'],
    owner: 'Onward',
    health: 'unavailable',
    successRate: 0.95,
    typicalDurationSec: 40,
    mockReason: 'No Onward dataset or credentials available — portfolio seeded synthetically',
  },
  {
    id: 'jojo',
    name: 'JoJo',
    opco: 'AIGoGo',
    type: 'intelligence',
    description: 'Orchestration layer. Translates an objective into a plan and routes it across the mesh.',
    supportedActions: [
      action('plan-objective', 'Plan objective', 'Turn a stated objective into an execution plan.'),
      action('next-best-action', 'Next best action', 'Compute the highest-value practical next action.'),
    ],
    apiEndpoint: null,
    authMethod: 'internal-mesh',
    maturity: 'beta',
    executionMode: 'synchronous',
    requiredInputs: ['objective'],
    outputs: ['plan'],
    owner: 'AIGoGo Group',
    health: 'healthy',
    successRate: 0.93,
    typicalDurationSec: 10,
    // JoJo is the one capability implemented in this repository rather than mocked.
  },
];

const VALUE_FRACTIONS: Record<string, number> = {
  'salesonic:reactivate-dormant': 0.62,
  'salesonic:execute-outreach': 0.48,
  'salesonic:book-meetings': 0.35,
  'buyonic:negotiate-renewal': 0.71,
  'buyonic:detect-duplication': 0.55,
  'sourcingai:run-sourcing-event': 0.66,
  'sixonic:automate-process': 0.58,
  'strata-metamsp:start-delivery': 0.85,
  'grothos:pricing-review': 0.4,
};

const adapters = new Map<string, CapabilityAdapter>(
  CAPABILITIES.map((c) => [
    c.id,
    createMockAdapter(c, {
      valueFraction: 0,
      outputs: (inv, seed) => ({
        capability: c.id,
        action: inv.actionId,
        summary: `${c.name} completed "${inv.actionId}" for company ${inv.companyId}`,
        simulationSeed: Math.round(seed * 1000) / 1000,
      }),
    }),
  ]),
);

// Attach per-action value fractions so measured benefit differs by action.
for (const [key, fraction] of Object.entries(VALUE_FRACTIONS)) {
  const [capId, actionId] = key.split(':') as [string, string];
  const cap = CAPABILITIES.find((c) => c.id === capId);
  if (!cap) continue;
  const existing = adapters.get(capId)!;
  adapters.set(capId, {
    capability: cap,
    async invoke(inv) {
      if (inv.actionId !== actionId) return existing.invoke(inv);
      const scoped = createMockAdapter(cap, {
        valueFraction: fraction,
        outputs: (i, seed) => ({
          capability: capId,
          action: i.actionId,
          summary: `${cap.name} completed "${i.actionId}"`,
          simulationSeed: Math.round(seed * 1000) / 1000,
        }),
        evidence: (i, seed) => [
          `Simulated ${cap.name} · ${actionId}. No live ${cap.opco} service is connected.`,
          `Modelled realisation of ${Math.round(fraction * 100)}% of the financial target (seed ${Math.round(seed * 1000) / 1000}).`,
        ],
      });
      return scoped.invoke(inv);
    },
  });
}

export function listCapabilities(): Capability[] {
  return CAPABILITIES.map((c) => ({ ...c }));
}

export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function getAdapter(id: string): CapabilityAdapter | undefined {
  return adapters.get(id);
}

export function registerAdapter(adapter: CapabilityAdapter): void {
  const idx = CAPABILITIES.findIndex((c) => c.id === adapter.capability.id);
  if (idx >= 0) CAPABILITIES[idx] = adapter.capability;
  else CAPABILITIES.push(adapter.capability);
  adapters.set(adapter.capability.id, adapter);
}

export function findActionOwner(actionId: string): { capability: Capability; action: CapabilityAction } | null {
  for (const c of CAPABILITIES) {
    const a = c.supportedActions.find((x) => x.id === actionId);
    if (a) return { capability: c, action: a };
  }
  return null;
}
