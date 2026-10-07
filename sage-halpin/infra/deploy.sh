#!/usr/bin/env bash
# Deploy Sage Halpin to Azure from a workstation (the GitHub Actions workflow
# does the same thing on merge to main).
#
#   az login
#   RESOURCE_GROUP=rg-sagehalpin-prod FOUNDRY_RESOURCE_NAME=my-foundry ./infra/deploy.sh
#
# Optional: ENVIRONMENT_NAME (default prod), LOCATION (default uksouth),
# AI_MODEL, VITE_ENQUIRY_EMAIL, PUBLIC_BASE_URL (address in emailed links),
# EMAIL_ENDPOINT and EMAIL_SENDER (Azure Communication Services, to email
# questionnaires; without them the lead sends each link themselves).
#
# Accounts need a session secret in Key Vault. The first deploy creates one and
# later deploys keep it. To rotate it (this signs everyone out), set
# ROTATE_SESSION_SECRET=1.
#
# Image source (build once, promote by digest). By default the image is built
# in Azure Container Registry from this checkout. CI instead sets one of:
#   IMAGE_ARCHIVE  a `docker save` tarball built and tested earlier in the run;
#                  it is pushed to this environment's registry as-is (nonprod).
#   IMAGE_SOURCE   a digest-pinned reference (registry/sage-halpin@sha256:...)
#                  already deployed to an earlier environment; it is imported
#                  into this environment's registry and must keep that digest
#                  (production).
# IMAGE_TAG overrides the tag (CI passes the full git SHA). Either way the app
# is rolled out by digest, and image_ref/digest/app_url are written to
# $GITHUB_OUTPUT when it is set.
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP}"
: "${FOUNDRY_RESOURCE_NAME:?Set FOUNDRY_RESOURCE_NAME (the Microsoft Foundry resource with the Claude deployment)}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-prod}"
LOCATION="${LOCATION:-uksouth}"
AI_MODEL="${AI_MODEL:-claude-opus-5-5}"
APP_NAME="ca-sagehalpin-${ENVIRONMENT_NAME}"
TAG="${IMAGE_TAG:-$(git rev-parse HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Keep whatever image is running so re-applying infrastructure never rolls the app back.
CURRENT_IMAGE="$(az containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
CURRENT_IMAGE="${CURRENT_IMAGE:-mcr.microsoft.com/k8se/quickstart:latest}"

# Create the session secret once; afterwards keep the one in Key Vault, so
# deploys never sign people out. (Checked through Azure Resource Manager, which
# needs no access to secret values.)
SESSION_SECRET_PARAM=""
VAULT="$(az keyvault list -g "$RESOURCE_GROUP" --query "[?starts_with(name, 'kv-sh-${ENVIRONMENT_NAME}-')].name | [0]" -o tsv 2>/dev/null || true)"
if [[ "${ROTATE_SESSION_SECRET:-}" == "1" ]] || [[ -z "$VAULT" ]] || \
   ! az resource show -g "$RESOURCE_GROUP" --namespace Microsoft.KeyVault --parent "vaults/$VAULT" \
       --resource-type secrets --name session-secret --output none 2>/dev/null; then
  echo "Creating the account session secret…"
  SESSION_SECRET_PARAM="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fi

echo "Applying infrastructure to $RESOURCE_GROUP ($ENVIRONMENT_NAME)…"
OUTPUTS="$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$HERE/main.bicep" \
  --parameters environmentName="$ENVIRONMENT_NAME" location="$LOCATION" \
               foundryResourceName="$FOUNDRY_RESOURCE_NAME" aiModel="$AI_MODEL" \
               containerImage="$CURRENT_IMAGE" \
               publicBaseUrl="${PUBLIC_BASE_URL:-}" emailEndpoint="${EMAIL_ENDPOINT:-}" emailSender="${EMAIL_SENDER:-}" \
               sessionSecret="$SESSION_SECRET_PARAM" \
  --query properties.outputs -o json)"

REGISTRY="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registryName"]["value"])')"
LOGIN_SERVER="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registryLoginServer"]["value"])')"
APP_URL="$(echo "$OUTPUTS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["appUrl"]["value"])')"

if [[ -n "${IMAGE_ARCHIVE:-}" ]]; then
  echo "Pushing the prebuilt image to $REGISTRY…"
  LOADED="$(docker load --input "$IMAGE_ARCHIVE" | sed -n 's/^Loaded image: //p' | head -n 1)"
  [[ -n "$LOADED" ]] || { echo "No image found in $IMAGE_ARCHIVE" >&2; exit 1; }
  docker tag "$LOADED" "$LOGIN_SERVER/sage-halpin:$TAG"
  az acr login --name "$REGISTRY"
  docker push "$LOGIN_SERVER/sage-halpin:$TAG"
elif [[ -n "${IMAGE_SOURCE:-}" ]]; then
  [[ "$IMAGE_SOURCE" == *@sha256:* ]] || { echo "IMAGE_SOURCE must be pinned by digest (…@sha256:…)" >&2; exit 1; }
  echo "Promoting $IMAGE_SOURCE into $REGISTRY…"
  if [[ "${IMAGE_SOURCE%%/*}" != "$LOGIN_SERVER" ]]; then
    az acr import --name "$REGISTRY" --source "$IMAGE_SOURCE" --image "sage-halpin:$TAG" --force --output none
  fi
else
  echo "Building image in Azure Container Registry ($REGISTRY)…"
  az acr build --registry "$REGISTRY" --image "sage-halpin:$TAG" \
    --build-arg VITE_ENQUIRY_EMAIL="${VITE_ENQUIRY_EMAIL:-}" "$HERE/.."
fi

if [[ -n "${IMAGE_SOURCE:-}" && "${IMAGE_SOURCE%%/*}" == "$LOGIN_SERVER" ]]; then
  DIGEST="${IMAGE_SOURCE##*@}"
else
  DIGEST="$(az acr repository show --name "$REGISTRY" --image "sage-halpin:$TAG" --query digest -o tsv)"
fi
[[ "$DIGEST" == sha256:* ]] || { echo "Could not read the image digest from $REGISTRY" >&2; exit 1; }
if [[ -n "${IMAGE_SOURCE:-}" && "$DIGEST" != "${IMAGE_SOURCE##*@}" ]]; then
  echo "Digest changed during promotion ($DIGEST, expected ${IMAGE_SOURCE##*@}); refusing to deploy." >&2
  exit 1
fi
IMAGE_REF="$LOGIN_SERVER/sage-halpin@$DIGEST"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "image_ref=$IMAGE_REF"; echo "digest=$DIGEST"; echo "app_url=$APP_URL"; } >> "$GITHUB_OUTPUT"
fi

echo "Rolling out $IMAGE_REF (sage-halpin:$TAG)…"
az containerapp update -g "$RESOURCE_GROUP" -n "$APP_NAME" --image "$IMAGE_REF" --output none

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
