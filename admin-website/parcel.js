import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import { doc, getDoc, getFirestore } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const STATUS_LABELS = {
  awaiting_dispatch: 'Awaiting office dispatch',
  first_mile_assigned: 'Driver collecting to office',
  awaiting_hub_intake: 'At office — awaiting intake',
  received_at_hub: 'Received at DoorDrop office',
  in_transit_carrier: 'In transit (bus / air)',
  arrived_destination: 'Arrived at destination',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
};

function params() {
  return new URLSearchParams(window.location.search);
}

function safe(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function transportMeta(mode, handoff) {
  const m = String(mode || '').toLowerCase();
  const h = String(handoff || '').toLowerCase();
  if (m === 'express' || h === 'airport') {
    return { icon: '✈️', label: h === 'home' ? 'Air · home delivery' : 'Air · airport handoff' };
  }
  if (h === 'home') {
    return { icon: '🏠', label: 'Bus · home delivery' };
  }
  return { icon: '🚌', label: 'Bus · stand handoff' };
}

function parseEmbeddedSummary(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

function renderParcel(data) {
  const root = document.getElementById('root');
  const code = safe(data.parcelCode || data.c, '—');
  const origin = safe(data.originCity || data.origin, 'Origin');
  const dest = safe(data.destinationCity || data.dest, 'Destination');
  const transport = transportMeta(data.shippingMode || data.mode, data.handoffMode || data.handoff);
  const status = safe(data.logisticsStatus || data.status, 'awaiting_dispatch');
  const statusLabel = STATUS_LABELS[status] || status.replace(/_/g, ' ');

  root.innerHTML = `
    <div class="brand">
      <img src="./assets/doordrop.png" alt="DoorDrop" />
      <strong>DoorDrop parcel</strong>
    </div>
    <h1>Parcel label</h1>
    <p class="code">${code}</p>
    <div class="pill">${statusLabel}</div>
    <div class="route">
      <div>
        <span class="muted">From</span>
        <strong style="display:block">${origin}</strong>
      </div>
      <div class="arrow">→</div>
      <div>
        <span class="muted">To</span>
        <strong style="display:block">${dest}</strong>
      </div>
    </div>
    <div class="transport"><div class="icon">${transport.icon}</div><div>${transport.label}</div></div>
    <div class="row"><span>Order</span><strong>${safe(data.orderNumber || data.on)}</strong></div>
    <div class="row"><span>Destination detail</span><strong>${safe(data.destinationStand || data.stand || data.outsideDestinationLabel)}</strong></div>
    <div class="row"><span>Weight</span><strong>${safe(data.weightKg || data.weight)} kg</strong></div>
    <div class="row"><span>Recipient</span><strong>${safe(data.recipientName || data.recipient)}</strong></div>
    <div class="row"><span>Recipient phone</span><strong>${safe(data.recipientPhoneMasked || data.phone)}</strong></div>
    <div class="row"><span>Fare</span><strong>${safe(data.fareLabel || data.fare)}</strong></div>
    <p class="footer">Show this label at DoorDrop office handoff and when the recipient collects the parcel. Keep the QR private.</p>
  `;
}

async function load() {
  const query = params();
  const code = safe(query.get('c'), '');
  const orderId = safe(query.get('id'), '');
  const embedded = parseEmbeddedSummary(query.get('d'));
  const root = document.getElementById('root');

  if (embedded && (embedded.c || embedded.parcelCode)) {
    renderParcel(embedded);
  }

  if (!code && !orderId) {
    if (!embedded) {
      root.innerHTML = `<p class="error">Parcel code missing. Ask DoorDrop office to rescan the label.</p>`;
    }
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    if (code) {
      const snap = await getDoc(doc(db, 'publicParcels', code));
      if (snap.exists()) {
        renderParcel({ ...snap.data(), parcelCode: code });
        return;
      }
    }
    if (orderId) {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        const order = orderSnap.data();
        renderParcel({
          parcelCode: order.parcelCode || code,
          orderNumber: order.orderNumber,
          originCity: order.outsideOriginCity,
          destinationCity: order.outsideDestinationCity,
          destinationStand: order.outsideDestinationStand || order.outsideDestinationLabel,
          shippingMode: order.outsideShippingMode,
          handoffMode: order.outsideHandoffMode,
          weightKg: order.outsideParcelWeightKg,
          recipientName: order.recipientName,
          recipientPhoneMasked: order.recipientPhone,
          fareLabel: order.totalLabel || order.fareLabel,
          logisticsStatus: order.logisticsStatus,
        });
        return;
      }
    }
    if (!embedded) {
      root.innerHTML = `<p class="error">Parcel ${code || orderId} was not found.</p>`;
    }
  } catch (error) {
    if (!embedded) {
      root.innerHTML = `<p class="error">Could not load parcel details. ${error?.message || ''}</p>
        <p class="footer">Code: <strong>${code || '—'}</strong></p>`;
    }
  }
}

load();
