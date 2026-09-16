import type { Opportunity } from '@/lib/core/opportunity';
import { gbp } from '@/lib/format';

function band(opportunities: Opportunity[]) {
  return {
    point: opportunities.reduce((s, o) => s + o.estimatedAnnualValue, 0),
    low: opportunities.reduce((s, o) => s + o.financialModel.lowEstimate, 0),
    high: opportunities.reduce((s, o) => s + o.financialModel.highEstimate, 0),
    count: opportunities.length,
  };
}

export function MoneyCards({ opportunities }: { opportunities: Opportunity[] }) {
  const makeMore = band(opportunities.filter((o) => o.category === 'MAKE_MORE'));
  const spendLess = band(opportunities.filter((o) => o.category === 'SPEND_LESS'));
  const mspExpand = band(opportunities.filter((o) => o.category === 'MSP_EXPAND'));

  return (
    <div className="grid-3">
      <div className="money-card make-more">
        <div className="money-label">Make more</div>
        <div className="money-value">{gbp(makeMore.point)}</div>
        <div className="money-range">
          {gbp(makeMore.low)}–{gbp(makeMore.high)} estimated opportunity
        </div>
        <div className="money-meta">{makeMore.count} opportunities</div>
      </div>
      <div className="money-card spend-less">
        <div className="money-label">Spend less</div>
        <div className="money-value">{gbp(spendLess.point)}</div>
        <div className="money-range">
          {gbp(spendLess.low)}–{gbp(spendLess.high)} estimated opportunity
        </div>
        <div className="money-meta">{spendLess.count} opportunities</div>
      </div>
      <div className="money-card msp-expand">
        <div className="money-label">MSP expand</div>
        <div className="money-value">{gbp(mspExpand.point)}</div>
        <div className="money-range">
          {gbp(Math.round(mspExpand.point / 12))} additional MRR
        </div>
        <div className="money-meta">{mspExpand.count} opportunities</div>
      </div>
    </div>
  );
}
