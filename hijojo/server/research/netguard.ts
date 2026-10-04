// Outbound URL policy. Research fetches pages named by models and by web
// content, so every URL is treated as hostile until shown to point at the
// public internet.

import { isIP } from "node:net";

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Block(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail.
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(fill).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p || "0", 16));
}

export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return inV4Block(ip);
  if (fam !== 6) return true;
  const w = expandV6(ip);
  if (!w) return true;
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  // IPv4-mapped / -compatible: judge the embedded address.
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    return inV4Block(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  }
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  if (w[0] === 0x0064 && w[1] === 0xff9b) return true; // NAT64 can reach v4 internals
  return false;
}

const INTERNAL_HOST = /(^localhost$|\.localhost$|\.local$|\.internal$|\.intranet$|\.lan$|\.home\.arpa$|^metadata$)/i;

export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: `Scheme ${url.protocol} is not allowed` };
  if (url.username || url.password) return { ok: false, error: "URLs with credentials are not allowed" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, error: `Port ${url.port} is not allowed` };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !isIP(host)) return { ok: false, error: "Single-label hostnames are not allowed" };
  if (INTERNAL_HOST.test(host)) return { ok: false, error: `Host ${host} is internal` };
  if (isIP(host) && isBlockedAddress(host)) return { ok: false, error: `Address ${host} is private or reserved (blocked)` };
  return { ok: true, url };
}
