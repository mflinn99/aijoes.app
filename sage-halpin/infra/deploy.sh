#!/usr/bin/env bash
# Deploy Sage Halpin to Azure from a workstation (the GitHub Actions workflow
# does the same thing on merge to main).
#
#   az login
#   RESOURCE_GROUP=rg-sagehalpin-prod FOUNDRY_RESOURCE_NAME=my-foundry ./infra/deploy.sh
#
# Optional: ENVIRONMENT_NAME (default prod), LOCATION (default uksouth),
# AI_MODEL, VITE_ENQUIRY_EMAIL.
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP}"
: "${FOUNDRY_RESOURCE_NAME:?Set FOUNDRY_RESOURCE_NAME (the Microsoft Foundry resource with the Claude deployment)}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-prod}"
LOCATION="${LOCATION:-uksouth}"
AI_MODEL="${AI_MODEL:-claude-opus-5-5}"
APP_NAME="ca-sagehalpin-${ENVIRONMENT_NAME}"
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
               foundryResourceName="$FOUNDRY_RESOURCE_NAME" aiModel="$AI_MODEL" \
               containerImage="$CURRENT_IMAGE" \
  --query properties.outputs -o json)"

REGISTRY="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registryName"]["value"])')"
LOGIN_SERVER="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registryLoginServer"]["value"])')"
APP_URL="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["appUrl"]["value"])')"

echo "Building image in Azure Container Registry ($REGISTRY)…"
az acr build --registry "$REGISTRY" --image "sage-halpin:$TAG" \
  --build-arg VITE_ENQUIRY_EMAIL="${VITE_ENQUIRY_EMAIL:-}" "$HERE/.."

echo "Rolling out sage-halpin:$TAG…"
az containerapp update -g "$RESOURCE_GROUP" -n "$APP_NAME" --image "$LOGIN_SERVER/sage-halpin:$TAG" --output none

echo "Waiting for readiness…"
for _ in $(seq 1 30); do
  if curl -fsS "$APP_URL/api/readyz" >/dev/null 2>&1; then
    echo "Live: $APP_URL"
    exit 0
  fi
  sleep 10
done
echo "The app did not report ready at $APP_URL/api/readyz; check: az containerapp logs show -g $RESOURCE_GROUP -n $APP_NAME" >&2
exit 1
