import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BOOKING_URL, EMAIL_FOOTER_HTML, EMAIL_FOOTER_TEXT } from "../shared/contact.js";
import { mailtoFor } from "../src/lib/consultations.js";

// The "Schedule online" call to action in every email footer, and the
// website's booking button, all point at the same working booking page.

describe("email footer", () => {
  it("links to the Sentinel8 booking page over https, without a sign-in flag", () => {
    const url = new URL(BOOKING_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("bookings.cloud.microsoft");
    expect(url.pathname).toBe("/book/SENTINEL81%40aigogo.ai/");
    expect(url.search).toBe("");
  });

  it("writes every link in the HTML footer as a complete, quoted address", () => {
    const hrefs = [...EMAIL_FOOTER_HTML.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([BOOKING_URL, "mailto:customer@sentinel8.ai", "tel:+442081291416"]);
    expect(EMAIL_FOOTER_HTML).not.toMatch(/href='|href=[^"]/);
  });

  it("puts the full address in the plain-text footer, where mail apps make it clickable", () => {
    expect(EMAIL_FOOTER_TEXT).toContain(`Schedule online: ${BOOKING_URL}`);
    // No "@" in the address, so it isn't mistaken for an email address.
    expect(BOOKING_URL).not.toContain("@");
  });

  it("ends the invitation the lead sends from their own mailbox with the footer", () => {
    const href = mailtoFor(
      { name: "Alex", email: "alex@example.com", role: "CFO" },
      { leadName: "Pat", organisation: "Acme", question: "Should we expand?", dueDate: null },
      "https://app.example.com/respond/abc",
    );
    // What the mail app shows: the body decoded once, so the link keeps its %40.
    const body = decodeURIComponent(href.split("&body=")[1]);
    expect(body.trimEnd().endsWith(EMAIL_FOOTER_TEXT)).toBe(true);
  });

  it("matches the website's booking button", () => {
    const site = readFileSync(new URL("../site/contact.js", import.meta.url), "utf8");
    expect(site).toContain(`bookingUrl: '${BOOKING_URL}'`);
  });
});
