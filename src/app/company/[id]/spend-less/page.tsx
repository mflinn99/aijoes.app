import { requirePermission } from '@/lib/session';
import { CategoryPage } from '@/components/CategoryPage';
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  return (
    <CategoryPage
      id={id}
      category="SPEND_LESS"
      seg="spend-less"
      title="Spend less"
      blurb="Opportunities to reduce supplier, technology, licence, cloud and process cost. Where no financial system is connected, these are benchmark-led hypotheses — connecting accounting or a bank feed promotes them to quantified opportunities."
    />
  );
}
