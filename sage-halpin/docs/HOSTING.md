# Hosting

Sage Halpin has two parts. Each has one source in this repository and one home.

| Part | Source | Host | Address | Cost |
| --- | --- | --- | --- | --- |
| **Website**: landing page, interactive demo, media page and the standalone hero animation | `sage-halpin/site/` (static HTML, no build) | GitHub Pages | `www.sentinel8.ai` (see the pages below; `sentinel8.ai` redirects there) | Free |
| **Boardroom app**: the rebranded Sixonic, calling Claude | `sage-halpin/` (Node app, Docker image) | Azure Container Apps, UK South | suggested `app.sentinel8.ai` | Azure usage plus Claude usage |

Both publish from GitHub Actions when changes reach the repository's **default
branch** (today `claude/aiogo-metamsp-build-directive-2lsui2`; `main` also works if
the branch is renamed). Pull requests only run the checks.

The claude.ai links used during design are previews, not hosting. They can be
shared from their own Share menu, but the website above is the public copy.

---

## 1. Publish the website (about 15 minutes, plus DNS time)

1. **Merge PR #2** into the default branch.
2. **Turn on Pages**: repository **Settings → Pages → Build and deployment →
   Source: GitHub Actions**.
3. **Run it once**: **Actions → Sage Halpin site → Run workflow** (on the
   default branch). Later changes to `sage-halpin/site/` publish on their own.
   The site is now live at `https://mflinn99.github.io/aijoes.app/`.
4. **Add the domain in DNS**, wherever `sentinel8.ai` is managed:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `www` | `mflinn99.github.io` |
   | A | `@` (the bare domain) | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |

   The `www` record serves the site. The four `A` records let GitHub redirect
   `sentinel8.ai` to `www.sentinel8.ai`. Optionally add the matching `AAAA`
   records (`2606:50c0:8000::153`, `8001::153`, `8002::153`, `8003::153`).

5. **Set the custom domain**: **Settings → Pages → Custom domain:
   `www.sentinel8.ai` → Save**. When the DNS check passes, tick
   **Enforce HTTPS**. Certificates usually take minutes, occasionally a few hours.
6. Optional but recommended: verify `sentinel8.ai` for GitHub Pages at the account
   level (**GitHub Settings → Pages → Add a domain**), so no other GitHub
   account can claim a subdomain of it.

### Pages on the website

| Address | File | What it is |
| --- | --- | --- |
| `/` | `site/index.html` | The landing page, including Contact Us (`#contact`: call booking, message form, customer@sentinel8.ai, +44 (0)208 1291416) |
| `/demo/` | `site/demo/index.html` | The interactive demo, with fictional data |
| `/media/` | `site/media/index.html` | The hero animation as videos (16:9, 1:1, 9:16, GIF, transparent WebM, still) with downloads and the embed code. Not indexed by search engines. |
| `/hero.html` | `site/hero.html` | The hero animation on its own, for embedding (`<iframe>`) and recording. Options: `background`, `years`, `yearsAt`, `speed`, `still`. Not indexed. |
| | `site/contact.js` | The booking calendar and message form (settings below) |
| | `site/app-links.js` | Where **Sign in** and **Create account** go: `APP_URL` (default `https://app.sentinel8.ai`) plus `/signin` or `/signup` |

To change the website, edit the files above and merge. Links inside the site are
relative, so it works at both addresses. **Every pull request and every publish runs
`npm run check:site`** (in `sage-halpin/`): it fails if a tag is left unclosed, a
link, file or `#anchor` doesn't exist, the Contact Us details are missing or don't
match `contact.js`, or "Talk to Us" reappears. A failing check stops the publish,
so a broken page never goes live.

## 2. Publish the boardroom app (about an hour, first time)

The app needs Azure and a Claude deployment on Microsoft Foundry.
`docs/RUNBOOK.md` has the detail. In short:

1. In Azure, in UK South, create a resource group and a Microsoft Foundry
   resource with a Claude deployment (`claude-opus-5-5`).
2. Deploy once from a workstation:

   ```bash
   az login
   RESOURCE_GROUP=rg-sagehalpin-prod FOUNDRY_RESOURCE_NAME=<foundry-resource> ./sage-halpin/infra/deploy.sh
   ```

   It prints the app's address when it reports ready.
3. For automatic deploys, set up GitHub OIDC and the repository variables listed
   in `docs/RUNBOOK.md` (Continuous deployment). Merges to the default branch
   then deploy on their own.
4. Custom domain (after the first deploy):

   ```bash
   az containerapp hostname add -g rg-sagehalpin-prod -n ca-sagehalpin-prod --hostname app.sentinel8.ai
   ```

   Add the two DNS records the command asks for:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `app` | the app's default address (`ca-sagehalpin-prod.<region-id>.uksouth.azurecontainerapps.io`) |
   | TXT | `asuid.app` | the verification ID the command prints |

   Then bind a free managed certificate:

   ```bash
   az containerapp hostname bind -g rg-sagehalpin-prod -n ca-sagehalpin-prod --hostname app.sentinel8.ai --environment cae-sagehalpin-prod --validation-method CNAME
   ```

