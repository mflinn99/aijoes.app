// One place that knows what time it is, so tests can move it (a trip can only
// be reviewed once it has started).

let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

export function setClock(fn: (() => Date) | null): void {
  override = fn;
}
