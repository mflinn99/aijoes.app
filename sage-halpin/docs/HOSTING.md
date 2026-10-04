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
| `/` | `site/index.html` | The landing page, including Contact Us (`#contact`: call booking, message form, amy@aigogo.ai, 07803 000952) |
| `/demo/` | `site/demo/index.html` | The interactive demo, with fictional data |
| `/media/` | `site/media/index.html` | The hero animation as videos (16:9, 1:1, 9:16, GIF, transparent WebM, still) with downloads and the embed code. Not indexed by search engines. |
| `/hero.html` | `site/hero.html` | The hero animation on its own, for embedding (`<iframe>`) and recording. Options: `background`, `years`, `yearsAt`, `speed`, `still`. Not indexed. |
| | `site/contact.js` | The booking calendar and message form (settings below) |

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

5. When the app is live, a "Sign in" or "Open the boardroom" link can be added
   to the website. It is left out until the address works.

## Before anything is public

From `BLOCKERS.md`: written consent from Bryn Sage and Mark Halpin to the name
and its public association, and trade mark checks.

## Contact Us: booking and messages

The website's **Contact Us** section has a booking calendar and a message form.
Their settings are at the top of `sage-halpin/site/contact.js`:

| Setting | Today | What it does |
| --- | --- | --- |
| `email` | `amy@aigogo.ai` | Where requests and messages go (also shown on the page with the phone number, 07803 000952) |
| `endpoint` | empty | A form service URL that accepts a JSON POST, such as Formspree. When set, messages and call requests are delivered straight to it |
| `bookingUrl` | empty | A scheduling page: a Google Calendar appointment schedule, Microsoft Bookings or Calendly. When set, it replaces the request calendar, so visitors book live against real availability |
| `startHour`, `endHour`, `minutes`, `days`, `leadHours` | 9, 17, 30, 15, 18 | The call times on offer, in UK time |

With neither service set, the page still works: a visitor picks a weekday slot
(UK working hours, bank holidays excluded, shown in their own time zone), enters
their details, and their email app opens with the request addressed to `email`.
They also get the time as a calendar entry (`.ics` or Google Calendar). The team
confirms each call by email.
