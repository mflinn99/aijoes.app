import type { Repo } from "../repo";
import type { Fetcher } from "../research/fetcher";
import type { Source, SourceKind } from "../../shared/types";
import { hashText } from "../evidence";
import { z } from "zod/v4";

export const EvidenceSchema = z.object({ sourceId: z.string(), quote: z.string() });
export const EpistemicSchema = z.enum(["FACT", "INFERENCE", "UNKNOWN"]);

/** Fetch each URL and store what was retrieved. Failures are reported, never papered over. */
export async function retrieve(
  repo: Repo,
  fetcher: Fetcher,
  urls: { url: string; kind: SourceKind }[],
  owner: { opcoId?: string; prospectId?: string },
): Promise<{ sources: Source[]; failures: string[] }> {
  const sources: Source[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const { url, kind } of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await fetcher.fetch(url);
    if (!r.ok) {
      failures.push(`${url}: ${r.error}`);
      continue;
    }
    if (r.text.trim().length < 40) {
      failures.push(`${url}: too little text to use`);
      continue;
    }
    sources.push(
      repo.addSource(
        { url: r.url, kind, title: r.title, retrievedAt: repo.now(), publishedAt: r.publishedAt, contentHash: hashText(r.text), text: r.text },
        owner,
      ),
    );
  }
  return { sources, failures };
}

/** A page on the same site; "/" is the address as given. */
export function pageUrl(base: string, path: string): string {
  if (path === "/") return base;
  const u = new URL(base);
  return `${u.protocol}//${u.host}${path}`;
}
