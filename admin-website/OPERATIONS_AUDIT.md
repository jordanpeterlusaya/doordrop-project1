# DoorDrop Admin — Operations Overhaul Audit

**Date:** 2026-09-02  
**Scope:** Order operations & workflow control (local + inter-region)  
**Rule:** Preserve working features. Extend architecture — do not replace blindly.

---

## 1. Executive summary

The admin already runs **city deliveries** and **inter-region parcels** on one Firestore `orders` collection, but they use **different status models** and **unequal operational depth**. Inter-region work lives mainly on **Other Regions Parcels**; the dashboard and **Orders** page largely ignore it. There is **no SLA engine**, **no attention queue**, **no per-stage expected vs actual times**, and **no immutable audit trail for city orders**.

This audit maps your 32-point spec to the current codebase and defines the architecture changes required.

---

## 2. Current order structure

**Type definition:** `lib/delivery-data.ts` → `DeliveryOrder`  
**Collection:** `orders`  
**Admin reader:** `admin-website/app.js` (live snapshots, caps 80–120 docs)

### Shared fields (all orders)

| Area | Fields |
|------|--------|
| Identity | `id`, `orderNumber`, `userId`, `customerName`, `customerPhone`, `customerEmail` |
| Route | `pickupLabel`, `dropoffLabel`, lat/lng pairs, `routeLabel`, `distanceMeters`, `durationSeconds` |
| Pricing | `fareLabel`, `totalLabel`, `etaLabel` |
| Driver | `driverId`, `driverName`, `driverPhone`, `driverVehicleType/Label`, live GPS fields |
| Lifecycle | `status`, `createdAt`, `updatedAt`, `deliveredAt`, `cancelledAt`, `cancellationReason` |
| Assignment | `assignmentMode`, `assignedAt`, `driverSearchStatus`, `autoCancelledAt` |

### Inter-region only (`parcelScope: 'outside'`)

| Field | Purpose |
|-------|---------|
| `outsideOriginCity`, `outsideDestinationCity/Label/Stand` | Regions |
| `outsideShippingMode` | `standard` (bus) / `express` (air) |
| `outsideHandoffMode` | `bus`, `airport`, `home` |
| `parcelCode`, `trackingId` | Public tracking |
| **`logisticsStatus`** | **Primary inter-region stage** |
| **`logisticsEvents[]`** | `{ status, note, by, at }` — only structured audit today |
| `carrierRef`, `departedAt` | Transport handover |
| `outsideExpress*` | Flight booking metadata |
| `firstMileCompletedAt` | Set by driver app (not on TS type) |

**Discrimination:** `lib/outside-order-logistics.ts` → `isOutsideParcelOrder()`  
Also duplicated in `admin-website/app.js`.

---

## 3. Current statuses

### LOCAL (`status` field)

```
pending_assignment → driver_assigned → driver_at_pickup → in_transit → at_hub → delivered
                                                                              ↘ cancelled
```

Admin: `STATUS_FLOW`, `DELIVERY_STATUS_LABELS` in `app.js`.

### INTER-REGION (`logisticsStatus` field)

| Current status | Admin label |
|----------------|-------------|
| `awaiting_dispatch` | Awaiting dispatch |
| `first_mile_assigned` | Driver collecting |
| `awaiting_hub_intake` | Awaiting hub intake |
| `received_at_hub` | Received at hub |
| `in_transit_carrier` | In transit (carrier) |
| `arrived_destination` | Arrived destination |
| `out_for_delivery` | Out for delivery |
| `completed` | Completed |

**Gap vs your spec:** No explicit `order_confirmed`, `pickup_pending`, `dispatch_preparation`, `handed_to_transport`, `destination_hub`, `failed`, `return_*` states. These can be mapped or added as sub-stages without breaking existing apps.

### Dual-status problem

City `status` and `logisticsStatus` **coexist** on outside orders (e.g. `status: at_hub` while `logisticsStatus: awaiting_hub_intake`). Analytics and the order drawer show **city timeline only** — misleading for inter-region.

---

## 4. Timestamps today

| Field | When |
|-------|------|
| `createdAt` | Order created |
| `updatedAt` | Any change |
| `assignedAt`, `acceptedByDriverAt` | Assignment |
| `outsidePickupAt`, `outsideEtaDeadlineAt` | Outside ETA |
| `firstMileCompletedAt` | Driver completes first mile |
| `departedAt` | Admin marks carrier depart |
| `deliveredAt`, `cancelledAt` | Terminal |

