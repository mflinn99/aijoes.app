// Time is injected everywhere so the five-day rule can be tested without waiting.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private t: number;
  constructor(start: string | Date = "2026-10-05T09:00:00.000Z") {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceDays(days: number): void {
    this.advance(days * DAY_MS);
  }
  set(at: string | Date): void {
    this.t = new Date(at).getTime();
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(iso: string | Date, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}
