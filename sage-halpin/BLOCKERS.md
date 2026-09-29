# Blockers before launch

Each needs a person. None is a code defect.

| Blocker | What it takes | Who |
| --- | --- | --- |
| **Azure subscription and Foundry access** | A subscription, a resource group in UK South, and a Microsoft Foundry resource with a Claude deployment. Confirm the deployment type (Hosted on Azure keeps inference in Azure) and that it is available for UK data residency | Whoever owns the Azure tenant |
| **Live-model verification** | The app has not yet been run against a real Claude deployment (no credentials in the build environment). Run the first board session and scenario analysis on staging, and compare the outputs with Sixonic's for the same inputs | Mark Halpin, with the deployer |
| **Foundry role for managed identity** | The template grants Cognitive Services User on the Foundry resource. Confirm this is the role Claude deployments need for Entra ID access; if not, pass the right role id as `foundryRoleDefinitionId` | Azure administrator |
| **GitHub deployment settings** | An Entra app registration with a federated credential for this repository's `production` environment, plus the repository variables listed in the workflow | Repository administrator |
| **Name consent** | Written consent from Bryn Sage and Mark Halpin to the name and its public association | Bryn Sage, Mark Halpin |
| **Trade mark and domain** | Checks in the relevant markets, then a custom domain on the Container App (or Front Door) | Mark Halpin |
| **Enquiry address** | An address for the bespoke-challenge waitlist (`VITE_ENQUIRY_EMAIL`); the link is hidden until one exists | Mark Halpin |
| **Publishing the website** | Merge PR #2, turn on GitHub Pages (Source: GitHub Actions), add the DNS record `sagehalpin` CNAME `mflinn99.github.io` for aigogo.ai, then set the custom domain. Steps in `docs/HOSTING.md` | Repository owner; whoever manages aigogo.ai DNS |
| **Retiring sixonic.replit.app** | Once production is live: a "Sage Halpin, formerly Sixonic" notice, then a redirect | Owner of the Sixonic Repl |
