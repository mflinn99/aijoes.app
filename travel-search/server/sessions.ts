import { randomBytes } from "node:crypto";
import { mergeRequest, interpretInstruction, type RefineInput, refineSchema } from "./refine.js";
import { runSearch, type SearchOptions, type SearchResult, type TripOption } from "./search.js";
import type { Store } from "./store.js";
import type { TripRequest } from "./schema.js";

// A search session is one traveller's conversation with the platform: the
// first three options, then every refinement as a numbered version. Saving
// takes an immutable snapshot of a version that can be reopened and printed
// later. Ids are long and random: whoever holds the link holds the trip.

export interface Version {
  number: number;
  createdAt: string;
  change: { kind: "initial" | "refine"; understood: string[]; kept: string[]; replaced: string[] };
  result: SearchResult;
}

export interface SearchSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
}

export interface SavedTrip {
  id: string;
  name: string;
  savedAt: string;
  sessionId: string;
  version: number;
  /** Ids of the options the traveller chose to save; all three if none were picked. */
  optionIds: string[];
  result: SearchResult;
}

const MAX_VERSIONS = 50;
export const SESSIONS = "searches";
export const SAVED = "saved";

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

export async function saveTrip(store: Store, id: string, opts: { name?: string; version?: number; optionIds?: string[] }): Promise<SavedTrip> {
  const session = await loadSession(store, id);
  const version = opts.version ? session.versions.find((v) => v.number === opts.version) : current(session);
  if (!version) throw new NotFoundError(`Version ${opts.version} not found`);
  const ids = version.result.options.map((o) => o.id);
  const optionIds = opts.optionIds?.length ? opts.optionIds : ids;
  const unknown = optionIds.filter((o) => !ids.includes(o));
  if (unknown.length) throw new RefineError(`Option(s) ${unknown.join(", ")} are not in version ${version.number}`);
  const r = version.result;
  const saved: SavedTrip = {
    id: newId(),
    name: opts.name?.trim() || defaultName(r),
    savedAt: new Date().toISOString(),
    sessionId: session.id,
    version: version.number,
    optionIds,
    result: { ...r, options: r.options.filter((o) => optionIds.includes(o.id)) },
  };
  await store.put(SAVED, saved.id, saved);
  return saved;
}

export async function loadSaved(store: Store, id: string): Promise<SavedTrip> {
  const s = await store.get<SavedTrip>(SAVED, id);
  if (!s) throw new NotFoundError("Saved trip not found");
  return s;
}

function defaultName(r: SearchResult): string {
  const where = r.resolved.destination?.name ?? (r.options.length ? r.options.map((o) => o.destination.name).join(" / ") : "Anywhere");
  return `${r.resolved.origin.name} to ${where}, ${r.request.dates.depart}`;
}
