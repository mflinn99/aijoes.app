import { CHECKPOINT_YEARS, type CheckpointEntry } from "../../shared/board";
import type { Organisation } from "./organisation";

// The people side of the checkpoint. People live in the lead's browser, so
// their joining and leaving is assembled here and sent when a checkpoint is
// published.

export const today = () => new Date().toISOString().slice(0, 10);

function threeYearsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - CHECKPOINT_YEARS);
  return d.toISOString().slice(0, 10);
}

export function peopleEntries(org: Organisation): CheckpointEntry[] {
  const from = threeYearsAgo();
  const out: CheckpointEntry[] = [];
  const member = (permanent: boolean | undefined) => (permanent ? "as a permanent member" : "invited as needed");
  for (const p of org.people) {
    if (p.joinedAt) {
      out.push({ id: `${p.id}-joined`, date: p.joinedAt, kind: "joined", title: `${p.name} joined, ${p.role}`, detail: `Joined ${member(p.permanent)}.${p.expertise ? ` Brings: ${p.expertise}.` : ""}`, source: "Your board" });
    }
  }
  for (const p of org.formerPeople ?? []) {
    if (p.joinedAt) out.push({ id: `${p.id}-joined`, date: p.joinedAt, kind: "joined", title: `${p.name} joined, ${p.role}`, detail: `Joined ${member(p.permanent)}.`, source: "Your board" });
    out.push({ id: `${p.id}-left`, date: p.leftAt, kind: "left", title: `${p.name} left, ${p.role}`, detail: "Their decisions, answers and the agents' lessons from their time remain in the record.", source: "Your board" });
  }
  return out.filter((e) => e.date >= from);
}
