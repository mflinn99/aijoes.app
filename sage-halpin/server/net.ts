import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";

// Fetches public web feeds for horizon scanning. The chair chooses the feed
// addresses, so every request is checked to stop it reaching private or
// internal networks (including Azure's metadata endpoint): https only, no
// credentials in the URL, and the address actually connected to must be
// public. The check happens in the socket's DNS lookup, so a hostname cannot
// resolve to a public address when checked and a private one when used.

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: [string, number][] = [
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

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const n = ipv4ToInt(address);
    return !PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(address)) {
    const g = ipv6Groups(address);
    if (!g) return false;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zero = (n: number) => g.slice(0, n).every((x) => x === 0);
    // Forms that carry an IPv4 address: judge the IPv4 address.
    if (zero(5) && g[5] === 0xffff) return isPublicAddress(v4(g[6], g[7])); // ::ffff:a.b.c.d (mapped)
    if (zero(6)) return g[6] === 0 && g[7] <= 1 ? false : isPublicAddress(v4(g[6], g[7])); // ::, ::1, ::a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicAddress(v4(g[6], g[7])); // NAT64 64:ff9b::/96 and /48
    if (g[0] === 0x2002) return isPublicAddress(v4(g[1], g[2])); // 6to4
    const first = g[0];
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((first & 0xffc0) === 0xfec0) return false; // site-local fec0::/10 (deprecated)
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
    if (first === 0x2001 && g[1] === 0) return false; // Teredo 2001::/32
    if (first === 0x0100 && zero(4)) return false; // discard 100::/64
    return true;
  }
  return false;
}

/** The eight 16-bit groups of an IPv6 address (any textual form), or null. */
function ipv6Groups(address: string): number[] | null {
  let a = address.toLowerCase().split("%")[0];
  const dotted = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const n = ipv4ToInt(dotted[1]);
    a = a.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail, extra] = a.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return groups.map((x) => parseInt(x, 16));
}

/** Checks a feed address before any request is made. */
export function checkFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid web address");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Feeds must use https");
  if (url.username || url.password) throw new UnsafeUrlError("Feed addresses cannot contain credentials");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Feeds must use the standard https port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError("Feeds must be on the public internet");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    throw new UnsafeUrlError("Feeds must be on the public internet");
  }
  return url;
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const safe = list.find((a) => isPublicAddress(a.address));
    if (!safe || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError(`${hostname} does not resolve to a public address`), "", 4);
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, [safe]);
    } else {
      callback(null, safe.address, safe.family);
    }
  });
};

/** GETs a public https URL and returns its body as text (bounded in size and time). */
export async function fetchPublicText(raw: string, redirects = 0): Promise<string> {
  // async, so an unsafe redirect target rejects rather than throwing in a callback.
  const url = checkFeedUrl(raw);
  return new Promise<string>((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: publicOnlyLookup,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": "Sentinel8-HorizonScanner/1.0 (+https://www.sentinel8.ai)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects"));
          return resolve(fetchPublicText(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`Feed returned HTTP ${status}`));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("Feed is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Feed timed out")));
    req.on("error", reject);
  });
}
