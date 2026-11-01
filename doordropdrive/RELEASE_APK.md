# DoorDrive — Standalone APK checklist

## Build imekamilika ✓

**APK ya mwisho (standalone, signed):**
- Build ID: `d3bdb995-b2e2-434c-8afa-96fa6cd762d3`
- Version: **1.0.0 (4)**
- Package: `com.doordrive.app`
- Install link: https://expo.dev/accounts/jordanpeter/projects/doordrive/builds/d3bdb995-b2e2-434c-8afa-96fa6cd762d3
- Direct download: https://expo.dev/artifacts/eas/jJvReJF8-BZ-kGw6IC_PFSnTTTjCXiFtP8c0qLiYpjc.apk

APK imepakuliwa kwenye: `dist/DoorDrive-standalone-v1.0.0-build4.apk`

## 1. Environment variables (required)

Copy `doordropdrive/.env.example` → `../.env.local` (or `doordropdrive/.env`) and fill in:

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps on Android (build fails without it) |
| `EXPO_PUBLIC_API_BASE_URL` | Production backend (`https://…cloudfunctions.net/api`) |
| `EXPO_PUBLIC_FIREBASE_*` | Auth + Firestore |

For **EAS cloud builds**, also add the same keys as [EAS secrets](https://docs.expo.dev/build-reference/variables/).

## 2. Prepare native project (no APK yet)

```bash
cd doordropdrive
npm install
npm run prepare:apk
```

This script:
- Verifies env + TypeScript
- Confirms `incoming-alert` native module is linked
- Runs `expo prebuild --clean` for Android
- Checks manifest (no `exp+doordrive` dev scheme, alert sound present)

## 3. Release signing (recommended)

```bash
# Once — create keystore (store password safely!)
keytool -genkeypair -v -storetype PKCS12 \
  -keystore doordropdrive/android/doordrive-release.keystore \
  -alias doordrive -keyalg RSA -keysize 2048 -validity 10000

cp doordropdrive/android/keystore.properties.example doordropdrive/android/keystore.properties
# Edit keystore.properties with real passwords
```

Without `keystore.properties`, release APK is signed with the **debug** keystore (installable for testing only).

## 4. Build APK (when ready)

**Local Gradle:**
```bash
cd doordropdrive
npm run build:apk:local
# Output: android/app/build/outputs/apk/release/app-release.apk
```

**EAS cloud:**
```bash
cd doordropdrive
eas build --platform android --profile standalone
```

## 5. Install on phone

```bash
adb uninstall com.doordrive.app   # remove old dev-client build first
adb install -r doordropdrive/android/app/build/outputs/apk/release/app-release.apk
```

## 6. What’s already configured

- **Standalone profile** in `eas.json` → APK, production env, auto version bump
- **`app.config.js`** → Maps key injection, API URL baked into `extra`, standalone plugin
- **`plugins/withStandaloneRelease.js`** → strips dev-client deep links
- **`incoming-alert`** native module → order alarm foreground service
- **`incoming_order_alarm.wav`** in `android/app/src/main/res/raw/`
- **Hermes** + JS bundle embedded at build (`export:embed` in Gradle)
- **No Metro required** on phone after install
- **`expo-dev-client`** moved to devDependencies (dev builds only)
- **`expo-linear-gradient`** removed (was crashing — not in native build)

## 7. Backend must be live

Standalone APK talks to:
- API: `https://us-central1-efootball-app-9d175.cloudfunctions.net/api`
- Cargo WS: `wss://haul-cargo-offer-ws-729242246964.us-central1.run.app`
- Parcel WS: `wss://haul-parcel-offer-ws-729242246964.us-central1.run.app`

Redeploy WebSockets: `bash ../backend/scripts/deploy-offer-ws.sh`

Ensure Firebase Functions + Firestore rules + Cloud Run WS services are live before distributing the APK.

## 8. Version bumps

Update both before each store/release:
- `app.json` → `expo.android.versionCode`
- `android/app/build.gradle` → `versionCode` (synced via prebuild, or set manually)

Current: **1.0.0 (5)**
