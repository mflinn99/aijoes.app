import { requirePermission } from '@/lib/session';
import { PageHead } from '@/components/Shell';
import { AnalyseForm } from '@/components/AnalyseForm';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';
import { DEMO_COMPANIES } from '@/lib/fixtures/demo';

export const dynamic = 'force-dynamic';

export default async function AnalysePage() {
  await requirePermission('analyse');
  return (
    <>
      <PageHead
        title="Analyse a company"
        sub="Enter a company name or website. The platform learns the company, then identifies how to make it more, spend less, and expand the MSP relationship."
      />
      <AnalyseForm
        examples={[
          // Demo companies first: their figures are real, which makes them the
          // better thing to show someone than an invented fixture.
          ...DEMO_COMPANIES.map((c) => ({ input: c.input, name: c.name, description: c.description, notice: c.notice })),
          ...SYNTHETIC_COMPANIES.map((c) => ({ input: c.domain, name: c.name, description: c.description })),
        ]}
      />
    </>
  );
}
