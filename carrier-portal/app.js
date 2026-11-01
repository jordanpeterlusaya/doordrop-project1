import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

const ADMIN_EMAIL = 'boyzeus11@gmail.com';
/** Fallback only — prefer carrier deskStanding / streak tier. */
const HAUL_FEE_RATE = 0.12;
const OFFER_MS = 5 * 60 * 1000;
const TIER_FEE_RATES = [
  { minStreak: 500, feeRate: 0.06, feePercent: 6 },
  { minStreak: 250, feeRate: 0.08, feePercent: 8 },
  { minStreak: 100, feeRate: 0.1, feePercent: 10 },
  { minStreak: 0, feeRate: 0.12, feePercent: 12 },
];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const FLOW = ['new', 'matching', 'assigned', 'accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived', 'delivered'];
const NEXT_STATUS = {
  accepted: 'contacted',
  contacted: 'pickup_scheduled',
  pickup_scheduled: 'picked_up',
  picked_up: 'at_bus',
  at_bus: 'in_transit',
  in_transit: 'arrived',
  arrived: 'delivered',
};
const STATUS_LABEL = {
  new: 'Mpya',
  matching: 'Inatafutwa',
  assigned: 'Oda',
  accepted: 'Imekubaliwa',
  contacted: 'Uchukuzi',
  pickup_scheduled: 'Pickup imewekwa',
  picked_up: 'Imechukuliwa',
  at_bus: 'Imepakiwa',
  in_transit: 'Safarini',
  arrived: 'Imefika',
  delivered: 'Imewasili',
};
const TRACK = [
  { key: 'received', label: 'Imepokelewa', status: 'accepted' },
  { key: 'pickup', label: 'Uchukuzi', status: 'contacted' },
  { key: 'packed', label: 'Imepakiwa', status: 'at_bus' },
  { key: 'transit', label: 'Safarini', status: 'in_transit' },
  { key: 'arrived', label: 'Imefika', status: 'arrived' },
  { key: 'handed', label: 'Imewasili', status: 'delivered' },
];
const HISTORY_LABEL = {
  assigned: 'Oda imefika',
  accepted: 'Imekubaliwa',
  received: 'Imepokelewa',
  pickup: 'Uchukuzi',
  agent_collects: 'Wakala anachukua',
  haul_delivers_to_office: 'Kuleta ofisini',
  contacted: 'Uchukuzi',
  packed: 'Imepakiwa',
  at_bus: 'Imepakiwa',
  transit: 'Safarini',
  in_transit: 'Safarini',
  arrived: 'Imefika',
  handed: 'Imewasili',
  delivered: 'Imewasili',
  matching: 'Imekataliwa',
};

const runtime = globalThis.DOORDROP_ADMIN_CONFIG || {};
const firebaseOverrides = runtime.firebaseConfig || {};
const app = initializeApp({
  apiKey: firebaseOverrides.apiKey || runtime.firebaseApiKey || 'AIzaSyD97lPfGR0Yf0z-WfCl1L_rYH9HPlgE3s0',
  authDomain: firebaseOverrides.authDomain || 'efootball-app-9d175.firebaseapp.com',
  projectId: firebaseOverrides.projectId || 'efootball-app-9d175',
  storageBucket: firebaseOverrides.storageBucket || 'efootball-app-9d175.firebasestorage.app',
  messagingSenderId: firebaseOverrides.messagingSenderId || '729242246964',
  appId: firebaseOverrides.appId || '1:729242246964:web:bdb35a59a681a4a7420f61',
});
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  authReady: false,
  user: null,
  orderEnrichPending: Object.create(null),
  orderEnrichDone: Object.create(null),
  isAdmin: false,
  carrier: null,
  shipments: [],
  routes: [],
  vehicles: [],
  staff: [],
  notes: [],
  mode: 'login',
  needsCompanySetup: false,
  unsubscribers: [],
};

let countdownTimer = null;
let manifestScanStream = null;
let latraPollTimer = null;
const latraRouteHint = { text: '', fetchedAt: 0, loading: false };

function offerExpiresMs(item) {
  const raw = item?.offerExpiresAt;
  if (!raw) return 0;
  if (raw.toDate) return raw.toDate().getTime();
  if (typeof raw.seconds === 'number') return raw.seconds * 1000;
  if (raw instanceof Date) return raw.getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function refreshCountdownLabels() {
  document.querySelectorAll('[data-offer-until]').forEach((el) => {
    const until = Number(el.dataset.offerUntil);
    if (!until) return;
    const left = until - Date.now();
    const strong = el.querySelector('strong');
    if (strong) strong.textContent = formatCountdown(left);
    el.classList.toggle('urgent', left > 0 && left <= 60000);
    el.classList.toggle('expired', left <= 0);
  });
}

function startCountdownTicker() {
  refreshCountdownLabels();
  if (countdownTimer) return;
  countdownTimer = setInterval(refreshCountdownLabels, 1000);
}

function stopCountdownTicker() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function darTodayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
}

