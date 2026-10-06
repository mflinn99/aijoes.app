#!/usr/bin/env bash
# Deploy Hijojo to Azure Container Apps from a workstation.
#
#   az login
#   RESOURCE_GROUP=rg-hijojo-prod FOUNDRY_RESOURCE_NAME=my-foundry ./infra/deploy.sh
#
# Optional: ENVIRONMENT_NAME (default prod), LOCATION (default uksouth), AI_MODEL,
# SEND_MODE (simulate|live, default simulate), SENDER_MAILBOX, SENDER_NAME,
# HANDOFF_TO, ENTRA_TENANT_ID and ENTRA_AUDIENCES (to enable Copilot).
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP}"
: "${FOUNDRY_RESOURCE_NAME:?Set FOUNDRY_RESOURCE_NAME (the Microsoft Foundry resource with the Claude deployment)}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-prod}"
LOCATION="${LOCATION:-uksouth}"
APP_NAME="ca-hijojo-${ENVIRONMENT_NAME}"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
HERE="$(cd "$(dirname "$0")" && pwd)"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Keep whatever image is running so re-applying infrastructure never rolls the app back.
CURRENT_IMAGE="$(az containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
CURRENT_IMAGE="${CURRENT_IMAGE:-mcr.microsoft.com/k8se/quickstart:latest}"

echo "Applying infrastructure to $RESOURCE_GROUP ($ENVIRONMENT_NAME)…"
OUTPUTS="$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$HERE/main.bicep" \
  --parameters environmentName="$ENVIRONMENT_NAME" location="$LOCATION" \
               foundryResourceName="$FOUNDRY_RESOURCE_NAME" aiModel="${AI_MODEL:-claude-opus-5-5}" \
               containerImage="$CURRENT_IMAGE" sendMode="${SEND_MODE:-simulate}" \
               senderMailbox="${SENDER_MAILBOX:-}" senderName="${SENDER_NAME:-AIGoGo}" handoffTo="${HANDOFF_TO:-mark@aigogo.ai}" \
               entraTenantId="${ENTRA_TENANT_ID:-}" entraAudiences="${ENTRA_AUDIENCES:-}" \
  --query properties.outputs -o json)"

out() { echo "$OUTPUTS" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1']['value'])"; }
REGISTRY="$(out registryName)"
LOGIN_SERVER="$(out registryLoginServer)"
APP_URL="$(out appUrl)"

echo "Building image in Azure Container Registry ($REGISTRY)…"
az acr build --registry "$REGISTRY" --image "hijojo:$TAG" "$HERE/.."

echo "Rolling out hijojo:$TAG…"
az containerapp update -g "$RESOURCE_GROUP" -n "$APP_NAME" --image "$LOGIN_SERVER/hijojo:$TAG" --output none

echo "Waiting for readiness…"
for _ in $(seq 1 30); do
  if curl -fsS "$APP_URL/api/readyz" >/dev/null 2>&1; then
    echo "Live: $APP_URL"
    echo "Create the first users (passwords print once):"
    echo "  az containerapp exec -g $RESOURCE_GROUP -n $APP_NAME --command 'node dist/seed.mjs'"
    exit 0
  fi
  sleep 10
done
echo "Not ready at $APP_URL/api/readyz; check: az containerapp logs show -g $RESOURCE_GROUP -n $APP_NAME" >&2
exit 1
