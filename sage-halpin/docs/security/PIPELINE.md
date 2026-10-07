# CI/CD pipeline security

How the Sage Halpin pipeline is hardened, what each check proves, and what the
repository owner still has to switch on in GitHub and Entra. Nothing below
about GitHub or Azure settings has been verified from this repository: those
settings live outside the code.

Workflows:

- `.github/workflows/sage-halpin.yml`: test, build the image once, deploy to nonprod, promote to production
- `.github/workflows/sage-halpin-security.yml`: secret scan, dependency audit, SBOM, CodeQL, dependency review, Bicep
- `.github/workflows/sage-halpin-site.yml`: GitHub Pages site

## Controls implemented

| Control | Where |
|---|---|
| Every third-party action pinned to a full commit SHA, with the release tag in a comment | all workflows |
| Dependabot keeps those SHAs and the npm dependencies current, weekly | `.github/dependabot.yml` |
| Default `permissions: contents: read`. Jobs are granted more only where they need it: `id-token: write` on the two Azure deploy jobs, `pages: write` + `id-token: write` on the Pages job, and `security-events: write` on CodeQL | all workflows |
| `persist-credentials: false` on every checkout, so the `GITHUB_TOKEN` is not left in `.git/config` for later steps | all workflows |
| `timeout-minutes` on every job; `concurrency` on the deploy jobs, so two deploys to one environment never overlap | all workflows |
| Build once, then promote by digest: the image is built one time in `ci`, tagged with the full commit SHA, then pushed to nonprod and rolled out by `@sha256:` digest. Production imports that same digest, and `deploy.sh` refuses to continue if the digest changes | `sage-halpin.yml`, `infra/deploy.sh` |
| Azure access through OIDC federated credentials only (`azure/login` with client, tenant and subscription IDs). No client secret is stored | `sage-halpin.yml` |
| Deploy jobs run only on `push` to the default branch, and stay skipped until `vars.AZURE_CLIENT_ID` is set | `sage-halpin.yml` |
| Secret scan of the full git history with a pinned gitleaks binary (v8.24.3, sha256-verified). The allowlist is narrow, path plus exact pattern | `sage-halpin-security.yml`, `/.gitleaks.toml` |
| `npm audit` fails on high or critical advisories in production dependencies | `sage-halpin-security.yml` |
| CycloneDX SBOM of production dependencies, kept as a run artifact for 90 days | `sage-halpin-security.yml` |
| CodeQL (`javascript-typescript`, `security-extended`) over `sage-halpin/` | `sage-halpin-security.yml` |
| Dependency review on PRs: fails when a PR adds a dependency with a high or critical advisory | `sage-halpin-security.yml` |
| Bicep `build` + `lint` for `infra/azure/main.bicep` (when present) and `infra/main.bicep` | `sage-halpin-security.yml` |
| CODEOWNERS for `sage-halpin/`, `.github/`, `.gitleaks.toml` and every `infra/` | `.github/CODEOWNERS` |

## What each job proves

| Check name | Passing means |
|---|---|
| `ci` | Typecheck, unit and PostgreSQL tests, web and server build, brand and site checks, and Bicep compile all pass, and the Dockerfile builds, at this commit |
| `deploy-nonprod` | The image built by `ci` in this run was pushed to the nonprod registry and is running in nonprod at a known digest. This job does not run a smoke test beyond `deploy.sh`'s `/api/readyz` wait |
| `deploy-production` | That same digest, unchanged, was imported into production and rolled out after the `production` environment's protection rules passed |
| `secret-scan (gitleaks)` | No secret matching gitleaks' default rules exists anywhere in the git history, apart from the five documented false positives in `.gitleaks.toml` |
| `npm-audit (production deps)` | No known high or critical advisory affects a dependency that ships in the production image, as of the run date |
| `sbom (CycloneDX)` | An inventory of the production dependency tree exists for this commit |
| `codeql (javascript-typescript)` | CodeQL's security-extended queries found nothing it fails on. Alerts appear under Security → Code scanning |
| `dependency-review` | This PR adds no dependency with a high or critical advisory |
| `bicep (build + lint)` | The infrastructure templates compile and pass the Bicep linter's error-level rules |
| `deploy` (site) | The static site passed its link and content check and was published to Pages |

## Settings the owner must enable (not set by this change)

### Branch protection or ruleset on the default branch

Currently `claude/aiogo-metamsp-build-directive-2lsui2`.

- Require a pull request before merging, with at least 1 approving review.
  - Dismiss stale approvals when new commits are pushed.
  - Require review from Code Owners.
  - With a single maintainer, an approving review is only possible if a second account reviews. Otherwise rely on status checks plus the environment reviewer on production.
- Require status checks to pass, and require branches to be up to date:
  - `ci`
  - `secret-scan (gitleaks)`
  - `npm-audit (production deps)`
  - `codeql (javascript-typescript)`
  - `dependency-review`
  - `bicep (build + lint)`

  These workflows have `paths` filters. A required check from a workflow that did not run, for example on a PR touching only `travel-search/`, stays "Expected" and blocks the merge. Either scope the rule set to these paths, or remove the `paths` filter from the security workflow.
