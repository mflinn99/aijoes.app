/**
 * Polite HTTP fetching for public-web discovery.
 *
 * Bounded, identified, and failure-tolerant: Directive §23 requires the platform
 * to degrade to a low understanding score rather than invent a business, so a
 * fetch failure here is a normal outcome, not an exception that stops analysis.
 */

const USER_AGENT = 'AIGoGoMetaMSP/0.1 (+https://aigogo.ai; company-analysis)';
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;

export interface FetchResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  error?: string;
}

export async function fetchText(url: string, timeoutMs = TIMEOUT_MS): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const reader = res.body?.getReader();
    let body = '';
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        body += decoder.decode(value, { stream: true });
        if (received > MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    return { ok: res.ok, url, finalUrl: res.url || url, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      url,
      finalUrl: url,
      status: 0,
      body: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.replace(/^www\./, '');
    // A bare company name has no dot and is not a domain.
    if (!host.includes('.')) return null;
    if (/\s/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function looksLikeDomain(input: string): boolean {
  return normaliseDomain(input) !== null;
}
