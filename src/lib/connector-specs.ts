/**
 * Connector setup descriptions.
 *
 * Plain data in its own module: the connect form is a client component, and a
 * `'use client'` file's exports become client references, so a server component
 * cannot read them. This keeps the specs importable from both sides.
 */

export interface ConnectorField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface ConnectorSpec {
  id: string;
  name: string;
  connectedBlurb: string;
  pitch: string;
  setup: string;
  fields: ConnectorField[];
}

export const CONNECTOR_SPECS: ConnectorSpec[] = [
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    pitch: 'Replaces the headcount guess with a counted user population, and the licence-waste benchmark with measured seats, leavers and dormant accounts.',
    connectedBlurb: 'Licence counts, seat assignment and dormant accounts are read from the tenant, so the licence opportunity is counted rather than estimated.',
    setup:
      'Register an application in the customer’s Entra tenant with the application permissions User.Read.All, Organization.Read.All and AuditLog.Read.All (the last is what makes sign-in activity, and therefore dormancy, visible). Grant admin consent, then paste the values below.',
    fields: [
      { key: 'tenantId', label: 'Directory (tenant) ID', placeholder: 'contoso.onmicrosoft.com' },
      { key: 'clientId', label: 'Application (client) ID' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
  },
  {
    id: 'accounting',
    name: 'Accounting (Xero)',
    pitch: 'The widest promotion: counted turnover, margin, supplier spend by category, software subscriptions and the real customer base.',
    connectedBlurb: 'Turnover, supplier spend and the customer base are counted from the ledger, so savings opportunities name real suppliers and real amounts.',
    setup:
      'Create a Xero Custom Connection for the customer’s organisation with the scopes accounting.reports.read, accounting.transactions.read and accounting.contacts.read, then paste its credentials below.',
    fields: [
      { key: 'xeroTenantId', label: 'Xero tenant (organisation) ID' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
  },
  {
    id: 'crm',
    name: 'CRM (HubSpot)',
    pitch: 'Turns the last modelled numbers into counted ones: dormant accounts, open and stalled pipeline, conversion rate and average deal value.',
    connectedBlurb: 'Dormancy, pipeline, conversion rate and deal value are counted from deals rather than modelled from turnover.',
    setup:
      'Create a private app in the customer’s HubSpot account with the scopes crm.objects.companies.read and crm.objects.deals.read, then paste its access token below.',
    fields: [{ key: 'accessToken', label: 'Private app access token', secret: true }],
  },
];
