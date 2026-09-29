import { requirePermission } from '@/lib/session';
import { CategoryPage } from '@/components/CategoryPage';
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  return (
    <CategoryPage
      id={id}
      category="MAKE_MORE"
      seg="make-more"
      title="Make more"
      blurb="Opportunities to increase revenue, turnover, pipeline, customer value, sales conversion, margin, market reach or recurring revenue. Ranked by score, which weighs value against confidence, effort, risk and time to value."
    />
  );
}