5. The website's **Sign in** and **Create account** buttons open
   `https://app.sentinel8.ai/signin` and `/signup` (set by `APP_URL` in
   `site/app-links.js`; change it there if the app lives elsewhere). Until that
   address answers, a click shows "Accounts open when the platform launches" with
   the contact email instead of a broken page, so the buttons can stay up before
   launch. Accounts need the session secret, which `deploy.sh` creates (see
   `RUNBOOK.md`, Accounts).

## Before anything is public

From `BLOCKERS.md`: written consent from Bryn Sage and Mark Halpin to the name
and its public association, and trade mark checks.

## Contact Us: booking and messages

The website's **Contact Us** section has a booking calendar and a message form.
Their settings are at the top of `sage-halpin/site/contact.js`:

| Setting | Today | What it does |
| --- | --- | --- |
| `email` | `customer@sentinel8.ai` | Where requests and messages go (also shown on the page with the phone number, +44 (0)208 1291416) |
| `endpoint` | empty | A form service URL that accepts a JSON POST, such as Formspree. When set, messages and call requests are delivered straight to it |
| `bookingUrl` | The Sentinel8 Microsoft Bookings shared page (`https://bookings.cloud.microsoft/book/SENTINEL81%40aigogo.ai/`) | A live booking page connected to a real calendar. When set, it replaces the request calendar, so visitors book live against real availability. A Microsoft Bookings page opens from a **Schedule online** button in a new tab; a Google Calendar or Calendly page is embedded. Keep it the same as `BOOKING_URL` in `shared/contact.ts` |
| `startHour`, `endHour`, `minutes`, `days`, `leadHours` | 9, 17, 30, 15, 18 | The call times on offer, in UK time |

### Link the booking calendar to your Microsoft 365 (Outlook) calendar

Use a **Microsoft Bookings shared booking page**: it reads the Outlook calendar's
free/busy times and puts every booking straight into it.

1. Sign in at https://outlook.office.com/bookings (or open **Bookings** from the
   Microsoft 365 app launcher) and create a **shared booking page**, for example
   "Sentinel8".
2. Add a service of 30 minutes, turn on **Add online meeting** (Teams), add
   yourself as staff, and set your business hours.
3. On the booking page settings, set it to be bookable by anyone, then **Save and publish**.
4. Copy the page's link (**Share → Copy link**). Leave off anything after `?`, such
   as `?ismsaljsauthenabled`: that is a sign-in flag for your own session, not for visitors.
5. Put that address in `bookingUrl` in `site/contact.js` and `BOOKING_URL` in
   `shared/contact.ts`, and merge.

#### The live setup: the Sentinel8 shared booking page

The website and every email footer link to the Sentinel8 Microsoft Bookings shared
page: https://bookings.cloud.microsoft/book/SENTINEL81%40aigogo.ai/ (`@` is
written `%40` so mail apps don't mistake part of it for an email address). Its
services, staff and hours are set in the Bookings app (https://outlook.office.com/bookings).
To move to a different page, change `bookingUrl` in `site/contact.js` and
`BOOKING_URL` in `shared/contact.ts` together.

Suggested services, all on Microsoft Teams:

| Service | Visibility | Duration | Description to use |
| --- | --- | --- | --- |
| Sentinel8 introductory call | Public | 30 min | A 30-minute call with the Sentinel8 team. We'll talk through the decisions your board faces, what an evolving team of experienced people and AI advisers would look like around it, and how a first engagement runs. No preparation needed. If you have a specific question in mind, add it in the notes when you book. |
| Sentinel8 board walkthrough (optional) | Public | 45 min | A 45-minute walkthrough for a chair or board member: we take one real decision your board is facing and show how Sentinel8 would assemble the people and AI advisers around it, test it against scenarios, and record the outcome. Bring a question you're working on. |
| Sentinel8 engagement session (optional) | Private (link only) | 60 min | Working session for an active Sentinel8 engagement. |

Suggested for each: Monday to Friday 09:00–17:00 UK time, 10-minute buffer before
and 15 after, at least 24 hours' notice, up to 30 days ahead. Set the business email
to customer@sentinel8.ai so confirmations and replies use it. Check the page in a
private browser window: it should list the public services without asking visitors
to sign in.

### Email footers

Every email Sentinel8 sends or drafts ends with the same footer: a **Schedule
online** button linking to the booking page, plus customer@sentinel8.ai and
+44 (0)208 1291416. It is defined once in `shared/contact.ts` (HTML and plain-text
versions) and used by the questionnaire invitation the app emails and the
invitation it drafts for the lead to send from their own mailbox.

A personal **Bookings with me** page (`…/bookwithme/…`) also works and opens from
the same button. A Google Calendar appointment page or Calendly link works too, and
is embedded in the panel.

With neither service set, the page still works: a visitor picks a weekday slot
(UK working hours, bank holidays excluded, shown in their own time zone), enters
their details, and their email app opens with the request addressed to `email`.
They also get the time as a calendar entry (`.ics` or Google Calendar). The team
confirms each call by email.
