import { PageHead } from '@/components/Shell';
import { AnalyseForm } from '@/components/AnalyseForm';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';

export const dynamic = 'force-dynamic';

export default function AnalysePage() {
  return (
    <>
      <PageHead
        title="Analyse a company"
        sub="Enter a company name or website. The platform learns the company, then identifies how to make it more, spend less, and expand the MSP relationship."
      />
      <AnalyseForm
        examples={SYNTHETIC_COMPANIES.map((c) => ({ domain: c.domain, name: c.name, description: c.description }))}
      />
    </>
  );
}
