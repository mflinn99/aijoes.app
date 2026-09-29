# Hosting

Sage Halpin has two parts. Each has one source in this repository and one home.

| Part | Source | Host | Address | Cost |
| --- | --- | --- | --- | --- |
| **Website**: landing page and interactive demo | `sage-halpin/site/` (static HTML, no build) | GitHub Pages | `sagehalpin.aigogo.ai` (demo at `/demo/`) | Free |
| **Boardroom app**: the rebranded Sixonic, calling Claude | `sage-halpin/` (Node app, Docker image) | Azure Container Apps, UK South | suggested `app.sagehalpin.aigogo.ai` | Azure usage plus Claude usage |

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
4. **Add the domain in DNS**, wherever `aigogo.ai` is managed:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `sagehalpin` | `mflinn99.github.io` |

5. **Set the custom domain**: **Settings → Pages → Custom domain:
   `sagehalpin.aigogo.ai` → Save**. When the DNS check passes, tick
   **Enforce HTTPS**. Certificates usually take minutes, occasionally a few hours.
6. Optional but recommended: verify `aigogo.ai` for GitHub Pages at the account
   level (**GitHub Settings → Pages → Add a domain**), so no other GitHub
   account can claim a subdomain of it.

To change the website, edit `sage-halpin/site/index.html` or
`sage-halpin/site/demo/index.html` and merge. Links inside the site are
relative, so it works at both addresses.

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
   az containerapp hostname add -g rg-sagehalpin-prod -n ca-sagehalpin-prod --hostname app.sagehalpin.aigogo.ai
   ```

   Add the two DNS records the command asks for:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `app.sagehalpin` | the app's default address (`ca-sagehalpin-prod.<region-id>.uksouth.azurecontainerapps.io`) |
   | TXT | `asuid.app.sagehalpin` | the verification ID the command prints |

   Then bind a free managed certificate:

   ```bash
   az containerapp hostname bind -g rg-sagehalpin-prod -n ca-sagehalpin-prod --hostname app.sagehalpin.aigogo.ai --environment cae-sagehalpin-prod --validation-method CNAME
   ```

5. When the app is live, a "Sign in" or "Open the boardroom" link can be added
   to the website. It is left out until the address works.

## Before anything is public

From `BLOCKERS.md`: written consent from Bryn Sage and Mark Halpin to the name
and its public association, trade mark checks, and an enquiry route for "Talk to
Us", which currently jumps to the closing section.
