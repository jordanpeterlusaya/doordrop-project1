#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> DoorDrop customer app — standalone APK prepare (no build)"
echo

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Missing $name. Set it in .env.local or .env."
  fi
}

load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

load_env "$ROOT/.env.local"
load_env "$ROOT/.env"

require_var EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
require_var EXPO_PUBLIC_API_BASE_URL
require_var EXPO_PUBLIC_FIREBASE_API_KEY
require_var EXPO_PUBLIC_FIREBASE_APP_ID
require_var EXPO_PUBLIC_CARGO_OFFER_WS_URL

# Standalone APK (no Expo Go / no Metro). Prefer public https/wss worldwide.
export DOORDROP_STANDALONE=1
if [[ "$EXPO_PUBLIC_API_BASE_URL" == http://* ]] || [[ "${EXPO_PUBLIC_CARGO_OFFER_WS_URL:-}" == ws://* ]]; then
  export DOORDROP_ALLOW_LAN_STANDALONE=1
  export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-standalone-lan}"
else
  export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-standalone}"
fi

echo "✓ Required EXPO_PUBLIC_* variables are set"
echo "✓ API: $EXPO_PUBLIC_API_BASE_URL"
echo "✓ Cargo WS: $EXPO_PUBLIC_CARGO_OFFER_WS_URL"
echo "✓ Parcel WS: ${EXPO_PUBLIC_PARCEL_OFFER_WS_URL:-'(unset)'}"
echo "✓ Profile: $EAS_BUILD_PROFILE (LAN allow=${DOORDROP_ALLOW_LAN_STANDALONE:-0})"
echo

echo "==> Typecheck"
if npx tsc --noEmit; then
  echo "✓ TypeScript OK"
else
  echo "⚠ TypeScript reported errors — continuing standalone prepare (release bundle still embeds JS)"
fi
echo

echo "==> Regenerate android/ from app.config.js (standalone, no dev client)"
EXPO_NO_WEB=1 DOORDROP_STANDALONE=1 DOORDROP_ALLOW_LAN_STANDALONE="${DOORDROP_ALLOW_LAN_STANDALONE:-0}" \
  EAS_BUILD_PROFILE="$EAS_BUILD_PROFILE" \
  npx expo prebuild --platform android --clean
echo "✓ prebuild complete"
echo

echo "==> Post-prebuild checks"
grep -q "exp+doordrop" android/app/src/main/AndroidManifest.xml \
  && fail "Dev-client scheme exp+doordrop still present — standalone manifest not clean" \
  || echo "✓ No exp+doordrop dev scheme in manifest"
grep -q "com.google.android.geo.API_KEY" android/app/src/main/AndroidManifest.xml \
  || fail "Google Maps API key meta-data missing from AndroidManifest"
echo "✓ Google Maps meta-data present"
if [[ "${DOORDROP_ALLOW_LAN_STANDALONE:-0}" == "1" ]]; then
  if grep -q 'android:usesCleartextTraffic="true"' android/app/src/main/AndroidManifest.xml; then
    echo "✓ Cleartext enabled (required for LAN http/ws)"
  else
    fail "usesCleartextTraffic is not true — LAN WebSockets will fail on device"
  fi
else
  echo "✓ Public https/wss — cleartext not required"
fi
echo

if [[ -f android/keystore.properties ]]; then
  echo "✓ Release keystore.properties found"
else
  echo "⚠ android/keystore.properties not found — release build uses debug keystore (testing only)"
  echo "  Copy android/keystore.properties.example after prebuild."
fi
echo

echo "Ready to build:"
echo "  Local:  npm run build:apk:local"
echo "  EAS:    npm run build:apk:eas"
echo
echo "Install:"
echo "  adb install -r android/app/build/outputs/apk/release/app-release.apk"
