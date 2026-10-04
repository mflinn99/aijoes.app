// Retrieval with provenance. Every page used as evidence is fetched here,
// stored verbatim (as text) with its URL, retrieval time and hash.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { checkUrl, isBlockedAddress } from "./netguard";
import { extractPublished, extractTitle, htmlToText } from "./html";

export type FetchResult =
  | { ok: true; url: string; status: number; title: string | null; publishedAt: string | null; text: string }
  | { ok: false; url: string; status: number | null; error: string };

export interface LinkCheck {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  error: string | null;
}

export interface Fetcher {
  fetch(url: string): Promise<FetchResult>;
  /** Liveness check for a link about to go into an email. */
  check(url: string): Promise<LinkCheck>;
}

export interface LiveFetcherOptions {
  resolve?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

const MAX_TEXT_CHARS = 200_000;

export class LiveFetcher implements Fetcher {
  private resolve: (host: string) => Promise<string[]>;
  private timeoutMs: number;
  private maxBytes: number;
  private maxRedirects: number;
  private userAgent: string;
  private proxy: string | undefined;

  constructor(opts: LiveFetcherOptions = {}) {
    this.resolve = opts.resolve ?? (async (h) => (await dnsLookup(h, { all: true })).map((a) => a.address));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxBytes = opts.maxBytes ?? 3_000_000;
    this.maxRedirects = opts.maxRedirects ?? 5;
    this.userAgent = opts.userAgent ?? "HijojoResearch/0.1 (+https://aigogo.ai)";
    this.proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  }

  /** Resolve and vet a host; returns the address to connect to. */
  private async vet(url: URL): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = isIP(host) ? [host] : await this.resolve(host).catch(() => [] as string[]);
    if (addrs.length === 0) return { ok: false, error: `Could not resolve ${host}` };
    const bad = addrs.find((a) => isBlockedAddress(a));
    if (bad) return { ok: false, error: `${host} resolves to a private or reserved address (${bad}); blocked` };
    return { ok: true, address: addrs[0] };
  }

  private dispatcherFor(address: string): Dispatcher {
    if (this.proxy) return new ProxyAgent(this.proxy);
    // Pin the connection to the vetted address so DNS cannot be re-pointed between check and connect.
    return new Agent({
      connect: {
        lookup: (_host: string, options: any, cb: any) => {
          const family = isIP(address);
          if (options && options.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
      },
    });
  }

  private async request(raw: string, method: "GET" | "HEAD") {
    let current = raw;
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const checked = checkUrl(current);
      if (!checked.ok) return { ok: false as const, url: current, status: null, error: checked.error };
      const vetted = await this.vet(checked.url);
      if (!vetted.ok) return { ok: false as const, url: current, status: null, error: vetted.error };
      const dispatcher = this.dispatcherFor(vetted.address);
      try {
        const res = await undiciFetch(checked.url, {
          method,
          redirect: "manual",
          dispatcher,
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { "user-agent": this.userAgent, accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          current = new URL(res.headers.get("location")!, checked.url).toString();
          await res.body?.cancel();
          continue;
        }
        return { ok: true as const, url: current, res };
      } catch (e) {
        return { ok: false as const, url: current, status: null, error: `Request failed: ${(e as Error).message}` };
      } finally {
        if (dispatcher instanceof Agent) void dispatcher.close().catch(() => {});
      }
    }
    return { ok: false as const, url: current, status: null, error: "Too many redirects" };
  }

  async fetch(url: string): Promise<FetchResult> {
    const r = await this.request(url, "GET");
    if (!r.ok) return r;
    const { res } = r;
    if (res.status >= 400) {
      await res.body?.cancel();
      return { ok: false, url: r.url, status: res.status, error: `HTTP ${res.status}` };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      await res.body?.cancel();
      return { ok: false, url: r.url, status: res.status, error: `Unsupported content type ${type || "unknown"}` };
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const isHtml = /html/i.test(type);
    const text = (isHtml ? htmlToText(body) : body).slice(0, MAX_TEXT_CHARS);
    return {
      ok: true,
      url: r.url,
      status: res.status,
      title: isHtml ? extractTitle(body) : null,
      publishedAt: isHtml ? extractPublished(body) : null,
      text,
    };
  }

  async check(url: string): Promise<LinkCheck> {
    let r = await this.request(url, "HEAD");
    if (r.ok && (r.res.status === 405 || r.res.status === 501)) r = await this.request(url, "GET");
    if (!r.ok) return { ok: false, status: r.status, finalUrl: null, error: r.error };
    await r.res.body?.cancel();
    const ok = r.res.status >= 200 && r.res.status < 300;
    return { ok, status: r.res.status, finalUrl: r.url, error: ok ? null : `HTTP ${r.res.status}` };
  }
}
