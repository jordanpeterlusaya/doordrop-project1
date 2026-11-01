# DoorDrop Admin — Phase 1 Audit

**Date:** 2026-09-02  
**App:** `admin-website/` → https://efootball-app-9d175.web.app/  
**Rule:** Preserve working functionality. Improve, reorganize, connect — do not duplicate or fake data.

## Executive summary

The admin is a **single-page Firestore-backed operations console** (`index.html` + `app.js`, ~7.5k lines). It already handles orders, dispatch, drivers, intercity parcels, air transport, finance snapshots, subscriptions review, and analytics.

**Blockers for production reliability:**
1. **Firebase billing disabled** on project `efootball-app-9d175` — Cloud Functions API returns 503 (affects driver payments, not admin Firestore reads directly).
2. **Auto-dispatch runs only while admin browser tab is open** — misleading "Cloud auto-dispatch On" in settings.
3. **Query caps** (80–120 docs) truncate busy-day history.
4. **Single hardcoded admin email** in client code.

## Feature classification

| Status | Examples |
|--------|----------|
| **WORKING** | Auth, order sync, dispatch assign, driver verify, outside parcels, air transport, history/data analytics |
| **PARTIAL** | Auto-dispatch (client-only), schematic map (not Google Maps), finance estimates, customers (list only), subscriptions (fee=0), payment USSD read |
| **BROKEN** | Local dev without `firebase-config.local.js`; static "Online" sidebar badge |
| **MISSING** | Live tracking map, failed-delivery workflow, merchant settlements, rider payouts, RBAC, customer detail, global search, activity audit log |

## Navigation (current → target)

| Current | Target phase |
|---------|----------------|
| Dashboard | Overview → **Operational control center** |
| Orders | Operations → Orders (filters + command center drawer) |
| Dispatch | Operations → **Dispatch Center** |
| Drivers | Network → Riders |
| Customers | Network → Customers (+ profiles) |
| Finance / Subscriptions | Finance → Payments & rider access |
| History / Data | Analytics + **Activity log** |
| Settings | System → Settings |

## Firestore collections in use

`orders`, `drivers`, `users`, `userNotifications`, `commissionPaymentReviews`, `driverPayments`, `drivers/{id}/commissionPayments`, `appActivityEvents`, `outsideDestinationCities`, `outsideExpressRoutes`, `appConfig/outsideParcel`, `publicParcels`

## Implementation phases (from spec)

1. ✅ **Audit** — this document  
2. 🔄 **Information architecture** — sidebar grouping, Action Required on dashboard (started)  
3. ⏳ **Order system** — lifecycle timeline, status audit trail  
4. ⏳ **Dispatch** — dedicated center improvements, recommendations  
5. ⏳ **Riders** — performance dashboard  
6. ⏳ **Tracking** — real map or honest schematic labeling  
7. ⏳ **Customers & merchants** — profiles linked to orders  
8. ⏳ **Finance** — real payment breakdown per order, rider earnings  
9. ⏳ **Analytics** — date ranges, ops + finance KPIs  
10. ⏳ **Audit & security** — activity log, roles  
11. ⏳ **UI polish** — consistent typography, responsive tables  
12. ⏳ **QA** — full order journey + failure scenarios  

## P0 actions (do first)

1. ✅ Enable **Google Cloud billing** for `efootball-app-9d175`.
2. ✅ Deploy backend `api` function with `MONGIKE_API_KEY` + `GOOGLE_SERVER_API_KEY`.
3. ✅ Fix admin **connection/sync indicator** (sidebar shows Live / Syncing / Payments offline).
4. Cloud auto-dispatch triggers deploy separately when Functions discovery is stable.

## Files

| File | Role |
|------|------|
| `app.js` | All admin logic |
| `index.html` | Shell, nav, inline CSS |
| `firebase-config.js` | Firebase + API URL config |

---

*Next: Phase 2 continues dashboard ops center, order drawer timeline, and dispatch filters without removing existing features.*
