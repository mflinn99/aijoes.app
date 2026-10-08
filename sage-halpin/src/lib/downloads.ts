// Building and saving downloads in the browser: CSV, JSON, and standalone
// HTML documents that open in a browser or in Word.

export function saveFile(name: string, type: string, content: string | Blob) {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A CSV with a header row. Cells that a spreadsheet would read as formulas are neutralised. */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}`;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** A filename-safe slug of a title. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "sentinel8";

const DOC_STYLE = `body{font-family:Georgia,'Times New Roman',serif;color:#13232B;max-width:820px;margin:32px auto;padding:0 20px;line-height:1.5}
h1{font-weight:400;font-size:26px;margin:0 0 4px}h2{font-size:16px;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 8px;border-bottom:1px solid #DCD6CA;padding-bottom:4px}
h3{font-size:15px;margin:18px 0 4px}p,li,td,th{font-size:14px}.meta{color:#4F5D63;font-size:12px;margin-bottom:24px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #DCD6CA;padding:6px 8px;text-align:left;vertical-align:top}.pre{white-space:pre-wrap}footer{margin-top:40px;color:#65737A;font-size:11px}`;

/** A standalone HTML document (opens in a browser, and in Word when saved as .doc). */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${DOC_STYLE}</style></head><body><h1>${escapeHtml(title)}</h1><p class="meta">Sentinel8 · downloaded ${new Date().toLocaleString("en-GB")}</p>${body}<footer>Exported from Sentinel8. AI agents advise; the organisation's people decide.</footer></body></html>`;
}

/** A section of an HTML document: a heading and paragraphs (text is escaped). */
export function section(heading: string, ...paras: (string | null | undefined | false)[]): string {
  const ps = paras.filter((p): p is string => !!p && p.trim().length > 0);
  if (!ps.length) return "";
  return `<h2>${escapeHtml(heading)}</h2>${ps.map((p) => `<p class="pre">${escapeHtml(p)}</p>`).join("")}`;
}

/** A table for an HTML document (text is escaped). */
export function table(head: string[], rows: (string | number | null | undefined)[][]): string {
  if (!rows.length) return "";
  const cell = (v: string | number | null | undefined) => escapeHtml(v === null || v === undefined ? "" : String(v));
  return `<table><thead><tr>${head.map((h) => `<th>${cell(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v) => `<td class="pre">${cell(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/**
 * The page as it is shown, as a clean document: the main content without
 * buttons, menus and form controls (fields become their current values).
 */
export function pageAsHtml(title: string): string {
  const source = document.querySelector("main") ?? document.body;
  const clone = source.cloneNode(true) as HTMLElement;
  // Form fields: keep what was entered, as text.
  const originals = source.querySelectorAll("input, textarea, select");
  clone.querySelectorAll("input, textarea, select").forEach((el, i) => {
    const original = originals[i] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
    let value = "";
    if (original instanceof HTMLSelectElement) value = original.selectedOptions[0]?.textContent ?? "";
    else if (original instanceof HTMLInputElement && (original.type === "checkbox" || original.type === "radio")) value = original.checked ? "☑" : "☐";
    else if (original instanceof HTMLInputElement && (original.type === "file" || original.type === "hidden" || original.type === "password")) value = "";
    else if (original) value = original.value;
    const span = document.createElement("span");
    span.className = "pre";
    span.textContent = value;
    el.replaceWith(span);
  });
  clone.querySelectorAll("button, script, style, noscript, [role=menu], [data-download-skip], .sr-only, svg[aria-hidden=true]").forEach((el) => el.remove());
  // Keep only structure and text: no classes, styles, handlers or links to the app.
  clone.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) if (!["colspan", "rowspan", "open"].includes(attr.name)) el.removeAttribute(attr.name);
  });
  clone.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  return htmlDocument(title, clone.innerHTML);
}