function darTodayLabel() {
  return new Intl.DateTimeFormat('sw-TZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date());
}

const $ = (id) => document.getElementById(id);

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function money(amount) {
  return `TZS ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}
function when(value) {
  const ms = value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
  if (!ms) return '—';
  return new Date(ms).toLocaleString('sw-TZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function stamp() {
  return new Date().toISOString();
}
function carrierFeeRate(carrier = state.carrier) {
  const standing = carrier?.deskStanding;
  const fromStanding = Number(standing?.feeRate);
  if (Number.isFinite(fromStanding) && fromStanding > 0) return fromStanding;
  const percent = Number(standing?.feePercent);
  if (Number.isFinite(percent) && percent > 0) return percent / 100;
  const streak = Math.max(0, Math.round(Number(carrier?.streak) || Number(carrier?.deliveries) || 0));
  const tier = TIER_FEE_RATES.find((row) => streak >= row.minStreak) || TIER_FEE_RATES[TIER_FEE_RATES.length - 1];
  return Number(tier?.feeRate) || HAUL_FEE_RATE;
}

function feeSplit(amount, rate = carrierFeeRate()) {
  const safe = Math.max(0, Math.round(Number(amount) || 0));
  const haulFee = Math.round(safe * (Number(rate) || HAUL_FEE_RATE));
  return { amount: safe, haulFee, carrierNet: Math.max(0, safe - haulFee), feeRate: Number(rate) || HAUL_FEE_RATE };
}

function photoUrls(item) {
  const raw = item?.parcelPhotoUrls;
  if (!Array.isArray(raw)) return [];
  return raw.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6);
}

function distanceLabelOf(item) {
  const labeled = String(item?.distanceLabel || '').trim();
  if (labeled) return labeled;
  const meters = Number(item?.distanceMeters);
  if (Number.isFinite(meters) && meters > 0) {
    if (meters >= 1000) {
      const km = meters / 1000;
      return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
    }
    return `${Math.round(meters)} m`;
  }
  const km = Number(item?.distanceKm);
  if (Number.isFinite(km) && km > 0) return `${km} km`;
  return '';
}

function isBusParcel(order) {
  if (!order || order.status === 'cancelled') return false;
  if (norm(order.flow) !== 'parcel') return false;
  const mode = norm(order.outsideShippingMode);
  if (['express', 'air', 'flight', 'ndege'].includes(mode)) return false;
  if (norm(order.parcelScope) === 'outside') return true;
  if (String(order.outsideDestinationCity || order.outsideDestinationLabel || '').trim()) return true;
  return ['road', 'bus', 'ferry'].includes(mode);
}
function weightOf(order) {
  const parsed = Number(String(order.outsideParcelWeightKg || order.weightKg || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function declaredValueOf(order) {
  const parsed = Number(String(order?.declaredValueTzs ?? order?.declaredValue ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
function phoneLine(phone) {
  const raw = String(phone || '').trim();
  if (!raw || /^not provided$/i.test(raw)) return '—';
  const dial = digits(raw);
  return dial ? `<a href="tel:${esc(dial)}">${esc(raw)}</a>` : esc(raw);
}
function trackLabel(step, mode) {
  if (!step) return '';
  if (step.key === 'pickup') return mode === 'haul_delivers_to_office' ? 'Kuleta ofisini' : 'Wakala anachukua';
  return step.label;
}
function trackIndex(item) {
  if (item?.trackStep) {
    const found = TRACK.findIndex((step) => step.key === item.trackStep);
    if (found >= 0) return found;
  }
  const status = item?.shipmentStatus;
  if (status === 'accepted') return 0;
  if (status === 'contacted' || status === 'pickup_scheduled') return item?.pickupMode ? 1 : 0;
  if (status === 'picked_up' || status === 'at_bus') return 2;
  if (status === 'in_transit') return 3;
  if (status === 'arrived') return 4;
  if (status === 'delivered') return 5;
  return -1;
}
function matchedRoute(item) {
  return state.routes.find((route) => route.id === item?.routeId) || null;
}
function orderFacts(item) {
  const route = matchedRoute(item);
  const value = declaredValueOf(item);
  const schedule = item.routeLabel || (route ? `${route.origin} → ${route.destination}` : '');
  const distance = distanceLabelOf(item);
  const size = String(item.outsideParcelSize || '').trim();
  return `${cargoPhotosBlock(item)}<dl class="facts">
    <div><dt>Uzito</dt><dd>${esc(item.weightKg || 0)} kg${item.parcelDescription ? ` · ${esc(item.parcelDescription)}` : ''}${size ? ` · ${esc(size)}` : ''}</dd></div>
    <div><dt>Umbali</dt><dd>${esc(distance || '—')}</dd></div>
    <div><dt>Marudio</dt><dd>${esc(item.destination || item.routeLabel || '—')}</dd></div>
    <div><dt>Mtumaji</dt><dd>${esc(item.customerName || '—')}</dd></div>
    <div><dt>Mpokeaji</dt><dd>${esc(item.recipientName || '—')}</dd></div>
    <div><dt>Simu mtumaji</dt><dd>${phoneLine(item.customerPhone)}</dd></div>
    <div><dt>Simu mpokeaji</dt><dd>${phoneLine(item.recipientPhone)}</dd></div>
    <div><dt>Thamani</dt><dd>${value ? esc(money(value)) : '—'}</dd></div>
    <div><dt>Safari</dt><dd>${esc(schedule || '—')}</dd></div>
  </dl>`;
}
function cashOf(order) {
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''} ${order.cashExpected || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (match) return Math.round(Number(match[1]));
  return Math.round(Number(order.customerOffer || 0));
}
function priceOf(item) {
  const n = Number(item?.cashExpected);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return cashOf(item);
}
function needsCompanyPrice(item) {
  const quote = String(item?.quoteStatus || '').trim();
  if (quote === 'awaiting_company') return true;
  if (quote === 'offered' && priceOf(item) <= 0) return true;
  if (quote && priceOf(item) <= 0) return true;
  return false;
}
function quoteEditorBlock(item) {
  const rate = carrierFeeRate();
  const percent = Math.round(rate * 100);
  const seedPrice = priceOf(item) > 0 ? priceOf(item) : '';
  const seedFee = Number(item?.quoteDraftCommissionTzs) > 0
    ? Math.round(Number(item.quoteDraftCommissionTzs))
    : seedPrice
      ? feeSplit(seedPrice, rate).haulFee
      : '';
  return `<div class="quote-editor" data-quote-editor="${esc(item.id)}">
    <p class="quote-editor-title">Bei na commission</p>
    <p class="muted quote-editor-hint">Weka bei ya usafirishaji. Commission inahesabiwa kutoka bei hiyo (${percent}%) — unaweza kuibadilisha. Commission inahesabiwa tu unapochukua oda.</p>
    <label class="quote-field">Bei ya usafirishaji (TZS)
      <input data-quote-price="${esc(item.id)}" inputmode="numeric" type="number" min="1000" step="500" value="${esc(seedPrice)}" placeholder="mf. 25000" />
    </label>
    <label class="quote-field">Commission tutakayokata (TZS)
      <input data-quote-fee="${esc(item.id)}" inputmode="numeric" type="number" min="0" step="100" value="${esc(seedFee)}" placeholder="mf. 3000" />
    </label>
    <p class="quote-split muted" data-quote-split="${esc(item.id)}">Neti ya kampuni: —</p>
  </div>`;
}
function cargoPhotosBlock(item) {
  const urls = photoUrls(item);
  if (!urls.length) {
    return needsCompanyPrice(item)
      ? `<p class="photo-missing">Picha ya mzigo bado haijaonekana kwenye oda hii.</p>`
      : '';
  }
  return `<div class="cargo-photos" aria-label="Picha ya mzigo">
    ${urls.map((url) => `<a class="cargo-photo" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Picha ya mzigo" loading="lazy" /></a>`).join('')}
  </div>`;
}

/** Pull photo + distance from the customer order when the shipment copy is thin. */
async function enrichShipmentFromOrder(item) {
  if (!item?.id) return item;
  if (state.orderEnrichDone[item.id] || state.orderEnrichPending[item.id]) return item;
  const hasPhotos = photoUrls(item).length > 0;
  const hasDistance = Boolean(distanceLabelOf(item));
  if (hasPhotos && hasDistance) {
    state.orderEnrichDone[item.id] = true;
    return item;
  }
  state.orderEnrichPending[item.id] = true;
  try {
    const orderId = String(item.orderId || item.id).trim();
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (!snap.exists()) {
      state.orderEnrichDone[item.id] = true;
      return item;
    }
    const order = snap.data() || {};
    const photos = Array.isArray(order.parcelPhotoUrls)
      ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
      : [];
    const meters = Number(order.distanceMeters);
    const patch = {};
    if (!hasPhotos && photos.length) patch.parcelPhotoUrls = photos;
    if (!hasDistance && Number.isFinite(meters) && meters > 0) {
      patch.distanceMeters = Math.round(meters);
      patch.distanceKm = Math.round((meters / 1000) * 10) / 10;
      patch.distanceLabel = String(order.distanceLabel || '').trim() || `${patch.distanceKm} km`;
    }
    if (!item.durationSeconds && Number(order.durationSeconds) > 0) {
      patch.durationSeconds = Math.round(Number(order.durationSeconds));
    }
    if (!item.outsideParcelSize && order.outsideParcelSize) {
      patch.outsideParcelSize = String(order.outsideParcelSize).trim();
    }
    if (!item.quoteStatus && order.quoteStatus) {
      patch.quoteStatus = String(order.quoteStatus).trim();
    }
    if (Object.keys(patch).length) {
      Object.assign(item, patch);
      const idx = state.shipments.findIndex((row) => row.id === item.id);
      if (idx >= 0) state.shipments[idx] = { ...state.shipments[idx], ...patch };
      // Persist onto shipment so next open is instant (best-effort).
      updateDoc(doc(db, 'carrierShipments', item.id), patch).catch(() => undefined);
      render();
    }
  } catch (error) {
    console.warn('order enrich failed', error);
  } finally {
    delete state.orderEnrichPending[item.id];
    state.orderEnrichDone[item.id] = true;
  }
  return item;
}

function readQuoteInputs(shipmentId) {
  const priceEl = document.querySelector(`[data-quote-price="${shipmentId}"]`);
  const feeEl = document.querySelector(`[data-quote-fee="${shipmentId}"]`);
  const price = Math.round(Number(priceEl?.value) || 0);
  const feeRaw = feeEl?.value;
  const fee = feeRaw === '' || feeRaw == null ? null : Math.round(Number(feeRaw) || 0);
  return { price, fee, priceEl, feeEl };
}

function syncQuoteSplit(shipmentId) {
  const splitEl = document.querySelector(`[data-quote-split="${shipmentId}"]`);
  if (!splitEl) return;
  const { price, fee } = readQuoteInputs(shipmentId);
  if (price <= 0) {
    splitEl.textContent = 'Neti ya kampuni: —';
    return;
  }
  const rate = carrierFeeRate();
  const commission = fee == null ? feeSplit(price, rate).haulFee : Math.max(0, Math.min(price, fee));
  const feeInput = document.querySelector(`[data-quote-fee="${shipmentId}"]`);
  if (feeInput && document.activeElement !== feeInput && (feeInput.value === '' || fee == null)) {
    feeInput.value = String(commission);
  }
  splitEl.textContent = `Commission ${money(commission)} · Neti ${money(Math.max(0, price - commission))}`;
}

function ownedRows() {
  const id = state.carrier?.id;
  if (!id) return [];
  return state.shipments.filter((item) => item.carrierId === id);
}
function todayCargoRows() {
  const id = state.carrier?.id;
  if (!id) return [];
  const today = darTodayKey();
  return state.shipments.filter((item) => {
    if (item.carrierId !== id || item.shipmentStatus === 'assigned') return false;
    if (item.shipmentStatus === 'delivered') {
      const raw = item.deliveredAt;
      const ms = raw?.toDate ? raw.toDate().getTime() : new Date(raw || 0).getTime();
      if (!ms) return false;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(ms));
      return day === today;
    }
    return item.shipmentStatus !== 'matching';
  });
}
function todayCountLine() {
  const count = todayCargoRows().filter((item) => item.shipmentStatus !== 'delivered').length;
  return `<p class="summary-line"><span>${count} mizigo leo</span></p>`;
}
function manifestRowStatus(item) {
  if (isDelivered(item)) return 'Imekabidhiwa';
  if (isArrived(item)) return 'Imefika';
  if (isLoaded(item)) return 'Imepakiwa';
  if (item.pickupMode) return 'Imepokelewa';
  if (item.shipmentStatus === 'accepted' || item.trackStep === 'received') return 'Imepokelewa';
  return STATUS_LABEL[item.shipmentStatus] || '—';
}
function primaryActiveJob(active) {
  const needsPickup = active.filter((item) => !item.pickupMode && ['accepted', 'contacted'].includes(item.shipmentStatus));
  if (needsPickup.length) return needsPickup[0];
  return active[0];
}
function deskNextActionBlock(item) {
  if (item.carrierId !== state.carrier?.id) return '';
  if (!item.pickupMode && ['accepted', 'contacted'].includes(item.shipmentStatus)) {
    return `<div class="choice-grid">
        <button class="choice" data-act="pickup" data-mode="agent_collects" data-id="${esc(item.id)}" type="button"><strong>Nitafuata</strong></button>
        <button class="choice" data-act="pickup" data-mode="haul_delivers_to_office" data-id="${esc(item.id)}" type="button"><strong>Leteni ofisini</strong></button>
      </div>`;
  }
  if (item.pickupMode && !isLoaded(item)) {
    const index = trackIndex(item);
    const next = index >= 0 ? TRACK[index + 1] : null;
    if (next) {
      return `<button class="btn primary" data-act="track" data-step="${esc(next.key)}" data-id="${esc(item.id)}" type="button">${esc(trackLabel(next, item.pickupMode))}</button>`;
    }
  }
  const manifest = manifestNextAction(item);
  if (manifest) {
    return `<button class="btn primary" data-act="${esc(manifest.act)}" data-id="${esc(item.id)}" type="button">${esc(manifest.label)}</button>`;
  }
  return '';
}
function dropOffLabel(item) {
  return item.destination || item.outsideDestinationLabel || item.dropoffLabel || item.routeLabel || '—';
}
function conductorStatusLabel(item) {
  if (isDelivered(item)) return 'Imekabidhiwa';
  if (isArrived(item)) return 'Imefika';
  if (isLoaded(item)) return 'Njiani';
  return 'Haijapakiwa';
}
function manifestNextAction(item) {
  if (!isLoaded(item)) return { act: 'mark-loaded', label: 'Imepakiwa' };
  if (!isArrived(item)) return { act: 'mark-arrived', label: 'Imefika' };
  if (!isDelivered(item)) return { act: 'mark-delivered', label: 'Imekabidhiwa' };
  return null;
}
function swahiliError(message) {
  const text = String(message || '').trim();
  const map = {
    'Shipment not found.': 'Mzigo haukupatikana.',
    'Not your shipment.': 'Mzigo huu si wa kampuni yako.',
    'Mark loaded first.': 'Weka alama ya kupakiwa kwanza.',
    'Mark arrived first.': 'Weka alama ya kufika kwanza.',
    'No company on this login.': 'Akaunti hii haijaunganishwa na kampuni.',
    'No matching parcel for that code.': 'Nambari hiyo haipatikani.',
    'Could not mark loaded.': 'Imeshindwa kuweka alama ya kupakiwa.',
    'Camera scan is not supported here. Type or paste the code.': 'Kamera haipatikani hapa. Andika nambari.',
    'Scanned code did not match a shipment.': 'Nambari iliyoskanishwa haipatikani.',
    'Camera access was denied or unavailable.': 'Kamera hairuhusiwi.',
  };
  if (map[text]) return map[text];
  if (/firebase/i.test(text) || /^auth\//.test(text)) return 'Imeshindwa. Jaribu tena.';
  return text || 'Imeshindwa. Jaribu tena.';
}
const HOLD_STATUSES = ['assigned', 'accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
function isDarHub(value) {
  const text = norm(value);
  return text.includes('kariakoo') || text.includes('dar') || text.includes('salaam') || text.includes('dsm');
}
function placesMatch(left, right) {
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (isDarHub(a) && isDarHub(b)) return true;
  return false;
}
function orderOrigin(order) {
  return order.outsideOriginCity || order.pickupLabel || order.origin || '';
}
function orderDestination(order) {
  return order.outsideDestinationCity || order.outsideDestinationLabel || order.dropoffLabel || order.destination || '';
}

const TZ_REGION_ALIASES = [
  ['dar es salaam', 'dar', 'dsm', 'salaam', 'kariakoo', 'ilala', 'kinondoni', 'temeke', 'ubungo', 'kigamboni'],
  ['mwanza', 'ilemela', 'nyamagana', 'nyegezi', 'nyakato'],
  ['arusha'],
  ['dodoma'],
  ['mbeya'],
  ['morogoro'],
  ['tanga'],
  ['kilimanjaro', 'moshi'],
  ['kigoma'],
  ['tabora'],
  ['shinyanga', 'kahama'],
  ['singida'],
  ['iringa'],
  ['mtwara', 'mikindani'],
  ['lindi'],
  ['ruvuma', 'songea'],
  ['pwani', 'coast', 'kibaha', 'bagamoyo'],
  ['geita'],
  ['kagera', 'bukoba'],
  ['mara', 'musoma'],
  ['manyara', 'babati'],
  ['njombe', 'makambako'],
  ['katavi', 'mpanda'],
  ['rukwa', 'sumbawanga'],
  ['simiyu'],
  ['songwe'],
  ['unguja', 'zanzibar', 'stone town'],
  ['pemba'],
];
const INTL_HINTS = ['kenya', 'nairobi', 'mombasa', 'uganda', 'kampala', 'rwanda', 'kigali', 'burundi', 'zambia', 'malawi', 'mozambique', 'congo', 'dubai', 'international', 'nje ya nchi'];

function detectTzRegion(value) {
  const text = norm(value);
  if (!text) return '';
  const tokens = new Set(text.split(' ').filter(Boolean));
  let bestId = '';
  let bestLen = 0;
  for (const aliases of TZ_REGION_ALIASES) {
    for (const alias of aliases) {
      const key = norm(alias);
      if (!key) continue;
      const hit = key.includes(' ') ? text.includes(key) : tokens.has(key);
      if (!hit || key.length <= bestLen) continue;
      bestLen = key.length;
      bestId = aliases[0];
    }
  }
  return bestId;
}

function carrierBaseRegion(carrier) {
  if (!carrier) return '';
  return (
    detectTzRegion(carrier.region) ||
    detectTzRegion(carrier.location) ||
    detectTzRegion(carrier.physicalAddress) ||
    detectTzRegion(carrier.companyName) ||
    detectTzRegion(carrier.tradingName) ||
    detectTzRegion(carrier.name) ||
    ''
  );
}

function looksInternationalDest(value) {
  const text = norm(value);
  if (!text || detectTzRegion(value)) return false;
  return INTL_HINTS.some((hint) => text.includes(hint));
}

/** Same rules as backend/carrier-matching.js — origin is the company region, routes are ignored. */
function coverageAllows(order, carrier) {
  const base = carrierBaseRegion(carrier);
  if (!base) return false;
  const originRegion = detectTzRegion(orderOrigin(order));
  if (!originRegion || originRegion !== base) return false;
  const destination = orderDestination(order);
  if (!norm(destination)) return false;
  const destRegion = detectTzRegion(destination);
  const international = looksInternationalDest(destination);
  if (carrier.coverageIntraCity === true) return Boolean(destRegion) && destRegion === base;
  if (carrier.coverageAllTanzania === true) return true;
  if (international) return carrier.coverageInternational === true;
  const selected = (carrier.coverageRegions || []).map((region) => detectTzRegion(region)).filter(Boolean);
  return Boolean(destRegion) && selected.includes(destRegion);
}
function serviceDay(order, now) {
  const clock = now || new Date();
  if (norm(order?.timingMode) === 'later' && order?.scheduleDate) {
    const parsed = new Date(`${order.scheduleDate}T12:00:00+03:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(parsed).slice(0, 3).toLowerCase();
    }
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(clock).slice(0, 3).toLowerCase();
}
function heldWeightByRoute(shipments, excludeOrderId) {
  const used = new Map();
  (shipments || []).forEach((item) => {
    if (!item?.routeId || item.id === excludeOrderId || item.orderId === excludeOrderId) return;
    if (!HOLD_STATUSES.includes(item.shipmentStatus)) return;
    used.set(item.routeId, (used.get(item.routeId) || 0) + (Number(item.weightKg) || 0));
  });
  return used;
}
function routeCanTake(route, weight, usedByRoute) {
  const limit = Number(route.cargoCapacityKg) || 0;
  if (limit <= 0) return false;
  const used = usedByRoute?.get(route.id) || 0;
  return used < limit && used + (Number(weight) || 0) <= limit;
}
function carrierStatusLabel(status) {
  const map = {
    pending: 'Inasubiri uthibitisho',
    verified: 'Imethibitishwa',
    suspended: 'Imesimamishwa',
    rejected: 'Imekataliwa',
  };
  return map[String(status || '').toLowerCase()] || status || '';
}

