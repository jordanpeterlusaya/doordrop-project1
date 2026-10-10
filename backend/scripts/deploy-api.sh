#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${FIREBASE_PROJECT:-efootball-app-9d175}"
API_URL="https://us-central1-${PROJECT}.cloudfunctions.net/api"

echo "==> Preparing Firebase env for ${PROJECT}"
bash "$ROOT/scripts/prepare-firebase-env.sh"

echo "==> Deploying Cloud Function: api"
cd "$ROOT/.."
npx firebase-tools deploy --only functions:api --project "$PROJECT"

echo "==> Checking /health"
for attempt in 1 2 3 4 5; do
  sleep 5
  response="$(curl -sS "$API_URL/health" || true)"
  echo "Attempt ${attempt}: ${response}"
  if echo "$response" | grep -q '"ok":true'; then
    echo "✓ API is live"
    if echo "$response" | grep -q '"mongikeConfigured":true'; then
      echo "✓ Mongike configured"
    else
      echo "⚠ Mongike not configured — check MONGIKE_API_KEY in backend/.env"
    fi
    if echo "$response" | grep -q '"smsConfigured":true'; then
      echo "✓ SMS OTP provider configured"
    else
      echo "⚠ SMS not configured — check SMS_PROVIDER / MAMBO_SMS_* in backend/.env"
    fi
    exit 0
  fi
done

echo "✗ API health check failed. Verify Blaze billing:" >&2
echo "  https://console.firebase.google.com/project/${PROJECT}/usage/details" >&2
echo "  https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT}" >&2
exit 1
