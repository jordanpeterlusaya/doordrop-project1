#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

ENV_FILE="$ROOT/../.env"
[[ -f "$ROOT/../.env.local" ]] && ENV_FILE="$ROOT/../.env.local"
[[ -f "$ROOT/.env" ]] && ENV_FILE="$ROOT/.env"

[[ -f "$ENV_FILE" ]] || fail "Missing .env with EXPO_PUBLIC_* keys"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[[ -n "${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:-}" ]] || fail "Missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
[[ -n "${EXPO_PUBLIC_API_BASE_URL:-}" ]] || fail "Missing EXPO_PUBLIC_API_BASE_URL"

echo "==> Push env to EAS production (DoorDrive)"
eas env:push production --path "$ENV_FILE" --force

echo
echo "==> EAS cloud build — DoorDrive standalone APK"
EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform android --profile standalone --non-interactive --wait
