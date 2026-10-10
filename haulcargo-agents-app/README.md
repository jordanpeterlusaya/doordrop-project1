# Haul Cargo Agents

React Native (Expo) app for bus/cargo companies to receive and manage HAUL parcel orders. Connects to the same Firebase project as the DoorDrop customer app (`efootball-app-9d175`).

## Run

```bash
cd haulcargo-agents-app
cp .env.example .env.local   # optional: override Firebase / Maps keys
npm install
npx expo start
```

Use Expo Go or a dev client on device. Android package: `com.haulcargo.agents`.

## Features (MVP)

- Landing, login, register (company + first route), forgot password, session persistence
- Live `carrierShipments` inbox — accept/reject offers (5 min), pickup mode
- Home one-job desk, orders, manifest, finances (commission lock), settings, schedule, history
- Order detail, live map/directions to pickup, printable receipt PDF share
- Admin verification screen for `boyzeus11@gmail.com`

## Data

Firestore collections: `carriers`, `carrierMembers`, `carrierRoutes`, `carrierShipments`, `orders` (read via shipments mirror fields).