- Block force pushes. Block deletions.
- Do not allow bypassing the above settings, including for administrators.
- Optional: require signed commits, and require linear history.

### Environments (Settings → Environments)

- `production`:
  - Required reviewers: at least one. Turn on "Prevent self-review" if a second person is available.
  - Deployment branches: only the default branch.
  - Put the production `AZURE_*` / resource variables here.
- `nonprod`:
  - Deployment branches: only the default branch.
  - Put the nonprod variables here.
- Repository variable `AZURE_CLIENT_ID` (any non-empty value) enables the deploy jobs. A job-level `if` cannot read environment variables, so this switch has to be a repository variable.

### Other repository settings

- Settings → Actions → General:
  - Workflow permissions "Read repository contents".
  - Do not allow Actions to create or approve PRs.
  - Require approval for fork PR workflows from outside collaborators.
- Settings → Code security:
  - Turn on the dependency graph, Dependabot alerts and security updates, secret scanning and push protection.
  - On a private repository, CodeQL and dependency review need GitHub Advanced Security (Code Security). Without it those two jobs fail. Make them non-required, or remove them.

## Entra federated credentials

Use one app registration (or user-assigned managed identity) per environment, each with exactly one federated credential:

| Environment | Issuer | Subject | Audience |
|---|---|---|---|
| nonprod | `https://token.actions.githubusercontent.com` | `repo:mflinn99/aijoes.app:environment:nonprod` | `api://AzureADTokenExchange` |
| production | `https://token.actions.githubusercontent.com` | `repo:mflinn99/aijoes.app:environment:production` | `api://AzureADTokenExchange` |

- Do not add `ref:` or `pull_request` subjects. Because the deploy jobs declare `environment:`, the token's subject is the environment, so only a job running in that GitHub environment can sign in.
- Role assignments:
  - nonprod identity: rights on the nonprod resource group only.
  - production identity: rights on the production resource group, plus `AcrPull` (or Reader) on the nonprod registry, so that `az acr import` can copy the digest.
  - Give neither identity rights on the other environment's resources beyond that.

## Why a PR or a nonprod compromise cannot reach production

- **PRs and forks.** Deploy jobs require `github.event_name == 'push'` to the default branch. A `pull_request` run gets no `id-token: write`, no deploy job, and a read-only token. No workflow uses `pull_request_target` or `workflow_run`. Code from a PR can reach Azure only after it is merged.
- **Nonprod.** The nonprod credential's subject is `environment:nonprod`. Entra will not issue a production token to it. The production job runs only after the nonprod job succeeds and the `production` environment's reviewers approve. It deploys only the digest nonprod ran: a changed image is refused, and nothing is rebuilt.

## Residual risks (honest)

- **Write access to the default branch deploys to nonprod.** Without branch protection, anyone who can push to the default branch can change the workflow itself. That covers dropping the digest check, or running arbitrary code in the `production` job. The environment reviewer is then the only gate before production.
- **Production approval depends on settings.** Production approval exists only if Required reviewers is enabled on the `production` environment. None of these settings has been verified from here.
- **Single maintainer.** With one maintainer, the author and the approver are the same person. Two-person review needs a second account.
- **Build inputs are not fully pinned or attested:**
  - The image builds `FROM node:22-alpine` by tag, not by digest.
  - The `postgres:16` test service is also unpinned.
  - No provenance attestation or image signature is produced (SLSA build L1-ish, not L3).
  - Candidates for later: `actions/attest-build-provenance`, digest-pinned base images, Dependabot's `docker` ecosystem.
- **The image artifact is not separately signed.** It passes between jobs as a GitHub Actions artifact within a single run. Its integrity relies on GitHub's artifact store; `upload-artifact` records a digest, which is not re-checked on download.
- **The gitleaks checksum came from the same release.** The pinned sha256 was taken from that release's checksums file. It protects against later replacement of the asset, not against a compromise that happened at release time.
- **`npm audit` and CodeQL only report what is known.** They detect known advisories and query-matched patterns. A passing run is not proof of absence.
- **The secret scan only runs on matching changes.** Push and PR scans run only for changes under `sage-halpin/`, `.github/` or `.gitleaks.toml`. Other folders are covered by the weekly full-history scan, not per PR.
- **The deploy jobs have not run.** They have not been exercised against Azure in this change, because `AZURE_CLIENT_ID` is not set.

## Known gap: deploy target

The deploy jobs still call `infra/deploy.sh`, which targets the superseded
Container Apps design (`infra/main.bicep`). Before the first Azure deployment,
switch them to `infra/azure` (App Service), keeping build once and promote by
digest (`REMEDIATION-PLAN.md` #12). With `acrPrivate=true`, a hosted runner
can't push to the registry. Use one of the options in `infra/azure/README.md`.
