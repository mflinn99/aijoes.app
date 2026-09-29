/** Autonomy & Permissions — Directive §12. */

import { db, requirePermission } from '@/lib/session';
import { listGrants } from '@/lib/db/repositories/tenant-data';
import { AUTONOMY_LABELS, AUTONOMY_DESCRIPTIONS, AutonomyLevel } from '@/lib/core/autonomy';
import { PageHead } from '@/components/Shell';
import { HaltControl } from '@/components/HaltControl';
import { gbpExact } from '@/lib/format';

export const dynamic = 'force-dynamic';

const LEVELS = [
  AutonomyLevel.OBSERVE,
  AutonomyLevel.RECOMMEND,
  AutonomyLevel.PREPARE,
  AutonomyLevel.EXECUTE,
  AutonomyLevel.AUTONOMOUS,
];

export default async function AutonomyPage() {
  await requirePermission('read');
  const grants = listGrants(await db());
  const highest = grants.reduce((max, g) => Math.max(max, g.level), 0);

  return (
    <>
      <PageHead
        title="Autonomy & permissions"
        sub="What the platform may do without a human. Nothing is granted by default — an action with no matching grant resolves to Observe."
      />

      <HaltControl currentLevel={highest} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Levels</div>
        <table className="table">
          <tbody>
            {LEVELS.map((level) => (
              <tr key={level}>
                <td style={{ width: 60 }} className="mono faint">L{level}</td>
                <td style={{ width: 140, fontWeight: 600 }}>
                  {AUTONOMY_LABELS[level]}
                  {level === highest ? <span className="badge ok" style={{ marginLeft: 8 }}>current max</span> : null}
                </td>
                <td className="dim">{AUTONOMY_DESCRIPTIONS[level]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Grants</div>
        <table className="table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Action type</th>
              <th>Capability</th>
              <th>Level</th>
              <th className="num">Monetary threshold</th>
              <th>Max risk</th>
              <th>Granted by</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="faint">{g.userId ? `User ${g.userId}` : 'All users'}</td>
                <td>{g.actionType ?? <span className="faint">All</span>}</td>
                <td>{g.capabilityId ?? <span className="faint">All</span>}</td>
                <td>
                  <span className={`badge ${g.level >= 3 ? 'warn' : 'muted'}`}>
                    L{g.level} {AUTONOMY_LABELS[g.level as AutonomyLevel]}
                  </span>
                </td>
                <td className="num">{gbpExact(g.monetaryThreshold)}</td>
                <td className="faint">{g.maxRisk}</td>
                <td className="faint tiny">{g.grantedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 14 }}>
        A grant caps what it covers rather than failing outright: an action exceeding its monetary threshold or risk
        ceiling drops to <b>Prepare</b>, so the work still happens and a human approves the last step. Anything
        affecting systems, money, customers, contracts or communications requires <b>Execute</b> or above, and no
        grant here reaches that level.
      </div>
    </>
  );
}