function carrierReviewedMs(carrier) {
  const raw = carrier?.reviewedAt || carrier?.createdAt;
  if (!raw) return 0;
  if (raw.toDate) return raw.toDate().getTime();
  if (typeof raw.seconds === 'number') return raw.seconds * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function carrierVerifyBadge(status) {
  const key = String(status || 'pending').toLowerCase();
  return `<span class="badge verify-${esc(key)}">${esc(carrierStatusLabel(key))}</span>`;
}

function carrierStatusHint(status) {
  const key = String(status || 'pending').toLowerCase();
  if (key === 'verified') return 'Unaweza kupokea oda za mizigo kutoka HAUL.';
  if (key === 'rejected') return 'Wasiliana na HAUL au sasisha hati kwenye Mipangilio.';
  if (key === 'suspended') return 'Akaunti imesimamishwa. Wasiliana na HAUL.';
  return 'Timu ya HAUL inapitia taarifa za kampuni yako.';
}

function badge(status) {
  const key = String(status || '').toLowerCase();
  const live = ['assigned', 'accepted', 'contacted', 'at_bus', 'in_transit', 'arrived'].some((item) => key.includes(item));
  const label = STATUS_LABEL[key] || cashStatusLabel(key) || status || '—';
  return `<span class="badge${live ? ' live' : ''}">${esc(label)}</span>`;
}

function shipmentCode(item) {
  const parcelCode = String(item.parcelCode || '').trim();
  if (parcelCode) {
    return parcelCode.toUpperCase();
  }
  return String(item.orderNumber || item.id.slice(0, 8)).trim().toUpperCase();
}

function findShipmentByCode(raw) {
  const needle = String(raw || '').trim().toUpperCase();
  if (!needle) return null;
  return state.shipments.find((item) => {
    if (!mine(item) || item.carrierId !== state.carrier?.id) return false;
    const codes = [item.parcelCode, item.orderNumber, item.id.slice(0, 8), item.id].filter(Boolean).map((v) => String(v).trim().toUpperCase());
    return codes.some((code) => code === needle || code.includes(needle) || needle.includes(code));
  }) || null;
}

function isLoaded(item) {
  return Boolean(item.loadedAt) || ['at_bus', 'in_transit', 'arrived', 'delivered'].includes(item.shipmentStatus);
}

function isArrived(item) {
  return Boolean(item.arrivedAt) || ['arrived', 'delivered'].includes(item.shipmentStatus);
}

function isDelivered(item) {
  return item.shipmentStatus === 'delivered';
}

async function stopManifestScan() {
  if (manifestScanStream) {
    manifestScanStream.getTracks().forEach((track) => track.stop());
    manifestScanStream = null;
  }
  const video = document.getElementById('manifestScanVideo');
  if (video) {
    video.srcObject = null;
    video.classList.remove('active');
  }
}
function mine(shipment) {
  if (state.isAdmin) return true;
  const id = state.carrier?.id;
  return Boolean(id && (shipment.carrierId === id || shipment.offeredCarrierId === id));
}

const AUTH_INTENT_KEY = 'haulAuthIntent';
const HERO_SLIDES = [
  { src: './assets/hero-pokea-oda.jpg?v=20261005g', label: 'Pokea oda' },
  { src: './assets/hero-simamia-mzigo.jpg?v=20261005g', label: 'Simamia mzigo' },
  { src: './assets/hero-toa-risiti.jpg?v=20261005g', label: 'Toa risiti' },
];
let heroTimer = null;
let heroIndex = 0;

function route() {
  const raw = location.hash.replace(/^#\/?/, '') || (state.user ? 'overview' : '');
  const [page, id] = raw.split('/');
  return { page: page || 'overview', id: id || '' };
}

function rememberAuthIntent(mode) {
  try {
    sessionStorage.setItem(AUTH_INTENT_KEY, mode);
  } catch {
    /* ignore */
  }
}

function clearAuthIntent() {
  try {
    sessionStorage.removeItem(AUTH_INTENT_KEY);
  } catch {
    /* ignore */
  }
}

function isVerifiedCarrier(carrier) {
  return String(carrier?.status || '').toLowerCase() === 'verified';
}

function authModeFromHash() {
  if (state.user) return '';
  const page = route().page;
  if (page !== 'login' && page !== 'register') return '';
  try {
    if (sessionStorage.getItem(AUTH_INTENT_KEY) === page) return page;
  } catch {
    /* ignore */
  }
  if (location.hash === '#/login' || location.hash === '#/register') {
    location.replace('#/');
  }
  return '';
}

function scrubLoggedOutHash() {
  if (state.user) return;
  if (authModeFromHash()) return;
  const raw = location.hash.replace(/^#\/?/, '').trim();
  if (raw) location.replace('#/');
}

function stopHeroCarousel() {
  if (!heroTimer) return;
  clearInterval(heroTimer);
  heroTimer = null;
}

function paintHeroSlide(index) {
  const slides = document.querySelectorAll('[data-hero-slide]');
  if (!slides.length) return;
  heroIndex = ((index % slides.length) + slides.length) % slides.length;
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === heroIndex);
  });
}

function startHeroCarousel() {
  stopHeroCarousel();
  const root = document.getElementById('heroCarousel');
  if (!root || state.user || !$('landing') || $('landing').classList.contains('hidden')) return;
  paintHeroSlide(heroIndex);
  heroTimer = setInterval(() => paintHeroSlide(heroIndex + 1), 4500);
}

let registerStep = 1;

const LOGIN_CREDENTIAL_CODES = new Set([
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
]);

function logAuthErrorCode(error) {
  const code = String(error?.code || 'unknown');
  console.error('[auth]', code);
}

function loginAuthErrorMessage(error) {
  const code = String(error?.code || '');
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Nenosiri si sahihi.';
    case 'auth/user-not-found':
      return 'Akaunti haipo kwa barua pepe hii.';
    case 'auth/invalid-email':
      return 'Barua pepe si sahihi.';
    case 'auth/too-many-requests':
      return 'Umejaribu mara nyingi. Subiri kidogo.';
    case 'auth/network-request-failed':
      return 'Hakuna mtandao. Jaribu tena.';
    case 'auth/user-disabled':
      return 'Akaunti imezimwa. Wasiliana na msaada.';
    default:
      break;
  }
  return 'Imeshindwa kuingia. Jaribu tena.';
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (LOGIN_CREDENTIAL_CODES.has(code)) {
    return 'Nenosiri si sahihi.';
  }
  switch (code) {
    case 'auth/user-not-found':
      return 'Akaunti haipo kwa barua pepe hii.';
    case 'auth/email-already-in-use':
      return 'Barua pepe hii tayari imesajiliwa. Ingia.';
    case 'auth/weak-password':
      return 'Nenosiri liwe na herufi 6 au zaidi.';
    case 'auth/invalid-email':
      return 'Barua pepe si sahihi.';
    case 'auth/too-many-requests':
      return 'Umejaribu mara nyingi. Subiri kidogo.';
    case 'auth/network-request-failed':
      return 'Hakuna mtandao. Jaribu tena.';
    case 'auth/user-disabled':
      return 'Akaunti imezimwa. Wasiliana na msaada.';
    case 'permission-denied':
      return 'Huna ruhusa. Jaribu tena baadaye.';
    case 'unavailable':
      return 'Huduma haipatikani. Jaribu tena.';
    case 'failed-precondition':
      return 'Huduma haiko tayari. Jaribu tena.';
    default:
      break;
  }
  const msg = String(error?.message || '').trim();
  if (msg && !/firebase/i.test(msg) && !/^auth\//.test(msg) && !code.startsWith('auth/')) {
    return msg;
  }
  return 'Imeshindwa. Jaribu tena.';
}

function readLoginCredentials() {
  return {
    email: String($('loginEmail')?.value || '').trim().toLowerCase(),
    password: String($('loginPassword')?.value || ''),
  };
}

function readRegisterCredentials() {
  const step3 = document.querySelector('#registerFields [data-reg-step="3"]');
  return {
    email: String(step3?.querySelector('input[name="email"]')?.value || '').trim().toLowerCase(),
    password: String(step3?.querySelector('input[name="password"]')?.value || ''),
  };
}

function syncAuthFieldAvailability(mode) {
  const register = mode === 'register';
  $('registerFields')?.querySelectorAll('input, select, textarea').forEach((input) => {
    input.disabled = !register;
  });
  $('loginFields')?.querySelectorAll('input, select, textarea').forEach((input) => {
    input.disabled = register;
  });
}

function registerMaxStep() {
  return state.needsCompanySetup ? 2 : 3;
}

function validateRegisterStep(step) {
  const data = new FormData($('authForm'));
  if (step === 1 && !String(data.get('companyName') || '').trim()) {
    $('authError').textContent = 'Weka jina la kampuni.';
    return false;
  }
  if (step === 2) {
    if (!String(data.get('region') || '').trim()) {
      $('authError').textContent = 'Weka mkoa wa makao (mfano Dar es Salaam).';
      return false;
    }
  }
  return true;
}

function setRegisterStep(step) {
  registerStep = step;
  document.querySelectorAll('[data-reg-step]').forEach((el) => {
    el.classList.toggle('hidden', Number(el.dataset.regStep) !== step);
  });
  const loginBlock = $('loginFields');
  const regBlock = $('registerFields');
  if (state.mode === 'register') {
    loginBlock.classList.add('hidden');
    loginBlock.querySelectorAll('input').forEach((input) => { input.required = false; });
    regBlock.classList.remove('hidden');
    const step3 = regBlock.querySelector('[data-reg-step="3"]');
    step3.querySelectorAll('input').forEach((input) => { input.required = step === 3; });
    $('authSubmit').textContent = step === 3 ? 'Unda akaunti' : 'Endelea';
    $('authSubmit').type = 'submit';
  }
}

function showPublic(authMode) {
  if (state.user && !state.needsCompanySetup) return;
  $('public').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('landing').classList.toggle('hidden', Boolean(authMode));
  $('authCard').classList.toggle('hidden', !authMode);
  if (!authMode) {
    startHeroCarousel();
    return;
  }
  stopHeroCarousel();
  state.mode = authMode;
  const register = authMode === 'register';
  const loginBlock = $('loginFields');
  $('registerFields').classList.toggle('hidden', !register);
  loginBlock.classList.toggle('hidden', register);
  loginBlock.querySelectorAll('input').forEach((input) => {
    input.required = !register;
  });
  document.querySelector('#registerFields [data-reg-step="3"]')?.classList.toggle('hidden', state.needsCompanySetup);
  syncAuthFieldAvailability(register ? 'register' : 'login');
  $('authTitle').textContent = state.needsCompanySetup ? 'Maliza usajili' : (register ? 'Jisajili' : 'Ingia');
  $('authLead').textContent = state.needsCompanySetup
    ? 'Akaunti ipo. Maliza usajili wa kampuni.'
    : (register ? 'Sajili kampuni na njia ya kwanza.' : 'Fungua dashibodi ya kampuni yako.');
  $('authSubmit').textContent = register ? 'Endelea' : 'Ingia';
  $('authSubmit').type = 'submit';
  $('authSwitch').textContent = register ? 'Tayari una akaunti?' : 'Huna akaunti?';
  $('authSwitch').classList.toggle('hidden', state.needsCompanySetup);
  $('authSuccess').classList.add('hidden');
  $('authSuccess').textContent = '';
  if (register) setRegisterStep(registerStep || 1);
}

function showCompanySetup() {
  state.needsCompanySetup = true;
  state.mode = 'register';
  registerStep = 1;
  rememberAuthIntent('register');
  location.hash = '#/register';
  showPublic('register');
  $('authSuccess').textContent = 'Akaunti ipo. Maliza usajili wa kampuni.';
  $('authSuccess').classList.remove('hidden');
}

function navButton(page, label) {
  return `<button class="side-link ${navActive(page)}" data-go="${page}" type="button">${label}</button>`;
}

const NAV = [
  ['overview', 'Muhtasari'],
  ['trips', 'Safari'],
  ['orders', 'Oda'],
  ['manifest', 'Orodha'],
  ['historia', 'Historia'],
  ['routes', 'Njia'],
  ['fares', 'Nauli'],
  ['payments', 'Malipo'],
  ['receipts', 'Risiti'],
  ['customers', 'Wateja'],
  ['reports', 'Ripoti'],
  ['settings', 'Mipangilio'],
];
const FOLDED = {
  dashboard: 'overview',
  assignments: 'orders',
  mizigo: 'manifest',
  fedha: 'payments',
  account: 'settings',
  settings: 'settings',
  notifications: 'overview',
  staff: 'settings',
  vehicles: 'trips',
  pickups: 'manifest',
  shipments: 'manifest',
  profile: 'settings',
  verification: 'settings',
  finance: 'payments',
  cash: 'payments',
  reconciliation: 'payments',
  arrivals: 'manifest',
  history: 'historia',
};

function navActive(page) {
  const current = route().page;
  return current === page
    || (page === 'orders' && current === 'assignment')
    || (page === 'receipts' && current === 'sticker')
    ? 'active'
    : '';
}

function renderNav() {
  const links = NAV.map(([page, label]) => navButton(page, label)).join('');
  const adminOnly = state.isAdmin
    ? navButton('uthibitisho', 'Uthibitisho') + navButton('desk', 'Ofisi')
    : '';
  $('nav').innerHTML = links + adminOnly;
}

