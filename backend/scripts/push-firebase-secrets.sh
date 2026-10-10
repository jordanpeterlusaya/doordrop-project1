#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PROJECT="${FIREBASE_PROJECT:-efootball-app-9d175}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

read_env() {
  local name="$1"
  local line
  line="$(grep -m1 "^${name}=" "$ENV_FILE" || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

push_secret() {
  local name="$1"
  local value
  if ! value="$(read_env "$name")"; then
    echo "skip $name (not in .env)"
    return 0
  fi
  if [[ -z "$value" || "$value" == "your-mongike-api-key" ]]; then
    echo "skip $name (empty/placeholder)"
    return 0
  fi
  printf '%s' "$value" | npx firebase-tools functions:secrets:set "$name" --project "$PROJECT" --data-file - --force
  echo "✓ $name"
}

echo "==> Push Firebase secrets from backend/.env"
push_secret MONGIKE_API_KEY
push_secret GOOGLE_SERVER_API_KEY
# Mambo SMS OTP (also copied into .env.<project> by prepare-firebase-env.sh)
push_secret MAMBO_SMS_API_TOKEN
push_secret MAMBO_SMS_SENDER_ID
echo "Done."
