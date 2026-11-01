#!/usr/bin/env bash
# Deploy cargo + parcel offer WebSocket servers to Cloud Run (public wss://).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${FIREBASE_PROJECT:-efootball-app-9d175}"
REGION="${CLOUD_RUN_REGION:-us-central1}"
PATH_ADDITIONS="/home/jordan/.local/opt/google-cloud-sdk/bin:/home/jordan/.local/bin"
export PATH="${PATH_ADDITIONS}:$PATH"

cd "$ROOT"

echo "==> Project ${PROJECT} / region ${REGION}"
gcloud config set project "$PROJECT" >/dev/null

deploy_one() {
  local name="$1"
  local dockerfile="$2"
  echo
  echo "==> Deploying ${name} (${dockerfile})"
  cp "$dockerfile" Dockerfile
  # Ensure Cloud Build uses container, not buildpacks
  gcloud run deploy "$name" \
    --project="$PROJECT" \
    --region="$REGION" \
    --source=. \
    --allow-unauthenticated \
    --session-affinity \
    --timeout=3600 \
    --concurrency=80 \
    --cpu=1 \
    --memory=512Mi \
    --min-instances=0 \
    --max-instances=20 \
    --set-env-vars="DOORDROP_FIREBASE_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GCLOUD_PROJECT=${PROJECT},NODE_ENV=production" \
    --quiet

  local url
  url="$(gcloud run services describe "$name" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
  echo "✓ ${name} → ${url}"
  echo "  WebSocket: ${url/https:/wss:}"
  rm -f Dockerfile
}

deploy_one "haul-cargo-offer-ws" "Dockerfile.cargo-ws"
deploy_one "haul-parcel-offer-ws" "Dockerfile.parcel-ws"

CARGO_URL="$(gcloud run services describe haul-cargo-offer-ws --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
PARCEL_URL="$(gcloud run services describe haul-parcel-offer-ws --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
# Prefer stable *.REGION.run.app host when Cloud Run also advertises the hash host.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
STABLE_CARGO="https://haul-cargo-offer-ws-${PROJECT_NUMBER}.${REGION}.run.app"
STABLE_PARCEL="https://haul-parcel-offer-ws-${PROJECT_NUMBER}.${REGION}.run.app"
if curl -fsS -m 10 "${STABLE_CARGO}/health" >/dev/null 2>&1; then
  CARGO_URL="$STABLE_CARGO"
fi
if curl -fsS -m 10 "${STABLE_PARCEL}/health" >/dev/null 2>&1; then
  PARCEL_URL="$STABLE_PARCEL"
fi
CARGO_WSS="${CARGO_URL/https:/wss:}"
PARCEL_WSS="${PARCEL_URL/https:/wss:}"

echo
echo "==> Health checks"
curl -sS -m 20 "${CARGO_URL}/health" || true
echo
curl -sS -m 20 "${PARCEL_URL}/health" || true
echo
echo
echo "Set these in app .env / EAS standalone:"
echo "  EXPO_PUBLIC_CARGO_OFFER_WS_URL=${CARGO_WSS}"
echo "  EXPO_PUBLIC_PARCEL_OFFER_WS_URL=${PARCEL_WSS}"
echo "  EXPO_PUBLIC_API_BASE_URL=https://us-central1-${PROJECT}.cloudfunctions.net/api"

# Write machine-local pointer file (gitignored via *.local)
cat > "$ROOT/offer-ws.urls.local" <<EOF
EXPO_PUBLIC_CARGO_OFFER_WS_URL=${CARGO_WSS}
EXPO_PUBLIC_PARCEL_OFFER_WS_URL=${PARCEL_WSS}
CARGO_OFFER_WS_HTTPS=${CARGO_URL}
PARCEL_OFFER_WS_HTTPS=${PARCEL_URL}
EOF
echo "✓ Wrote ${ROOT}/offer-ws.urls.local"
