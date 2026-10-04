// An in-memory web for tests and the simulation. Nothing here touches a network.

import type { Fetcher, FetchResult, LinkCheck } from "../research/fetcher";
import { extractPublished, extractTitle, htmlToText } from "../research/html";

export interface SimPage {
  html?: string;
  text?: string;
  status?: number;
  title?: string;
  publishedAt?: string;
}

function key(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "") || ""}`;
  } catch {
    return url;
  }
}

export class SimWeb implements Fetcher {
  private pages = new Map<string, SimPage>();
  readonly requests: string[] = [];

  constructor(pages: Record<string, SimPage> = {}) {
    for (const [u, p] of Object.entries(pages)) this.set(u, p);
  }

  set(url: string, page: SimPage): void {
    this.pages.set(key(url), page);
  }

  remove(url: string): void {
    this.pages.delete(key(url));
  }

  async fetch(url: string): Promise<FetchResult> {
    this.requests.push(url);
    const page = this.pages.get(key(url));
    if (!page) return { ok: false, url, status: 404, error: "HTTP 404" };
    const status = page.status ?? 200;
    if (status >= 400) return { ok: false, url, status, error: `HTTP ${status}` };
    const html = page.html;
    return {
      ok: true,
      url,
      status,
      title: page.title ?? (html ? extractTitle(html) : null),
      publishedAt: page.publishedAt ?? (html ? extractPublished(html) : null),
      text: page.text ?? (html ? htmlToText(html) : ""),
    };
  }

  async check(url: string): Promise<LinkCheck> {
    this.requests.push(`CHECK ${url}`);
    const page = this.pages.get(key(url));
    if (!page) return { ok: false, status: 404, finalUrl: null, error: "HTTP 404" };
    const status = page.status ?? 200;
    return { ok: status < 400, status, finalUrl: url, error: status < 400 ? null : `HTTP ${status}` };
  }
}
