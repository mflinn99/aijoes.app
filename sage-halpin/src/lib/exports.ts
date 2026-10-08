import { htmlDocument, saveFile, section, slug, table, toCsv, today } from "./downloads";
import type { ConsultationView } from "./consultations";
import type { Organisation } from "./organisation";
import { AGENT_PERSONAS, DECISION_MODE_LABELS, OUTCOME_LABELS, POSITION_LABELS, type Position } from "../../shared/board";

// What each page offers in its Download menu. Never includes access tokens.

const label = (p: Position | null | undefined) => (p ? POSITION_LABELS[p] : "");
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "");

// ─── A board question ───────────────────────────────────────────────────────

export function questionRecordHtml(c: ConsultationView): string {
  const answers = c.invitees.map((i) => {
    const r = c.responses[i.personId];
    const rows = c.questionnaire.map((q) => [q.prompt, r?.answers.find((a) => a.questionId === q.id)?.value ?? ""]);
    return `<h3>${i.name}, ${i.role}${i.permanent ? " (permanent member)" : ""}</h3>${
      r ? `<p class="meta">Answered ${date(r.submittedAt)}</p>${table(["Question", "Answer"], rows.map(([q, a]) => [q, q === "What is your position?" ? label(a as Position) || a : a]))}` : "<p>No answer yet.</p>"
    }`;
  });
  const opinions = (round: ConsultationView["shadow"], title: string) =>
    round
      ? `<h2>${title}</h2><p class="meta">Convened ${date(round.createdAt)}</p>${round.opinions
          .map((o) => `<h3>${o.persona} (${o.seat})${o.position ? ` · ${label(o.position)}` : ""}${o.confidence ? ` · confidence ${o.confidence}/5` : ""}</h3><p class="pre">${escape(o.content)}</p>`)
          .join("")}`
      : "";
  const body = [
    section("The question", c.question),
    section("Context", c.context),
    section("How it is decided", `${DECISION_MODE_LABELS[c.mode]}${c.mode === "collaborative" ? ` · people's weight ${c.peopleWeight}%` : ""} · asked by ${c.leadName} on ${date(c.createdAt)}${c.dueDate ? ` · reply by ${c.dueDate}` : ""}`),
    c.invitees.length ? `<h2>The people</h2>${answers.join("")}` : "",
    opinions(c.shadow, "The shadow board"),
    opinions(c.challenge, "Round two: the challenge"),
    section("Summary of the people's input", c.syntheses.people?.content),
    section("Combined view of people and agents", c.syntheses.mixed?.content),
    c.decision
      ? section(
          "The decision",
          `${c.decision.decision} (${label(c.decision.position)}), decided ${date(c.decision.decidedAt)}`,
          c.decision.rationale && `Why: ${c.decision.rationale}`,
          c.decision.plan && `Plan: ${c.decision.plan}`,
          c.decision.withoutPermanent?.length ? `Decided without: ${c.decision.withoutPermanent.join(", ")}` : null,
        )
      : section("The decision", "Not yet decided."),
  ].join("");
  return htmlDocument(`${c.organisation}: board question`, body);
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function downloadQuestion(c: ConsultationView, kind: "doc" | "json" | "answers") {
  const base = `board-question-${slug(c.question)}-${today()}`;
  if (kind === "doc") return saveFile(`${base}.doc`, "application/msword", questionRecordHtml(c));
  if (kind === "json") {
    const record = {
      question: c.question,
      context: c.context,
      organisation: c.organisation,
      lead: c.leadName,
      createdAt: c.createdAt,
      dueDate: c.dueDate,
      mode: c.mode,
      peopleWeight: c.peopleWeight,
      questionnaire: c.questionnaire,
      people: c.invitees.map((i) => ({ name: i.name, role: i.role, permanent: !!i.permanent, response: c.responses[i.personId] ?? null })),
      shadowBoard: c.shadow,
      challenge: c.challenge,
      syntheses: c.syntheses,
      decision: c.decision,
    };
    return saveFile(`${base}.json`, "application/json", JSON.stringify(record, null, 2));
  }
  const head = ["Name", "Role", "Permanent", "Answered", ...c.questionnaire.map((q) => q.prompt)];
  const rows = c.invitees.map((i) => {
    const r = c.responses[i.personId];
    return [i.name, i.role, i.permanent ? "Yes" : "No", r ? date(r.submittedAt) : "", ...c.questionnaire.map((q) => r?.answers.find((a) => a.questionId === q.id)?.value ?? "")];
  });
  return saveFile(`${base}-answers.csv`, "text/csv;charset=utf-8", toCsv(head, rows));
}

// ─── The organisation ───────────────────────────────────────────────────────

/** The organisation's profile, people and shadow board, without its workspace access token. */
export function organisationExport(org: Organisation) {
  const { workspace: _token, ...rest } = org;
  return rest;
}

export function downloadOrganisation(org: Organisation, kind: "doc" | "people" | "json") {
  const base = `${slug(org.name || "organisation")}-${today()}`;
  if (kind === "json") return saveFile(`${base}-board.json`, "application/json", JSON.stringify(organisationExport(org), null, 2));
  if (kind === "people") {
    return saveFile(
      `${base}-people.csv`,
      "text/csv;charset=utf-8",
      toCsv(
        ["Name", "Role", "Email", "Phone", "Permanent", "Joined", "Expertise", "CV"],
        org.people.map((p) => [p.name, p.role, p.email, p.phone ?? "", p.permanent ? "Yes" : "No", p.joinedAt ?? "", p.expertise ?? "", p.cv ?? ""]),
      ),
    );
  }
  const body = [
    section("Contact", `${org.name}`, `Lead: ${org.leadName}${org.leadEmail ? ` <${org.leadEmail}>` : ""}`),
    section("About the organisation", org.sector && `Sector: ${org.sector}`, org.profile),
    org.people.length
      ? `<h2>The people</h2>${table(["Name", "Role", "Membership", "Expertise", "Joined"], org.people.map((p) => [p.name, p.role, p.permanent ? "Permanent" : "As needed", p.expertise ?? "", p.joinedAt ?? ""]))}`
      : "",
    `<h2>The shadow board</h2>${table(
      ["Agent", "Seat", "Seated", "Brief"],
      org.agents.map((a) => [AGENT_PERSONAS[a.id].persona, AGENT_PERSONAS[a.id].seat, a.seated ? "Yes" : "No", a.brief]),
    )}`,
    (org.formerPeople ?? []).length
      ? `<h2>Former members</h2>${table(["Name", "Role", "Joined", "Left"], (org.formerPeople ?? []).map((p) => [p.name, p.role, p.joinedAt, p.leftAt]))}`
      : "",
  ].join("");
  return saveFile(`${base}-board.doc`, "application/msword", htmlDocument(`${org.name || "Your board"}: the board`, body));
}

export { OUTCOME_LABELS };
