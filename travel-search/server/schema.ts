import { z } from "zod";

// The six inputs a traveller gives us, validated once at the edge. Everything
// downstream works on the normalised TripRequest, never on raw request bodies.
//
// Order of importance when searching (see search.ts):
//   1. starting point   — non-negotiable
//   2. travellers       — non-negotiable
//   3. budget           — non-negotiable (within its stated flexibility)
//   4. vibe, likes, dislikes — important, scored
//   5. destination      — optional; when absent the world is open

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");

const tagList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[,;\n]/)))
  .transform((v) => v.map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(80)).max(20));

export const travellersSchema = z
  .union([
    z.number().int().min(1).max(9).transform((adults) => ({ adults, children: 0, infants: 0 })),
    z.object({
      adults: z.number().int().min(1).max(9),
      children: z.number().int().min(0).max(8).default(0),
      infants: z.number().int().min(0).max(4).default(0),
    }),
  ])
  .refine((t) => t.adults + t.children <= 9, "At most 9 seated travellers per search")
  .refine((t) => t.infants <= t.adults, "Each infant needs an adult lap");

export const datesSchema = z
  .object({
    depart: isoDate,
    return: isoDate,
    /** How many days either side of each date the traveller can move. */
    flexibilityDays: z.number().int().min(0).max(7).default(0),
  })
  .refine((d) => d.return > d.depart, { message: "Return must be after departure", path: ["return"] });

export const budgetSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase())
    .default("GBP"),
  /** Whether the amount is for the whole party or for each traveller. */
  per: z.enum(["total", "person"]).default("total"),
  /** How far over the amount the traveller will go, as a percentage. 0 means a hard ceiling. */
  flexibilityPercent: z.number().min(0).max(50).default(0),
});

const MODES = ["flight", "train", "coach", "ferry", "car"] as const;

export const preferencesSchema = z
  .preprocess(
    // maxFlightHours is the old name for maxTravelHours.
    (v) => (v && typeof v === "object" && "maxFlightHours" in v && !("maxTravelHours" in v) ? { ...(v as object), maxTravelHours: (v as { maxFlightHours: unknown }).maxFlightHours } : v),
    z.object({
      /** Ways of travelling the traveller will accept. All of them unless narrowed. */
      modes: z
        .array(z.enum(MODES))
        .min(1, "Allow at least one way of travelling")
        .transform((m) => [...new Set(m)])
        .default([...MODES]),
      /** Most stops or changes each way. */
      maxStops: z.number().int().min(0).max(3).optional(),
      cabin: z.enum(["economy", "premium_economy", "business", "first"]).default("economy"),
      minHotelStars: z.number().int().min(1).max(5).optional(),
      /** Most hours travelling each way, by any mode. */
      maxTravelHours: z.number().positive().max(36).optional(),
    }),
  )
  .default({});

const tripRequestFields = z.object({
  travellers: travellersSchema,
  dates: datesSchema,
  origin: z.string().trim().min(2).max(80),
  destination: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((s) => (s ? s : undefined)),
  vibe: tagList.default([]),
  /** Anything at all that should inform the search: places, events, themes, interests. */
  keywords: tagList.default([]),
  likes: tagList.default([]),
  dislikes: tagList.default([]),
  budget: budgetSchema,
  preferences: preferencesSchema,
  /** Destinations the traveller has ruled out during refinement. */
  excludeDestinations: z.array(z.string().max(80)).max(50).default([]),
});

export const tripRequestSchema = tripRequestFields.refine((r) => r.vibe.length > 0 || r.keywords.length > 0, {
  message: "Describe the vibe in a word or two, or give some keywords",
  path: ["vibe"],
});

export type TripRequestInput = z.input<typeof tripRequestSchema>;
export type TripRequest = z.output<typeof tripRequestSchema>;
export type Travellers = TripRequest["travellers"];

export function partySize(t: Travellers): number {
  return t.adults + t.children + t.infants;
}

/** Seats and beds: infants travel on a lap and share a bed. */
export function seatedTravellers(t: Travellers): number {
  return t.adults + t.children;
}

/** The ceiling in the budget's currency for the whole party, flexibility included. */
export function budgetCeiling(req: TripRequest): number {
  const base = req.budget.per === "person" ? req.budget.amount * partySize(req.travellers) : req.budget.amount;
  return round2(base * (1 + req.budget.flexibilityPercent / 100));
}

export function budgetTarget(req: TripRequest): number {
  return req.budget.per === "person" ? req.budget.amount * partySize(req.travellers) : req.budget.amount;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatIssues(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
