import { useEffect } from "react";
import { useLocation } from "wouter";

const pages: Record<string, [string, string]> = {
  "/": ["Sentinel8 — The Evolving Board", "An evolving board of human judgement and AI agents: six perspectives on every decision, with the people accountable for the business deciding."],
  "/dashboard": ["Executive Workspace — Sentinel8", "Review performance, decisions, strategic priorities and risks in your browser-local executive workspace."],
  "/boardroom": ["Boardroom — Sentinel8", "Explore strategic questions with six AI agents on governance, risk, value, innovation, culture and performance."],
  "/analysis": ["Scenario Analysis — Sentinel8", "Examine strategic challenges and trade-offs through six AI boardroom perspectives, for your decision."],
  "/log": ["Decision Log — Sentinel8", "Review the decisions and scenario analyses saved in this browser."],
  "/organisation": ["Your Board — Sentinel8", "Assemble your board: your organisation, the people who take part in its decisions, and the shadow board of AI agents."],
  "/questions": ["Board Questions — Sentinel8", "Put questions to your board: questionnaires for your people, opinions from the shadow board of AI agents."],
  "/agents": ["Agent Development — Sentinel8", "Develop and educate each AI agent for your organisation, and see how it learns from decisions and outcomes."],
  "/checkpoint": ["Checkpoint — Sentinel8", "Your organisation on a page: its status and three years of events, decisions, achievements and people joining and leaving, with insights."],
  "/horizon": ["The Horizon — Sentinel8", "How Sentinel8 keeps looking outward: external signals, the landscape briefing and what the agents learn from it."],
  "/questions/new": ["Ask the Board — Sentinel8", "Put a question to your people by questionnaire and to the shadow board of AI agents."],
};

// Pages whose address carries an id or token.
const prefixes: [string, [string, string]][] = [
  ["/questions/", ["Board Question — Sentinel8", "A board question seen by the people, by the shadow board of AI agents, and by both together."]],
  ["/respond/", ["Your Input — Sentinel8", "A questionnaire from your board."]],
];

export function PageMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    const [title, description] = pages[location] ??
      prefixes.find(([prefix]) => location.startsWith(prefix))?.[1] ?? ["Page not found — Sentinel8", "Return to the Sentinel8 executive workspace."];
    document.title = title;
    for (const [attribute, name, content] of [
      ["name", "description", description],
      ["property", "og:title", title],
      ["property", "og:description", description],
    ]) {
      let meta = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attribute, name);
        document.head.append(meta);
      }
      meta.content = content;
    }
  }, [location]);

  return null;
}