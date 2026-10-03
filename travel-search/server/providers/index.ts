import { amadeusFromEnv } from "./amadeus.js";
import { duffelFromEnv } from "./duffel.js";
import { kiwiFromEnv } from "./kiwi.js";
import { createMock } from "./mock.js";
import { createDrive } from "./drive.js";
import type { Provider } from "./types.js";

// Which aggregators this deployment searches. Each is enabled by its own
// credentials; TRAVEL_PROVIDERS narrows the list (e.g. "amadeus,kiwi") or
// selects the mock ("mock") for development and tests.
//
// Skyscanner, Booking.com, Expedia Rapid, Trainline, Omio, Rail Europe,
// FlixBus, Direct Ferries and Ferryhopper are partner-only APIs: they slot in
// behind the same Provider interface once a commercial agreement grants keys.

export class ProviderConfigError extends Error {}

const FACTORIES: Record<string, () => Provider | null> = {
  amadeus: () => amadeusFromEnv(),
  duffel: () => duffelFromEnv(),
  kiwi: () => kiwiFromEnv(),
  mock: () => createMock(),
  drive: () => createDrive(),
};

let override: Provider[] | null = null;

/** Tests inject fake providers here. */
export function setProviders(providers: Provider[] | null): void {
  override = providers;
}

export function getProviders(): Provider[] {
  if (override) return override;
  const wanted = (process.env.TRAVEL_PROVIDERS ?? "amadeus,duffel,kiwi,drive")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = wanted.filter((w) => !FACTORIES[w]);
  if (unknown.length) throw new ProviderConfigError(`Unknown provider(s) in TRAVEL_PROVIDERS: ${unknown.join(", ")}`);
  return wanted.map((w) => FACTORIES[w]!()).filter((p): p is Provider => p !== null);
}

/** Fail fast at startup rather than serve searches that cannot find anything. */
export function assertProvidersConfigured(): void {
  const providers = getProviders();
  if (process.env.NODE_ENV === "production" && providers.some((p) => !p.live)) {
    throw new ProviderConfigError("The mock provider is not allowed in production");
  }
  if (!providers.some((p) => p.searchTransport && p.name !== "drive")) {
    throw new ProviderConfigError("No transport provider configured: set AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET, DUFFEL_ACCESS_TOKEN or KIWI_API_KEY (or TRAVEL_PROVIDERS=mock for development)");
  }
}

export function providerSummary(): { name: string; live: boolean; transport: string[]; stays: boolean; anywhere: boolean }[] {
  return getProviders().map((p) => ({ name: p.name, live: p.live, transport: p.searchTransport ? (p.modes ?? ["flight"]) : [], stays: !!p.searchStays, anywhere: !!p.anywhere }));
}
