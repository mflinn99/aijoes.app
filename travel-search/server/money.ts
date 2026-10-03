// Prices arrive in whatever currency each provider quotes. The budget is
// non-negotiable, so conversion is deliberately pessimistic: a buffer is added
// to every converted amount, and a currency we have no rate for is refused
// rather than guessed at.
//
// Rates are units per 1 GBP. Override with FX_RATES_JSON, e.g. {"USD":1.27}, or
// feed it from your treasury source; the built-in table is a fallback only.

const DEFAULT_RATES: Record<string, number> = {
  GBP: 1,
  EUR: 1.17,
  USD: 1.33,
  CAD: 1.84,
  AUD: 2.02,
  NZD: 2.25,
  CHF: 1.07,
  SEK: 12.6,
  NOK: 14.1,
  DKK: 8.73,
  PLN: 4.98,
  CZK: 29.2,
  HUF: 455,
  TRY: 54.0,
  AED: 4.88,
  JPY: 197,
  SGD: 1.71,
  THB: 43.0,
  ZAR: 23.5,
  MXN: 24.6,
  INR: 113,
};

/** Added to any amount converted between currencies. */
export const FX_BUFFER = 0.03;

let cached: Record<string, number> | null = null;

export function rates(): Record<string, number> {
  if (cached) return cached;
  let overrides: Record<string, number> = {};
  if (process.env.FX_RATES_JSON) {
    try {
      const parsed = JSON.parse(process.env.FX_RATES_JSON) as Record<string, unknown>;
      overrides = Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0).map(([k, v]) => [k.toUpperCase(), v]),
      );
    } catch {
      throw new Error("FX_RATES_JSON must be a JSON object of currency to rate per GBP");
    }
  }
  cached = { ...DEFAULT_RATES, ...overrides };
  return cached;
}

export function resetRatesCache(): void {
  cached = null;
}

export function canConvert(from: string, to: string): boolean {
  const r = rates();
  return r[from.toUpperCase()] !== undefined && r[to.toUpperCase()] !== undefined;
}

/** Convert, rounding up and adding the buffer when currencies differ. Null if we cannot. */
export function convert(amount: number, from: string, to: string): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return Math.round(amount * 100) / 100;
  const r = rates();
  const rf = r[f];
  const rt = r[t];
  if (rf === undefined || rt === undefined) return null;
  return Math.ceil((amount / rf) * rt * (1 + FX_BUFFER) * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}
