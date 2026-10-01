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
| **Publishing the website** | Turn on GitHub Pages (Source: GitHub Actions), add the DNS records for sentinel8.ai (`www` CNAME `mflinn99.github.io`, plus GitHub's four `A` records on the bare domain), then set the custom domain `www.sentinel8.ai`. Steps in `docs/HOSTING.md` | Repository owner; whoever manages sentinel8.ai DNS |
| **Personal data in board questions** | People's names, roles, emails and answers are stored with each board question (Azure Table Storage, UK South, 90 days by default), and CVs and answers are sent to Claude on Microsoft Foundry. Confirm the lawful basis, update the privacy notice and record a data-protection impact assessment before real people are invited | Mark Halpin, with whoever holds data protection |
| **Email for questionnaires** | Optional. Until an Azure Communication Services sending domain is verified, the lead sends each link from their own mailbox. Steps in `docs/RUNBOOK.md` | Azure administrator; whoever manages sentinel8.ai DNS |
| **Retiring sixonic.replit.app** | Once production is live: a "Sage Halpin, formerly Sixonic" notice, then a redirect | Owner of the Sixonic Repl |
