import { randomBytes } from "node:crypto";
import { mergeRequest, interpretInstruction, type RefineInput, refineSchema, remixSchema } from "./refine.js";
import { runSearch, type LockElement, type SearchOptions, type SearchResult, type TripOption } from "./search.js";
import type { Store } from "./store.js";
import type { TripRequest } from "./schema.js";

// A search session is one traveller's conversation with the platform: the
// first three options, then every refinement or remix as a numbered version.
// Saving, sharing and reviewing live in trips.ts. Ids are long and random:
// whoever holds the link holds the search.

export interface Version {
  number: number;
  createdAt: string;
  change: {
    kind: "initial" | "refine" | "remix";
    understood: string[];
    kept: string[];
    replaced: string[];
    /** For a remix: the option remixed and what was locked. */
    remixOf?: string;
    locked?: LockElement[];
  };
  result: SearchResult;
}

export interface SearchSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
}


const MAX_VERSIONS = 50;
export const SESSIONS = "searches";

export function newId(): string {
  return randomBytes(16).toString("base64url");
}

export class NotFoundError extends Error {}
export class RefineError extends Error {}

export async function createSession(store: Store, req: TripRequest, opts: SearchOptions = {}): Promise<SearchSession> {
  const result = await runSearch(req, opts);
  const now = new Date().toISOString();
  const session: SearchSession = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    versions: [{ number: 1, createdAt: now, change: { kind: "initial", understood: [], kept: [], replaced: [] }, result }],
  };
  await store.put(SESSIONS, session.id, session);
  return session;
}

export async function loadSession(store: Store, id: string): Promise<SearchSession> {
  const s = await store.get<SearchSession>(SESSIONS, id);
  if (!s) throw new NotFoundError("Search not found");
  return s;
}

export function current(s: SearchSession): Version {
  return s.versions[s.versions.length - 1]!;
}

export async function refineSession(store: Store, id: string, input: RefineInput, opts: SearchOptions = {}): Promise<SearchSession> {
  const body = refineSchema.parse(input);
  const session = await loadSession(store, id);
  if (session.versions.length >= MAX_VERSIONS) throw new RefineError(`This search has reached ${MAX_VERSIONS} versions. Start a new one from the latest.`);
  const latest = current(session).result;
  const optionIds = new Set(latest.options.map((o) => o.id));
  for (const oid of [...body.keep, ...body.replace]) {
    if (!optionIds.has(oid)) throw new RefineError(`Option ${oid} is not in the current results`);
  }

  let request: TripRequest = latest.request;
  const understood: string[] = [];
  let somewhereElse = false;
  if (body.instruction) {
    const interp = interpretInstruction(body.instruction, request);
    if (interp.understood.length === 0 && !body.changes && body.keep.length === 0 && body.replace.length === 0) {
      throw new RefineError("We couldn't work out what to change from that. Try something like “cheaper”, “direct flights only”, “add a child”, “somewhere else” or “more beach, no nightlife”.");
    }
    understood.push(...interp.understood);
    somewhereElse = interp.somewhereElse;
    if (Object.keys(interp.changes).length) request = mergeRequest(request, interp.changes);
  }
  if (body.changes) {
    request = mergeRequest(request, body.changes);
    understood.push(...Object.keys(body.changes).map((k) => `${k} changed`));
  }
  if (!body.instruction && !body.changes && body.keep.length === 0 && body.replace.length === 0) {
    throw new RefineError("Nothing to refine: send changes, an instruction, or options to keep or replace.");
  }

  const replaced = latest.options.filter((o) => body.replace.includes(o.id));
  // Swapping out one option keeps the others, unless the traveller said which to keep.
  const keepIds = body.keep.length ? body.keep : body.replace.length && !body.changes && !body.instruction ? latest.options.filter((o) => !body.replace.includes(o.id)).map((o) => o.id) : [];
  const keep: TripOption[] = latest.options.filter((o) => keepIds.includes(o.id));

  // On an open search, a replaced option's destination is ruled out, and
  // "somewhere else" rules out everything currently shown.
  if (!request.destination) {
    const out = [...(somewhereElse ? latest.options : replaced)].filter((o) => !keepIds.includes(o.id)).map((o) => o.destination.code);
    if (out.length) request = { ...request, excludeDestinations: [...new Set([...request.excludeDestinations, ...out])] };
  }
  const rejectIds = [...replaced.map((o) => o.id), ...(somewhereElse ? latest.options.map((o) => o.id) : [])];

  const result = await runSearch(request, { ...opts, keep, rejectIds });
  const now = new Date().toISOString();
  session.versions.push({
    number: session.versions.length + 1,
    createdAt: now,
    change: { kind: "refine", understood, kept: keep.map((o) => o.id), replaced: replaced.map((o) => o.id) },
    result,
  });
  session.updatedAt = now;
  await store.put(SESSIONS, session.id, session);
  return session;
}

/**
 * Lock elements of one option (destination, dates, flight, stay) and remix the
 * rest into three new options. The locked parts go back through every
 * non-negotiable check against the current request.
 */
export async function remixOption(store: Store, id: string, optionId: string, input: unknown, opts: SearchOptions = {}): Promise<SearchSession> {
  const { lock } = remixSchema.parse(input);
  const session = await loadSession(store, id);
  if (session.versions.length >= MAX_VERSIONS) throw new RefineError(`This search has reached ${MAX_VERSIONS} versions. Start a new one from the latest.`);
  const latest = current(session).result;
  const from = latest.options.find((o) => o.id === optionId);
  if (!from) throw new RefineError(`Option ${optionId} is not in the current results`);
  const result = await runSearch(latest.request, { ...opts, locks: { from, elements: lock }, rejectIds: [from.id] });
  const now = new Date().toISOString();
  session.versions.push({
    number: session.versions.length + 1,
    createdAt: now,
    change: { kind: "remix", understood: [], kept: [], replaced: [], remixOf: from.id, locked: result.remix?.locked ?? lock },
    result,
  });
  session.updatedAt = now;
  await store.put(SESSIONS, session.id, session);
  return session;
}
