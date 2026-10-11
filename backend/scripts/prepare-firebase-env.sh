#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PROJECT="${FIREBASE_PROJECT:-efootball-app-9d175}"
OUT_FILE="$ROOT/.env.${PROJECT}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

{
  grep -E '^(MONGIKE_API_KEY|GOOGLE_SERVER_API_KEY|MONGIKE_WEBHOOK_URL|GOOGLE_PLACES_API_KEY|GOOGLE_ROUTES_API_KEY|SMS_PROVIDER|MAMBO_SMS_API_TOKEN|MAMBO_SENDER_ID|MAMBO_SMS_SENDER_ID|MAMBO_SMS_BASE_URL|MAMBO_SMS_MOBILE_FORMAT|CARRIER_OTP_BYPASS_ENABLED|OTP_BYPASS_ENABLED|SMS_API_KEY|SMS_API_SECRET|SMS_API_USERNAME|SMS_SENDER_ID|SMS_API_URL|SMS_WEBHOOK_URL|SMS_WEBHOOK_TOKEN)=' "$ENV_FILE" || true
} > "$OUT_FILE"

# Never ship emulator OTP bypass to production Functions env.
if grep -q '^SMS_OTP_ALLOW_DEV=' "$OUT_FILE" 2>/dev/null; then
  sed -i '/^SMS_OTP_ALLOW_DEV=/d' "$OUT_FILE"
fi

# Prefer CARRIER_OTP_BYPASS_ENABLED; map OTP_BYPASS_ENABLED alias if present.
if ! grep -q '^CARRIER_OTP_BYPASS_ENABLED=' "$OUT_FILE" 2>/dev/null; then
  if grep -q '^OTP_BYPASS_ENABLED=' "$OUT_FILE" 2>/dev/null; then
    alias_val="$(grep '^OTP_BYPASS_ENABLED=' "$OUT_FILE" | head -1 | cut -d= -f2-)"
    echo "CARRIER_OTP_BYPASS_ENABLED=${alias_val}" >> "$OUT_FILE"
  fi
fi
if grep -q '^OTP_BYPASS_ENABLED=' "$OUT_FILE" 2>/dev/null; then
  sed -i '/^OTP_BYPASS_ENABLED=/d' "$OUT_FILE"
fi

if ! grep -q '^MONGIKE_API_KEY=.' "$OUT_FILE"; then
  echo "ERROR: MONGIKE_API_KEY missing in $ENV_FILE" >&2
  exit 1
fi

echo "✓ Wrote deploy env: $OUT_FILE"
wc -l "$OUT_FILE"