function listen() {
  state.unsubscribers.forEach((stop) => stop());
  state.unsubscribers = [];
  if (!state.carrier?.id) {
    state.shipments = [];
    state.routes = [];
    state.vehicles = [];
    state.staff = [];
    state.notes = [];
    render();
    return;
  }
  const id = state.carrier.id;
  const buckets = { offered: [], owned: [] };
  const publishShipments = () => {
    const map = new Map();
    [...buckets.offered, ...buckets.owned].forEach((item) => map.set(item.id, item));
    state.shipments = [...map.values()];
  };
  const watch = (q, apply) => state.unsubscribers.push(onSnapshot(q, (snap) => {
    apply(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    render();
  }));
  watch(query(collection(db, 'carrierShipments'), where('offeredCarrierId', '==', id)), (rows) => {
    buckets.offered = rows;
    publishShipments();
  });
  watch(query(collection(db, 'carrierShipments'), where('carrierId', '==', id)), (rows) => {
    buckets.owned = rows;
    publishShipments();
  });
  watch(query(collection(db, 'carrierRoutes'), where('carrierId', '==', id)), (rows) => { state.routes = rows; });
  watch(query(collection(db, 'carrierVehicles'), where('carrierId', '==', id)), (rows) => { state.vehicles = rows; });
  watch(query(collection(db, 'carrierStaff'), where('carrierId', '==', id)), (rows) => { state.staff = rows; });
  watch(collection(db, 'carriers', id, 'notifications'), (rows) => {
    state.notes = rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  });
}

async function loadSession(user) {
  state.user = user;
  state.isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  if (!user) {
    state.carrier = null;
    state.needsCompanySetup = false;
    listen();
    scrubLoggedOutHash();
    showPublic(authModeFromHash());
    return;
  }
  const memberSnap = await getDoc(doc(db, 'carrierMembers', user.uid));
  if (!state.isAdmin && !memberSnap.exists()) {
    const ownedCarrierSnap = await getDoc(doc(db, 'carriers', user.uid));
    if (!ownedCarrierSnap.exists()) {
      state.carrier = null;
      showCompanySetup();
      listen();
      return;
    }
  }
  state.needsCompanySetup = false;
  const carrierId = memberSnap.exists() ? memberSnap.data().carrierId : state.isAdmin ? '' : user.uid;
  if (carrierId) {
    const carrierSnap = await getDoc(doc(db, 'carriers', carrierId));
    state.carrier = carrierSnap.exists() ? { id: carrierSnap.id, ...carrierSnap.data() } : null;
  } else {
    state.carrier = null;
  }
  $('public').classList.add('hidden');
  $('app').classList.remove('hidden');
  clearAuthIntent();
  stopHeroCarousel();
  const rawHash = location.hash.replace(/^#\/?/, '').trim();
  const authHash = rawHash === 'login' || rawHash === 'register';
  if (authHash || location.hash === '#/' || !rawHash) {
    location.replace('#/overview');
  }
  $('companyLabel').textContent = state.carrier?.companyName || (state.isAdmin ? 'Bus Cargo Ofisi' : 'Kampuni');
  const statusEl = $('statusLabel');
  const statusText = state.isAdmin && !state.carrier ? 'Msimamizi' : carrierStatusLabel(state.carrier?.status);
  statusEl.textContent = statusText;
  statusEl.classList.toggle('verified', isVerifiedCarrier(state.carrier));
  listen();
  render();
}

function shipmentRows(rows) {
  if (!rows.length) return '<p class="empty">Hakuna rekodi bado.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Oda</th><th>Njia</th><th>Mteja</th><th>Taslimu</th><th>Hali</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}"><strong>${esc(item.orderNumber || item.id.slice(0, 6))}</strong></a></td>
      <td>${esc(item.routeLabel || item.destination || '—')}</td>
      <td>${esc(item.customerName || '—')}<br><span class="muted">${esc(item.customerPhone || '')}</span></td>
      <td>${money(item.cashExpected)}</td>
      <td>${badge(item.shipmentStatus)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function kilosLeft() {
  const used = heldWeightByRoute(state.shipments);
  return state.routes.reduce((sum, item) => {
    if (item.active === false) return sum;
    const limit = Number(item.cargoCapacityKg) || 0;
    return sum + Math.max(0, limit - (used.get(item.id) || 0));
  }, 0);
}

function cashTotals(rows) {
  const owned = rows.filter((item) => item.carrierId === state.carrier?.id);
  const collected = owned
    .filter((item) => ['collected', 'pending_reconciliation', 'reconciled'].includes(item.cashStatus))
    .reduce((sum, item) => sum + (Number(item.cashCollectedAmount) || Number(item.cashExpected) || 0), 0);
  const pending = owned
    .filter((item) => item.cashStatus === 'unpaid')
    .reduce((sum, item) => sum + (Number(item.cashExpected) || 0), 0);
  const haulFee = owned
    .filter((item) => item.shipmentStatus === 'delivered')
    .reduce((sum, item) => sum + (Number(item.haulFee) || 0), 0);
  return { collected, pending, haulFee };
}

function offerCountdownBlock(item) {
  const until = offerExpiresMs(item);
  if (!until) return '';
  return `<div class="countdown" data-offer-until="${until}"><span>Kubali ndani ya</span><strong>${formatCountdown(until - Date.now())}</strong></div>`;
}

function offerHeroCard(item) {
  void enrichShipmentFromOrder(item);
  const dest = dropOffLabel(item);
  const kg = item.weightKg || 0;
  const value = declaredValueOf(item);
  const distance = distanceLabelOf(item);
  const priceLine = needsCompanyPrice(item)
    ? 'Bei baada ya kampuni'
    : money(priceOf(item));
  return `<section class="panel offer-panel">
    <p class="offer-route">${esc(dest)}</p>
    <p class="offer-meta">${esc(kg)} kg${distance ? ` · ${esc(distance)}` : ''} · ${esc(priceLine)}${value ? ` · thamani ${money(value)}` : ''}</p>
    ${cargoPhotosBlock(item)}
    ${offerCountdownBlock(item)}
    ${quoteEditorBlock(item)}
    <div class="actions">
      <button class="btn primary" data-act="accept" data-id="${esc(item.id)}" type="button">${needsCompanyPrice(item) ? 'Weka bei & chukua oda' : 'Chukua oda'}</button>
      <button class="btn line" data-act="reject" data-id="${esc(item.id)}" type="button">Kataa</button>
    </div>
  </section>`;
}

function activeJobCard(item) {
  const dest = dropOffLabel(item);
  const value = declaredValueOf(item);
  const next = deskNextActionBlock(item);
  return `<section class="panel desk-job">
    <p class="offer-route">${esc(dest)}</p>
    <p class="offer-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))}${value ? ` · thamani ${money(value)}` : ''}</p>
    <div class="actions desk-next">${next || '<p class="muted">Hakuna hatua inayofuata.</p>'}</div>
  </section>`;
}

function dashboard() {
  const rows = state.shipments.filter(mine);
  const line = todayCountLine();
  const offers = rows.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  const active = rows
    .filter((item) => item.carrierId === state.carrier?.id && ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'].includes(item.shipmentStatus))
    .sort((a, b) => String(a.acceptedAt || a.updatedAt || '').localeCompare(String(b.acceptedAt || b.updatedAt || '')));
  if (offers.length) {
    startCountdownTicker();
    return `${line}${offerHeroCard(offers[0])}`;
  }
  stopCountdownTicker();
  const job = primaryActiveJob(active);
  if (job) return `${line}${activeJobCard(job)}`;
  return `${line}<p class="empty">Hakuna kazi hai sasa.</p>`;
}

function orderRow(item) {
  const offered = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const owned = item.carrierId === state.carrier?.id && item.shipmentStatus !== 'assigned';
  const value = declaredValueOf(item);
  const actions = offered
    ? `<button class="btn primary small" data-act="accept" data-id="${esc(item.id)}" type="button">Kubali</button>
       <button class="btn line small" data-act="reject" data-id="${esc(item.id)}" type="button">Kataa</button>`
    : `<a class="btn primary small" href="#/assignment/${esc(item.id)}">Fungua</a>`;
  return `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong>${esc(dropOffLabel(item))}</strong>
      <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'}</span>
      ${offered ? offerCountdownBlock(item) : `<span class="cargo-item-meta">${badge(item.shipmentStatus)}</span>`}
    </div>
    <div class="cargo-item-actions">${actions}</div>
  </article>`;
}

function trackerBlock(item) {
  const mode = item.pickupMode || '';
  const index = trackIndex(item);
  const steps = TRACK.map((step, stepIndex) => {
    const tone = stepIndex < index ? 'done' : stepIndex === index ? 'now' : '';
    return `<li class="${tone}"><span>${stepIndex + 1}</span>${esc(trackLabel(step, mode))}</li>`;
  }).join('');
  const next = index >= 1 ? TRACK[index + 1] : null;
  const history = (item.statusHistory || []).map((entry) => {
    const label = entry.label || HISTORY_LABEL[entry.status] || STATUS_LABEL[entry.status] || entry.status;
    return `<p>${esc(label)} · ${esc(entry.at || '')}</p>`;
  }).join('');
  const pickupChoice = item.carrierId === state.carrier?.id && !mode && ['accepted', 'contacted'].includes(item.shipmentStatus)
    ? `<div class="choice-grid">
        <button class="choice" data-act="pickup" data-mode="agent_collects" data-id="${esc(item.id)}" type="button"><strong>Nitafuata</strong></button>
        <button class="choice" data-act="pickup" data-mode="haul_delivers_to_office" data-id="${esc(item.id)}" type="button"><strong>Leteni ofisini</strong></button>
      </div>`
    : '';
  return `<section class="panel">
    ${pickupChoice}
    <ol class="track">${steps}</ol>
    ${next && mode ? `<button class="btn primary" data-act="track" data-step="${next.key}" data-id="${esc(item.id)}" type="button">${esc(trackLabel(next, mode))}</button>` : ''}
    ${history ? `<div class="muted" style="margin-top:16px;font-size:13px">${history}</div>` : ''}
  </section>`;
}

function assignmentPage(id) {
  const item = state.shipments.find((shipment) => shipment.id === id);
  if (!item || !mine(item)) return '<p class="empty">Oda hii haipo kwenye akaunti yako.</p>';
  const offered = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const owned = item.carrierId === state.carrier?.id;
  void enrichShipmentFromOrder(item);
  const map = item.pickupLatitude && item.pickupLongitude
    ? `https://www.google.com/maps/search/?api=1&query=${item.pickupLatitude},${item.pickupLongitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.pickupLabel || item.destination || 'Kariakoo')}`;
  return `<section class="panel">
    <p class="offer-route">${esc(item.destination || item.routeLabel || item.orderNumber || id.slice(0, 6))}</p>
    ${offered ? offerCountdownBlock(item) : ''}
    ${orderFacts(item)}
    ${offered || (owned && needsCompanyPrice(item)) ? quoteEditorBlock(item) : ''}
    <div class="actions" style="margin-top:14px">
      ${offered ? `<button class="btn primary" data-act="accept" data-id="${esc(item.id)}" type="button">${needsCompanyPrice(item) ? 'Weka bei & chukua oda' : 'Chukua oda'}</button><button class="btn line" data-act="reject" data-id="${esc(item.id)}" type="button">Kataa</button>` : ''}
      ${owned ? `<a class="btn primary" href="#/sticker/${esc(item.id)}">Chapisha risiti</a>` : ''}
      <a class="btn line" href="${map}" target="_blank" rel="noopener">Ramani</a>
    </div>
  </section>
  ${owned ? trackerBlock(item) : ''}`;
}

function stickerPage(id) {
  const item = state.shipments.find((shipment) => shipment.id === id);
  if (!item || !mine(item)) return '<p class="empty">Risiti haipatikani.</p>';
  const route = matchedRoute(item);
  const code = shipmentCode(item);
  const value = declaredValueOf(item);
  const origin = item.origin || route?.origin || item.pickupLabel || '—';
  const destination = dropOffLabel(item);
  const tagDate = darTodayLabel();
  const routeLine = item.routeLabel || (route ? `${route.origin} → ${route.destination}` : `${origin} → ${destination}`);
  return `<p class="no-print"><button class="btn line small" data-go="receipts" type="button">Rudi</button></p>
    <article class="sticker tag-sticker">
      <div class="tag-hole" aria-hidden="true"></div>
      <header>
        <img src="./assets/logo.svg" alt="" />
        <div><strong>Bus Cargo Agents</strong><span>Mzigo wa basi</span></div>
        <em>${esc(code)}</em>
      </header>
      <p class="sticker-route">${esc(origin)} <b>→</b> ${esc(destination)}</p>
      <p class="sticker-drop"><span>Kushuka</span><strong>${esc(destination)}</strong></p>
      <div class="sticker-people">
        <section>
          <span>Kutoka</span>
          <strong>${esc(item.customerName || '—')}</strong>
          <p>${esc(item.customerPhone || '—')}</p>
        </section>
        <section>
          <span>Kwenda</span>
          <strong>${esc(item.recipientName || '—')}</strong>
          <p>${esc(item.recipientPhone || '—')}</p>
        </section>
      </div>
      <div class="sticker-meta sticker-meta-4">
        <div><span>Uzito</span><strong>${esc(item.weightKg || 0)} kg</strong></div>
        <div><span>Bei</span><strong>${esc(money(priceOf(item)))}</strong></div>
        <div><span>Thamani</span><strong>${value ? esc(money(value)) : '—'}</strong></div>
        <div><span>Tarehe</span><strong>${esc(tagDate)}</strong></div>
      </div>
      <p class="sticker-route secondary">${esc(routeLine)}</p>
      <footer>Bandika kwenye mzigo · ${esc(item.parcelDescription || 'Mzigo')}</footer>
    </article>
    <p class="no-print sticker-actions"><button class="btn primary" data-act="print" type="button">Chapisha</button></p>`;
}

function pickupQueue() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && ['accepted', 'contacted', 'pickup_scheduled', 'picked_up'].includes(item.shipmentStatus));
  if (!rows.length) return '<p class="empty">Hakuna pickup za Kariakoo kwa kampuni hii.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Oda</th><th>Marudio</th><th>Mteja</th><th>Simu</th><th>Mzigo</th><th>Pickup</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 6))}</a></td>
      <td>${esc(item.destination)}</td>
      <td>${esc(item.customerName)}</td>
      <td>${esc(item.customerPhone)}</td>
      <td>${esc(item.weightKg || 0)} kg</td>
      <td>${badge(item.shipmentStatus === 'picked_up' ? 'picked_up' : item.shipmentStatus)}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function financePage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id);
  const today = new Date().toDateString();
  const sum = (pred, field = 'cashExpected') => rows.filter(pred).reduce((total, item) => total + (Number(item[field]) || 0), 0);
  const delivered = rows.filter((item) => item.shipmentStatus === 'delivered');
  const collected = rows.filter((item) => ['collected', 'pending_reconciliation', 'reconciled'].includes(item.cashStatus));
  const reconciled = rows.filter((item) => item.cashStatus === 'reconciled');
  const cards = [
    ["Today's revenue", money(delivered.filter((item) => new Date(item.deliveredAt || item.updatedAt || 0).toDateString() === today).reduce((total, item) => total + (Number(item.cashExpected) || 0), 0))],
    ['Total revenue', money(sum((item) => item.shipmentStatus === 'delivered'))],
    ['Cash collected', money(collected.reduce((total, item) => total + (Number(item.cashCollectedAmount) || Number(item.cashExpected) || 0), 0))],
    ['Pending cash', money(sum((item) => item.carrierId && item.cashStatus === 'unpaid'))],
    ['Haul commission', money(delivered.reduce((total, item) => total + (Number(item.haulFee) || 0), 0))],
    ['Carrier net', money(delivered.reduce((total, item) => total + (Number(item.carrierNet) || 0), 0))],
    ['Reconciled', money(reconciled.reduce((total, item) => total + (Number(item.cashCollectedAmount) || 0), 0))],
    ['Outstanding', money(sum((item) => item.cashStatus && item.cashStatus !== 'reconciled' && item.shipmentStatus === 'delivered'))],
  ];
  return `<div class="cards">${cards.map(([label, value]) => `<article class="card"><span>${label}</span><strong>${esc(value)}</strong></article>`).join('')}</div>`;
}

function cashTable(rows) {
  if (!rows.length) return '<p class="empty">No cash rows yet.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Route</th><th>Amount</th><th>Haul fee</th><th>Carrier net</th><th>Cash status</th><th>Date</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td>${esc(item.orderNumber || item.id.slice(0, 6))}</td>
      <td>${esc(item.routeLabel || item.destination || '')}</td>
      <td>${money(item.cashExpected)}</td>
      <td>${money(item.haulFee)}</td>
      <td>${money(item.carrierNet)}</td>
      <td>${badge(item.cashStatus || 'unpaid')}</td>
      <td>${esc(when(item.deliveredAt || item.offeredAt))}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function reconciliationPage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered');
  return `${rows.map((item) => {
    const expected = Number(item.cashExpected) || 0;
    const collected = Number(item.cashCollectedAmount ?? item.cashExpected) || 0;
    const gap = expected - collected;
    return `<section class="panel"><h2>${esc(item.orderNumber || item.id.slice(0, 6))}</h2>
      <p>Expected ${money(expected)} · Collected ${money(collected)} · Difference ${money(gap)}</p>
      <p style="margin:8px 0">${badge(item.cashStatus || 'unpaid')}</p>
      ${item.cashStatus === 'collected' ? `<button class="btn primary small" data-recon="${esc(item.id)}" type="button">Submit for reconciliation</button>` : ''}
      ${state.isAdmin && item.cashStatus === 'pending_reconciliation' ? `<button class="btn black small" data-close="${esc(item.id)}" type="button">Mark reconciled</button>` : ''}
    </section>`;
  }).join('') || '<p class="empty">Delivered shipments appear here for cash reconciliation.</p>'}`;
}

function scheduleCards() {
  const used = heldWeightByRoute(state.shipments);
  if (!state.routes.length) return '<p class="empty">Hakuna njia zilizohifadhiwa. Weka safari ya leo.</p>';
  return `<div class="schedule-list">${state.routes.filter((item) => item.active !== false).map((item) => {
    const limit = Number(item.cargoCapacityKg) || 0;
    const taken = used.get(item.id) || 0;
    const remaining = Math.max(0, limit - taken);
    return `<article class="schedule-card">
      <header>
        <div>
          <strong>${esc(item.origin || '—')} → ${esc(item.destination || '—')}</strong>
          <p class="muted">${remaining} kg zimesalia</p>
        </div>
        <span class="limit-pill">${remaining} kg zimesalia</span>
      </header>
      <p class="schedule-meta">Uwezo ${limit} kg · Imefungwa ${taken} kg</p>
    </article>`;
  }).join('') || '<p class="empty">Hakuna njia hai.</p>'}</div>`;
}

function vehicleBlock() {
  return `<section class="panel"><h2>Magari</h2>
    <p class="muted">Magari ya kampuni yanasaidia kulinganisha oda na basi.</p>
    <form id="vehicleForm" class="form-grid">
      <input name="registration" placeholder="Registration T 123 ABC" required />
      <input name="vehicleType" placeholder="Coach, coaster, canter" required />
      <input name="cargoCapacityKg" type="number" min="1" placeholder="Cargo capacity kg" required />
      <select name="status"><option value="active">Hai</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select>
      <button class="btn primary" type="submit">Save vehicle</button>
    </form>
    ${state.vehicles.map((item) => `<p style="margin-top:12px"><strong>${esc(item.registration)}</strong> · ${esc(item.vehicleType)} · ${esc(item.cargoCapacityKg)} kg ${badge(item.status)}</p>`).join('') || '<p class="empty">Hakuna magari bado.</p>'}
  </section>`;
}

function primaryRoute() {
  const active = state.routes.filter((item) => item.active !== false);
  const today = darTodayKey();
  const todayMarked = active.find((item) => item.serviceDate === today);
  if (todayMarked) return todayMarked;
  return active[0] || null;
}

function todayTripBanner(route) {
  if (!route) return '';
  const used = heldWeightByRoute(state.shipments);
  const limit = Number(route.cargoCapacityKg) || 0;
  const taken = used.get(route.id) || 0;
  const remaining = Math.max(0, limit - taken);
  return `<article class="today-trip">
    <header>
      <div>
        <strong>${esc(route.origin || '—')}</strong>
        <p class="muted">${remaining} kg zimesalia</p>
      </div>
      <span class="limit-pill">${limit} kg</span>
    </header>
    ${route.serviceDate === darTodayKey() ? '<p class="saved-tag">Safari ya leo imehifadhiwa</p>' : ''}
  </article>`;
}

function latraBusLineHtml(route) {
  if (!route?.origin || !route?.destination) return '';
  if (latraRouteHint.text) {
    return `<p class="latra-live" id="latraLiveLine">Basi liko: ${esc(latraRouteHint.text)}</p>`;
  }
  if (latraRouteHint.loading) {
    return '<p class="latra-live muted" id="latraLiveLine">Inatafuta eneo la basi…</p>';
  }
  return '<p class="latra-live muted hidden" id="latraLiveLine"></p>';
}

async function refreshLatraBusHint(route) {
  if (!route?.origin || !route?.destination) return;
  latraRouteHint.loading = true;
  try {
    const params = new URLSearchParams({ origin: route.origin, destination: route.destination });
    const res = await fetch(`/api/latra-bus?${params.toString()}`);
    if (!res.ok) {
      latraRouteHint.text = '';
      return;
    }
    const data = await res.json();
    latraRouteHint.text = data.summary || '';
    latraRouteHint.fetchedAt = Date.now();
  } catch {
    latraRouteHint.text = '';
  } finally {
    latraRouteHint.loading = false;
    const el = document.getElementById('latraLiveLine');
    if (el && latraRouteHint.text) {
      el.textContent = `Basi liko: ${latraRouteHint.text}`;
      el.classList.remove('hidden', 'muted');
    }
  }
}

function bindLatraPoll(route) {
  if (latraPollTimer) {
    clearInterval(latraPollTimer);
    latraPollTimer = null;
  }
  if (!route) return;
  refreshLatraBusHint(route);
  latraPollTimer = setInterval(() => refreshLatraBusHint(route), 120000);
}

function stopLatraPoll() {
  if (!latraPollTimer) return;
  clearInterval(latraPollTimer);
  latraPollTimer = null;
}

function tripsPage() {
  const route = primaryRoute();
  const capacity = route?.cargoCapacityKg || state.carrier?.cargoCapacityKg || '';
  return `<section class="panel">
      <p class="muted">Oda zinategemea mkoa wa kampuni na coverage. Muda wa kuondoka na njia kuu hazihifadhiwi.</p>
      <form id="dailyTripForm" class="form-grid">
        <input type="hidden" name="routeId" value="${esc(route?.id || '')}" />
        <div><label for="cargoLimit">Kilo (kg)</label><input id="cargoLimit" name="cargoCapacityKg" type="number" min="1" step="1" value="${esc(capacity)}" placeholder="200" required /></div>
        <button class="btn primary" type="submit">Hifadhi uwezo</button>
      </form>
    </section>`;
}

function routesPage() {
  return `<section class="panel flush">${scheduleCards()}</section>`;
}

function ordersPage(rows) {
  const offers = rows.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  if (offers.length) startCountdownTicker();
  else stopCountdownTicker();
  if (!offers.length) return '<p class="empty">Hakuna oda mpya.</p>';
  return `<div class="cargo-list">${offers.map((item) => orderRow(item)).join('')}</div>`;
}

function historiaPage() {
  const rows = state.shipments
    .filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered')
    .sort((a, b) => {
      const am = a.deliveredAt?.toDate ? a.deliveredAt.toDate().getTime() : new Date(a.deliveredAt || 0).getTime();
      const bm = b.deliveredAt?.toDate ? b.deliveredAt.toDate().getTime() : new Date(b.deliveredAt || 0).getTime();
      return bm - am;
    });
  if (!rows.length) return '<p class="empty">Hakuna mizigo iliyokabidhiwa bado.</p>';
  return `<div class="cargo-list">${rows.map((item) => {
    const value = declaredValueOf(item);
    return `<article class="cargo-item">
      <div class="cargo-item-body">
        <strong><code>${esc(shipmentCode(item))}</code> · ${esc(dropOffLabel(item))}</strong>
        <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'}</span>
        <span class="cargo-item-meta">${esc(when(item.deliveredAt))} · Imekabidhiwa</span>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function manifestPage() {
  const rows = todayCargoRows()
    .filter((item) => item.shipmentStatus !== 'delivered')
    .sort((a, b) => String(dropOffLabel(a)).localeCompare(String(dropOffLabel(b), 'sw'));
  const groups = new Map();
  rows.forEach((item) => {
    const town = dropOffLabel(item);
    if (!groups.has(town)) groups.set(town, []);
    groups.get(town).push(item);
  });
  const scanBlock = `<form id="manifestScanForm" class="scan-bar">
      <div style="flex:1 1 220px">
        <label for="manifestCode">Nambari ya mzigo</label>
        <input id="manifestCode" name="code" placeholder="Andika au skanisha" autocomplete="off" />
      </div>
      <button class="btn primary" type="submit">Weka imepakiwa</button>
      <button class="btn line" id="manifestCameraBtn" type="button">Kamera</button>
    </form>
    <p class="scan-msg hidden" id="manifestScanMsg"></p>
    <video id="manifestScanVideo" playsinline muted></video>`;
  if (!rows.length) {
    return `${scanBlock}<p class="empty">Hakuna mizigo kwenye orodha ya leo.</p>`;
  }
  const body = [...groups.entries()].map(([town, items]) => {
    const list = items.map((item) => {
      const value = declaredValueOf(item);
      return `<article class="cargo-item manifest-row" data-manifest-id="${esc(item.id)}">
        <div class="cargo-item-body manifest-row-body">
          <strong><code>${esc(shipmentCode(item))}</code></strong>
          <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'} · ${esc(manifestRowStatus(item))}</span>
        </div>
        <div class="cargo-item-actions">
          <a class="btn primary small" href="#/sticker/${esc(item.id)}">Risiti</a>
        </div>
      </article>`;
    }).join('');
    return `<section class="manifest-group"><h2 class="manifest-town">Inashuka ${esc(town)}</h2><div class="cargo-list">${list}</div></section>`;
  }).join('');
  return `${scanBlock}${body}`;
}

function settingsPage() {
  const carrier = state.carrier;
  if (!carrier && !state.isAdmin) return '<p class="empty">Unda akaunti ya kampuni kwanza.</p>';
  if (!carrier) return '<p class="empty">Ingia hii haina wasifu wa kampuni.</p>';
  const verifyKey = String(carrier.status || 'pending').toLowerCase();
  return `<section class="panel verify-status-card">
      ${carrierVerifyBadge(verifyKey)}
      <p class="muted">${esc(carrierStatusHint(verifyKey))}</p>
      ${carrier.rejectionReason ? `<p class="muted">Sababu: ${esc(carrier.rejectionReason)}</p>` : ''}
    </section>
    <form id="profileForm" class="panel">
      <label>Jina la kampuni</label><input name="companyName" value="${esc(carrier.companyName || '')}" />
      <div class="form-grid"><div><label>Mhusika</label><input name="contactPerson" value="${esc(carrier.contactPerson || '')}" /></div>
      <div><label>Simu</label><input name="phone" value="${esc(carrier.phone || '')}" /></div></div>
      <label>Barua pepe</label><input value="${esc(carrier.email || '')}" disabled />
      <label>Mahali pa ofisi</label><input name="location" value="${esc(carrier.location || '')}" />
      <button class="btn primary" type="submit">Hifadhi</button></form>`;
}

function faresPage() {
  const rows = ownedRows();
  if (!rows.length) return '<p class="empty">Hakuna bei bado.</p>';
  return `<div class="cargo-list">${rows.map((item) => `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong><code>${esc(shipmentCode(item))}</code> · ${esc(dropOffLabel(item))}</strong>
      <span class="cargo-item-meta">bei ${money(priceOf(item))} · ada ${money(item.haulFee || 0)} · neti ${money(item.carrierNet || 0)}</span>
    </div>
    <div class="cargo-item-actions">${badge(item.shipmentStatus)}</div>
  </article>`).join('')}</div>`;
}

function receiptsPage() {
  const rows = ownedRows();
  if (!rows.length) return '<p class="empty">Hakuna risiti bado.</p>';
  return `<div class="receipt-grid">${rows.map((item) => {
    const value = declaredValueOf(item);
    return `<article class="receipt-card">
      <strong>${esc(shipmentCode(item))}</strong>
      <p>${esc(dropOffLabel(item))}</p>
      <p class="muted">${value ? esc(money(value)) : '—'} · ${esc(item.weightKg || 0)} kg</p>
      <a class="btn primary small" href="#/sticker/${esc(item.id)}">Chapisha</a>
    </article>`;
  }).join('')}</div>`;
}

function customersPage() {
  const rows = ownedRows();
  const map = new Map();
  rows.forEach((item) => {
    const senderKey = `s:${item.customerName || ''}|${digits(item.customerPhone)}`;
    if (item.customerName || digits(item.customerPhone)) {
      const prev = map.get(senderKey);
      map.set(senderKey, { role: 'Mtumaji', name: item.customerName || '—', phone: item.customerPhone || '—', trips: (prev?.trips || 0) + 1 });
    }
    const recvKey = `r:${item.recipientName || ''}|${digits(item.recipientPhone)}`;
    if (item.recipientName || digits(item.recipientPhone)) {
      const prev = map.get(recvKey);
      map.set(recvKey, { role: 'Mpokeaji', name: item.recipientName || '—', phone: item.recipientPhone || '—', trips: (prev?.trips || 0) + 1 });
    }
  });
  const people = [...map.values()].sort((a, b) => b.trips - a.trips);
  if (!people.length) return '<p class="empty">Hakuna wateja bado.</p>';
  return `<div class="cargo-list">${people.map((p) => `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong>${esc(p.name)}</strong>
      <span class="cargo-item-meta">${esc(p.role)} · ${phoneLine(p.phone)}</span>
    </div>
    <div class="cargo-item-actions"><span class="muted">${esc(p.trips)} mizigo</span></div>
  </article>`).join('')}</div>`;
}

function reportsPage() {
  const rows = ownedRows();
  const count = rows.length;
  const kilos = rows.reduce((sum, item) => sum + (Number(item.weightKg) || 0), 0);
  const cash = rows.reduce((sum, item) => sum + priceOf(item), 0);
  const value = rows.reduce((sum, item) => sum + declaredValueOf(item), 0);
  return `<div class="finance-row">
      <article class="stat"><span>Mizigo</span><strong>${count}</strong></article>
      <article class="stat"><span>Kilo</span><strong>${kilos.toLocaleString('en-US')}</strong></article>
      <article class="stat"><span>Jumla bei</span><strong>${esc(money(cash))}</strong></article>
    </div>
    <div class="finance-row">
      <article class="stat"><span>Jumla thamani</span><strong>${esc(money(value))}</strong></article>
    </div>`;
}

function paymentsPage() {
  const rows = ownedRows();
  const unpaid = rows.filter((item) => (item.cashStatus || 'unpaid') === 'unpaid');
  const settled = rows.filter((item) => item.cashStatus && item.cashStatus !== 'unpaid');
  const unpaidSum = unpaid.reduce((sum, item) => sum + priceOf(item), 0);
  const settledSum = settled.reduce((sum, item) => sum + priceOf(item), 0);
  const list = (items, empty) => (items.length
    ? `<div class="cargo-list">${items.map((item) => `<article class="cargo-item">
      <div class="cargo-item-body">
        <strong>${esc(dropOffLabel(item))}</strong>
        <span class="cargo-item-meta">${money(priceOf(item))} · ${badge(cashStatusLabel(item.cashStatus))}</span>
      </div>
    </article>`).join('')}</div>`
    : `<p class="empty">${empty}</p>`);
  return `<div class="finance-row">
      <article class="stat"><span>Haijalipwa</span><strong>${esc(money(unpaidSum))}</strong></article>
      <article class="stat"><span>Imeshapatana</span><strong>${esc(money(settledSum))}</strong></article>
    </div>
    ${list(unpaid, 'Hakuna deni haijalipwa.')}
    ${settled.length ? `<div class="section-gap"></div>${list(settled, '')}` : ''}`;
}

function cashTableEnglish(rows) {
  if (!rows.length) return '<p class="empty">No payment records yet.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Route</th><th>Expected</th><th>Haul fee</th><th>Net</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 6))}</a></td>
      <td>${esc(item.routeLabel || item.destination || '')}</td>
      <td>${money(item.cashExpected)}</td>
      <td>${money(item.haulFee)}</td>
      <td>${money(item.carrierNet)}</td>
      <td>${badge(cashStatusLabel(item.cashStatus))}</td>
      <td>${esc(when(item.deliveredAt || item.offeredAt))}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function cashStatusLabel(status) {
  const map = { unpaid: 'Haijalipwa', collected: 'Imekusanywa', pending_reconciliation: 'Inasubiri ulinganisho', reconciled: 'Imelinganishwa' };
  return map[status] || status || 'Haijalipwa';
}

function reconciliationBlock(allRows) {
  const rows = allRows.filter((item) => item.shipmentStatus === 'delivered');
  return `<section class="panel"><div class="section-head"><h2>Reconciliation</h2></div>
    ${rows.map((item) => {
    const expected = Number(item.cashExpected) || 0;
    const collected = Number(item.cashCollectedAmount ?? item.cashExpected) || 0;
    const gap = expected - collected;
    return `<article class="recon-row">
      <strong>${esc(item.orderNumber || item.id.slice(0, 6))}</strong>
      <p class="muted">Expected ${money(expected)} · Collected ${money(collected)} · Gap ${money(gap)}</p>
      <p>${badge(cashStatusLabel(item.cashStatus))}</p>
      ${item.cashStatus === 'collected' ? `<button class="btn primary small" data-recon="${esc(item.id)}" type="button">Submit reconciliation</button>` : ''}
      ${state.isAdmin && item.cashStatus === 'pending_reconciliation' ? `<button class="btn line small" data-close="${esc(item.id)}" type="button">Mark reconciled</button>` : ''}
    </article>`;
  }).join('') || '<p class="empty">Delivered shipments appear here for cash reconciliation.</p>'}
  </section>`;
}

function companyPages() {
  const page = route().page;
  const carrier = state.carrier;
  if (!carrier && !state.isAdmin) return '<p class="empty">Open a company account first.</p>';
  if (page === 'profile' && carrier) {
    return `<form id="profileForm" class="panel"><h2>Wasifu wa kampuni</h2>
      <label>Company name</label><input name="companyName" value="${esc(carrier.companyName || '')}" />
      <div class="form-grid"><div><label>Contact person</label><input name="contactPerson" value="${esc(carrier.contactPerson || '')}" /></div>
      <div><label>Phone</label><input name="phone" value="${esc(carrier.phone || '')}" /></div></div>
      <label>Email</label><input value="${esc(carrier.email || '')}" disabled />
      <label>Location</label><input name="location" value="${esc(carrier.location || '')}" />
      <label>Business details</label><textarea name="businessDetails">${esc(carrier.businessDetails || '')}</textarea>
      <button class="btn primary" type="submit">Hifadhi wasifu</button></form>`;
  }
  if (page === 'verification' && carrier) {
    const docs = carrier.documents || {};
    return `<form id="verifyForm" class="panel"><h2>Verification documents</h2>
      <p class="muted">Status: ${esc(carrier.status)}. Haul approves verified companies.</p>
      <label>Business licence number</label><input name="licence" value="${esc(docs.licence || '')}" />
      <label>TIN</label><input name="tin" value="${esc(docs.tin || '')}" />
      <label>Insurance note</label><input name="insurance" value="${esc(docs.insurance || '')}" />
      <button class="btn primary" type="submit">Save documents</button></form>`;
  }
  if (page === 'staff' && carrier) {
    return `<section class="panel"><h2>Staff</h2>
      <form id="staffForm" class="form-grid">
        <input name="name" placeholder="Name" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Phone" />
        <select name="role"><option value="dispatcher">Dispatcher</option><option value="finance">Finance</option><option value="owner">Owner</option></select>
        <button class="btn primary" type="submit">Invite</button>
      </form>
      ${state.staff.map((item) => `<p style="margin-top:10px"><strong>${esc(item.name)}</strong> · ${esc(item.email)} · ${esc(item.role)}</p>`).join('') || '<p class="empty">No staff yet. Invited people register with the same email.</p>'}
    </section>`;
  }
  if (page === 'notifications') {
    return `<section class="panel"><h2>Notifications</h2>${state.notes.map((item) => `<p style="margin:8px 0"><strong>${esc(item.title)}</strong><br>${esc(item.body || '')}</p>`).join('') || '<p class="empty">No notifications.</p>'}</section>`;
  }
  return settingsPage();
}

function scoreCarrier(order, carrier, routes, vehicles) {
  void routes;
  if (!coverageAllows(order, carrier)) return null;
  const origin = orderOrigin(order);
  const destination = orderDestination(order);
  let score = 70;
  if ((vehicles || []).some((item) => item.status === 'active')) score += 6;
  return {
    carrierId: carrier.id,
    companyName: carrier.companyName,
    score: Math.max(1, Math.min(99, score)),
    routeId: '',
    routeLabel: `${origin} → ${destination}`,
    departureTime: '',
    arrivalTime: '',
  };
}

function shipmentCopy(order, orderId) {
  const quoteStatus = String(order.quoteStatus || '').trim();
  const awaitingQuote = quoteStatus === 'awaiting_company';
  const cashAmount = awaitingQuote ? 0 : cashOf(order);
  const amount = feeSplit(cashAmount);
  const photos = Array.isArray(order.parcelPhotoUrls)
    ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
    : [];
  const meters = Number(order.distanceMeters);
  const distanceMeters = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  const distanceKm = distanceMeters > 0
    ? Math.round((distanceMeters / 1000) * 10) / 10
    : Number(order.distanceKm) > 0
      ? Number(order.distanceKm)
      : 0;
  const distanceLabel = String(order.distanceLabel || '').trim()
    || (distanceKm >= 1 ? `${distanceKm} km` : distanceMeters > 0 ? `${distanceMeters} m` : '');
  return {
    orderId,
    orderNumber: order.orderNumber || order.parcelCode || orderId.slice(0, 6).toUpperCase(),
    parcelCode: order.parcelCode || order.orderNumber || '',
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    recipientName: order.recipientName || '',
    recipientPhone: order.recipientPhone || '',
    declaredValueTzs: declaredValueOf(order),
    pickupLabel: order.pickupLabel || '',
    pickupLatitude: order.pickupLatitude || null,
    pickupLongitude: order.pickupLongitude || null,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    parcelDescription: order.parcelTypeLabel || 'Mzigo',
    outsideParcelSize: String(order.outsideParcelSize || '').trim(),
    outsideShippingMode: String(order.outsideShippingMode || '').trim(),
    quoteStatus,
    ...(photos.length ? { parcelPhotoUrls: photos } : {}),
    ...(distanceMeters > 0 ? { distanceMeters } : {}),
    ...(distanceKm > 0 ? { distanceKm } : {}),
    ...(distanceLabel ? { distanceLabel } : {}),
    ...(Number(order.durationSeconds) > 0 ? { durationSeconds: Math.round(Number(order.durationSeconds)) } : {}),
    weightKg: weightOf(order),
    // Commission (haulFee) is counted only when the company takes the order.
    cashExpected: awaitingQuote ? 0 : amount.amount,
    haulFee: awaitingQuote ? 0 : 0,
    carrierNet: awaitingQuote ? 0 : amount.amount,
    fareLabel: awaitingQuote ? 'Bei baada ya kampuni' : String(order.totalLabel || order.fareLabel || '').trim(),
    paymentMethod: 'cash',
  };
}

async function rememberBusMatch(orderId, status, routeLabel) {
  try {
    await setDoc(doc(db, 'orders', orderId), {
      carrierShipmentId: orderId,
      carrierMatchStatus: status,
      carrierRouteLabel: routeLabel || '',
    }, { merge: true });
  } catch (error) {
    console.error('Bus match pointer was not saved');
  }
}

async function runMatching() {
  if (!state.isAdmin) throw new Error('Only the Haul desk can match orders.');
  const [ordersSnap, carriersSnap, routesSnap, vehiclesSnap, shipmentsSnap] = await Promise.all([
    getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(40))),
    getDocs(query(collection(db, 'carriers'), where('status', '==', 'verified'))),
    getDocs(query(collection(db, 'carrierRoutes'), where('active', '==', true))),
    getDocs(query(collection(db, 'carrierVehicles'), where('status', '==', 'active'))),
    getDocs(query(collection(db, 'carrierShipments'), limit(80))),
  ]);
  const shipmentRows = shipmentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const shipments = new Map(shipmentRows.map((item) => [item.id, item]));
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const routesOf = (id) => routesSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.carrierId === id);
  const vehiclesOf = (id) => vehiclesSnap.docs.map((item) => item.data()).filter((item) => item.carrierId === id);
  let offered = 0;
  for (const orderDoc of ordersSnap.docs) {
    const order = { id: orderDoc.id, ...orderDoc.data() };
    if (!isBusParcel(order)) continue;
    const existing = shipments.get(order.id);
    if (existing?.carrierId) continue;
    if (existing?.shipmentStatus === 'assigned' && existing.offerExpiresAt?.toDate && existing.offerExpiresAt.toDate().getTime() > Date.now()) continue;
    const declined = new Set(existing?.declinedCarrierIds || []);
    if (existing?.shipmentStatus === 'assigned' && existing.offeredCarrierId) declined.add(existing.offeredCarrierId);
    const ranked = carriers
      .map((carrier) => scoreCarrier(order, carrier, routesOf(carrier.id), vehiclesOf(carrier.id), {
        usedByRoute: heldWeightByRoute(shipmentRows, order.id),
      }))
      .filter((entry) => entry && !declined.has(entry.carrierId))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const payload = {
      ...shipmentCopy(order, order.id),
      cashStatus: existing?.cashStatus || 'unpaid',
      updatedAt: serverTimestamp(),
      createdAt: existing?.createdAt || serverTimestamp(),
    };
    if (!best) {
      await setDoc(doc(db, 'carrierShipments', order.id), {
        ...payload,
        shipmentStatus: 'matching',
        offeredCarrierId: null,
        capacityReserved: false,
      }, { merge: true });
      await rememberBusMatch(order.id, 'matching', '');
      continue;
    }
    await setDoc(doc(db, 'carrierShipments', order.id), {
      ...payload,
      shipmentStatus: 'assigned',
      pickupStatus: 'assigned',
      offeredCarrierId: best.carrierId,
      offerScore: best.score,
      routeId: null,
      routeLabel: best.routeLabel,
      departureTime: deleteField(),
      arrivalTime: deleteField(),
      pickupMode: deleteField(),
      trackStep: deleteField(),
      offerExpiresAt: new Date(Date.now() + OFFER_MS),
      offeredAt: serverTimestamp(),
      declinedCarrierIds: [...declined],
      capacityReserved: true,
      statusHistory: arrayUnion({ status: 'assigned', at: stamp(), actor: 'haul' }),
    }, { merge: true });
    await rememberBusMatch(order.id, 'offered', best.routeLabel || '');
    await setDoc(doc(db, 'carriers', best.carrierId), { ordersReceived: increment(1) }, { merge: true });
    await addDoc(collection(db, 'carriers', best.carrierId, 'notifications'), {
      title: 'New assignment',
      body: `${payload.orderNumber} · ${payload.destination} · ${best.score}%`,
      orderId: order.id,
      createdAt: stamp(),
      read: false,
    });
    offered += 1;
  }
  return offered;
}

async function carrierRouteLabelsById() {
  const snap = await getDocs(query(collection(db, 'carrierRoutes'), where('active', '==', true), limit(400)));
  const map = new Map();
  snap.docs.forEach((item) => {
    const data = item.data();
    const carrierId = data.carrierId;
    if (!carrierId) return;
    const label = `${String(data.origin || '').trim()} → ${String(data.destination || '').trim()}`.replace(/^ → | → $/g, '').trim() || '—';
    const list = map.get(carrierId) || [];
    if (!list.includes(label)) list.push(label);
    map.set(carrierId, list);
  });
  return map;
}

function uthibitishoRow(item, routesByCarrier) {
  const status = String(item.status || 'pending').toLowerCase();
  const routes = routesByCarrier.get(item.id) || [];
  const route = routes.join(' · ') || '—';
  const canAct = status !== 'verified';
  return `<article class="verify-row">
    <div class="verify-row-main">
      <strong>${esc(item.companyName || '—')}</strong>
      <span class="muted">${esc(route)}</span>
    </div>
    <div class="verify-row-meta">
      ${phoneLine(item.phone)}
      ${carrierVerifyBadge(status)}
    </div>
    ${item.rejectionReason ? `<p class="muted verify-reason">Sababu: ${esc(item.rejectionReason)}</p>` : ''}
    ${canAct ? `<div class="actions">
      <button class="btn primary small" data-status="verified" data-carrier="${esc(item.id)}" type="button">Thibitisha</button>
      <button class="btn line small" data-status="rejected" data-carrier="${esc(item.id)}" data-ask-reason="1" type="button">Kataa</button>
    </div>` : ''}
  </article>`;
}

async function uthibitishoPage() {
  if (!state.isAdmin) return '<p class="empty">Ukurasa huu unapatikana kwa msimamizi wa HAUL pekee.</p>';
  const [carriersSnap, routesByCarrier] = await Promise.all([
    getDocs(collection(db, 'carriers')),
    carrierRouteLabelsById(),
  ]);
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const waiting = carriers
    .filter((item) => {
      const status = String(item.status || 'pending').toLowerCase();
      return status === 'pending' || status === 'rejected' || status === 'suspended';
    })
    .sort((a, b) => {
      const rank = (c) => (String(c.status || 'pending').toLowerCase() === 'pending' ? 0 : 1);
      return rank(a) - rank(b) || carrierReviewedMs(b) - carrierReviewedMs(a);
    });
  const verifiedRecent = carriers
    .filter((item) => String(item.status || '').toLowerCase() === 'verified')
    .sort((a, b) => carrierReviewedMs(b) - carrierReviewedMs(a))
    .slice(0, 12);
  return `<p class="page-lead">Thibitisha makampuni ya mabasi yaliyojiandikisha — ndiyo yanaweza kupokea oda za mizigo.</p>
    <section class="panel">
      <div class="section-head"><h2>Inasubiri uthibitisho</h2><span class="muted">${waiting.length}</span></div>
      ${waiting.length ? waiting.map((item) => uthibitishoRow(item, routesByCarrier)).join('') : '<p class="empty">Hakuna kampuni inayosubiri.</p>'}
    </section>
    <section class="panel">
      <div class="section-head"><h2>Imethibitishwa hivi karibuni</h2></div>
      ${verifiedRecent.length ? verifiedRecent.map((item) => uthibitishoRow(item, routesByCarrier)).join('') : '<p class="empty">Bado hakuna kampuni iliyothibitishwa.</p>'}
    </section>`;
}

async function deskPage() {
  if (!state.isAdmin) return '<p class="empty">The Haul desk is only for the admin account.</p>';
  const carriersSnap = await getDocs(collection(db, 'carriers'));
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  return `<section class="panel"><h2>Matching &amp; assign</h2>
    <button class="btn primary" id="runMatch" type="button">Retry matching</button>
    <p class="muted">A bus parcel is matched on its own when the customer places the order. This retries parcels that are still waiting. Carriers only see an offer sent to their company.</p>
    <p class="muted">Kampuni zinathibitishwa kwenye <button class="btn link inline" data-go="uthibitisho" type="button">Uthibitisho</button>.</p>
    <p class="muted" id="matchResult"></p>
  </section>
  <section class="panel"><h2>Manual assign</h2>
    <form id="manualForm" class="form-grid">
      <input name="orderId" placeholder="Order document id" required />
      <select name="carrierId">${carriers.filter((item) => item.status === 'verified').map((item) => `<option value="${esc(item.id)}">${esc(item.companyName)}</option>`).join('')}</select>
      <button class="btn black" type="submit">Assign</button>
    </form>
  </section>`;
}

async function render() {
  if (!state.user) return;
  const current = route();
  const folded = FOLDED[current.page];
  if (folded && location.hash !== `#/${folded}`) {
    location.replace(`#/${folded}`);
    return;
  }
  const { page, id } = current;
  if (page !== 'manifest') await stopManifestScan();
  if (page !== 'trips') stopLatraPoll();
  renderNav();
  const titles = {
    overview: 'Muhtasari',
    trips: 'Safari',
    orders: 'Oda',
    manifest: 'Orodha',
    historia: 'Historia',
    routes: 'Njia',
    fares: 'Nauli',
    payments: 'Malipo',
    receipts: 'Risiti',
    customers: 'Wateja',
    reports: 'Ripoti',
    settings: 'Mipangilio',
    assignment: 'Oda',
    sticker: 'Risiti',
    desk: 'Ofisi',
    uthibitisho: 'Uthibitisho',
  };
  $('pageTitle').textContent = titles[page] || 'Muhtasari';
  const viewEl = $('view');
  viewEl.classList.toggle('wide', page === 'fares' || page === 'payments');
  const rows = state.shipments.filter(mine);
  let html = '';
  if (!state.carrier && !state.isAdmin && page !== 'desk' && page !== 'uthibitisho') {
    html = '<p class="empty">Ingia hii haijaunganishwa na kampuni.</p>';
  } else if (!state.carrier && state.isAdmin && (page === 'overview' || page === 'dashboard')) {
    html = `<p class="page-lead">Karibu Ofisi ya Bus Cargo Agents.</p><p class="empty">Chagua ukurasa kwenye menyu — Oda, Uthibitisho, au Ofisi.</p>`;
  } else if (page === 'overview' || page === 'dashboard') html = dashboard();
  else if (page === 'trips') html = tripsPage();
  else if (page === 'orders' || page === 'assignments') html = ordersPage(rows);
  else if (page === 'manifest' || page === 'mizigo') html = manifestPage();
  else if (page === 'historia' || page === 'history') html = historiaPage();
  else if (page === 'routes') html = routesPage();
  else if (page === 'fares') html = faresPage();
  else if (page === 'payments' || page === 'fedha') html = paymentsPage();
  else if (page === 'receipts') html = receiptsPage();
  else if (page === 'customers') html = customersPage();
  else if (page === 'reports') html = reportsPage();
  else if (page === 'settings' || page === 'account') html = settingsPage();
  else if (page === 'assignment') html = assignmentPage(id);
  else if (page === 'sticker') html = stickerPage(id);
  else if (page === 'desk') html = await deskPage();
  else if (page === 'uthibitisho') html = await uthibitishoPage();
  else if (['profile', 'verification', 'staff', 'notifications'].includes(page)) html = companyPages();
  else html = dashboard();
  viewEl.innerHTML = html;
  viewEl.querySelectorAll('[data-quote-editor]').forEach((node) => {
    syncQuoteSplit(node.getAttribute('data-quote-editor'));
  });
  if (page === 'manifest' || page === 'mizigo') bindManifestScan();
  if (page === 'trips') bindLatraPoll(primaryRoute());
}

async function applyManifestMark(id, stage) {
  const ref = doc(db, 'carrierShipments', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  if (!mine({ id, ...current }) || current.carrierId !== state.carrier?.id) throw new Error('Not your shipment.');
  if (stage === 'loaded') {
    if (isLoaded({ ...current, id })) return;
    await updateDoc(ref, {
      shipmentStatus: 'at_bus',
      trackStep: 'packed',
      loadedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'packed', label: 'Imepakiwa', at: stamp(), actor: state.user.email }),
    });
    return;
  }
  if (stage === 'arrived') {
    if (!isLoaded({ ...current, id })) throw new Error('Mark loaded first.');
    if (isArrived({ ...current, id })) return;
    await updateDoc(ref, {
      shipmentStatus: 'arrived',
      trackStep: 'arrived',
      arrivedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'arrived', label: 'Imefika', at: stamp(), actor: state.user.email }),
    });
    return;
  }
  if (stage === 'delivered') {
    if (!isArrived({ ...current, id })) throw new Error('Mark arrived first.');
    await updateDoc(ref, {
      shipmentStatus: 'delivered',
      trackStep: 'handed',
      deliveredAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'handed', label: 'Imewasili', at: stamp(), actor: state.user.email }),
    });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
}

