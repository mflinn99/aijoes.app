#!/usr/bin/env bash
# Apply the target architecture (infra/azure) to a resource group.
# Run it after `az login` as the FEDERATED deploy identity (GitHub Actions
# azure/login with OIDC), never with a personal account in prod.
#
#   RESOURCE_GROUP=rg-sagehalpin-prod ENVIRONMENT=prod \
#   BUDGET_AMOUNT=... ALERT_EMAILS=a@x,b@y FOUNDRY_RESOURCE_NAME=... TAG_OWNER=... \
#   ./infra/azure/deploy.sh            # what-if, then asks before applying
#
#   WHAT_IF_ONLY=1   stop after what-if
#   ASSUME_YES=1     apply without the prompt (CI, after a reviewed what-if)
#   ROTATE_SESSION_SECRET=1  new session secret (signs everyone out)
#   ROTATE_PG_PASSWORD=1     new Postgres admin password (+ database-url secret)
#
# Secrets are generated here and written into Key Vault by the template through
# Azure Resource Manager; they are passed as environment variables to the
# .bicepparam file, never written to disk, and never echoed.
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
LOCATION="${LOCATION:-uksouth}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PARAMS="$HERE/params/${ENVIRONMENT}.bicepparam"
[[ -f "$PARAMS" ]] || { echo "No parameter file $PARAMS" >&2; exit 2; }
: "${BUDGET_AMOUNT:?Set BUDGET_AMOUNT (monthly budget; no default by design)}"
: "${ALERT_EMAILS:?Set ALERT_EMAILS (comma-separated)}"
: "${TAG_OWNER:?Set TAG_OWNER}"
: "${FOUNDRY_RESOURCE_NAME:?Set FOUNDRY_RESOURCE_NAME}"

gen() { python3 -c 'import secrets; print(secrets.token_urlsafe(48))'; }

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Keep the running image so re-applying infrastructure never rolls the app back.
APP="$(az webapp list -g "$RESOURCE_GROUP" --query "[?starts_with(name, 'app-sagehalpin-${ENVIRONMENT}-')].name | [0]" -o tsv 2>/dev/null || true)"
if [[ -n "$APP" && -z "${CONTAINER_IMAGE:-}" ]]; then
  FX="$(az webapp config show -g "$RESOURCE_GROUP" -n "$APP" --query linuxFxVersion -o tsv)"
  # DOCKER|<registry>/<repo>:<tag>  ->  <repo>:<tag>
  CONTAINER_IMAGE="${FX#DOCKER|}"
  CONTAINER_IMAGE="${CONTAINER_IMAGE#*/}"
fi
export CONTAINER_IMAGE="${CONTAINER_IMAGE:-sage-halpin:bootstrap}"

# Secret existence is checked through ARM (no data-plane access needed, which
# matters because the vault has no public network access).
VAULT="$(az keyvault list -g "$RESOURCE_GROUP" --query "[?starts_with(name, 'kv-sh-${ENVIRONMENT}-')].name | [0]" -o tsv 2>/dev/null || true)"
secret_exists() {
  [[ -n "$VAULT" ]] && az resource show -g "$RESOURCE_GROUP" --namespace Microsoft.KeyVault \
    --parent "vaults/$VAULT" --resource-type secrets --name "$1" --output none 2>/dev/null
}

export SESSION_SECRET=""
if [[ "${ROTATE_SESSION_SECRET:-}" == "1" ]] || ! secret_exists session-secret; then
  echo "Generating the session secret."
  SESSION_SECRET="$(gen)"
fi

export PG_ADMIN_PASSWORD=""
PG="$(az postgres flexible-server list -g "$RESOURCE_GROUP" --query "[?starts_with(name, 'psql-sagehalpin-${ENVIRONMENT}-')].name | [0]" -o tsv 2>/dev/null || true)"
if [[ "${ROTATE_PG_PASSWORD:-}" == "1" || -z "$PG" ]] || ! secret_exists database-url; then
  echo "Generating the Postgres admin password."
  PG_ADMIN_PASSWORD="$(gen)"
fi

NAME="sagehalpin-${ENVIRONMENT}-$(date -u +%Y%m%d%H%M%S)"

echo "What-if against $RESOURCE_GROUP ($ENVIRONMENT)…"
az deployment group what-if -g "$RESOURCE_GROUP" -n "$NAME" \
  --template-file "$HERE/main.bicep" --parameters "$PARAMS"

[[ "${WHAT_IF_ONLY:-}" == "1" ]] && exit 0
if [[ "${ASSUME_YES:-}" != "1" ]]; then
  read -r -p "Apply these changes? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Not applied."; exit 1; }
fi

az deployment group create -g "$RESOURCE_GROUP" -n "$NAME" \
  --template-file "$HERE/main.bicep" --parameters "$PARAMS" \
  --query properties.outputs -o json

if [[ -n "$SESSION_SECRET$PG_ADMIN_PASSWORD" && -n "$APP" ]]; then
  # Key Vault references are cached for up to 24h; restart to pick up rotated
  # secrets now.
  echo "Restarting $APP to pick up rotated secrets."
  az webapp restart -g "$RESOURCE_GROUP" -n "$APP"
fi

cat <<MSG
Applied. Next (see infra/azure/README.md):
  1. Approve the Front Door private endpoint connection on the web app (first deploy only).
  2. Push an image and roll it out (README "Images").
  3. Run the post-deploy checks.
MSG
