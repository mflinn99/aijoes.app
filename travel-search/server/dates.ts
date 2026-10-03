// Date flexibility: "18th to 25th, give or take two days" becomes a small set
// of concrete outbound/return pairs. Every pair stays inside the window the
// traveller gave, and the trip length never moves by more than the same
// flexibility, so a week does not quietly become a long weekend.

export interface DatePair {
  depart: string;
  return: string;
  nights: number;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(depart: string, ret: string): number {
  return Math.round((Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${depart}T00:00:00Z`)) / 86_400_000);
}

export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

/**
 * Candidate pairs, the requested dates first. With flexibility we try the
 * earliest and latest shifts of the whole trip, and a shorter and longer stay,
 * capped at `max` pairs so live providers are not asked dozens of times.
 */
export function datePairs(dates: { depart: string; return: string; flexibilityDays: number }, today: string, max = 5): DatePair[] {
  const f = dates.flexibilityDays;
  const shifts: [number, number][] = [[0, 0]];
  if (f > 0) {
    shifts.push([-f, -f], [f, f], [0, -Math.min(f, 1)], [0, Math.min(f, 1)], [-f, 0], [0, f]);
  }
  const seen = new Set<string>();
  const out: DatePair[] = [];
  const baseNights = nightsBetween(dates.depart, dates.return);
  for (const [a, b] of shifts) {
    const depart = addDays(dates.depart, a);
    const ret = addDays(dates.return, b);
    const nights = nightsBetween(depart, ret);
    if (nights < 1 || Math.abs(nights - baseNights) > f) continue;
    if (depart <= today) continue;
    const key = `${depart}/${ret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ depart, return: ret, nights });
    if (out.length >= max) break;
  }
  return out;
}

/** Is this pair inside the traveller's window? Used to police provider results. */
export function withinWindow(pair: { depart: string; return: string }, dates: { depart: string; return: string; flexibilityDays: number }): boolean {
  const f = dates.flexibilityDays;
  const inRange = (d: string, centre: string) => d >= addDays(centre, -f) && d <= addDays(centre, f);
  return inRange(pair.depart, dates.depart) && inRange(pair.return, dates.return) && pair.return > pair.depart;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
