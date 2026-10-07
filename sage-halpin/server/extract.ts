import { inflateRawSync } from "node:zlib";

// What Sentinel can read from an uploaded file. Any file can be uploaded and
// kept; this decides how its content reaches the model:
//  - "pdf" and "image": sent to Claude as a document or image, which it reads natively
//  - "text": plain text, HTML, CSV, JSON, Markdown and similar, decoded here
//  - "office": Word, Excel, PowerPoint and OpenDocument files, text pulled from their XML
//  - "other": kept and downloadable, but its content can't be read (audio, video,
//    archives, old binary Office formats); Sentinel works from its name and type

export type FileKind = "pdf" | "image" | "text" | "office" | "other";

export const TEXT_LIMIT = 200_000; // characters of extracted text kept per file
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // the model's per-image limit
export const PDF_MAX_BYTES = 30 * 1024 * 1024;

const TEXT_EXT = /\.(txt|text|md|markdown|csv|tsv|json|xml|html?|rtf|yaml|yml|log|ini|toml|ics|vcf|eml|srt|vtt|tex|sql|js|ts|py|css)$/i;
const OFFICE_EXT = /\.(docx|docm|xlsx|xlsm|pptx|pptm|odt|ods|odp)$/i;

export function sniffType(name: string, declared: string, bytes: Buffer): string {
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const clean = declared.split(";")[0].trim().toLowerCase();
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(clean) && clean !== "application/octet-stream") return clean;
  if (/\.docx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.xlsx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.pptx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (TEXT_EXT.test(name)) return "text/plain";
  return "application/octet-stream";
}

export function kindOf(name: string, type: string, bytes: Buffer): FileKind {
  if (type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  if (OFFICE_EXT.test(name) || /officedocument|opendocument/.test(type)) return isZip(bytes) ? "office" : "other";
  if (type.startsWith("text/") || /json|xml|csv|yaml|javascript|rtf/.test(type) || TEXT_EXT.test(name)) return looksLikeText(bytes) ? "text" : "other";
  return looksLikeText(bytes) && bytes.length > 0 ? "text" : "other";
}

/** The readable text of a file (empty for PDFs, images and unreadable files). */
export function extractText(name: string, type: string, kind: FileKind, bytes: Buffer): string {
  try {
    if (kind === "text") {
      let text = decodeText(bytes);
      if (/html?$/i.test(name) || type === "text/html") text = htmlToText(text);
      else if (/\.rtf$/i.test(name) || type.includes("rtf")) text = rtfToText(text);
      return tidy(text);
    }
    if (kind === "office") return tidy(officeText(bytes));
  } catch {
    // A damaged file: keep it, but there is no text to give the model.
  }
  return "";
}

function isZip(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return true;
  let odd = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd += 1;
  }
  return odd / sample.length < 0.02;
}

function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  return bytes.toString("utf8");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Removes <script>, <style> and <noscript> elements with their content, in linear time. */
function dropBlocks(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  for (;;) {
    const open = /<(script|style|noscript)\b/g;
    open.lastIndex = at;
    const m = open.exec(lower);
    if (!m) break;
    const close = lower.indexOf(`</${m[1]}`, m.index + m[0].length);
    out += `${html.slice(at, m.index)} `;
    if (close < 0) return out;
    const end = lower.indexOf(">", close);
    at = end < 0 ? html.length : end + 1;
  }
  return out + html.slice(at);
}

/** Removes markup, repeating until none is left, then any stray angle brackets. */
function stripTags(text: string, replacement = " "): string {
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^<>]*>/g, replacement);
  } while (text !== prev);
  return text.replace(/[<>]/g, " ");
}

function htmlToText(html: string): string {
  return decodeEntities(stripTags(dropBlocks(html).replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")));
}

function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/ *\t */g, "\t")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_LIMIT);
}

// ─── Office files: a minimal ZIP reader for their XML parts ─────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const MAX_ENTRY_BYTES = 50 * 1024 * 1024; // refuse zip bombs

function zipEntries(bytes: Buffer): ZipEntry[] {
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const size = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const offset = bytes.readUInt32LE(p + 42);
    entries.push({ name: bytes.subarray(p + 46, p + 46 + nameLen).toString("utf8"), method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(bytes: Buffer, e: ZipEntry): string {
  if (e.size > MAX_ENTRY_BYTES || e.offset + 30 > bytes.length || bytes.readUInt32LE(e.offset) !== 0x04034b50) return "";
  const start = e.offset + 30 + bytes.readUInt16LE(e.offset + 26) + bytes.readUInt16LE(e.offset + 28);
  const data = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
  return "";
}

const xmlText = (xml: string, paragraph: RegExp) =>
  decodeEntities(stripTags(xml.replace(paragraph, "\n").replace(/<w:tab\/>|<a:tab\/>/g, "\t"), ""));

const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function officeText(bytes: Buffer): string {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (name: string) => (byName.has(name) ? readEntry(bytes, byName.get(name)!) : "");

  // Word
  if (byName.has("word/document.xml")) {
    const parts = ["word/document.xml", ...entries.map((e) => e.name).filter((n) => /^word\/(footnotes|endnotes|comments)\.xml$/.test(n))];
    return parts.map((n) => xmlText(read(n), /<\/w:p>/g)).join("\n\n");
  }
  // Excel: shared strings plus inline values, sheet by sheet
  if (byName.has("xl/workbook.xml")) {
    const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1], /<\/t>/g).replace(/\n/g, ""));
    const sheets = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(naturalOrder);
    return sheets
      .map((name, i) => {
        const rows = [...read(name).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
          [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)]
            .map(([, attrs, body]) => {
              const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
              return /t="s"/.test(attrs) ? (shared[Number(v)] ?? "") : decodeEntities(v);
            })
            .join("\t"),
        );
        return `Sheet ${i + 1}\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  // PowerPoint: slides and their notes, in order
  if (entries.some((e) => e.name.startsWith("ppt/slides/"))) {
    const slides = entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalOrder);
    return slides
      .map((name, i) => {
        const notes = read(name.replace("slides/slide", "notesSlides/notesSlide"));
        return `Slide ${i + 1}\n${xmlText(read(name), /<\/a:p>/g)}${notes ? `\nNotes: ${xmlText(notes, /<\/a:p>/g)}` : ""}`;
      })
      .join("\n\n");
  }
  // OpenDocument
  if (byName.has("content.xml")) return xmlText(read("content.xml"), /<\/text:(p|h)>/g);
  return "";
}