function setManifestScanMessage(text, ok) {
  const el = document.getElementById('manifestScanMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('ok', Boolean(ok));
  el.classList.toggle('err', Boolean(text && !ok));
}

function bindManifestScan() {
  const form = document.getElementById('manifestScanForm');
  const cameraBtn = document.getElementById('manifestCameraBtn');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = new FormData(form).get('code');
    const item = findShipmentByCode(code);
    if (!item) {
      setManifestScanMessage(swahiliError('No matching parcel for that code.'), false);
      return;
    }
    try {
      await applyManifestMark(item.id, 'loaded');
      setManifestScanMessage(`Imepakiwa: ${shipmentCode(item)}.`, true);
      form.reset();
    } catch (error) {
      setManifestScanMessage(swahiliError(error.message || 'Could not mark loaded.'), false);
    }
  });
  if (!cameraBtn) return;
  cameraBtn.addEventListener('click', async () => {
    setManifestScanMessage('', false);
    if (!('BarcodeDetector' in window)) {
      setManifestScanMessage(swahiliError('Camera scan is not supported here. Type or paste the code.'), false);
      return;
    }
    const video = document.getElementById('manifestScanVideo');
    if (!video) return;
    try {
      await stopManifestScan();
      manifestScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = manifestScanStream;
      video.classList.add('active');
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
      const tick = async () => {
        if (!manifestScanStream) return;
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          if (raw) {
            const input = document.getElementById('manifestCode');
            if (input) input.value = raw;
            const item = findShipmentByCode(raw);
            if (item) {
              await applyManifestMark(item.id, 'loaded');
              setManifestScanMessage(`Imepakiwa: ${shipmentCode(item)}.`, true);
              await stopManifestScan();
              return;
            }
            setManifestScanMessage(swahiliError('Scanned code did not match a shipment.'), false);
          }
        } catch {
          /* frame skipped */
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setManifestScanMessage(swahiliError('Camera access was denied or unavailable.'), false);
      await stopManifestScan();
    }
  });
}

