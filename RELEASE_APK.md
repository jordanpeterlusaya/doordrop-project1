# DoorDrop Customer App — Standalone APK

## Build imekamilika ✓

**APK ya mwisho (standalone, signed):**
- Build ID: `b0b53f0c-a90c-44e5-9082-faaed394db95`
- Version: **1.0.0 (5)**
- Package: `com.doordrop.mobile`
- Install link: https://expo.dev/accounts/jordanpeter/projects/DoorDrop/builds/b0b53f0c-a90c-44e5-9082-faaed394db95

APK imepakuliwa kwenye: `dist/DoorDrop-standalone-v1.0.0-build5.apk`

## Simu — install

```bash
# Pakua APK kutoka link hapo juu, au:
adb install -r dist/*.apk
```

Ondoa dev-client ya zamani kwanza ikiwa ipo:
```bash
adb uninstall com.doordrop.mobile
```

## Build tena baadaye

```bash
# 1. Hakikisha .env ina EXPO_PUBLIC_* keys
npm run build:apk:eas
```

Au local (inahitaji Android SDK):
```bash
npm run prepare:apk
npm run build:apk:local
# → android/app/build/outputs/apk/release/app-release.apk
```

## Env inayohitajika (.env)

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Ramani |
| `EXPO_PUBLIC_API_BASE_URL` | Backend |
| `EXPO_PUBLIC_FIREBASE_*` | Auth + Firestore |

## Kumbuka

- **Hii ni standalone** — hakuna Metro/dev-client; app inafunguka peke yake.
- `google-services.json` bado ina package `com.trustika.doordrop` — push notifications za native FCM hazijasanidi hadi file ifanane na `com.doordrop.mobile`.
- Backend API: `https://us-central1-efootball-app-9d175.cloudfunctions.net/api`
- WebSockets (Cloud Run, dunia nzima):
  - Cargo: `wss://haul-cargo-offer-ws-729242246964.us-central1.run.app`
  - Parcel: `wss://haul-parcel-offer-ws-729242246964.us-central1.run.app`
  - Redeploy: `bash backend/scripts/deploy-offer-ws.sh`
