import { useEffect } from "react";
import { useLocation } from "wouter";

const pages: Record<string, [string, string]> = {
  "/": ["SIXONIC — Boardroom Intelligence", "Whole-company boardroom intelligence connecting responsible performance, ethical leadership, organisational culture and long-term value."],
  "/dashboard": ["Executive Workspace — SIXONIC", "Review performance, decisions, strategic priorities and risks in your browser-local executive workspace."],
  "/boardroom": ["AI Boardroom — SIXONIC", "Explore strategic questions through six perspectives on governance, risk, value, innovation, culture and performance."],
  "/analysis": ["Scenario Analysis — SIXONIC", "Examine strategic challenges and trade-offs through six boardroom perspectives."],
  "/log": ["Decision Log — SIXONIC", "Review the decisions and scenario analyses saved in this browser."],
};

export function PageMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    const [title, description] = pages[location] ?? ["Page not found — SIXONIC", "Return to SIXONIC's executive workspace."];
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