async function requireCarrier() {
  if (!state.carrier?.id) throw new Error('No company on this login.');
  if (!state.isAdmin && state.carrier.status !== 'verified' && route().page === 'assignment') {
    /* profile edits still allowed */
  }
  return state.carrier.id;
}

async function onViewClick(event) {
  const go = event.target.closest('[data-go]');
  if (go) {
    navigateApp(go.dataset.go);
    $('sidebar').classList.remove('open');
    return;
  }
  const statusBtn = event.target.closest('[data-status][data-carrier]');
  if (statusBtn && state.isAdmin) {
    const nextStatus = statusBtn.dataset.status;
    const patch = {
      status: nextStatus,
      reviewedAt: serverTimestamp(),
      reviewedBy: state.user?.email || '',
    };
    if (nextStatus === 'rejected' && statusBtn.dataset.askReason !== undefined) {
      const reason = window.prompt('Sababu fupi (si lazima):', '') ?? '';
      patch.rejectionReason = String(reason).trim();
    }
    if (nextStatus === 'verified') {
      patch.rejectionReason = deleteField();
    }
    await updateDoc(doc(db, 'carriers', statusBtn.dataset.carrier), patch);
    render();
    return;
  }
  const recon = event.target.closest('[data-recon]');
  if (recon) {
    await updateDoc(doc(db, 'carrierShipments', recon.dataset.recon), { cashStatus: 'pending_reconciliation' });
    return;
  }
  const close = event.target.closest('[data-close]');
  if (close && state.isAdmin) {
    await updateDoc(doc(db, 'carrierShipments', close.dataset.close), { cashStatus: 'reconciled', reconciledAt: serverTimestamp() });
    return;
  }
  const drop = event.target.closest('[data-drop-route]');
  if (drop) {
    await updateDoc(doc(db, 'carrierRoutes', drop.dataset.drop), { active: false });
    return;
  }
  const actBtn = event.target.closest('[data-act]');
  const act = actBtn?.dataset.act;
  if (!act) return;
  if (act === 'print') {
    window.print();
    return;
  }
  const id = actBtn.dataset.id || route().id;
  if (act === 'mark-loaded') {
    await applyManifestMark(id, 'loaded');
    return;
  }
  if (act === 'mark-arrived') {
    await applyManifestMark(id, 'arrived');
    return;
  }
  if (act === 'mark-delivered') {
    await applyManifestMark(id, 'delivered');
    return;
  }
  const ref = doc(db, 'carrierShipments', id);
  const snap = await getDoc(ref);
  if (!snap.exists() || !mine({ id, ...snap.data() })) return;
  const current = snap.data();
  if (act === 'accept') {
    if (current.offeredCarrierId !== state.carrier.id) return;
    const rate = carrierFeeRate();
    const quoteNeeded = needsCompanyPrice(current) || priceOf(current) <= 0;
    const inputs = readQuoteInputs(id);
    let fee = priceOf(current);
    let haulFee = Number(current.haulFee) > 0 ? Math.round(Number(current.haulFee)) : 0;
    if (quoteNeeded || inputs.priceEl) {
      fee = inputs.price;
      if (fee < 1000 || fee > 50000000) {
        window.alert('Weka bei sahihi ya usafirishaji (TZS) kabla ya kuchukua oda.');
        inputs.priceEl?.focus();
        return;
      }
      haulFee = inputs.fee == null ? feeSplit(fee, rate).haulFee : Math.max(0, Math.min(fee, inputs.fee));
    } else if (!haulFee && fee > 0) {
      haulFee = feeSplit(fee, rate).haulFee;
    }
    const label = fee > 0 ? `TZS ${fee.toLocaleString('en-US')}` : String(current.fareLabel || '').trim();
    const orderId = String(current.orderId || id).trim();
    let orderExtras = {};
    try {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) {
        const order = orderSnap.data() || {};
        const photos = Array.isArray(order.parcelPhotoUrls)
          ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
          : [];
        if (photos.length && !photoUrls(current).length) orderExtras.parcelPhotoUrls = photos;
        const meters = Number(order.distanceMeters);
        if ((!current.distanceMeters || Number(current.distanceMeters) <= 0) && Number.isFinite(meters) && meters > 0) {
          orderExtras.distanceMeters = Math.round(meters);
          orderExtras.distanceKm = Math.round((meters / 1000) * 10) / 10;
          orderExtras.distanceLabel = String(order.distanceLabel || '').trim() || `${orderExtras.distanceKm} km`;
        }
        if (!current.durationSeconds && Number(order.durationSeconds) > 0) {
          orderExtras.durationSeconds = Math.round(Number(order.durationSeconds));
        }
      }
    } catch {
      // Display still works from local inputs.
    }
    const patch = {
      carrierId: state.carrier.id,
      shipmentStatus: 'accepted',
      trackStep: 'received',
      pickupStatus: 'assigned',
      acceptedAt: serverTimestamp(),
      manifestDate: darTodayKey(),
      cashExpected: fee,
      haulFee,
      haulFeeRate: fee > 0 ? haulFee / fee : rate,
      carrierNet: Math.max(0, fee - haulFee),
      commissionCountedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'received', label: 'Imepokelewa', at: stamp(), actor: state.user.email }),
      ...orderExtras,
    };
    if (fee > 0) {
      patch.fareLabel = label;
      if (quoteNeeded || String(current.quoteStatus || '') === 'awaiting_company' || String(current.quoteStatus || '') === 'offered') {
        patch.quoteStatus = 'offered';
      }
    }
    await updateDoc(ref, patch);
    if (orderId && fee > 0 && (quoteNeeded || String(current.quoteStatus || '') === 'awaiting_company')) {
      await setDoc(doc(db, 'orders', orderId), {
        quoteStatus: 'offered',
        carrierQuoteTzs: fee,
        fareLabel: label,
        totalLabel: label,
        carrierQuoteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    await updateDoc(doc(db, 'carriers', state.carrier.id), { accepted: increment(1) });
    if (route().page !== 'overview') location.hash = '#/overview';
  }
  if (act === 'reject') {
    await updateDoc(ref, {
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      pickupMode: deleteField(),
      trackStep: deleteField(),
      declinedCarrierIds: arrayUnion(state.carrier.id),
      statusHistory: arrayUnion({ status: 'matching', label: 'Declined', at: stamp(), actor: state.user.email }),
    });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { rejected: increment(1) });
  }
  if (act === 'pickup') {
    const mode = actBtn.dataset.mode;
    if (current.carrierId !== state.carrier.id) return;
    if (mode !== 'agent_collects' && mode !== 'haul_delivers_to_office') return;
    const label = mode === 'haul_delivers_to_office' ? 'Leteni ofisini' : 'Nitafuata';
    await updateDoc(ref, {
      pickupMode: mode,
      shipmentStatus: 'contacted',
      trackStep: 'pickup',
      manifestDate: darTodayKey(),
      stickerReady: true,
      stickerCreatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: mode === 'haul_delivers_to_office' ? 'inaletwa_ofisini' : 'inafuatwa',
        label,
        at: stamp(),
        actor: state.user.email,
      }),
    });
  }
  if (act === 'track') {
    const step = TRACK.find((item) => item.key === actBtn.dataset.step);
    const nextIndex = step ? TRACK.findIndex((item) => item.key === step.key) : -1;
    const nowIndex = trackIndex(current);
    if (!step || nextIndex !== nowIndex + 1 || current.carrierId !== state.carrier.id || !current.pickupMode) return;
    const patch = {
      trackStep: step.key,
      shipmentStatus: step.status,
      statusHistory: arrayUnion({ status: step.key, label: trackLabel(step, current.pickupMode), at: stamp(), actor: state.user.email }),
    };
    if (step.key === 'packed') patch.pickedUpAt = serverTimestamp();
    if (step.key === 'handed') patch.deliveredAt = serverTimestamp();
    await updateDoc(ref, patch);
    if (step.key === 'packed') await updateDoc(doc(db, 'carriers', state.carrier.id), { pickups: increment(1) });
    if (step.key === 'handed') await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
  if (act === 'advance') {
    const next = NEXT_STATUS[current.shipmentStatus];
    if (!next || current.carrierId !== state.carrier.id) return;
    const patch = {
      shipmentStatus: next,
      statusHistory: arrayUnion({ status: next, at: stamp(), actor: state.user.email }),
    };
    if (next === 'picked_up') patch.pickedUpAt = serverTimestamp();
    if (next === 'delivered') patch.deliveredAt = serverTimestamp();
    await updateDoc(ref, patch);
    if (next === 'picked_up') await updateDoc(doc(db, 'carriers', state.carrier.id), { pickups: increment(1) });
    if (next === 'delivered') await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
  if (act === 'cash') {
    await updateDoc(ref, {
      cashStatus: 'collected',
      cashCollectedAmount: Number(current.cashExpected) || 0,
      cashCollectedAt: serverTimestamp(),
    });
  }
  if (act === 'issue') {
    const note = window.prompt('What happened with the customer?');
    if (!note) return;
    await updateDoc(ref, { customerIssue: note });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { customerIssues: increment(1) });
  }
  if (act === 'fail') {
    await updateDoc(ref, { failedPickup: true, shipmentStatus: 'accepted' });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { failedPickups: increment(1) });
  }
}

