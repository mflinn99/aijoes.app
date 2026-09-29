import { useEffect } from "react";
import { useLocation } from "wouter";

const pages: Record<string, [string, string]> = {
  "/": ["Sage Halpin — The Evolving Board", "An evolving board of human judgement and AI agents: six perspectives on every decision, with the people accountable for the business deciding."],
  "/dashboard": ["Executive Workspace — Sage Halpin", "Review performance, decisions, strategic priorities and risks in your browser-local executive workspace."],
  "/boardroom": ["Boardroom — Sage Halpin", "Explore strategic questions with six AI agents on governance, risk, value, innovation, culture and performance."],
  "/analysis": ["Scenario Analysis — Sage Halpin", "Examine strategic challenges and trade-offs through six AI boardroom perspectives, for your decision."],
  "/log": ["Decision Log — Sage Halpin", "Review the decisions and scenario analyses saved in this browser."],
};

export function PageMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    const [title, description] = pages[location] ?? ["Page not found — Sage Halpin", "Return to the Sage Halpin executive workspace."];
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