**Missing:** Per-stage `startedAt`, `expectedAt`, `completedAt`, `completedBy`, `delayMs`, `responsibleTeam`.  
**Missing:** `statusHistory` / `opsActivityLog` for city orders.  
**Partial:** `logisticsEvents[]` append-only for outside only.

---

## 5. Firebase collections in use

| Collection | Role |
|------------|------|
| `orders` | All deliveries |
| `publicParcels/{code}` | QR / public track mirror |
| `outsideDestinationCities` | Region catalog |
| `outsideExpressRoutes` | Flight schedules |
| `appConfig/outsideParcel` | Global express toggle |
| `userNotifications` | Customer push (city `status` only) |
| `drivers`, `users` | Fleet & customers |
| `driverPayments` | Driver access USSD (not order payment) |

**Not present:** `orderEvents`, `opsAlerts`, `hubs`, `slaPolicies`, `transportShipments`.

**Backend:** `backend/server.js` has **no order APIs** — all transitions are client-side Firestore writes.

---

## 6. Admin pages today

| Page | Purpose | Inter-region? |
|------|---------|---------------|
| Dashboard | KPIs, city priority | ❌ Outside ignored in action required |
| Orders | City queue | ❌ Excludes outside |
| Other Regions Parcels | Full outside ops desk | ✅ |
| Dispatch | Auto-assign city | ❌ |
| Drivers, Customers, Finance… | Support | Partial |

**Existing outside ops (good — keep):** assign driver, hub intake, depart, arrive, out-for-delivery, complete, QR, training export (`getOutsideNextAction`, `appendOutsideLogistics`).

---

## 7. Payments, notifications, tracking

| Area | State |
|------|-------|
| Customer order payment | Not in `DeliveryOrder`; optional display fields only |
| Driver subscription | Mongike USSD via backend ✅ |
| Customer notifications | City `status` changes only |
| Outside notifications | **None** on logistics transitions |
| Tracking | Customer app + `parcel.html`; admin schematic map |

---

## 8. Spec gap analysis (your 32 points)

| # | Requirement | Current | Action |
|---|-------------|---------|--------|
| 1 | Audit first | — | This document |
| 2 | Two delivery types | Implicit | `deliveryType: local \| inter_region` derived + UI labels |
| 3 | Inter-region lifecycle | 8 statuses | Extend map to 14-stage ops model; alias existing |
| 4 | Stage timestamps | Partial events | Add `opsStageRecords` on order doc |
| 5 | Expected vs actual | ❌ | SLA config + `expectedAt` per stage |
| 6 | Attention engine | ❌ | `ops-workflow.js` → `analyzeOpsAttention()` |
| 7 | Priority levels | ❌ | critical / high / medium / normal |
| 8 | Next action | Partial (`getOutsideNextAction`) | Unified `getNextOpsAction()` + buttons |
| 9 | Manual status + reason | Partial (city status buttons) | Modal: reason, note, admin, audit log |
| 10 | Immutable history | Outside events only | `opsActivityLog[]` append-only |
| 11 | Dedicated timeline page | ❌ | `orderTimeline` page |
| 12 | Individual action pages | ❌ | Ops queue pages per stage |
| 13 | Action-centered pages | Partial (otherRegions) | `renderOpsQueuePage()` |
| 14 | Transport management | Partial (depart + carrierRef) | `transportDesk` page |
| 15 | Transport delay | ❌ | Delay detection from `expectedAt` |
| 16 | Order ETA | Partial (`outsideEtaDeadlineAt`) | Show only when data exists |
| 17 | Configurable SLA | ❌ | `settings.opsSla` + `appConfig/opsWorkflow` |
| 18 | Overdue page | ❌ | `overdue` page |
| 19 | My Attention page | ❌ | `myAttention` page |
| 20 | Simple order detail | Drawer overloaded | Slim ops card + links |
| 21 | Activity page | ❌ | `orderActivity` from `opsActivityLog` |
| 22 | Action-based dashboard | KPI-heavy | Attention → Pipeline → Delayed |
| 23 | Focused action UIs | In modal | Keep + add quick-action sheets |
| 24 | Bulk operations | ❌ | Phase 2 (origin hub) |
| 25 | Filters | Partial | Persist `state.opsFilter` |
| 26 | Regional view | ❌ | `opsRegions` page |
| 27 | Configurable workflow | ❌ | `ops-workflow.js` + Firestore config |
| 28 | Delay notifications | ❌ | Phase 2 (Cloud Function) |
| 29 | Color system | Partial | Standardize priority colors |
| 30 | One page = one purpose | Violated | New nav section **Operations** |
| 31 | Professional UX | In progress | This overhaul |
| 32 | Acceptance test | — | QA checklist at end of Phase 4 |