async function onViewSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'dailyTripForm') {
    const carrierId = await requireCarrier();
    const capacity = Number(data.get('cargoCapacityKg')) || 0;
    const routeId = String(data.get('routeId') || '').trim();
    if (routeId) {
      await updateDoc(doc(db, 'carrierRoutes', routeId), {
        cargoCapacityKg: capacity,
        updatedAt: serverTimestamp(),
      });
    }
    await updateDoc(doc(db, 'carriers', carrierId), { cargoCapacityKg: capacity });
  }
  if (form.id === 'vehicleForm') {
    const id = await requireCarrier();
    await addDoc(collection(db, 'carrierVehicles'), {
      carrierId: id,
      registration: data.get('registration'),
      vehicleType: data.get('vehicleType'),
      cargoCapacityKg: Number(data.get('cargoCapacityKg')),
      status: data.get('status'),
      createdAt: serverTimestamp(),
    });
    form.reset();
  }
  if (form.id === 'profileForm') {
    const id = await requireCarrier();
    await updateDoc(doc(db, 'carriers', id), {
      companyName: data.get('companyName'),
      contactPerson: data.get('contactPerson'),
      phone: data.get('phone'),
      location: data.get('location'),
      businessDetails: data.get('businessDetails'),
    });
  }
  if (form.id === 'verifyForm') {
    const id = await requireCarrier();
    await updateDoc(doc(db, 'carriers', id), {
      documents: {
        licence: data.get('licence'),
        tin: data.get('tin'),
        insurance: data.get('insurance'),
      },
    });
  }
  if (form.id === 'staffForm') {
    const id = await requireCarrier();
    const email = String(data.get('email') || '').trim().toLowerCase();
    await addDoc(collection(db, 'carrierStaff'), {
      carrierId: id,
      name: data.get('name'),
      email,
      phone: data.get('phone'),
      role: data.get('role'),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')), {
      carrierId: id,
      email,
      role: data.get('role'),
      name: data.get('name'),
    });
    form.reset();
  }
  if (form.id === 'manualForm' && state.isAdmin) {
    const orderId = String(data.get('orderId') || '').trim();
    const carrierId = String(data.get('carrierId') || '').trim();
    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    if (!orderSnap.exists()) throw new Error('Order was not found.');
    const order = orderSnap.data();
    await setDoc(doc(db, 'carrierShipments', orderId), {
      ...shipmentCopy(order, orderId),
      cashStatus: 'unpaid',
      shipmentStatus: 'assigned',
      offeredCarrierId: carrierId,
      offerScore: 100,
      routeLabel: 'Manual assignment',
      offerExpiresAt: new Date(Date.now() + OFFER_MS),
      statusHistory: arrayUnion({ status: 'assigned', at: stamp(), actor: 'haul-manual' }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
}

function navigateApp(page) {
  location.hash = `#/${page}`;
  if (state.user) render();
}

async function createCarrierFromRegistration(user, data, email) {
  const inviteSnap = await getDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')));
  if (inviteSnap.exists()) {
    await setDoc(doc(db, 'carrierMembers', user.uid), {
      carrierId: inviteSnap.data().carrierId,
      role: inviteSnap.data().role || 'dispatcher',
      email,
    });
    return;
  }
  const carrierId = user.uid;
  const companyName = String(data.get('companyName') || '').trim();
  const region = String(data.get('region') || '').trim();
  const location = String(data.get('location') || '').trim();
  if (!companyName) throw new Error('Weka jina la kampuni.');
  if (!region) throw new Error('Weka mkoa wa makao.');
  await setDoc(doc(db, 'carriers', carrierId), {
    ownerUid: carrierId,
    companyName,
    contactPerson: data.get('contactPerson') || '',
    phone: data.get('phone') || '',
    email,
    region,
    location: location || region,
    businessDetails: data.get('businessDetails') || '',
    status: 'pending',
    documents: {},
    coverageRegions: [],
    coverageAllTanzania: false,
    coverageIntraCity: false,
    coverageInternational: false,
    coverageInternationalCountries: '',
    ordersReceived: 0,
    accepted: 0,
    rejected: 0,
    pickups: 0,
    deliveries: 0,
    failedPickups: 0,
    customerIssues: 0,
    cashDiscrepancies: 0,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'carrierMembers', user.uid), {
    carrierId,
    role: 'owner',
    email,
  });
}

function bindAuth() {
  const open = (mode) => {
    if (state.user && !state.needsCompanySetup) {
      location.replace('#/overview');
      return;
    }
    rememberAuthIntent(mode);
    location.hash = mode === 'register' ? '#/register' : '#/login';
    showPublic(mode);
  };
  $('heroCta')?.addEventListener('click', () => open('register'));
  $('heroRegister')?.addEventListener('click', () => open('register'));
  $('quietLogin')?.addEventListener('click', () => open('login'));
  $('footerLogin')?.addEventListener('click', () => open('login'));
  $('footerRegister')?.addEventListener('click', () => open('register'));
  $('authSwitch').onclick = () => open(state.mode === 'login' ? 'register' : 'login');
  $('forgotPassword')?.addEventListener('click', async () => {
    $('authError').textContent = '';
    $('authSuccess').classList.add('hidden');
    const email = String($('loginEmail')?.value || '').trim().toLowerCase();
    if (!email) {
      $('authError').textContent = 'Weka barua pepe kwanza.';
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      $('authSuccess').textContent = 'Barua ya kubadili nenosiri imetumwa.';
      $('authSuccess').classList.remove('hidden');
    } catch (error) {
      logAuthErrorCode(error);
      $('authError').textContent = loginAuthErrorMessage(error);
    }
  });
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (!toggle) return;
    const wrap = toggle.closest('.password-wrap');
    const input = wrap?.querySelector('[data-password]');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ficha' : 'Onyesha';
  });
  $('authForm').addEventListener('click', (event) => {
    const back = event.target.closest('[data-reg-back]');
    if (back) {
      event.preventDefault();
      $('authError').textContent = '';
      setRegisterStep(Number(back.dataset.regBack));
    }
  });
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    const maxStep = state.mode === 'register' ? registerMaxStep() : 0;
    if (state.mode === 'register' && registerStep < maxStep) {
      if (!validateRegisterStep(registerStep)) return;
      $('authError').textContent = '';
      setRegisterStep(registerStep + 1);
      if (state.needsCompanySetup && registerStep === 2) {
        $('authSubmit').textContent = 'Unda kampuni';
      }
      return;
    }
    $('authError').textContent = '';
    if (!state.needsCompanySetup) {
      $('authSuccess').classList.add('hidden');
    }
    const submitBtn = $('authSubmit');
    submitBtn.disabled = true;
    const data = new FormData(event.target);
    try {
      if (state.mode === 'register') {
        if (state.needsCompanySetup && state.user) {
          const email = String(state.user.email || '').trim().toLowerCase();
          await createCarrierFromRegistration(state.user, data, email);
          state.needsCompanySetup = false;
          document.querySelector('#registerFields [data-reg-step="3"]')?.classList.remove('hidden');
          clearAuthIntent();
          await loadSession(state.user);
          return;
        }
        const { email, password } = readRegisterCredentials();
        if (!email || !password) {
          $('authError').textContent = 'Weka barua pepe na nenosiri.';
          return;
        }
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await createCarrierFromRegistration(credential.user, data, email);
        clearAuthIntent();
      } else {
        const { email, password } = readLoginCredentials();
        if (!email || !password) {
          $('authError').textContent = 'Weka barua pepe na nenosiri.';
          return;
        }
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
          logAuthErrorCode(error);
          $('authError').textContent = loginAuthErrorMessage(error);
          return;
        }
        clearAuthIntent();
      }
    } catch (error) {
      logAuthErrorCode(error);
      $('authError').textContent = authErrorMessage(error);
    } finally {
      submitBtn.disabled = false;
      if (state.mode === 'register') setRegisterStep(registerStep);
      else {
        submitBtn.textContent = 'Ingia';
        submitBtn.type = 'submit';
      }
    }
  };
  $('signOutBtn').onclick = () => {
    state.needsCompanySetup = false;
    clearAuthIntent();
    signOut(auth);
  };
  const closeNav = () => {
    $('sidebar').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
  };
  $('menuBtn').onclick = () => {
    const open = $('sidebar').classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  $('navScrim').onclick = closeNav;
  $('navClose').onclick = closeNav;
  $('nav').addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (!go) return;
    event.preventDefault();
    navigateApp(go.dataset.go);
    closeNav();
  });
  $('view').addEventListener('click', (event) => {
    if (event.target.id === 'runMatch') {
      runMatching().then((count) => {
        $('matchResult').textContent = `${count} oda ${count === 1 ? 'imetumwa' : 'zimetumwa'}.`;
      }).catch((error) => {
        $('matchResult').textContent = error.message;
      });
      return;
    }
    onViewClick(event).catch((error) => {
      $('view').insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(swahiliError(error.message))}</p>`);
    });
  });
  $('view').addEventListener('input', (event) => {
    const price = event.target.closest('[data-quote-price]');
    const fee = event.target.closest('[data-quote-fee]');
    const id = price?.getAttribute('data-quote-price') || fee?.getAttribute('data-quote-fee');
    if (!id) return;
    if (price) {
      const amount = Math.round(Number(price.value) || 0);
      const feeInput = document.querySelector(`[data-quote-fee="${id}"]`);
      if (feeInput && document.activeElement !== feeInput) {
        feeInput.value = amount > 0 ? String(feeSplit(amount).haulFee) : '';
      }
    }
    syncQuoteSplit(id);
  });
  $('view').addEventListener('submit', (event) => {
    onViewSubmit(event).catch((error) => {
      $('view').insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(swahiliError(error.message))}</p>`);
    });
  });
  window.addEventListener('hashchange', () => {
    if (!state.authReady) return;
    if (!state.user) {
      scrubLoggedOutHash();
      showPublic(authModeFromHash());
    } else if (state.needsCompanySetup) {
      if (location.hash.replace(/^#\/?/, '').trim() !== 'register') {
        location.replace('#/register');
        return;
      }
      showCompanySetup();
    } else {
      const raw = location.hash.replace(/^#\/?/, '').trim();
      if (raw === 'login' || raw === 'register' || (isVerifiedCarrier(state.carrier) && raw === 'register')) {
        location.replace('#/overview');
        return;
      }
      render();
    }
  });
}

function finishAuthBoot() {
  state.authReady = true;
  document.body.classList.remove('auth-boot');
}

bindAuth();
async function bootstrapAuth() {
  await setPersistence(auth, browserLocalPersistence).catch(() => null);
  onAuthStateChanged(auth, (user) => {
    loadSession(user)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!state.authReady) finishAuthBoot();
      });
  });
}
bootstrapAuth().catch((error) => {
  console.error(error);
  finishAuthBoot();
});
