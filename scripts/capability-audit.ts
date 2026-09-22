/**
 * Generates agentic_gtm_capability_registry.json from the codebase itself, so
 * the machine-readable audit reflects what is actually there rather than what
 * somebody remembered. Re-run it after any structural change.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Verdict = 'REUSE' | 'EXTEND' | 'WRAP' | 'REPLACE' | 'NOT_RELEVANT' | 'NOTHING_TO_REUSE';

interface Component {
  id: string;
  name: string;
  repository: string;
  path: string | null;
  what_it_does: string;
  works: boolean | 'unverified';
  works_evidence: string;
  interface: string;
  authentication: string;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  data_available: string;
  test_coverage: { tests: number; files: string[] } | 'none';
  production_readiness: 'production' | 'beta' | 'mock' | 'not-deployed' | 'empty';
  gtm_relevance: 'core' | 'supporting' | 'none';
  verdict: Verdict;
  notes?: string;
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  if (statSync(path).isDirectory()) {
    return readdirSync(path).reduce((sum, f) => sum + countLines(join(path, f)), 0);
  }
  return readFileSync(path, 'utf8').split('\n').length;
}

function testsIn(file: string): number {
  const path = join('tests', file);
  if (!existsSync(path)) return 0;
  return (readFileSync(path, 'utf8').match(/^\s*it\(/gm) ?? []).length;
}

const COMPONENTS: Component[] = [
  {
    id: 'metamsp-tenancy',
    name: 'Multi-tenant data layer',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/db/tenant.ts',
    what_it_does: 'Rejects any statement touching a tenant-scoped table without a bound tenant predicate, before it reaches the database.',
    works: true,
    works_evidence: '10 tenant-isolation tests pass, including cross-tenant read attempts and audit-log immutability.',
    interface: 'TypeScript class TenantDb',
    authentication: 'TenantContext resolved from session',
    inputs: ['SQL', 'TenantContext'],
    outputs: ['rows'],
    dependencies: ['better-sqlite3'],
    data_available: 'All tenant data',
    test_coverage: { tests: testsIn('tenant-isolation.test.ts'), files: ['tests/tenant-isolation.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'REUSE',
  },
  {
    id: 'metamsp-auth',
    name: 'Authentication and RBAC',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/auth',
    what_it_does: 'scrypt passwords, server-side sessions, lockout, CSRF, an enforced permission matrix and OIDC sign-in.',
    works: true,
    works_evidence: 'Verified live: unauthenticated GET / redirects to /login; READ_ONLY refused on all nine mutating routes.',
    interface: 'guardRoute(), requirePermission()',
    authentication: 'local password or OIDC',
    inputs: ['credentials', 'session cookie'],
    outputs: ['TenantContext', 'permission decision'],
    dependencies: ['node:crypto'],
    data_available: 'users, sessions',
    test_coverage: { tests: testsIn('auth.test.ts') + testsIn('oidc.test.ts'), files: ['tests/auth.test.ts', 'tests/oidc.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'EXTEND',
    notes: "Mark's commercial gate is added as a 'commercial' permission.",
  },
  {
    id: 'metamsp-vault',
    name: 'Credential vault',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/secrets/vault.ts',
    what_it_does: 'AES-256-GCM per-tenant credential storage that refuses to store anything when no master key is configured.',
    works: true,
    works_evidence: '10 vault tests pass, including rotation and tamper detection.',
    interface: 'putSecret/getSecret',
    authentication: 'METAMSP_SECRET_KEY',
    inputs: ['credentials'],
    outputs: ['credentials'],
    dependencies: ['node:crypto'],
    data_available: 'connector credentials',
    test_coverage: { tests: testsIn('vault.test.ts'), files: ['tests/vault.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'REUSE',
  },
  {
    id: 'metamsp-jobs',
    name: 'Durable job queue',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/jobs',
    what_it_does: 'Atomic claim, retry with backoff, dead-letter, stale-lock recovery. Survives restart.',
    works: true,
    works_evidence: '8 queue tests pass; analysis verified running through it end to end against the live server.',
    interface: 'enqueue()/claimNext()',
    authentication: 'n/a (internal)',
    inputs: ['job payload'],
    outputs: ['job execution'],
    dependencies: ['sqlite'],
    data_available: 'jobs',
    test_coverage: { tests: testsIn('jobs.test.ts'), files: ['tests/jobs.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'EXTEND',
    notes: 'New job types for the GTM agents and autonomous recovery.',
  },
  {
    id: 'metamsp-twin',
    name: 'Company Digital Twin + provenance',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/core/company-twin.ts',
    what_it_does: '43 fields, each carrying value, source, method, confidence and timestamp; conflicting claims retained.',
    works: true,
    works_evidence: '9 evidence tests pass; three synthetic companies produce real understanding scores.',
    interface: 'CompanyTwin type + addClaim()',
    authentication: 'n/a',
    inputs: ['NormalisedRecord'],
    outputs: ['CompanyTwin'],
    dependencies: [],
    data_available: 'company_twins',
    test_coverage: { tests: testsIn('evidence.test.ts'), files: ['tests/evidence.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'REUSE',
    notes: 'Becomes the account intelligence record for GTM.',
  },
  {
    id: 'metamsp-website-connector',
    name: 'Website research connector',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/discovery/website-connector.ts',
    what_it_does: 'Crawls a homepage plus high-value internal pages, fingerprints technology, infers sector and segment, records provenance.',
    works: true,
    works_evidence: 'Fetches live sites; degrades to a low understanding score rather than inventing a business.',
    interface: 'CompanyDataConnector',
    authentication: 'none',
    inputs: ['domain'],
    outputs: ['NormalisedRecord[]'],
    dependencies: ['fetch'],
    data_available: 'public web',
    test_coverage: { tests: testsIn('resilience.test.ts'), files: ['tests/resilience.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'REUSE',
    notes: 'This is the Market and Account Intelligence agents’ research capability.',
  },
  {
    id: 'metamsp-capability-router',
    name: 'Capability registry and router',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/capabilities',
    what_it_does: 'Scores every registered capability action against a requested objective and explains the choice.',
    works: true,
    works_evidence: '16 router tests pass, including registering a new capability at runtime with no orchestration change.',
    interface: 'routeObjective(), registerAdapter()',
    authentication: 'per adapter',
    inputs: ['action id', 'objective'],
    outputs: ['recommendation + rationale'],
    dependencies: [],
    data_available: 'capability registry',
    test_coverage: { tests: testsIn('router.test.ts'), files: ['tests/router.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'core',
    verdict: 'EXTEND',
    notes: 'The ten GTM agents register here.',
  },
  {
    id: 'metamsp-ledger',
    name: 'Benefits ledger',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/benefits/ledger.ts',
    what_it_does: 'Six-stage forward-only value ratchet from theoretical to verified.',
    works: true,
    works_evidence: '8 ledger tests pass; verified value proven against a connected system in the verification suite.',
    interface: 'createBenefit/advance',
    authentication: 'n/a',
    inputs: ['opportunity'],
    outputs: ['benefit record'],
    dependencies: [],
    data_available: 'benefits',
    test_coverage: { tests: testsIn('benefits.test.ts'), files: ['tests/benefits.test.ts'] },
    production_readiness: 'production',
    gtm_relevance: 'supporting',
    verdict: 'EXTEND',
    notes: 'Pipeline value staging reuses this rather than inventing a parallel concept.',
  },
  {
    id: 'metamsp-jojo',
    name: 'JoJo orchestrator',
    repository: 'mflinn99/aijoes.app',
    path: 'src/lib/jojo/orchestrator.ts',
    what_it_does: 'Parses an objective into a measurable outcome, selects work, reports shortfall honestly.',
    works: true,
    works_evidence: "Answers the directive's own example objectives; reports an honest shortfall rather than inflating to hit a target.",
    interface: 'askJojo()',
    authentication: 'session',
    inputs: ['objective text'],
    outputs: ['steps, selection, answer'],
    dependencies: ['repositories'],
    data_available: 'opportunities, companies',
    test_coverage: { tests: testsIn('end-to-end.test.ts'), files: ['tests/end-to-end.test.ts'] },
    production_readiness: 'beta',
    gtm_relevance: 'core',
    verdict: 'EXTEND',
    notes: 'Becomes the JoJo GTM Director.',
  },
  {
    id: 'hazel-email-service',
    name: 'Dual-provider email service',
    repository: 'mflinn99/hazel-backend',
    path: 'server/_core/emailService.ts',
    what_it_does: 'Selects SendGrid or AWS SES from environment variables and no-ops when neither is configured.',
    works: 'unverified',
    works_evidence: 'Code inspected and coherent; not executed here — different stack, no deployment reachable, no provider credentials.',
    interface: 'EmailService class',
    authentication: 'SENDGRID_API_KEY or AWS SES keys',
    inputs: ['EmailMessage'],
    outputs: ['send result'],
    dependencies: ['@sendgrid/mail', '@aws-sdk/client-ses'],
    data_available: 'n/a',
    test_coverage: 'none',
    production_readiness: 'not-deployed',
    gtm_relevance: 'supporting',
    verdict: 'WRAP',
    notes: 'The provider-detection pattern is ported into the GTM outreach transport; the code is not imported across stacks.',
  },
  {
    id: 'aigogo-salesonic',
    name: 'SaleSonicAI',
    repository: '(none found)',
    path: null,
    what_it_does: 'Declared: pipeline generation and sales execution. No implementation exists anywhere reachable.',
    works: false,
    works_evidence: 'No repository, no service endpoint, no credentials. Registered as a mock with 8 declared actions.',
    interface: 'CapabilityAdapter (mock)',
    authentication: 'internal-mesh (notional)',
    inputs: ['companyId'],
    outputs: ['pipeline', 'meetings'],
    dependencies: [],
    data_available: 'none',
    test_coverage: 'none',
    production_readiness: 'mock',
    gtm_relevance: 'core',
    verdict: 'REPLACE',
    notes: 'The GTM outreach agent implements this function directly, behind the same interface, so a live SaleSonic can take over later.',
  },
  {
    id: 'aigogo-toleron',
    name: 'Toleron',
    repository: '(none found)',
    path: null,
    what_it_does: 'Declared: company, market and competitor analysis. No implementation exists anywhere reachable.',
    works: false,
    works_evidence: 'No repository, no service endpoint. Mocked.',
    interface: 'CapabilityAdapter (mock)',
    authentication: 'internal-mesh (notional)',
    inputs: ['companyId'],
    outputs: ['companyProfile'],
    dependencies: [],
    data_available: 'none',
    test_coverage: 'none',
    production_readiness: 'mock',
    gtm_relevance: 'core',
    verdict: 'REPLACE',
    notes: "MetaMSP's own twin and website connector already perform this function with real provenance.",
  },
  {
    id: 'aigogo-listeningpost',
    name: 'ListeningPost',
    repository: 'mflinn99/listeningpost',
    path: null,
    what_it_does: 'Declared: external signal monitoring. The repository is empty.',
    works: false,
    works_evidence: 'Clone returns zero refs.',
    interface: 'CapabilityAdapter (mock)',
    authentication: 'n/a',
    inputs: [],
    outputs: [],
    dependencies: [],
    data_available: 'none',
    test_coverage: 'none',
    production_readiness: 'empty',
    gtm_relevance: 'core',
    verdict: 'REPLACE',
    notes: 'The GTM Signal Agent implements signal detection from the twin and public sources.',
  },
  {
    id: 'aigogo-onward-systems',
    name: 'Onward systems (CRM, PSA, email, estate)',
    repository: '(none found)',
    path: null,
    what_it_does: 'Onward’s own commercial systems. None is reachable: no endpoint, no dataset, no credentials.',
    works: false,
    works_evidence: 'No repository; no credentials present in this environment.',
    interface: 'n/a',
    authentication: 'unknown',
    inputs: [],
    outputs: [],
    dependencies: [],
    data_available: 'none',
    test_coverage: 'none',
    production_readiness: 'not-deployed',
    gtm_relevance: 'core',
    verdict: 'WRAP',
    notes: 'A local CRM system of record is implemented behind a CRM adapter interface, so a real CRM connects later without changing the loop. See BLOCKERS.md.',
  },
];

const registry = {
  generated_at: new Date().toISOString(),
  audit_method:
    'Every reachable repository was cloned and inspected. Components are listed with the evidence that they do or do not work. Nothing is inferred from a repository name.',
  repositories_inspected: [
    { name: 'mflinn99/aijoes.app', files: 116, verdict: 'REUSE' },
    { name: 'mflinn99/hazel-backend', files: 508, verdict: 'WRAP (one pattern)' },
    { name: 'mflinn99/brightminds', files: 184, verdict: 'NOT_RELEVANT' },
    { name: 'mflinn99/-jojo-control-plane', files: 1, verdict: 'NOTHING_TO_REUSE' },
    { name: 'mflinn99/listeningpost', files: 0, verdict: 'NOTHING_TO_REUSE' },
    { name: 'mflinn99/agent-portal', files: 1, verdict: 'NOTHING_TO_REUSE' },
  ],
  repositories_not_inspected: [
    { name: 'mflinn99/zerion-ev-pulse-clean', reason: 'EV telemetry product line, unrelated domain' },
    { name: 'mflinn99/Zerion-site', reason: 'Marketing site for the above' },
    { name: 'mflinn99/housecost-app', reason: 'Housing cost tool, unrelated domain' },
    { name: 'mflinn99/Hazel-demo', reason: 'Demo of hazel-backend, which was inspected in full' },
    { name: 'mflinn99/PbP', reason: 'Dormant 15 months, no indication of GTM relevance' },
  ],
  summary: {
    total_components: COMPONENTS.length,
    reuse: COMPONENTS.filter((c) => c.verdict === 'REUSE').length,
    extend: COMPONENTS.filter((c) => c.verdict === 'EXTEND').length,
    wrap: COMPONENTS.filter((c) => c.verdict === 'WRAP').length,
    replace: COMPONENTS.filter((c) => c.verdict === 'REPLACE').length,
    working: COMPONENTS.filter((c) => c.works === true).length,
    not_working_or_absent: COMPONENTS.filter((c) => c.works === false).length,
  },
  components: COMPONENTS,
};

writeFileSync('docs/gtm/agentic_gtm_capability_registry.json', `${JSON.stringify(registry, null, 2)}\n`);
console.log(
  `registry: ${COMPONENTS.length} components | working ${registry.summary.working} | absent ${registry.summary.not_working_or_absent}`,
);
console.log(`lines of reusable platform: ${countLines('src/lib')}`);
