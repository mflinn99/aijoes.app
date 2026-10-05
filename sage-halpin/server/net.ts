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
    const a = address.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (a === "::" || a === "::1") return false;
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8, documentation 2001:db8::/32.
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff") || a.startsWith("2001:db8")) return false;
    return true;
  }
  return false;
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
