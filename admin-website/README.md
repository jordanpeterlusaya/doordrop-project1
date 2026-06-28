# DoorDrop Admin Website

This folder contains a standalone admin website that is separate from the Expo app.

## What it does

- Opens with a Firebase Auth admin email/password gate
- Reads live `orders`, `drivers`, and `users` collections from Firestore
- Provides a sidebar-driven admin workspace:
  - `Dashboard` for high-level operating KPIs
  - `Orders` for the live order queue and manual order creation
  - `Live Dispatch` for driver assignment and route context
  - `Services`, `Customers`, `Drivers`, `Finance`, `History`, `Data`, `Reports`, and `Settings` as focused pages
- Uses Google Maps for the live operations map
- Ranks available drivers fairly using vehicle fit, live GPS distance, rating, review history, recent workload, cancellation count, and idle time
- Automatically assigns fair best-match drivers when a waiting order is eligible
- Shows customer and driver history from orders, ratings, cancellations, assignments, and app activity
- Shows usage data for customer app screens and feature taps
- Updates delivery statuses
- Limits sidebar access to the approved admin email

## Run locally

1. Start a static server from the repo root:

   ```bash
   npm run admin:serve
   ```

2. Open `http://localhost:4173`

3. Sign in with the approved DoorDrop Firebase admin account.

## Hosted online

Firebase Hosting URL:

```text
https://efootball-app-9d175.web.app
```

This hosted admin website is served from Firebase Hosting, so it remains available even when your computer is off.

## Important Firebase setup

- Enable Email/Password in Firebase Authentication so Firestore requests run as the signed-in admin account
- Create or update the Firebase user `boyzeus11@gmail.com` in Firebase Authentication
- Add your deployed admin website domain in Firebase Authentication > Settings > Authorized domains
- Keep Firestore rules restricted so only trusted admin users can read and write operational collections

## Runtime config

- Keep real Firebase and Google Maps keys out of GitHub.
- For local/admin hosting config, copy `firebase-config.local.example.js` to `firebase-config.local.js` and fill real values there.
- `firebase-config.local.js` is ignored by Git.
- Enable `Maps JavaScript API` for the browser key in Google Cloud.
- Add `http://localhost:4173` and your deployed admin domain to the key's allowed HTTP referrers.
