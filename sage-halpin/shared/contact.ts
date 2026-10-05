// How people reach the Sentinel8 team. One place for the booking page and
// contact details used in every email footer (server and browser alike).
//
// The booking page is the Sentinel8 Microsoft Bookings page. "@" is written
// as %40 so mail apps that turn plain-text addresses into links don't mistake
// part of it for an email address.

export const BOOKING_URL = "https://bookings.cloud.microsoft/book/SENTINEL81%40aigogo.ai/";
export const BOOKING_LABEL = "Schedule online";
export const CONTACT_EMAIL = "customer@sentinel8.ai";
export const CONTACT_PHONE = "+44 (0)208 1291416";
export const CONTACT_PHONE_HREF = "tel:+442081291416";

/** Plain-text email footer: the call to action with its full address. */
export const EMAIL_FOOTER_TEXT = `--
Sentinel8
Talk to the Sentinel8 team. ${BOOKING_LABEL}: ${BOOKING_URL}
${CONTACT_EMAIL} · ${CONTACT_PHONE}`;

/**
 * HTML email footer: a "Schedule online" button with the contact details.
 * Inline styles and a table only, so it renders in Outlook and Gmail.
 */
export const EMAIL_FOOTER_HTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;border-top:1px solid #e3e0d8">
<tr><td style="padding-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#13232b">
<p style="margin:0 0 4px;font-weight:bold;letter-spacing:2px">SENTINEL8</p>
<p style="margin:0 0 12px;color:#555">Talk to the Sentinel8 team: book a 30-minute call at a time that suits you.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#13232b;border-radius:4px">
<a href="${BOOKING_URL}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${BOOKING_LABEL}</a>
</td></tr></table>
<p style="margin:12px 0 0;font-size:12px;color:#666"><a href="mailto:${CONTACT_EMAIL}" style="color:#13232b">${CONTACT_EMAIL}</a> · <a href="${CONTACT_PHONE_HREF}" style="color:#13232b">${CONTACT_PHONE}</a></p>
</td></tr></table>`;
