import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { now } from "./clock.js";
import { buildItinerary, type Itinerary } from "./itinerary.js";
import type { SearchResult, TripOption } from "./search.js";
import { current, loadSession, newId, NotFoundError, RefineError } from "./sessions.js";
import type { Store } from "./store.js";

// Saved trips, and everything that happens to them afterwards.
//
//   save    an immutable snapshot of a search version (all three options or
//           the ones picked), optionally tied to a traveller key so it shows
//           up in "my trips"
//   choose  pick the option you're going with: it becomes the itinerary
//   share   read-only links, each revocable and optionally expiring, which
//           can also let companions add their review
//   review  once the trip has started: an overall rating, aspects, comments,
//           would-go-again. Reviews feed back into that traveller's future
//           searches.
//
// Three kinds of secret, all long and random: the saved trip's id (the
// owner's link: manage, share, delete), share tokens (read-only), and the
// traveller key (lists the owner's trips). Share tokens and traveller keys are
// stored only as hashes.

export const SAVED = "saved";
const SHARES = "shares";
const TRAVELLERS = "travellers";

export interface Share {
  id: string;
  tokenHash: string;
  label?: string;
  createdAt: string;
  expiresAt?: string;
  allowReviews: boolean;
  revokedAt?: string;
}

export interface Review {
  id: string;
  optionId: string;
  by?: string;
  via: "owner" | "share";
  createdAt: string;
  rating: number;
  comment?: string;
  aspects?: { transport?: number; stay?: number; destination?: number; value?: number };
  wouldGoAgain?: boolean;
}

export interface SavedTrip {
  id: string;
  name: string;
  savedAt: string;
  updatedAt?: string;
  sessionId: string;
  version: number;
  /** Ids of the options the traveller chose to save; all three if none were picked. */
  optionIds: string[];
  result: SearchResult;
  /** The option the traveller is going with: the itinerary. */
  chosenOptionId?: string;
  /** The owner's own notes; never shown on share links. */
  myNotes?: string;
  ownerHash?: string;
  shares?: Share[];
  reviews?: Review[];
}

interface Traveller {
  id: string;
  createdAt: string;
  savedIds: string[];
}

export class ConflictError extends Error {}
export class GoneError extends Error {}

const hash = (secret: string) => createHash("sha256").update(secret).digest("base64url");
const token = () => randomBytes(24).toString("base64url");

// --- traveller keys -------------------------------------------------------------

export async function resolveTraveller(store: Store, key: string | undefined): Promise<{ key: string; created: boolean; record: Traveller }> {
  if (key) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) throw new RefineError("That traveller key is not valid");
    const record = await store.get<Traveller>(TRAVELLERS, hash(key));
    if (!record) throw new NotFoundError("Traveller key not recognised");
    return { key, created: false, record };
  }
  const fresh = token();
  const record: Traveller = { id: hash(fresh), createdAt: now().toISOString(), savedIds: [] };
  await store.put(TRAVELLERS, record.id, record);
  return { key: fresh, created: true, record };
}

