import { isEmail } from "../../shared/board";
import type { Organisation } from "./organisation";

// Setting up can be skipped, apart from the contact details. What was
// skipped is pointed out where it is used, so the lead knows what the board
// is working without and can fill it in.

export type Use = "question" | "decision" | "agents" | "horizon" | "checkpoint";

export interface MissingItem {
  key: string;
  label: string;
  why: string;
  href: string;
  action: string;
}

/** Contact details: the only part of setting up that can't be skipped. */
export function contactMissing(org: Organisation): string[] {
  const gaps: string[] = [];
  if (!org.name.trim()) gaps.push("organisation name");
  if (!org.leadName.trim()) gaps.push("your name");
  if (!isEmail(org.leadEmail.trim())) gaps.push("your email");
  return gaps;
}

export const hasContactDetails = (org: Organisation) => contactMissing(org).length === 0;

export function missingFor(use: Use, org: Organisation, personIds?: string[]): MissingItem[] {
  const out: MissingItem[] = [];
  const people = personIds ? org.people.filter((p) => personIds.includes(p.id)) : org.people;
  const board = use === "question" || use === "decision" || use === "agents";

  if ((board || use === "horizon") && !org.profile.trim()) {
    out.push({ key: "profile", label: "About the organisation", why: "The agents advise without knowing your size, markets, stage and priorities.", href: "/organisation#org-profile", action: "Describe it" });
  }
  if ((board || use === "horizon") && !org.sector.trim()) {
    out.push({ key: "sector", label: "Sector", why: use === "horizon" ? "Scans can't focus on your industry." : "The agents can't weigh sector norms and regulation.", href: "/organisation#org-sector", action: "Add it" });
  }
  if ((use === "question" || use === "checkpoint") && org.people.length === 0) {
    out.push({ key: "people", label: "The people", why: use === "question" ? "Only the shadow board can be asked until people are added." : "The checkpoint shows no board members.", href: "/organisation#people", action: "Add people" });
  }
  if ((use === "question" || use === "checkpoint") && org.people.length > 0 && !org.people.some((p) => p.permanent)) {
    out.push({ key: "permanent", label: "Permanent members", why: "No one is marked as taking part in every decision.", href: "/organisation#people", action: "Mark them" });
  }
  if (use === "question" || use === "decision") {
    const noCv = people.filter((p) => !p.cv?.trim());
    if (noCv.length) {
      out.push({ key: "cv", label: `CVs for ${names(noCv)}`, why: "The board can't weigh their experience.", href: "/organisation#people", action: "Add CVs" });
    }
    const noExpertise = people.filter((p) => !p.expertise?.trim());
    if (noExpertise.length) {
      out.push({ key: "expertise", label: `Expertise for ${names(noExpertise)}`, why: "The board can't tell what each brings.", href: "/organisation#people", action: "Add it" });
    }
  }
  if (use === "checkpoint") {
    const noJoined = org.people.filter((p) => !p.joinedAt);
    if (noJoined.length) out.push({ key: "joined", label: `When ${names(noJoined)} joined`, why: "Their place in the board's history is undated.", href: "/organisation#people", action: "Add dates" });
  }
  return out;
}

function names(people: { name: string }[]): string {
  const shown = people.slice(0, 3).map((p) => p.name || "unnamed");
  return people.length > 3 ? `${shown.join(", ")} and ${people.length - 3} more` : shown.join(people.length === 2 ? " and " : ", ");
}
