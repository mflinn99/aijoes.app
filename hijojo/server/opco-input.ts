// Validation for a new OpCo, shared by the web app and the Copilot API.

import { z } from "zod/v4";
import { checkUrl } from "./research/netguard";

export const OpcoInput = z.object({
  name: z.string().trim().min(1).max(120),
  website: z.string().trim().max(500).optional().default(""),
  introLink: z.string().trim().max(500).optional().nullable(),
  notes: z.string().max(50_000).optional(),
});
export type OpcoInputT = z.infer<typeof OpcoInput>;

/** Returns an error message, or null when the input is acceptable. */
export function opcoInputProblem(b: OpcoInputT): string | null {
  if (!b.website) {
    // A sale mandate or unlaunched OpCo: the documents are the evidence and every
    // message still needs one link of the OpCo's own (e.g. an NDA request page).
    if (!b.notes?.trim()) return "Without a website, supporting information is required";
    if (!b.introLink) return "Without a website, an intro link is required";
  }
  for (const u of [b.website, b.introLink].filter(Boolean) as string[]) {
    const c = checkUrl(u);
    if (!c.ok) return `${u}: ${c.error}`;
  }
  return null;
}
