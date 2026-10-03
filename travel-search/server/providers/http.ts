import { ProviderError } from "./types.js";

// One way out to the aggregators: JSON, a timeout tied to the search's abort
// signal, and errors that name the provider without echoing credentials.

export async function fetchJson<T>(provider: string, url: string, init: RequestInit & { signal: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (err) {
    if (init.signal.aborted) throw new ProviderError(provider, "timed out");
    throw new ProviderError(provider, `network error (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(provider, `HTTP ${res.status}${summarise(text)}`, res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, "returned something that is not JSON");
  }
}

function summarise(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: { title?: string; detail?: string; message?: string }[]; message?: string; error?: string };
    const first = parsed.errors?.[0];
    const msg = first?.detail ?? first?.title ?? first?.message ?? parsed.message ?? parsed.error;
    return msg ? `: ${String(msg).slice(0, 200)}` : "";
  } catch {
    return "";
  }
}