---

## 9. Recommended architecture (safe migration)

### Phase A — Foundation (started)

1. **`admin-website/ops-workflow.js`** — Pure workflow engine (no Firestore):
   - Delivery type detection
   - Stage definitions + SLA defaults
   - Attention analysis, pipeline counts, delays, timeline builder
   - Next-action resolver

2. **New order fields** (written on transitions, backward compatible):

```js
opsStageRecords: {
  received_at_hub: {
    startedAt: 'ISO-8601',
    expectedAt: 'ISO-8601',
    completedAt: 'ISO-8601',
    completedBy: 'admin@email',
    responsibleTeam: 'Operations',
    notes: ''
  }
},
opsActivityLog: [
  { type: 'status_change', from, to, by, at, reason, note, deliveryType }
],
deliveryType: 'local' | 'inter_region'  // optional cache
```

3. **Enhance `appendOutsideLogistics()`** — populate `opsStageRecords` + `opsActivityLog`.

4. **Enhance `updateOrderStatus()`** — same for local orders.

### Phase B — Admin UX (in progress)

- Nav section **Operations**: My Attention, Overdue, stage queues, Timeline, Transport
- Dashboard: Attention → Pipeline → Delayed (not 20 KPIs first)
- Manual status modal with required reason
- Dedicated timeline page

### Phase C — Data & scale

- Dedicated Firestore query: `where('logisticsStatus', 'in', [...])` (raise caps)
- `orderEvents/{orderId}/events` subcollection for heavy audit
- Cloud Function: validate transitions, delay alerts, customer notifications

### Phase D — Config & automation

- `appConfig/opsWorkflow` — SLA minutes, teams, notification rules
- Bulk hub actions, return workflow, merchant settlements

---

## 10. Status mapping (existing → ops model)

| Your spec stage | Maps to current `logisticsStatus` |
|-----------------|-----------------------------------|
| Order created | (implicit at create) |
| Order confirmed | `awaiting_dispatch` (add confirm action) |
| Pickup pending | `awaiting_dispatch` |
| Picked up | `first_mile_assigned` |
| At origin hub | `awaiting_hub_intake` / `received_at_hub` |
| Dispatch preparation | `received_at_hub` |
| Handed to transport | `in_transit_carrier` + `departedAt` |
| In transit | `in_transit_carrier` |
| Arrived destination region | `arrived_destination` |
| Destination hub | `arrived_destination` |
| Out for local delivery | `out_for_delivery` |
| Delivered | `completed` + `status: delivered` |

---

## 11. Files to change

| File | Role |
|------|------|
| `admin-website/ops-workflow.js` | **NEW** — workflow engine |
| `admin-website/app.js` | Integrate engine, pages, audit writes |
| `admin-website/index.html` | Operations nav, CSS |
| `lib/outside-order-logistics.ts` | Optional: export stage helpers for mobile |
| `lib/delivery-data.ts` | Optional: type extensions |
| `backend/server.js` | Phase C: order transition API |

---

## 12. What we are NOT removing

- Other Regions Parcels desk (enhance, don't delete)
- City Orders + Dispatch + auto-assign
- Driver verification, payments, air transport config
- QR labels, public parcel page, training export

---

## 13. Acceptance test checklist (Phase 4)

Simulate Dar → Arusha order through all stages; verify at each step:

- [ ] Timestamp recorded
- [ ] Expected vs actual shown
- [ ] Delay flagged when late
- [ ] Next action correct
- [ ] Attention priority correct
- [ ] Activity log immutable entry
- [ ] Manual override requires reason

Edge cases: rider rejection, transport delay, cancel, return, payment fail, duplicate action.

---

*Next: Phase A+B implementation in `ops-workflow.js` + admin Operations section.*
