/**
 * GTM Control Centre — Directive 02 Phase 13.
 *
 * What the engine has found, what it recommends, what it has done, what is in
 * the pipeline, what needs a decision, and what it is blocked on — with ASK JOJO
 * at the top, where the directive asks for it.
 *
 * The rule applied to every number on this page: it is read live from the tables
 * the engine writes to, and where the honest answer is "nothing", the page says
 * so with the reason rather than showing an empty box.
 */

import Link from 'next/link';
import { db, requirePermission } from '@/lib/session';
import { PageHead } from '@/components/Shell';
import { AskJojoGtm } from '@/components/AskJojoGtm';
import { RunLoopButton } from '@/components/RunLoopButton';
import { ONWARD } from '@/config/msp/onward';
import { morningBrief } from '@/lib/gtm/brief';
import { listAccounts, listHypotheses, listOutreach, listOpportunities } from '@/lib/gtm/store';
import { listDecisions } from '@/lib/gtm/governance';
import { activeStrategy } from '@/lib/gtm/learning';
import { profileCompleteness } from '@/lib/gtm/profile';
import { gbp } from '@/lib/format';
import { can } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export default async function GtmPage() {
  const session = await requirePermission('read');
  const database = await db();
  const mspId = ONWARD.id;

  const brief = morningBrief(database, mspId);
  const accounts = listAccounts(database, { mspId, limit: 2000 });
  const real = accounts.filter((a) => !a.synthetic);
  const ranked = real
    .filter((a) => !a.suppressed && a.researchState === 'researched')
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 15);
  const hypotheses = listHypotheses(database, { limit: 1000 });
  const workable = hypotheses.filter((h) => h.quality === 'strong' || h.quality === 'workable');
  const outreach = listOutreach(database, { limit: 500 });
  const opportunities = listOpportunities(database, { open: true, limit: 200 });
  const decisions = listDecisions(database, 'open');
  const strategy = activeStrategy(database);
  const completeness = profileCompleteness(ONWARD);

  return (
    <>
      <PageHead
        title="Agentic GTM"
        sub={`${ONWARD.name}. Discover, research, score, build a proposition, engage, follow up, qualify, book, update the CRM, monitor, learn.`}
      />

      <AskJojoGtm />

      <div className="grid-4" style={{ marginTop: 14 }}>
        <Stat label="Accounts" value={String(real.length)} sub={`${real.filter((a) => a.researchState === 'researched').length} researched`} />
        <Stat label="Hypotheses" value={String(workable.length)} sub={`${hypotheses.length - workable.length} rejected by the evidence bar`} />
        <Stat label="Open pipeline" value={gbp(brief.pipeline.weightedGbp)} sub={`${opportunities.length} opportunit${opportunities.length === 1 ? 'y' : 'ies'}, weighted`} />
        <Stat label="Needs you" value={String(brief.needsYou.length)} sub={decisions.length > 0 ? `${decisions.length} commercial decision(s)` : 'No open decisions'} tone={brief.needsYou.length > 0 ? 'warn' : 'ok'} />
      </div>

      {brief.oneThing ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">If you do one thing today</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{brief.oneThing.action}</div>
          <div className="tiny dim" style={{ marginTop: 6 }}>{brief.oneThing.because}</div>
        </div>
      ) : null}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-title">What happened overnight</div>
          {brief.overnight.map((item) => (
            <div key={item.headline} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600 }}>{item.headline}</div>
              <div className="tiny dim">{item.detail}</div>
              <div className="tiny faint">{item.basis}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">What needs you</div>
          {brief.needsYou.length === 0 ? (
            <div className="faint tiny">Nothing. Everything in flight is within standing commercial policy.</div>
          ) : (
            brief.needsYou.map((item) => (
              <div key={item.headline} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>{item.headline}</div>
                <div className="tiny dim">{item.detail}</div>
                {item.action ? <div className="tiny" style={{ marginTop: 4 }}>→ {item.action}</div> : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Commercial objectives</div>
        <table className="table">
          <thead>
            <tr>
              <th>Objective</th>
              <th className="num">Now</th>
              <th className="num">Target</th>
              <th>What is counted</th>
            </tr>
          </thead>
          <tbody>
            {brief.objectives.progress.map((p) => (
              <tr key={p.key}>
                <td style={{ fontWeight: 600 }}>{p.label}</td>
                <td className="num" style={{ color: p.met ? 'var(--ok)' : undefined }}>
                  {p.unit === 'gbp' ? gbp(p.actual) : p.actual}
                </td>
                <td className="num faint">{p.unit === 'gbp' ? gbp(p.target) : p.target}</td>
                <td className="tiny faint">{p.countedAs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Who to approach, and why</div>
        {ranked.length === 0 ? (
          <div className="note warn">
            No researched, non-suppressed account exists. Any list here would be invented. See what the engine is blocked
            on below.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Priority</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>
                    {a.companyId ? <Link href={`/company/${a.companyId}`}>{a.name}</Link> : a.name}
                  </td>
                  <td className="num">{Math.round(a.priorityScore)}</td>
                  <td className="tiny dim">{a.scores?.priority.summary ?? 'No scoring rationale recorded.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-title">Pipeline by stage</div>
          {brief.pipeline.byStage.length === 0 ? (
            <div className="faint tiny">The pipeline is empty.</div>
          ) : (
            <table className="table">
              <tbody>
                {brief.pipeline.byStage.map((s) => (
                  <tr key={s.stage}>
                    <td style={{ fontWeight: 600 }}>{s.stage.replace(/-/g, ' ')}</td>
                    <td className="num faint">{s.count}</td>
                    <td className="num">{gbp(s.valueGbp)}</td>
                    <td className="num">{gbp(s.weightedGbp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {brief.pipeline.atRisk.length > 0 ? (
            <div className="note warn" style={{ marginTop: 10 }}>
              {brief.pipeline.atRisk.length} open opportunit{brief.pipeline.atRisk.length === 1 ? 'y has' : 'ies have'} had
              no activity for 30 days or more. At 90 days the autopilot moves them to stalled so the forecast stops
              counting them.
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">Outreach</div>
          <dl className="kv">
            <dt>Drafted</dt><dd>{outreach.length}</dd>
            <dt>Awaiting approval</dt><dd>{outreach.filter((m) => m.status === 'awaiting-approval' || m.status === 'draft').length}</dd>
            <dt>Sent</dt><dd>{outreach.filter((m) => m.status === 'sent').length}</dd>
            <dt>Blocked or suppressed</dt><dd>{outreach.filter((m) => m.status === 'blocked' || m.status === 'suppressed').length}</dd>
          </dl>
          <div className="note" style={{ marginTop: 10 }}>
            Nothing is sent without approval, and no message is composed without a specific observation about the
            company and a lawful basis for contacting the person. Refusals are counted rather than hidden.
          </div>
        </div>
      </div>

      {brief.blockers.length > 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">What the engine cannot do</div>
          <ul className="tiny">
            {brief.blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
          </ul>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            Each of these is recorded in BLOCKERS.md with what it needs and who can supply it.
          </div>
        </div>
      ) : null}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-title">Engine health and strategy</div>
          <dl className="kv">
            <dt>System</dt>
            <dd style={{ color: brief.systemHealth.operational ? 'var(--ok)' : 'var(--warn)' }}>
              {brief.systemHealth.operational ? 'Operational' : 'Degraded'}
            </dd>
            <dt>Unresolved failures</dt><dd>{brief.systemHealth.unresolved}</dd>
            <dt>Active scoring strategy</dt><dd>{strategy.version}</dd>
            <dt>MSP profile completeness</dt><dd>{completeness.score}%</dd>
          </dl>
          {completeness.missing.length > 0 ? (
            <div className="tiny faint" style={{ marginTop: 8 }}>
              Missing from the profile: {completeness.missing.join(', ')}. Every one of these makes the engine less
              specific about what Onward can credibly claim.
            </div>
          ) : null}
        </div>

        {can(session.context.role, 'execute') ? <RunLoopButton /> : (
          <div className="card">
            <div className="card-title">Run a cycle</div>
            <div className="faint tiny">Running the engine needs the execute permission.</div>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : undefined }}>
        {value}
      </div>
      {sub ? <div className="tiny faint" style={{ marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
