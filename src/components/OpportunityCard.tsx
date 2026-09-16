import Link from 'next/link';
import type { Opportunity } from '@/lib/core/opportunity';
import { effortLabel, startAvailable, timeToValueLabel } from '@/lib/core/opportunity';
import { categoryClass, categoryLabel, gbp, pct } from '@/lib/format';

export function OpportunityCard({ opportunity: o }: { opportunity: Opportunity }) {
  const cls = categoryClass(o.category);
  const gate = startAvailable(o);

  return (
    <div className="opp">
      <div className="opp-main">
        <div className="row" style={{ marginBottom: 6 }}>
          <span className={`badge ${cls}`}>{categoryLabel(o.category)}</span>
          <span className={`badge ${o.epistemics === 'hypothesis' ? 'hypothesis' : 'fact'}`}>
            {o.epistemics === 'hypothesis' ? 'Hypothesis' : 'Evidenced'}
          </span>
          {o.executionStatus !== 'NOT_STARTED' ? (
            <span className="badge warn">{o.executionStatus.replace(/_/g, ' ').toLowerCase()}</span>
          ) : null}
        </div>
        <h3 className="opp-title">
          <Link href={`/opportunity/${o.id}`}>{o.title}</Link>
        </h3>
        <p className="opp-summary">{o.summary}</p>
        <div className="opp-meta">
          <span><b>Confidence</b> {pct(o.confidence)}</span>
          <span><b>Effort</b> {effortLabel(o.effort)}</span>
          <span><b>Time to value</b> {timeToValueLabel(o.timeToValue)}</span>
          <span><b>Risk</b> {o.risk}</span>
          <span><b>Score</b> {o.score}</span>
        </div>
      </div>
      <div className="opp-side">
        <div className={`opp-value ${cls}`}>{gbp(o.estimatedAnnualValue)}</div>
        <div className="tiny faint">
          {gbp(o.financialModel.lowEstimate)}–{gbp(o.financialModel.highEstimate)}
        </div>
        {o.realisedValue !== null ? (
          <div className="tiny" style={{ color: 'var(--ok)', marginTop: 4 }}>
            {gbp(o.realisedValue)} realised
          </div>
        ) : null}
        <div className="opp-actions">
          <Link className="btn small" href={`/opportunity/${o.id}`}>
            Evidence
          </Link>
          {gate.available ? (
            <Link className="btn small primary" href={`/opportunity/${o.id}#start`}>
              START
            </Link>
          ) : (
            <span className="btn small" title={gate.reason} style={{ opacity: 0.45, cursor: 'not-allowed' }}>
              START
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
