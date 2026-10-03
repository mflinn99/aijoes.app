// One place that knows what time it is, so tests can move it (a trip can only
// be reviewed once it has started). TRAVEL_CLOCK_OFFSET_DAYS shifts it for
// end-to-end runs against a real server; it is refused in production.

let override: (() => Date) | null = null;

export function now(): Date {
  if (override) return override();
  const offset = Number(process.env.TRAVEL_CLOCK_OFFSET_DAYS ?? 0);
  return offset ? new Date(Date.now() + offset * 86_400_000) : new Date();
}

export function setClock(fn: (() => Date) | null): void {
  override = fn;
}

export function assertClockConfigured(): void {
  if (process.env.TRAVEL_CLOCK_OFFSET_DAYS && process.env.NODE_ENV === "production") {
    throw new Error("TRAVEL_CLOCK_OFFSET_DAYS is for testing and is not allowed in production");
  }
}