export async function travellerTrips(store: Store, key: string): Promise<SavedTrip[]> {
  const { record } = await resolveTraveller(store, key);
  const trips = await Promise.all(record.savedIds.map((id) => store.get<SavedTrip>(SAVED, id)));
  return trips.filter((t): t is SavedTrip => !!t).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** What this traveller thought of places they have been: steers their future searches. */
export async function reviewHistory(store: Store, key: string | undefined): Promise<Record<string, { rating: number; name: string }>> {
  if (!key) return {};
  const trips = await travellerTrips(store, key).catch(() => []);
  const out: Record<string, { rating: number; name: string }> = {};
  for (const t of trips) {
    for (const r of t.reviews ?? []) {
      if (r.via !== "owner") continue;
      const o = t.result.options.find((x) => x.id === r.optionId);
      if (o) out[o.destination.code] = { rating: r.rating, name: o.destination.name };
    }
  }
  return out;
}

// --- save -----------------------------------------------------------------------

export async function saveTrip(
  store: Store,
  sessionId: string,
  opts: { name?: string; version?: number; optionIds?: string[]; travellerKey?: string },
): Promise<{ trip: SavedTrip; traveller: { key: string; created: boolean } }> {
  const session = await loadSession(store, sessionId);
  const version = opts.version ? session.versions.find((v) => v.number === opts.version) : current(session);
  if (!version) throw new NotFoundError(`Version ${opts.version} not found`);
  const ids = version.result.options.map((o) => o.id);
  const optionIds = opts.optionIds?.length ? opts.optionIds : ids;
  const unknown = optionIds.filter((o) => !ids.includes(o));
  if (unknown.length) throw new RefineError(`Option(s) ${unknown.join(", ")} are not in version ${version.number}`);
  const traveller = await resolveTraveller(store, opts.travellerKey);
  const r = version.result;
  const trip: SavedTrip = {
    id: newId(),
    name: opts.name?.trim() || defaultName(r),
    savedAt: now().toISOString(),
    sessionId: session.id,
    version: version.number,
    optionIds,
    result: { ...r, options: r.options.filter((o) => optionIds.includes(o.id)) },
    // One option saved is the one you're going with.
    chosenOptionId: optionIds.length === 1 ? optionIds[0] : undefined,
    ownerHash: traveller.record.id,
    shares: [],
    reviews: [],
  };
  await store.put(SAVED, trip.id, trip);
  traveller.record.savedIds.push(trip.id);
  await store.put(TRAVELLERS, traveller.record.id, traveller.record);
  return { trip, traveller: { key: traveller.key, created: traveller.created } };
}

export async function loadSaved(store: Store, id: string): Promise<SavedTrip> {
  const s = await store.get<SavedTrip>(SAVED, id);
  if (!s) throw new NotFoundError("Saved trip not found");
  return s;
}

export const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  myNotes: z.string().max(5000).optional(),
  chosenOptionId: z.string().max(32).nullable().optional(),
});

export async function updateTrip(store: Store, id: string, input: unknown): Promise<SavedTrip> {
  const body = updateSchema.parse(input);
  const trip = await loadSaved(store, id);
  if (body.chosenOptionId && !trip.optionIds.includes(body.chosenOptionId)) throw new RefineError(`Option ${body.chosenOptionId} is not in this trip`);
  if (body.name !== undefined) trip.name = body.name;
  if (body.myNotes !== undefined) trip.myNotes = body.myNotes;
  if (body.chosenOptionId !== undefined) trip.chosenOptionId = body.chosenOptionId ?? undefined;
  trip.updatedAt = now().toISOString();
  await store.put(SAVED, trip.id, trip);
  return trip;
}

export async function deleteTrip(store: Store, id: string): Promise<void> {
  const trip = await loadSaved(store, id);
  for (const s of trip.shares ?? []) await store.remove(SHARES, s.tokenHash);
  if (trip.ownerHash) {
    const owner = await store.get<Traveller>(TRAVELLERS, trip.ownerHash);
    if (owner) {
      owner.savedIds = owner.savedIds.filter((x) => x !== id);
      await store.put(TRAVELLERS, owner.id, owner);
    }
  }
  await store.remove(SAVED, id);
}

// --- share ----------------------------------------------------------------------

export const shareSchema = z.object({
  label: z.string().trim().max(80).optional(),
  /** Let people with the link add their own review (travel companions). */
  allowReviews: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function shareTrip(store: Store, id: string, input: unknown): Promise<{ token: string; share: Share }> {
  const body = shareSchema.parse(input ?? {});
  const trip = await loadSaved(store, id);
  const live = (trip.shares ?? []).filter((s) => !s.revokedAt);
  if (live.length >= 20) throw new RefineError("A trip can have at most 20 active share links. Revoke one first.");
  const secret = token();
  const created = now();
  const share: Share = {
    id: randomBytes(6).toString("base64url"),
    tokenHash: hash(secret),
    label: body.label,
    createdAt: created.toISOString(),
    expiresAt: body.expiresInDays ? new Date(created.getTime() + body.expiresInDays * 86_400_000).toISOString() : undefined,
    allowReviews: body.allowReviews,
  };
  trip.shares = [...(trip.shares ?? []), share];
  await store.put(SAVED, trip.id, trip);
  await store.put(SHARES, share.tokenHash, { savedId: trip.id, shareId: share.id });
  return { token: secret, share };
}

export async function revokeShare(store: Store, id: string, shareId: string): Promise<SavedTrip> {
  const trip = await loadSaved(store, id);
  const share = (trip.shares ?? []).find((s) => s.id === shareId);
  if (!share) throw new NotFoundError("Share link not found");
  share.revokedAt ??= now().toISOString();
  await store.remove(SHARES, share.tokenHash);
  await store.put(SAVED, trip.id, trip);
  return trip;
}

/** Open a share link: the trip and the share it was opened through. Revoked or expired links are gone. */
export async function openShare(store: Store, secret: string): Promise<{ trip: SavedTrip; share: Share }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) throw new NotFoundError("Share link not found");
  const ref = await store.get<{ savedId: string; shareId: string }>(SHARES, hash(secret));
  if (!ref) throw new NotFoundError("Share link not found");
  const trip = await store.get<SavedTrip>(SAVED, ref.savedId);
  const share = trip?.shares?.find((s) => s.id === ref.shareId);
  if (!trip || !share || share.revokedAt) throw new GoneError("This share link has been revoked");
  if (share.expiresAt && share.expiresAt < now().toISOString()) throw new GoneError("This share link has expired");
  return { trip, share };
}

