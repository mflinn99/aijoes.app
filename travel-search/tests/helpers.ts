import { addDays, todayIso } from "../server/dates.js";

export function future(days: number): string {
  return addDays(todayIso(), days);
}

export function brief(overrides: Record<string, unknown> = {}) {
  return {
    travellers: 2,
    dates: { depart: future(40), return: future(47), flexibilityDays: 2 },
    origin: "London",
    vibe: "relaxed beach, sunshine",
    likes: ["good food"],
    dislikes: ["nightlife"],
    budget: { amount: 2500, currency: "GBP", flexibilityPercent: 5 },
    ...overrides,
  };
}
