import { describe, it, expect } from "vitest";
import { UnsafeUrlError, checkFeedUrl, isPublicAddress } from "../server/net.js";

// The horizon scanner's fetcher: feeds must be public https addresses, so an
// organisation can't point it at the server's own network (SSRF).

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });

  it("refuses IPv6 forms that hide a private IPv4 address", () => {
    for (const ip of [
      "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe", "::ffff:10.0.0.1", "::127.0.0.1",
      "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::1",
      "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "2001:db8::1", "2001:0:4136::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("checkFeedUrl", () => {
  it("accepts a public https feed", () => {
    expect(checkFeedUrl("https://example.com/feed.xml").hostname).toBe("example.com");
  });

  it("refuses unsafe addresses before any request is made", () => {
    for (const url of [
      "http://example.com/feed", "https://user:pw@example.com/", "https://example.com:8443/", "https://localhost/",
      "https://metadata.google.internal/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/",
      "https://[::ffff:127.0.0.1]/", "https://[::ffff:169.254.169.254]/", "https://[64:ff9b::a9fe:a9fe]/",
      "https://2130706433/", "https://0x7f.1/", "file:///etc/passwd", "not a url",
    ]) {
      expect(() => checkFeedUrl(url), url).toThrow(UnsafeUrlError);
    }
  });
});