// --- review ---------------------------------------------------------------------

const aspect = z.number().int().min(1).max(5);
export const reviewSchema = z.object({
  optionId: z.string().max(32).optional(),
  by: z.string().trim().min(1).max(60).optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
  aspects: z.object({ transport: aspect, stay: aspect, destination: aspect, value: aspect }).partial().optional(),
  wouldGoAgain: z.boolean().optional(),
});

/** The option a trip is about: the chosen one, or the only one. */
export function tripOption(trip: SavedTrip, optionId?: string): TripOption | undefined {
  const id = optionId ?? trip.chosenOptionId ?? (trip.result.options.length === 1 ? trip.result.options[0]!.id : undefined);
  return trip.result.options.find((o) => o.id === id);
}

export async function addReview(store: Store, trip: SavedTrip, input: unknown, via: "owner" | "share"): Promise<Review> {
  const body = reviewSchema.parse(input);
  if (via === "share" && !body.by) throw new RefineError("Add your name so the traveller knows whose review it is");
  const option = tripOption(trip, body.optionId);
  if (!option) throw new RefineError("Choose which option you went with first (chosenOptionId), or say which one this review is for (optionId)");
  // Reviews are for after: they open once the trip has begun.
  const today = now().toISOString().slice(0, 10);
  if (today < option.dates.depart) throw new ConflictError(`You can review this trip once it starts on ${option.dates.depart}.`);
  const review: Review = {
    id: randomBytes(6).toString("base64url"),
    optionId: option.id,
    by: body.by,
    via,
    createdAt: now().toISOString(),
    rating: body.rating,
    comment: body.comment,
    aspects: body.aspects,
    wouldGoAgain: body.wouldGoAgain,
  };
  trip.reviews = [...(trip.reviews ?? []), review].slice(-200);
  trip.updatedAt = review.createdAt;
  await store.put(SAVED, trip.id, trip);
  return review;
}

// --- views ----------------------------------------------------------------------

export type TripStatus = "planning" | "upcoming" | "in progress" | "completed";

export function tripStatus(trip: SavedTrip): TripStatus {
  const o = tripOption(trip);
  if (!o) return "planning";
  const today = now().toISOString().slice(0, 10);
  if (today < o.dates.depart) return "upcoming";
  if (today <= o.dates.return) return "in progress";
  return "completed";
}

export function itineraryOf(trip: SavedTrip): Itinerary | null {
  const o = tripOption(trip);
  return o ? buildItinerary(o, trip.result.request) : null;
}

export function reviewSummary(reviews: Review[]): { count: number; averageRating: number | null; wouldGoAgain: number } {
  if (reviews.length === 0) return { count: 0, averageRating: null, wouldGoAgain: 0 };
  const avg = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length;
  return { count: reviews.length, averageRating: Math.round(avg * 10) / 10, wouldGoAgain: reviews.filter((r) => r.wouldGoAgain).length };
}

export function canReview(trip: SavedTrip): { open: boolean; from?: string } {
  const o = tripOption(trip);
  if (!o) return { open: false };
  return { open: now().toISOString().slice(0, 10) >= o.dates.depart, from: o.dates.depart };
}

function defaultName(r: SearchResult): string {
  const where = r.resolved.destination?.name ?? (r.options.length ? r.options.map((o) => o.destination.name).join(" / ") : "Anywhere");
  return `${r.resolved.origin.name} to ${where}, ${r.request.dates.depart}`;
}
