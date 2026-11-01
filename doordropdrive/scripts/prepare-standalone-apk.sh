#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> DoorDrive standalone APK — prepare only (no build)"
echo

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Missing $name. Set it in ../.env.local, doordropdrive/.env, or export it in your shell."
  fi
}

# Load env files without overwriting existing shell exports.
load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

load_env "$ROOT/../.env.local"
load_env "$ROOT/../.env"
load_env "$ROOT/.env.local"
load_env "$ROOT/.env"

require_var EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
require_var EXPO_PUBLIC_API_BASE_URL
require_var EXPO_PUBLIC_FIREBASE_API_KEY
require_var EXPO_PUBLIC_FIREBASE_APP_ID
require_var EXPO_PUBLIC_CARGO_OFFER_WS_URL

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
echo "✓ Profile: $EAS_BUILD_PROFILE (LAN allow=${DOORDROP_ALLOW_LAN_STANDALONE:-0})"
echo

echo "==> Typecheck"
if npx tsc --noEmit; then
  echo "✓ TypeScript OK"
else
  echo "⚠ TypeScript reported errors — continuing standalone prepare (release bundle still embeds JS)"
fi
echo

echo "==> Verify native modules (incoming-alert, expo modules)"
npx expo-modules-autolinking resolve --platform android | grep -q incoming-alert \
  || fail "incoming-alert native module is not autolinked"
echo "✓ incoming-alert autolinked"
echo

echo "==> Regenerate android/ from app.config.js (standalone, no dev client)"
EXPO_NO_WEB=1 DOORDROP_STANDALONE=1 DOORDROP_ALLOW_LAN_STANDALONE="${DOORDROP_ALLOW_LAN_STANDALONE:-0}" \
  EAS_BUILD_PROFILE="$EAS_BUILD_PROFILE" \
  npx expo prebuild --platform android --clean
echo "✓ prebuild complete"
echo

echo "==> Post-prebuild checks"
grep -q "IncomingAlertService" android/app/src/main/AndroidManifest.xml \
  || fail "IncomingAlertService missing from AndroidManifest after prebuild"
test -f android/app/src/main/res/raw/incoming_order_alarm.wav \
  || fail "incoming_order_alarm.wav missing from android/app/src/main/res/raw/"
grep -q "exp+doordrive" android/app/src/main/AndroidManifest.xml \
  && fail "Dev-client scheme exp+doordrive still present — standalone manifest not clean" \
  || echo "✓ No exp+doordrive dev scheme in manifest"
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
  echo "✓ Release keystore.properties found (release APK can be signed)"
else
  echo "⚠ android/keystore.properties not found — release build will use debug keystore"
  echo "  Copy android/keystore.properties.example and add your release keystore."
fi
echo

echo "Ready to build (when you choose):"
echo "  Local:  cd android && ./gradlew assembleRelease"
echo "  EAS:    eas build --platform android --profile standalone-lan"
echo
echo "Install on phone:"
echo "  adb install -r android/app/build/outputs/apk/release/app-release.apk"
