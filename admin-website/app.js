import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  addDoc,
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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

import { adminWebsiteConfig, firebaseConfig } from './firebase-config.js';

const DELIVERY_STATUS_LABELS = {
  pending_assignment: 'Waiting driver',
  driver_assigned: 'Driver assigned',
  driver_at_pickup: 'Driver at pickup',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_FLOW = [
  'pending_assignment',
  'driver_assigned',
  'driver_at_pickup',
  'in_transit',
  'delivered',
];

const ACTIVE_STATUSES = ['pending_assignment', 'driver_assigned', 'driver_at_pickup', 'in_transit'];
const HISTORY_STATUSES = ['delivered', 'cancelled'];
const ADMIN_SETTINGS_STORAGE_KEY = 'doordrop-admin-settings-v1';
const ADMIN_ACCESS_EMAIL = 'boyzeus11@gmail.com';
const ADMIN_RECENT_ORDER_LIMIT = 300;
const ADMIN_RECENT_USER_LIMIT = 300;
const ADMIN_PAYMENT_REVIEW_LIMIT = 200;
const ADMIN_ACTIVITY_EVENT_LIMIT = 250;

const SERVICE_CATALOG = [
  {
    key: 'parcel',
    flow: 'parcel',
    icon: '📦',
    title: 'Parcel Delivery',
    aliases: ['parcel', 'package', 'pikipiki', 'boda', 'bodaboda', 'motorcycle', 'motorbike', 'bike'],
    preferredVehicleTypes: ['bodaboda'],
    description: 'Small to medium parcel movement handled by Bodaboda/Motorcycle drivers within city and intercity handoff routes.',
  },
  {
    key: 'toyo',
    flow: 'cargo',
    icon: '🛺',
    title: 'TOYO',
    aliases: ['bajaj', 'bajaji', 'toyo', 'toyo xl', 'xl', 'three wheeler', 'cargo bajaji', 'pickup', 'van', 'truck', 'lorry', 'heavy cargo'],
    preferredVehicleTypes: ['toyo'],
    description: 'Instant TOYO requests for shops, SMEs, and market suppliers.',
  },
  {
    key: 'kirikuu',
    flow: 'cargo',
    icon: '🚚',
    title: 'Kirikuu',
    aliases: ['kirikuu'],
    preferredVehicleTypes: ['kirikuu'],
    description: 'Small cargo and quick pickup requests handled by Kirikuu carriers.',
  },
];

const PAGE_META = {
  dashboard: ['Dashboard Overview', 'Monitor doordrop operations, drivers, customers, revenue, and service performance.'],
  orders: ['Order Management', 'Track every request from creation to delivery completion.'],
  dispatch: ['Live Dispatch', 'Cloud auto-dispatch keeps assigning orders even when this admin web app is closed.'],
  services: ['Service Operations', 'Manage each doordrop service in its own professional section.'],
  customers: ['Customer Intelligence', 'Review customers, merchants, support issues, and retention activity.'],
  drivers: ['Driver Verification', 'Approve driver registrations, vehicle categories, documents, and availability.'],
  payments: ['Driver Access Records', 'Review legacy driver access payment records; dispatch access is free for drivers.'],
  finance: ['Finance & Payouts', 'Track delivery revenue, driver payouts, refunds, and settlements.'],
  history: ['Activity History', 'Review customer and driver activity from orders, ratings, status changes, and app usage.'],
  data: ['Usage Data', 'See which app features customers open, tap, and use most often.'],
  reports: ['Reports & Insights', 'Understand business performance with operational intelligence.'],
  settings: ['Admin Settings', 'Configure pricing, service zones, permissions, and operating rules.'],
};

const DEFAULT_SETTINGS = {
  companyName: 'doordrop',
  defaultCity: 'Dar es Salaam',
  currencyLabel: safeStoredValue(adminWebsiteConfig?.currencyLabel, 'TZS'),
  defaultServiceStatus: 'Active',
  supportMessage: 'Thank you for choosing doordrop. Our dispatch team is reviewing your delivery request.',
  commissionRate: Number(adminWebsiteConfig?.commissionRate ?? 0.15),
  weeklySubscriptionFee: 0,
  autoAssignEnabled: true,
};

const DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS = 1000 * 60 * 15;
const DRIVER_SEARCH_TIMEOUT_MS = 1000 * 60 * 10;
const DRIVER_SEARCH_TIMEOUT_REASON = 'No nearby driver came online in time.';
const AUTO_ASSIGN_SNAPSHOT_DELAY_MS = 50;
const AUTO_ASSIGN_RETRY_DELAY_MS = 3000;
const AUTO_ASSIGN_BATCH_SIZE = 12;
const DRIVER_WAITING_UPDATE_THROTTLE_MS = 1000 * 15;
const PRIORITY_DRIVER_RADIUS_METERS = 4000;
const PRIORITY_DRIVER_SCORE_BONUS = 80;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DRIVER_APP_ONLINE_WINDOW_MS = 1000 * 60 * 15;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => null);

const col = {
  orders: collection(db, 'orders'),
  drivers: collection(db, 'drivers'),
  users: collection(db, 'users'),
  notifications: collection(db, 'userNotifications'),
  paymentReviews: collection(db, 'commissionPaymentReviews'),
  activityEvents: collection(db, 'appActivityEvents'),
};

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ui = {
  authScreen: $('authScreen'),
  appScreen: $('appScreen'),
  authForm: $('authForm'),
  loginModeButton: $('loginModeButton'),
  emailInput: $('emailInput'),
  passwordInput: $('passwordInput'),
  signOutButton: $('signOutButton'),
  sidebar: $('sidebar'),
  menuButton: $('menuButton'),
  pageTitle: $('pageTitle'),
  pageSubtitle: $('pageSubtitle'),
  content: $('content'),
  orderDrawer: $('orderDrawer'),
  closeDrawer: $('closeDrawer'),
  drawerOrderId: $('drawerOrderId'),
  modalRoot: $('adminModalRoot'),
};

const state = {
  user: null,
  firebaseUser: null,
  currentPage: 'dashboard',
  query: '',
  selectedOrderId: '',
  orders: [],
  drivers: [],
  users: [],
  paymentReviews: [],
  activityEvents: [],
  settings: readStoredSettings(),
  loading: {
    orders: true,
    drivers: true,
    users: true,
    paymentReviews: true,
    activityEvents: true,
  },
  busy: false,
  autoAssigning: false,
  autoAssignTimer: null,
  renderTimer: null,
  unsubscribers: [],
  feedbackTimer: null,
};

function safeStoredValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function readStoredSettings() {
  try {
    const raw = window.localStorage.getItem(ADMIN_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...compact(parsed || {}),
      commissionRate: Number(parsed?.commissionRate ?? DEFAULT_SETTINGS.commissionRate),
      autoAssignEnabled: parsed?.autoAssignEnabled === undefined ? DEFAULT_SETTINGS.autoAssignEnabled : parsed.autoAssignEnabled === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings) {
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...compact(settings),
    commissionRate: Number(settings?.commissionRate ?? state.settings?.commissionRate ?? DEFAULT_SETTINGS.commissionRate),
    autoAssignEnabled: settings?.autoAssignEnabled === undefined
      ? state.settings?.autoAssignEnabled ?? DEFAULT_SETTINGS.autoAssignEnabled
      : settings.autoAssignEnabled === true || settings.autoAssignEnabled === 'true' || settings.autoAssignEnabled === 'on',
  };

  try {
    window.localStorage.setItem(ADMIN_SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    return;
  }
}

function syncUiRefs() {
  ui.authScreen = $('authScreen');
  ui.appScreen = $('appScreen') || document.querySelector('.app-shell');
  ui.authForm = $('authForm');
  ui.loginModeButton = $('loginModeButton');
  ui.emailInput = $('emailInput');
  ui.passwordInput = $('passwordInput');
  ui.signOutButton = $('signOutButton') || [...$$('.topbar .btn')].find((button) => normalize(button.textContent) === 'sign out') || null;
  ui.sidebar = $('sidebar');
  ui.menuButton = $('menuButton');
  ui.pageTitle = $('pageTitle');
  ui.pageSubtitle = $('pageSubtitle');
  ui.content = $('content');
  ui.orderDrawer = $('orderDrawer');
  ui.closeDrawer = $('closeDrawer');
  ui.drawerOrderId = $('drawerOrderId');
  ui.modalRoot = $('adminModalRoot');
}

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - TANZANIA_UTC_OFFSET_MS;
}

function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * DAY_MS;
}

function getNextTanzaniaSundayStartMillis(value = Date.now()) {
  return getTanzaniaWeekStartMillis(value) + WEEK_MS;
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatDateTime(value) {
  const millis = toMillis(value);
  if (!millis) return 'Not available';
  return new Date(millis).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInputValue(value) {
  const millis = toMillis(value);
  if (!millis) return '';
  return new Date(millis).toISOString().slice(0, 10);
}

function isToday(value) {
  const millis = toMillis(value);
  if (!millis) return false;
  const date = new Date(millis);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isActiveRecently(value) {
  const millis = toMillis(value);
  return !!millis && Date.now() - millis <= 1000 * 60 * 60 * 24;
}

function getCurrencyLabel() {
  return safeText(state.settings?.currencyLabel, safeText(adminWebsiteConfig?.currencyLabel, 'TZS'));
}

function formatMoney(value) {
  return `${getCurrencyLabel()} ${Math.max(0, Math.round(parseAmount(value))).toLocaleString('en-US')}`;
}

function formatDistance(distanceMeters) {
  const numeric = Number(distanceMeters);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Distance unavailable';
  const kilometers = numeric / 1000;
  return kilometers >= 100 ? `${kilometers.toFixed(0)} km` : `${kilometers.toFixed(1)} km`;
}

function formatDuration(durationSeconds) {
  const numeric = Number(durationSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'ETA pending';
  const minutes = Math.max(1, Math.round(numeric / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (remainder === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainder} min`;
}

function getDistanceBetweenPoints(start, end) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function decodePolyline(encoded, precision = 5) {
  if (!encoded || typeof encoded !== 'string') {
    return [];
  }

  const coordinates = [];
  const factor = 10 ** precision;
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / factor,
      longitude: longitude / factor,
    });
  }

  return coordinates;
}

function getOrderAmount(order) {
  return parseAmount(order.totalAmount ?? order.amount ?? order.price ?? order.totalLabel ?? order.deliveryFee);
}

function getOrderNumber(order) {
  return safeText(order.orderNumber || order.orderId || order.id, 'Unknown order');
}

function getGeneratedOrderNumber(documentId) {
  return `DD-${documentId.slice(0, 6).toUpperCase()}`;
}

function getServiceLabel(order) {
  return safeText(order.serviceLabel || order.serviceType || order.vehicleLabel || order.vehicleType || order.flow, 'Delivery');
}

function formatVehicleTypeLabel(vehicleType) {
  const labels = {
    bodaboda: 'Bodaboda / Motorcycle',
    pikipiki: 'Bodaboda / Motorcycle',
    boda: 'Bodaboda / Motorcycle',
    motorcycle: 'Bodaboda / Motorcycle',
    motorbike: 'Bodaboda / Motorcycle',
    kirikuu: 'Kirikuu',
    toyo: 'TOYO',
    bajaj: 'TOYO',
    bajaji: 'TOYO',
    toyo_xl: 'TOYO',
    pickup: 'TOYO',
    van: 'TOYO',
    truck: 'TOYO',
  };

  return labels[normalize(vehicleType)] || safeText(vehicleType, 'Vehicle');
}

function getDriverVehicleLabel(driver, fallback = 'Vehicle') {
  const label = safeText(driver?.vehicleLabel);
  if (label) {
    return label;
  }

  return driver?.vehicleType ? formatVehicleTypeLabel(driver.vehicleType) : fallback;
}

function getCustomerName(order) {
  return safeText(order.customerName || order.senderName || order.userName || order.name, 'Customer');
}

function getCustomerContact(order) {
  return safeText(order.customerPhone || order.phoneNumber || order.senderPhone || order.customerEmail || order.email, 'Not provided');
}

function getRecipientName(order) {
  return safeText(order.recipientName || order.receiverName || order.dropoffContactName, 'Recipient not provided');
}

function getRecipientContact(order) {
  return safeText(order.recipientPhone || order.receiverPhone || order.dropoffPhone || order.recipientContact, 'Recipient phone not provided');
}

function getPickup(order) {
  return safeText(order.pickupLabel || order.pickupAddress || order.pickup || order.from, 'Pickup not provided');
}

function getDropoff(order) {
  return safeText(order.dropoffLabel || order.dropoffAddress || order.dropoff || order.destination || order.to, 'Drop-off not provided');
}

function getDriverName(order) {
  return safeText(order.driverName || order.riderName || getDriverById(order.driverId)?.fullName, 'Not assigned');
}

function getOrderStatus(order) {
  return safeText(order.status, 'pending_assignment');
}

function getOrderPaymentLabel(order) {
  const parts = [
    order.paymentMethod || order.paymentType || order.paymentLabel,
    order.paymentStatus,
    order.transactionReference || order.paymentReference,
  ].map((part) => safeText(part)).filter(Boolean);

  return parts.join(' · ') || 'Payment not recorded';
}

function getOrderScheduleLabel(order) {
  const scheduledAt = toMillis(order.scheduledAt || order.pickupAt || order.pickupDateTime);
  if (scheduledAt) {
    return `${safeText(order.scheduleLabel || order.schedule || order.timingMode, 'Scheduled')} · ${formatDateTime(scheduledAt)}`;
  }

  return safeText(order.scheduleLabel || order.schedule || order.timingMode, 'Dispatch now');
}

function getOrderItemDescription(order) {
  return safeText(
    order.itemDescription
      || order.packageDescription
      || order.parcelDescription
      || order.cargoDescription
      || order.orderDescription
      || order.description
      || order.notes
      || order.deliveryNotes
      || order.specialInstructions,
    'No package notes'
  );
}

function getStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || safeText(status, 'Pending').replaceAll('_', ' ');
}

function getStatusClass(status) {
  if (status === 'delivered') return 'success';
  if (status === 'cancelled') return 'danger';
  if (status === 'pending_assignment') return 'warning';
  if (status === 'in_transit') return 'info';
  if (status === 'driver_assigned' || status === 'driver_at_pickup') return 'purple';
  return 'neutral';
}

function getOrderStatusLabel(order) {
  const status = getOrderStatus(order);
  if (status === 'cancelled' && order.autoCancelledReason) {
    return 'No driver found';
  }

  if (status !== 'pending_assignment') {
    return getStatusLabel(status);
  }

  if (order.timingMode === 'later') {
    return 'Scheduled';
  }

  if (order.driverSearchStatus === 'waiting_for_driver') {
    return 'No nearby driver yet';
  }

  if (order.driverSearchStatus === 'searching') {
    return 'Finding driver';
  }

  return getStatusLabel(status);
}

function getDriverSearchMessage(order) {
  const status = getOrderStatus(order);
  if (status === 'cancelled' && order.autoCancelledReason) {
    return 'Auto-cancelled because no nearby online driver came online in time.';
  }

  if (status !== 'pending_assignment' || order.driverId) {
    return order.driverSearchMessage || 'Driver search resolved.';
  }

  if (order.timingMode === 'later') {
    return 'Scheduled order: automatic assignment starts close to pickup time.';
  }

  const expiry = getDriverSearchExpiryMillis(order);
  const minutesLeft = expiry ? Math.max(0, Math.ceil((expiry - Date.now()) / 60000)) : 0;
  const timeCopy = minutesLeft ? ` Auto-cancel in about ${minutesLeft} min if no match appears.` : '';

  if (order.driverSearchStatus === 'waiting_for_driver') {
    return `${order.driverSearchMessage || 'No nearby online driver matches this order yet.'}${timeCopy}`;
  }

  return `${order.driverSearchMessage || 'Searching nearby online drivers automatically.'}${timeCopy}`;
}

function pill(label, type = 'neutral') {
  return `<span class="pill ${escapeHtml(type)}">${escapeHtml(label)}</span>`;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.body.toggleAttribute('data-busy', isBusy);
  $$('button').forEach((button) => {
    if (button.dataset.keepEnabled !== 'true') {
      button.disabled = isBusy;
    }
  });
}

function setFeedback(message, type = 'info') {
  const existing = $('feedbackToast') || document.createElement('div');
  existing.id = 'feedbackToast';
  existing.className = `feedback-toast ${type}`;
  existing.textContent = message;
  existing.style.cssText = `
    position: fixed;
    right: 24px;
    top: 92px;
    z-index: 9999;
    max-width: 420px;
    padding: 14px 16px;
    border-radius: 16px;
    font-weight: 900;
    box-shadow: 0 18px 40px rgba(15,23,42,.16);
    background: ${type === 'error' ? '#fff0f0' : type === 'success' ? '#e9fbf3' : '#eaf2ff'};
    color: ${type === 'error' ? '#be123c' : type === 'success' ? '#047857' : '#1d4ed8'};
    border: 1px solid rgba(15,23,42,.08);
  `;
  document.body.appendChild(existing);
  clearTimeout(state.feedbackTimer);
  state.feedbackTimer = setTimeout(() => existing.remove(), 5000);
}

function sortByRecent(items) {
  return [...items].sort((left, right) => {
    return toMillis(right.updatedAt || right.createdAt) - toMillis(left.updatedAt || left.createdAt);
  });
}

function sortDrivers(items) {
  return [...items].sort((left, right) => {
    const leftVerification = getDriverVerification(left);
    const rightVerification = getDriverVerification(right);
    if (leftVerification.rank !== rightVerification.rank) {
      return leftVerification.rank - rightVerification.rank;
    }

    if (isPriorityDriver(left) !== isPriorityDriver(right)) {
      return isPriorityDriver(left) ? -1 : 1;
    }

    if (!!left.currentOrderId !== !!right.currentOrderId) {
      return left.currentOrderId ? 1 : -1;
    }

    if (!!left.isAvailable !== !!right.isAvailable) {
      return left.isAvailable ? -1 : 1;
    }

    return safeText(left.fullName || left.email).localeCompare(safeText(right.fullName || right.email));
  });
}

function isPriorityDriver(driver) {
  return driver?.isPriorityDriver === true;
}

function getPriorityDriverLabel(driver) {
  return isPriorityDriver(driver) ? 'Priority driver' : 'Standard driver';
}

function getDriverVerification(driver) {
  const status = normalize(driver?.verificationStatus);
  if (status === 'pending_admin_verification') {
    return { status, label: 'Pending verification', className: 'warning', rank: 0 };
  }

  if (status === 'rejected') {
    return { status, label: 'Rejected', className: 'danger', rank: 1 };
  }

  return { status: 'verified', label: 'Verified', className: 'success', rank: 2 };
}

function isDriverVerifiedForDispatch(driver) {
  return getDriverVerification(driver).status === 'verified';
}

function getDriverById(driverId) {
  if (!driverId) return null;
  return state.drivers.find((driver) => driver.id === driverId) || null;
}

function getDriverStatus(driver) {
  const verification = getDriverVerification(driver);
  if (verification.status !== 'verified') return { label: verification.label, className: verification.className };
  if (driver.currentOrderId) return { label: 'Busy', className: 'info' };
  if (driver.isAvailable) return { label: 'Online', className: 'success' };
  if (isDriverAppOnline(driver)) return { label: 'App online', className: 'info' };
  return { label: 'Offline', className: 'neutral' };
}

function isDriverAppOnline(driver) {
  const onlineUntil = toMillis(driver?.appOnlineUntil);
  if (onlineUntil && onlineUntil > Date.now()) return true;

  const lastActiveAt = toMillis(driver?.lastActiveAt || driver?.updatedAt);
  return Boolean(lastActiveAt && Date.now() - lastActiveAt <= DRIVER_APP_ONLINE_WINDOW_MS);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  return String(value ?? '').split('').reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
  }, 0);
}

function getDriverRatingStats(driver) {
  const ratedOrders = state.orders.filter((order) => {
    return order.driverId === driver.id && Number(order.customerRating) >= 1 && Number(order.customerRating) <= 5;
  });
  const orderRatingTotal = ratedOrders.reduce((sum, order) => sum + Number(order.customerRating || 0), 0);
  const storedCount = Number(driver.ratingCount ?? driver.reviewCount ?? driver.driverReviewCount ?? 0);
  const storedAverage = Number(driver.ratingAverage ?? driver.averageRating ?? driver.driverRatingAverage ?? 0);
  const count = ratedOrders.length || (Number.isFinite(storedCount) ? storedCount : 0);
  const average = ratedOrders.length
    ? orderRatingTotal / ratedOrders.length
    : Number.isFinite(storedAverage) && storedAverage > 0
      ? storedAverage
      : 4.5;

  return {
    average: clamp(average, 1, 5),
    count,
    reviews: ratedOrders
      .filter((order) => safeText(order.customerReview))
      .slice(0, 3)
      .map((order) => ({
        orderNumber: getOrderNumber(order),
        rating: Number(order.customerRating),
        review: safeText(order.customerReview),
      })),
  };
}

function getDriverFairnessStats(driver) {
  const driverOrders = state.orders.filter((order) => order.driverId === driver.id);
  const assignedTimes = [
    toMillis(driver.lastAssignedAt),
    ...driverOrders.map((order) => toMillis(order.assignedAt || order.createdAt)),
  ].filter(Boolean);
  const lastAssignedAt = assignedTimes.length ? Math.max(...assignedTimes) : 0;
  const recentAssignments = driverOrders.filter((order) => {
    const assignedAt = toMillis(order.assignedAt || order.createdAt);
    return assignedAt && Date.now() - assignedAt <= 1000 * 60 * 60 * 24;
  }).length;
  const completedOrders = Number(driver.completedOrderCount ?? driver.completedOrdersCount ?? 0)
    || driverOrders.filter((order) => getOrderStatus(order) === 'delivered').length;
  const assignmentCount = Number(driver.assignmentCount ?? 0) || driverOrders.length;
  const cancellationCount = Number(driver.cancellationCount ?? 0)
    || driverOrders.filter((order) => getOrderStatus(order) === 'cancelled').length;

  return {
    assignmentCount,
    completedOrders,
    cancellationCount,
    recentAssignments,
    lastAssignedAt,
  };
}

function serviceKeyFromOrder(order) {
  const cargoVehicleKey = normalize(order.cargoVehicleKey);
  const keyMatch = {
    motorcycle: 'parcel',
    pikipiki: 'parcel',
    boda: 'parcel',
    bodaboda: 'parcel',
    motorbike: 'parcel',
    kirikuu: 'kirikuu',
    bajaj: 'toyo',
    bajaji: 'toyo',
    toyo: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
  }[cargoVehicleKey];

  if (keyMatch) {
    return keyMatch;
  }

  const text = normalize(`${getServiceLabel(order)} ${order.flow || ''} ${order.vehicleType || ''} ${order.cargoVehicleLabel || ''}`);
  if (text.includes('toyo xl')) {
    return 'toyo';
  }

  const match = SERVICE_CATALOG.find((service) => service.aliases.some((alias) => text.includes(alias)));
  return match?.key || 'parcel';
}

function normalizeServiceCatalogKey(serviceKey) {
  const normalized = normalize(serviceKey);
  const aliases = {
    parcel: 'parcel',
    pikipiki: 'parcel',
    boda: 'parcel',
    bodaboda: 'parcel',
    motorcycle: 'parcel',
    motorbike: 'parcel',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    kirikuu: 'kirikuu',
  };

  return aliases[normalized] || normalized;
}

function normalizeDriverVehicleKey(vehicleType) {
  const normalized = normalize(vehicleType);
  const aliases = {
    bodaboda: 'bodaboda',
    boda: 'bodaboda',
    pikipiki: 'bodaboda',
    motorcycle: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    kirikuu: 'kirikuu',
  };

  return aliases[normalized] || normalized;
}

function getDriverWeeklySubscriptionFee(_driver) {
  return 0;
}

function isCanonicalDriverVehicleType(vehicleType) {
  return ['bodaboda', 'toyo', 'kirikuu'].includes(normalize(vehicleType));
}

function getServiceConfig(serviceKey) {
  const normalizedServiceKey = normalizeServiceCatalogKey(serviceKey);
  return SERVICE_CATALOG.find((service) => service.key === normalizedServiceKey) || SERVICE_CATALOG[0];
}

function getDriverCurrentPoint(driver) {
  if (driver.currentLatitude === undefined || driver.currentLongitude === undefined) {
    return null;
  }

  return {
    latitude: Number(driver.currentLatitude),
    longitude: Number(driver.currentLongitude),
  };
}

function getOrderPickupPoint(order) {
  if (order.pickupLatitude === undefined || order.pickupLongitude === undefined) {
    return null;
  }

  return {
    latitude: Number(order.pickupLatitude),
    longitude: Number(order.pickupLongitude),
  };
}

function getOrderDropoffPoint(order) {
  if (order.dropoffLatitude === undefined || order.dropoffLongitude === undefined) {
    return null;
  }

  return {
    latitude: Number(order.dropoffLatitude),
    longitude: Number(order.dropoffLongitude),
  };
}

function driverSupportsOrder(driver, order) {
  const service = getServiceConfig(serviceKeyFromOrder(order));
  const vehicleType = normalizeDriverVehicleKey(driver.vehicleType);
  const vehicleLabel = normalize(driver.vehicleLabel);
  const matchesType = service.preferredVehicleTypes.includes(vehicleType);
  if (isCanonicalDriverVehicleType(vehicleType)) {
    return matchesType;
  }

  const matchesLabel = service.aliases.some((alias) => vehicleLabel.includes(alias));
  return matchesLabel;
}

function getDriverLastSeenMillis(driver) {
  return Math.max(
    toMillis(driver.lastLocationUpdatedAt),
    toMillis(driver.lastActiveAt),
    toMillis(driver.updatedAt),
    toMillis(driver.appOnlineUntil)
  );
}

function isDriverAutoAssignable(driver) {
  const appOnlineUntil = toMillis(driver.appOnlineUntil);
  const lastSeenMillis = getDriverLastSeenMillis(driver);
  const isFreshOnline =
    (appOnlineUntil && appOnlineUntil > Date.now()) ||
    (!!lastSeenMillis && Date.now() - lastSeenMillis <= DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS);
  return (
    isDriverVerifiedForDispatch(driver) &&
    driver.isAvailable === true &&
    !safeText(driver.currentOrderId) &&
    isFreshOnline
  );
}

function getNearbyDriverMatches(order) {
  const pickup = getOrderPickupPoint(order);
  const service = getServiceConfig(serviceKeyFromOrder(order));
  const declinedDriverIds = new Set(order.declinedDriverIds || []);
  const visibleDrivers = state.drivers.filter((driver) => isDriverAutoAssignable(driver) && !declinedDriverIds.has(driver.id));
  const assignmentCounts = visibleDrivers.map((driver) => getDriverFairnessStats(driver).assignmentCount);
  const minimumAssignments = assignmentCounts.length ? Math.min(...assignmentCounts) : 0;

  return visibleDrivers
    .map((driver) => {
      const currentPoint = getDriverCurrentPoint(driver);
      const supportsOrder = driverSupportsOrder(driver, order);
      const distanceMeters = pickup && currentPoint ? getDistanceBetweenPoints(currentPoint, pickup) : undefined;
      const etaSeconds = distanceMeters !== undefined ? Math.round((distanceMeters / 28000) * 3600) : undefined;
      const rating = getDriverRatingStats(driver);
      const fairness = getDriverFairnessStats(driver);
      const distancePenalty = distanceMeters === undefined ? 5000 : distanceMeters / 10;
      const ratingPenalty = rating.count ? clamp((5 - rating.average) * 2, 0, 8) : 4;
      const workloadPenalty = clamp((fairness.assignmentCount - minimumAssignments) * 2 + fairness.recentAssignments * 2, 0, 10);
      const isPriorityMatch = isPriorityDriver(driver)
        && supportsOrder
        && distanceMeters !== undefined
        && distanceMeters <= PRIORITY_DRIVER_RADIUS_METERS;
      const idleBonus = fairness.lastAssignedAt
        ? clamp((Date.now() - fairness.lastAssignedAt) / (1000 * 60 * 60 * 3), 0, 14)
        : 14;
      const vehiclePenalty = supportsOrder ? 0 : 120;
      const tieBreaker = stableHash(`${order.id}:${driver.id}`) / 10000000000;
      const matchScore =
        vehiclePenalty +
        distancePenalty +
        ratingPenalty +
        workloadPenalty +
        (isPriorityMatch ? PRIORITY_DRIVER_SCORE_BONUS : 0) -
        idleBonus +
        tieBreaker;
      const scoreBreakdown = {
        vehicle: vehiclePenalty,
        distance: Math.round(distancePenalty),
        rating: Math.round(ratingPenalty),
        workload: Math.round(workloadPenalty),
        priorityCredit: isPriorityMatch ? PRIORITY_DRIVER_SCORE_BONUS : 0,
        idleCredit: Math.round(idleBonus),
      };

      return {
        ...driver,
        service,
        supportsOrder,
        ratingAverage: rating.average,
        ratingCount: rating.count,
        reviewSnippets: rating.reviews,
        assignmentCount: fairness.assignmentCount,
        recentAssignments: fairness.recentAssignments,
        lastAssignedAt: fairness.lastAssignedAt,
        isPriorityMatch,
        distanceMeters,
        distanceLabel: distanceMeters !== undefined ? formatDistance(distanceMeters) : 'GPS pending',
        etaLabel: etaSeconds ? formatDuration(etaSeconds) : 'ETA pending',
        badgeType: distanceMeters === undefined ? 'neutral' : distanceMeters < 2000 ? 'success' : distanceMeters < 5000 ? 'info' : 'warning',
        matchScore,
        scoreBreakdown,
        matchReason: [
          isPriorityMatch ? 'priority driver within 4 km' : '',
          supportsOrder ? 'vehicle match' : 'vehicle fallback',
          distanceMeters !== undefined ? `${formatDistance(distanceMeters)} from pickup` : 'GPS pending',
          `${rating.average.toFixed(1)}/5 rating`,
          `${fairness.recentAssignments} jobs in 24h`,
        ].filter(Boolean).join(' · '),
      };
    })
    .filter((driver) => driver.supportsOrder)
    .sort((left, right) => {
      if (left.isPriorityMatch !== right.isPriorityMatch) {
        return left.isPriorityMatch ? -1 : 1;
      }

        if (left.distanceMeters !== undefined && right.distanceMeters !== undefined) {
          return left.distanceMeters - right.distanceMeters;
        }

        if (left.distanceMeters !== undefined) {
          return -1;
        }

        if (right.distanceMeters !== undefined) {
          return 1;
        }

        return left.matchScore - right.matchScore;
    });
}

function getSuggestedDispatchOrder() {
  const pendingOrders = sortByRecent(state.orders.filter((order) => getOrderStatus(order) === 'pending_assignment'));
  if (!pendingOrders.length) {
    return null;
  }

  return [...pendingOrders]
    .map((order) => {
      const bestMatch = getNearbyDriverMatches(order)[0];
      return {
        order,
        bestDistance: bestMatch?.distanceMeters ?? Number.MAX_SAFE_INTEGER,
        isGpsReady: Number.isFinite(bestMatch?.distanceMeters),
      };
    })
    .sort((left, right) => {
      if (left.isGpsReady !== right.isGpsReady) {
        return left.isGpsReady ? -1 : 1;
      }

      return left.bestDistance - right.bestDistance;
    })[0]?.order || pendingOrders[0];
}

function getScheduledMillis(order) {
  if (order.timingMode !== 'later') {
    return 0;
  }

  const date = safeText(order.scheduleDate);
  const time = safeText(order.scheduleTime, '00:00');
  const millis = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function isAutoAssignableOrder(order) {
  if (!state.settings.autoAssignEnabled) return false;
  if (getOrderStatus(order) !== 'pending_assignment') return false;
  if (order.driverId) return false;

  if (order.timingMode === 'later') {
    const scheduledMillis = getScheduledMillis(order);
    if (scheduledMillis && scheduledMillis - Date.now() > 1000 * 60 * 45) {
      return false;
    }
  }

  return true;
}

function isImmediatePendingWithoutDriver(order) {
  return getOrderStatus(order) === 'pending_assignment' && !order.driverId && order.timingMode !== 'later';
}

function getDriverSearchExpiryMillis(order) {
  const explicitExpiry = toMillis(order.driverSearchExpiresAt);
  if (explicitExpiry) {
    return explicitExpiry;
  }

  const createdAt = toMillis(order.createdAt);
  return createdAt ? createdAt + DRIVER_SEARCH_TIMEOUT_MS : 0;
}

function isDriverSearchExpired(order) {
  const expiry = getDriverSearchExpiryMillis(order);
  return !!expiry && Date.now() >= expiry;
}

async function recordDriverSearchEvent(order, eventName, metadata = {}) {
  await addDoc(col.activityEvents, compact({
    userId: order.userId || order.customerId || '',
    userName: getCustomerName(order),
    userRole: 'customer',
    eventName,
    featureKey: 'driver_matching',
    featureLabel: 'Driver matching',
    screen: 'admin_dispatch',
    route: '/admin/data',
    platform: 'admin_web',
    metadata: compact({
      orderId: order.id,
      orderNumber: getOrderNumber(order),
      serviceLabel: getServiceLabel(order),
      vehicleType: order.cargoVehicleKey || order.vehicleType || '',
      vehicleLabel: order.cargoVehicleLabel || order.vehicleLabel || '',
      ...metadata,
    }),
    dateKey: new Date().toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  }));
}

async function markOrderWaitingForDriver(order, reason = 'No online nearby driver matched this order yet.') {
  if (!isImmediatePendingWithoutDriver(order)) {
    return;
  }

  const lastNoDriverAt = toMillis(order.noNearbyDriverAt);
  if (lastNoDriverAt && Date.now() - lastNoDriverAt < DRIVER_WAITING_UPDATE_THROTTLE_MS) {
    return;
  }

  await updateDoc(orderRef(order.id), compact({
    driverSearchStatus: 'waiting_for_driver',
    driverSearchMessage: `We are still looking for a nearby ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'doordrop')} driver.`,
    noNearbyDriverAt: serverTimestamp(),
    noNearbyDriverReason: reason,
    updatedAt: serverTimestamp(),
  }));

  await recordDriverSearchEvent(order, 'no_nearby_driver', { reason }).catch(() => null);
}

async function autoCancelDriverSearchOrder(order) {
  if (!isImmediatePendingWithoutDriver(order) || !isDriverSearchExpired(order)) {
    return false;
  }

  await updateDoc(orderRef(order.id), compact({
    status: 'cancelled',
    cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON,
    cancelledBy: 'dispatch',
    cancelledAt: serverTimestamp(),
    driverSearchStatus: 'auto_cancelled',
    driverSearchMessage: 'We could not find an online nearby driver in time, so the order was cancelled automatically.',
    autoCancelledAt: serverTimestamp(),
    autoCancelledReason: DRIVER_SEARCH_TIMEOUT_REASON,
    updatedAt: serverTimestamp(),
  }));

  await Promise.all([
    createOrderNotification(order, 'cancelled', { cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON }).catch(() => null),
    recordDriverSearchEvent(order, 'order_auto_cancelled_no_driver', { reason: DRIVER_SEARCH_TIMEOUT_REASON }).catch(() => null),
  ]);

  return true;
}

function getAutoAssignmentCandidate(order) {
  return getNearbyDriverMatches(order)[0] || null;
}

function scheduleAutoAssignment(delayMs = AUTO_ASSIGN_SNAPSHOT_DELAY_MS) {
  if (!state.user || !state.settings.autoAssignEnabled) {
    return;
  }

  clearTimeout(state.autoAssignTimer);
  const delay = Math.max(0, Number(delayMs) || 0);
  state.autoAssignTimer = setTimeout(() => {
    state.autoAssignTimer = null;
    runAutoAssignmentQueue().catch((error) => {
      setFeedback(error.message || 'Automatic assignment could not run.', 'error');
    });
  }, delay);
}

async function runAutoAssignmentQueue() {
  if (state.autoAssigning || !state.user || !state.settings.autoAssignEnabled) {
    return;
  }

  const pending = [...state.orders]
    .filter(isAutoAssignableOrder)
    .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt))
    .slice(0, AUTO_ASSIGN_BATCH_SIZE);

  if (!pending.length) {
    return;
  }

  state.autoAssigning = true;
  let shouldRetrySoon = false;

  try {
    let assignedCount = 0;
    let cancelledCount = 0;
    for (const order of pending) {
      try {
        if (await autoCancelDriverSearchOrder(order)) {
          cancelledCount += 1;
          continue;
        }
      } catch {
        continue;
      }

      const driver = getAutoAssignmentCandidate(order);
      if (!driver) {
        await markOrderWaitingForDriver(order).catch(() => null);
        shouldRetrySoon = true;
        continue;
      }

      try {
        await assignDriver(order.id, driver.id, {
          mode: 'auto',
          score: driver.matchScore,
          reason: driver.matchReason,
        });
        assignedCount += 1;
      } catch {
        // Another admin tab or the customer app may have assigned it first.
      }
    }

    if (assignedCount) {
      setFeedback(`${assignedCount} order${assignedCount === 1 ? '' : 's'} assigned automatically and fairly.`, 'success');
    } else if (cancelledCount) {
      setFeedback(`${cancelledCount} order${cancelledCount === 1 ? '' : 's'} cancelled after no nearby driver was found.`, 'info');
    }
  } finally {
    state.autoAssigning = false;
    const hasPendingAutoAssignableOrder = state.orders.some(isAutoAssignableOrder);
    if (shouldRetrySoon && hasPendingAutoAssignableOrder && !state.autoAssignTimer) {
      scheduleAutoAssignment(AUTO_ASSIGN_RETRY_DELAY_MS);
    }
  }
}

function getServiceStats() {
  return SERVICE_CATALOG.map((service) => {
    const serviceOrders = state.orders.filter((order) => serviceKeyFromOrder(order) === service.key);
    const delivered = serviceOrders.filter((order) => getOrderStatus(order) === 'delivered');
    const cancelled = serviceOrders.filter((order) => getOrderStatus(order) === 'cancelled');
    const completeBase = delivered.length + cancelled.length;
    const completion = completeBase ? Math.round((delivered.length / completeBase) * 100) : 0;
    const revenue = delivered.reduce((sum, order) => sum + getOrderAmount(order), 0);
    return { ...service, orders: serviceOrders, delivered, cancelled, completion, revenue };
  });
}

function getAnalytics() {
  const orders = state.orders;
  const active = orders.filter((order) => ACTIVE_STATUSES.includes(getOrderStatus(order)));
  const pending = orders.filter((order) => getOrderStatus(order) === 'pending_assignment');
  const moving = orders.filter((order) => ['driver_assigned', 'driver_at_pickup', 'in_transit'].includes(getOrderStatus(order)));
  const delivered = orders.filter((order) => getOrderStatus(order) === 'delivered');
  const cancelled = orders.filter((order) => getOrderStatus(order) === 'cancelled');
  const deliveredToday = delivered.filter((order) => isToday(order.updatedAt || order.createdAt));
  const activeDrivers = state.drivers.filter((driver) => driver.isAvailable && !driver.currentOrderId);
  const busyDrivers = state.drivers.filter((driver) => !!driver.currentOrderId);
  const offlineDrivers = state.drivers.filter((driver) => !driver.isAvailable && !driver.currentOrderId);
  const activeUsers = state.users.filter((user) => isActiveRecently(user.lastActiveAt || user.updatedAt || user.createdAt));
  const revenue = delivered.reduce((sum, order) => sum + getOrderAmount(order), 0);
  const revenueToday = deliveredToday.reduce((sum, order) => sum + getOrderAmount(order), 0);
  const pipeline = active.reduce((sum, order) => sum + getOrderAmount(order), 0);
  const completionBase = delivered.length + cancelled.length;
  const completionRate = completionBase ? Math.round((delivered.length / completionBase) * 100) : 0;
  const driverUtilization = state.drivers.length ? Math.round((busyDrivers.length / state.drivers.length) * 100) : 0;

  return {
    total: orders.length,
    active,
    pending,
    moving,
    delivered,
    cancelled,
    deliveredToday,
    activeDrivers,
    busyDrivers,
    offlineDrivers,
    activeUsers,
    revenue,
    revenueToday,
    pipeline,
    completionRate,
    driverUtilization,
    services: getServiceStats(),
  };
}

function orderMatchesQuery(order) {
  const query = normalize(state.query);
  if (!query) return true;

  return normalize([
    order.id,
    getOrderNumber(order),
    order.orderId,
    order.trackingId,
    order.reference,
    getCustomerName(order),
    getCustomerContact(order),
    getRecipientName(order),
    getRecipientContact(order),
    getPickup(order),
    getDropoff(order),
    getServiceLabel(order),
    getDriverName(order),
    getOrderStatus(order),
  ].join(' ')).includes(query);
}

function compactLookupValue(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function orderLookupCandidates(order) {
  return [
    order.id,
    order.orderNumber,
    order.orderId,
    order.trackingId,
    order.reference,
    order.paymentReference,
    order.transactionReference,
    getOrderNumber(order),
  ].map((value) => safeText(value)).filter(Boolean);
}

function matchesOrderLookup(order, lookupValue) {
  const lookup = normalize(lookupValue);
  const compactLookup = compactLookupValue(lookupValue);
  if (!lookup && !compactLookup) return false;

  return orderLookupCandidates(order).some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    const compactCandidate = compactLookupValue(candidate);
    return (
      normalizedCandidate === lookup
      || compactCandidate === compactLookup
      || (lookup.length >= 6 && normalizedCandidate.includes(lookup))
      || (compactLookup.length >= 6 && compactCandidate.includes(compactLookup))
    );
  });
}

function findOrderByLookup(lookupValue) {
  return sortByRecent(state.orders).find((order) => matchesOrderLookup(order, lookupValue)) || null;
}

function driverMatchesQuery(driver) {
  const query = normalize(state.query);
  if (!query) return true;

  return normalize([
    driver.fullName,
    driver.phoneNumber,
    driver.email,
    driver.vehicleLabel,
    driver.vehicleType,
    driver.plateNumber,
    getPriorityDriverLabel(driver),
    getDriverVerification(driver).label,
  ].join(' ')).includes(query);
}

function userMatchesQuery(user) {
  const query = normalize(state.query);
  if (!query) return true;

  return normalize([
    user.fullName,
    user.phoneNumber,
    user.email,
    user.uid,
    user.id,
  ].join(' ')).includes(query);
}

function paymentMatchesQuery(payment) {
  const query = normalize(state.query);
  if (!query) return true;

  const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
  return normalize([
    payment.id,
    payment.driverId,
    payment.driverName,
    payment.driverPhone,
    payment.payerPhone,
    payment.transactionReference,
    payment.method,
    payment.status,
    payment.dateKey,
    driver?.fullName,
    driver?.phoneNumber,
    driver?.plateNumber,
  ].join(' ')).includes(query);
}

function orderRef(orderId) {
  return doc(db, 'orders', orderId);
}

function driverRef(driverId) {
  return doc(db, 'drivers', driverId);
}

function paymentReviewRef(paymentId) {
  return doc(db, 'commissionPaymentReviews', paymentId);
}

function driverCommissionPaymentRef(driverId, paymentId) {
  return doc(db, 'drivers', driverId, 'commissionPayments', paymentId);
}

function notificationRef() {
  return doc(col.notifications);
}

async function createOrderNotification(order, status, options = {}) {
  const userId = order.userId || order.customerId;
  if (!userId) {
    return;
  }

  if (normalize(userId).startsWith('manual:')) {
    return;
  }

  const user = state.users.find((item) => item.id === userId || item.uid === userId);
  if (user?.notificationPreferences?.orderUpdates === false) {
    return;
  }

  const titleMap = {
    pending_assignment: 'Order received',
    driver_assigned: 'Driver assigned',
    driver_at_pickup: 'Driver reached pickup',
    in_transit: 'Order in transit',
    delivered: 'Order delivered',
    cancelled: 'Order cancelled',
  };

  let message = `${getOrderNumber(order)} is now ${getStatusLabel(status).toLowerCase()}.`;
  if (status === 'driver_assigned') {
    message = `${safeText(options.driverName || order.driverName, 'A driver')} has been assigned to ${getOrderNumber(order)}.`;
  } else if (status === 'driver_at_pickup') {
    message = `${getOrderNumber(order)} has reached the pickup point and loading can begin.`;
  } else if (status === 'in_transit') {
    message = `${getOrderNumber(order)} is now on the road to the drop-off.`;
  } else if (status === 'delivered') {
    message = `${getOrderNumber(order)} was marked delivered successfully.`;
  } else if (status === 'cancelled') {
    message = `${getOrderNumber(order)} was cancelled. ${safeText(options.cancellationReason, 'Contact support if this was unexpected.')}`;
  }

  await setDoc(notificationRef(), compact({
    userId,
    orderId: order.id,
    orderNumber: getOrderNumber(order),
    orderStatus: status,
    title: titleMap[status] || 'Order updated',
    message,
    type: status === 'pending_assignment' ? 'order_created' : 'order_status',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

function clearDriverFields() {
  return {
    driverId: deleteField(),
    driverName: deleteField(),
    driverPhone: deleteField(),
    driverVehicleType: deleteField(),
    driverVehicleLabel: deleteField(),
    driverPlateNumber: deleteField(),
    driverLatitude: deleteField(),
    driverLongitude: deleteField(),
    driverHeading: deleteField(),
    driverSpeedKph: deleteField(),
    driverAccuracyMeters: deleteField(),
    driverLocationUpdatedAt: deleteField(),
    assignedAt: deleteField(),
    acceptedByDriverAt: deleteField(),
  };
}

function driverPayload(driver) {
  const driverVehicleType = normalizeDriverVehicleKey(driver.vehicleType);
  return compact({
    driverId: driver.id,
    driverName: driver.fullName,
    driverPhone: driver.phoneNumber,
    driverVehicleType: isCanonicalDriverVehicleType(driverVehicleType) ? driverVehicleType : driver.vehicleType,
    driverVehicleLabel: driver.vehicleLabel || formatVehicleTypeLabel(driverVehicleType),
    driverPlateNumber: driver.plateNumber,
    driverLatitude: driver.currentLatitude,
    driverLongitude: driver.currentLongitude,
    driverHeading: driver.currentHeading,
    driverSpeedKph: driver.currentSpeedKph,
    driverAccuracyMeters: driver.currentAccuracyMeters,
    driverLocationUpdatedAt: driver.lastLocationUpdatedAt ?? serverTimestamp(),
    assignedAt: serverTimestamp(),
    acceptedByDriverAt: serverTimestamp(),
  });
}

async function assignDriver(orderId, driverId, assignment = {}) {
  let assignedOrder = null;
  let assignedDriver = null;

  await runTransaction(db, async (transaction) => {
    const [orderSnapshot, driverSnapshot] = await Promise.all([
      transaction.get(orderRef(orderId)),
      transaction.get(driverRef(driverId)),
    ]);
    if (!orderSnapshot.exists()) throw new Error('Order not found.');
    if (!driverSnapshot.exists()) throw new Error('Driver not found.');

    const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
    const driver = { id: driverSnapshot.id, ...driverSnapshot.data() };
    const isSameAssignment = order.driverId === driver.id && driver.currentOrderId === orderId;

    if (getOrderStatus(order) !== 'pending_assignment' && order.driverId !== driver.id) {
      throw new Error(`${getOrderNumber(order)} is no longer waiting for assignment.`);
    }

    if (!isSameAssignment && (!driver.isAvailable || driver.currentOrderId)) {
      throw new Error('This driver is not available for a new order.');
    }

    if (!isDriverVerifiedForDispatch(driver)) {
      throw new Error('This driver is still waiting for admin verification.');
    }

    if (!driverSupportsOrder(driver, order)) {
      throw new Error(`${formatVehicleTypeLabel(driver.vehicleType)} driver cannot receive ${getServiceLabel(order)} orders.`);
    }

    if (order.driverId && order.driverId !== driver.id) {
      transaction.update(driverRef(order.driverId), {
        isAvailable: true,
        currentOrderId: '',
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(orderRef(orderId), compact({
      status: 'driver_assigned',
      ...driverPayload(driver),
      assignmentMode: safeText(assignment.mode, 'manual'),
      assignmentScore: Number.isFinite(assignment.score) ? Math.round(assignment.score * 100) / 100 : undefined,
      assignmentReason: safeText(assignment.reason),
      driverSearchStatus: 'assigned',
      driverSearchMessage: `${safeText(driver.fullName, 'A driver')} has been assigned to this order.`,
      driverSearchResolvedAt: serverTimestamp(),
      cancellationReason: deleteField(),
      cancelledAt: deleteField(),
      cancelledBy: deleteField(),
      updatedAt: serverTimestamp(),
    }));

    transaction.update(driverRef(driver.id), {
      isAvailable: false,
      currentOrderId: orderId,
      assignmentCount: increment(1),
      lastAssignedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    assignedOrder = order;
    assignedDriver = driver;
  });

  if (assignedOrder && assignedDriver) {
    await createOrderNotification(assignedOrder, 'driver_assigned', {
      driverName: assignedDriver.fullName,
    });
  }
}

async function unassignDriver(orderId) {
  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) throw new Error('Order not found.');

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  const batch = writeBatch(db);

  batch.update(orderRef(orderId), compact({
    status: 'pending_assignment',
    driverSearchStatus: order.timingMode === 'later' ? undefined : 'searching',
    driverSearchMessage: order.timingMode === 'later'
      ? undefined
      : `Looking for the nearest online ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'doordrop')} driver.`,
    driverSearchStartedAt: order.timingMode === 'later' ? undefined : serverTimestamp(),
    driverSearchExpiresAt: order.timingMode === 'later' ? undefined : new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
    driverSearchResolvedAt: deleteField(),
    noNearbyDriverAt: deleteField(),
    noNearbyDriverReason: deleteField(),
    autoCancelledAt: deleteField(),
    autoCancelledReason: deleteField(),
    updatedAt: serverTimestamp(),
    cancellationReason: deleteField(),
    cancelledAt: deleteField(),
    cancelledBy: deleteField(),
    ...clearDriverFields(),
  }));

  if (order.driverId) {
    batch.update(driverRef(order.driverId), {
      isAvailable: true,
      currentOrderId: '',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  await createOrderNotification(order, 'pending_assignment');
}

async function updateOrderStatus(orderId, status, options = {}) {
  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) throw new Error('Order not found.');

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (status === order.status) {
    return;
  }

  if (status === 'pending_assignment') {
    await unassignDriver(orderId);
    return;
  }

  if (!order.driverId && ['driver_assigned', 'driver_at_pickup', 'in_transit', 'delivered'].includes(status)) {
    throw new Error('Assign a driver first before moving this order forward.');
  }

  const batch = writeBatch(db);
  batch.update(orderRef(orderId), compact({
    status,
    updatedAt: serverTimestamp(),
    cancelledBy: status === 'cancelled' ? 'dispatch' : deleteField(),
    cancelledAt: status === 'cancelled' ? serverTimestamp() : deleteField(),
    cancellationReason: status === 'cancelled' ? safeText(options.cancellationReason, 'Cancelled by dispatch') : deleteField(),
  }));

  if ((status === 'delivered' || status === 'cancelled') && order.driverId) {
    batch.update(driverRef(order.driverId), compact({
      isAvailable: true,
      currentOrderId: '',
      subscriptionStatus: 'free_access',
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  await createOrderNotification(order, status, options);
}

async function createManualOrder(form) {
  const formData = new FormData(form);
  const linkedUserId = safeText(formData.get('linkedUserId'));
  const linkedUser = state.users.find((user) => user.id === linkedUserId || user.uid === linkedUserId) || null;
  const service = getServiceConfig(safeText(formData.get('serviceKey'), 'parcel'));
  const orderVehicleKey = service.key === 'parcel' ? 'bodaboda' : service.key;
  const orderVehicleLabel = service.key === 'parcel' ? 'Bodaboda / Motorcycle' : service.title;
  const orderDocument = doc(col.orders);
  const amount = parseAmount(formData.get('amount'));
  const timingMode = safeText(formData.get('timingMode'), 'now') === 'later' ? 'later' : 'now';
  const scheduleDate = safeText(formData.get('scheduleDate'));
  const scheduleTime = safeText(formData.get('scheduleTime'));
  const scheduleLabel =
    timingMode === 'later'
      ? `Scheduled${scheduleDate || scheduleTime ? ` • ${[scheduleDate, scheduleTime].filter(Boolean).join(' at ')}` : ''}`
      : 'Dispatch now';
  const customerName = safeText(formData.get('customerName'), linkedUser?.fullName || 'Manual customer');
  const customerPhone = safeText(formData.get('customerPhone'), linkedUser?.phoneNumber || 'Not provided');
  const customerEmail = safeText(formData.get('customerEmail'), linkedUser?.email || '');
  const recipientName = safeText(formData.get('recipientName'), customerName);
  const recipientPhone = safeText(formData.get('recipientPhone'), customerPhone);
  const totalLabel = amount > 0 ? formatMoney(amount) : 'To be quoted';
  const fareLabel = amount > 0 ? formatMoney(amount) : 'To be quoted';

  const order = compact({
    id: orderDocument.id,
    orderNumber: getGeneratedOrderNumber(orderDocument.id),
    userId: linkedUser?.id || `manual:${normalize(customerPhone || customerName || orderDocument.id).replaceAll(/\s+/g, '-')}`,
    customerName,
    customerEmail,
    customerPhone,
    flow: service.flow,
    serviceLabel: service.title,
    status: 'pending_assignment',
    driverSearchStatus: timingMode === 'later' ? undefined : 'searching',
    driverSearchMessage: timingMode === 'later' ? undefined : `Looking for the nearest online ${service.title} driver.`,
    driverSearchStartedAt: timingMode === 'later' ? undefined : serverTimestamp(),
    driverSearchExpiresAt: timingMode === 'later' ? undefined : new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
    pickupLabel: safeText(formData.get('pickupLabel'), 'Pickup not provided'),
    dropoffLabel: safeText(formData.get('dropoffLabel'), 'Drop-off not provided'),
    pickupLatitude: parseCoordinate(formData.get('pickupLatitude')),
    pickupLongitude: parseCoordinate(formData.get('pickupLongitude')),
    dropoffLatitude: parseCoordinate(formData.get('dropoffLatitude')),
    dropoffLongitude: parseCoordinate(formData.get('dropoffLongitude')),
    etaLabel: timingMode === 'later' ? 'Scheduled dispatch' : 'Dispatch assigning',
    fareLabel,
    totalLabel,
    timingMode,
    scheduleDate,
    scheduleTime,
    scheduleLabel,
    recipientName,
    recipientPhone,
    routeLabel: `${safeText(formData.get('pickupLabel'))} -> ${safeText(formData.get('dropoffLabel'))}`,
    distanceLabel: safeText(formData.get('distanceLabel')),
    durationLabel: safeText(formData.get('durationLabel')),
    distanceMeters: parseCoordinate(formData.get('distanceMeters')),
    durationSeconds: parseCoordinate(formData.get('durationSeconds')),
    parcelTypeKey: service.key === 'parcel' ? 'manual' : undefined,
    parcelTypeLabel: service.key === 'parcel' ? 'Manual parcel order' : undefined,
    cargoVehicleKey: orderVehicleKey,
    cargoVehicleLabel: orderVehicleLabel,
    cargoCapacityLabel: safeText(formData.get('cargoCapacityLabel')),
    notes: safeText(formData.get('notes')),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(orderDocument, order);
  await createOrderNotification(order, 'pending_assignment');
  state.selectedOrderId = orderDocument.id;
}

async function createDriverRecord(form) {
  const formData = new FormData(form);
  const requestedId = safeText(formData.get('authUid'));
  const driverId = requestedId || doc(col.drivers).id;
  const driverDocument = driverRef(driverId);
  const vehicleType = normalizeDriverVehicleKey(formData.get('vehicleType'));
  const requestedAvailable = formData.get('isAvailable') === 'on';
  const payload = compact({
    id: driverId,
    authUid: requestedId || undefined,
    email: safeText(formData.get('email')).toLowerCase(),
    fullName: safeText(formData.get('fullName'), 'doordrop driver'),
    phoneNumber: safeText(formData.get('phoneNumber'), 'Not provided'),
    vehicleType: isCanonicalDriverVehicleType(vehicleType) ? vehicleType : undefined,
    vehicleLabel: safeText(formData.get('vehicleLabel'), formatVehicleTypeLabel(vehicleType)),
    vehicleColor: safeText(formData.get('vehicleColor')),
    plateNumber: safeText(formData.get('plateNumber')).toUpperCase(),
    verificationStatus: 'verified',
    verificationReviewedAt: serverTimestamp(),
    verifiedAt: serverTimestamp(),
    verifiedByAdminId: state.user?.uid,
    verifiedByAdminEmail: state.user?.email,
    isAvailable: requestedAvailable,
    isPriorityDriver: formData.get('isPriorityDriver') === 'on',
    currentOrderId: '',
    subscriptionStatus: 'free_access',
    currentLatitude: parseCoordinate(formData.get('currentLatitude')),
    currentLongitude: parseCoordinate(formData.get('currentLongitude')),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  await setDoc(driverDocument, payload, { merge: true });
}

async function togglePriorityDriver(driverId) {
  const driver = getDriverById(driverId);
  if (!driver) {
    throw new Error('Driver profile not found.');
  }

  const nextPriorityState = !isPriorityDriver(driver);
  await updateDoc(driverRef(driverId), compact({
    isPriorityDriver: nextPriorityState,
    priorityDriverUpdatedAt: serverTimestamp(),
    priorityDriverUpdatedBy: state.user?.uid,
    priorityDriverUpdatedByEmail: state.user?.email,
    updatedAt: serverTimestamp(),
  }));

  return nextPriorityState;
}

async function verifyDriverAccount(driverId) {
  const driver = getDriverById(driverId);
  if (!driver) {
    throw new Error('Driver profile not found.');
  }

  await updateDoc(driverRef(driverId), compact({
    verificationStatus: 'verified',
    verificationReviewedAt: serverTimestamp(),
    verifiedAt: serverTimestamp(),
    verifiedByAdminId: state.user?.uid,
    verifiedByAdminEmail: state.user?.email,
    verificationRejectedAt: deleteField(),
    verificationRejectedByAdminId: deleteField(),
    verificationRejectedByAdminEmail: deleteField(),
    verificationRejectionReason: deleteField(),
    isAvailable: driver.currentOrderId ? false : true,
    subscriptionStatus: 'free_access',
    updatedAt: serverTimestamp(),
  }));
}

async function rejectDriverAccount(driverId, reason) {
  const driver = getDriverById(driverId);
  if (!driver) {
    throw new Error('Driver profile not found.');
  }

  await updateDoc(driverRef(driverId), compact({
    verificationStatus: 'rejected',
    verificationReviewedAt: serverTimestamp(),
    verificationRejectedAt: serverTimestamp(),
    verificationRejectedByAdminId: state.user?.uid,
    verificationRejectedByAdminEmail: state.user?.email,
    verificationRejectionReason: safeText(reason, 'Admin rejected driver verification'),
    isAvailable: false,
    currentOrderId: driver.currentOrderId || '',
    updatedAt: serverTimestamp(),
  }));
}

function ensureRuntimeShell() {
  injectRuntimeStyles();

  if (!ui.authScreen) {
    const overlay = document.createElement('div');
    overlay.id = 'authScreen';
    overlay.className = 'admin-auth-overlay';
    overlay.innerHTML = `
      <div class="admin-auth-card">
        <span class="eyebrow">Admin access</span>
        <h2>doordrop command center</h2>
        <p class="muted">Sign in with the doordrop admin Firebase account.</p>
        <div class="admin-auth-tabs">
          <button class="btn soft active" id="loginModeButton" type="button" data-keep-enabled="true">Sign in</button>
        </div>
        <form id="authForm" class="form-grid">
          <div class="field span-2">
            <label for="emailInput">Email address</label>
            <input id="emailInput" name="email" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="passwordInput">Password</label>
            <input id="passwordInput" name="password" type="password" autocomplete="current-password" required />
          </div>
          <div class="span-2 admin-auth-actions">
            <button class="btn primary" id="authSubmitButton" type="submit" data-keep-enabled="true">Sign in</button>
            <p class="mini">Access is limited to the approved doordrop admin email.</p>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  if (!ui.modalRoot) {
    const modalRoot = document.createElement('div');
    modalRoot.id = 'adminModalRoot';
    modalRoot.className = 'admin-modal-root hidden';
    document.body.appendChild(modalRoot);
  }

  syncUiRefs();
}

function injectRuntimeStyles() {
  if ($('adminRuntimeStyles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'adminRuntimeStyles';
  style.textContent = `
    .hidden { display: none !important; }
    .admin-auth-overlay {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(7, 17, 29, 0.52);
      backdrop-filter: blur(16px);
    }
    .admin-auth-card {
      width: min(520px, 100%);
      padding: 28px;
      display: grid;
      gap: 18px;
      border-radius: var(--radius);
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(223, 232, 239, 1);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
    }
    .admin-auth-card h2 {
      color: var(--ink);
      font-size: 1.45rem;
    }
    .admin-auth-tabs,
    .admin-inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .admin-auth-tabs .btn.active {
      background: var(--green);
      color: #fff;
      box-shadow: 0 10px 22px rgba(15, 159, 110, 0.2);
    }
    .admin-auth-actions {
      display: grid;
      gap: 10px;
    }
    .admin-modal-root {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(7, 17, 29, 0.46);
      backdrop-filter: blur(10px);
    }
    .admin-modal-card {
      width: min(760px, 100%);
      max-height: calc(100vh - 48px);
      overflow: auto;
      padding: 24px;
      display: grid;
      gap: 18px;
      border-radius: var(--radius);
      background: #fff;
      border: 1px solid rgba(223, 232, 239, 1);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
    }
    .admin-modal-card.wide {
      width: min(920px, 100%);
    }
    .admin-modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .admin-modal-close {
      width: 40px;
      height: 40px;
      border-radius: var(--radius);
      background: var(--surface-muted);
      color: var(--ink-soft);
      font-weight: 900;
    }
    .field small,
    .admin-helper-text {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.45;
    }
    .map-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .map-svg polyline {
      fill: none;
      stroke: rgba(37, 99, 235, 0.85);
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .map-svg line {
      stroke: rgba(16, 185, 129, 0.36);
      stroke-width: 1;
      stroke-dasharray: 2.4 2.4;
    }
    .map-panel-caption strong {
      display: block;
      margin-bottom: 4px;
    }
    .map-meta-grid {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .map-meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      max-width: 100%;
      padding: 8px 10px;
      border-radius: var(--radius);
      background: rgba(248, 250, 252, 0.98);
      border: 1px solid rgba(223, 232, 239, 1);
      color: var(--ink-soft);
      font-size: 0.78rem;
      font-weight: 800;
    }
    .admin-empty-note {
      color: var(--muted);
      font-size: 0.86rem;
      line-height: 1.55;
    }
  `;
  document.head.appendChild(style);
}

function openModal({ title, eyebrow, body, wide = false }) {
  if (!ui.modalRoot) {
    return;
  }

  ui.modalRoot.classList.remove('hidden');
  ui.modalRoot.innerHTML = `
    <div class="admin-modal-card ${wide ? 'wide' : ''}">
      <div class="admin-modal-head">
        <div>
          <span class="eyebrow">${escapeHtml(eyebrow || 'Admin task')}</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="admin-modal-close" type="button" data-close-modal="true" data-keep-enabled="true">×</button>
      </div>
      ${body}
    </div>
  `;
}

function closeModal() {
  if (!ui.modalRoot) {
    return;
  }

  ui.modalRoot.classList.add('hidden');
  ui.modalRoot.innerHTML = '';
}

function buildCustomerOptions() {
  const options = sortByRecent(state.users)
    .slice(0, 100)
    .map((user) => {
      const name = safeText(user.fullName || user.email, 'Customer');
      const contact = safeText(user.phoneNumber || user.email || user.id, 'No contact');
      return `<option value="${escapeHtml(user.id)}">${escapeHtml(name)} - ${escapeHtml(contact)}</option>`;
    })
    .join('');

  return `<option value="">Dispatch-only manual customer</option>${options}`;
}

function openCreateOrderModal() {
  openModal({
    title: 'Create manual order',
    eyebrow: 'Order operations',
    wide: true,
    body: `
      <form class="form-grid" data-form="create-order">
        <div class="field span-2">
          <label>Link to existing customer</label>
          <select name="linkedUserId">
            ${buildCustomerOptions()}
          </select>
          <small>Choose an existing app user if you want the order history and notifications to stay linked to that customer account.</small>
        </div>
        <div class="field">
          <label>Customer name</label>
          <input name="customerName" required />
        </div>
        <div class="field">
          <label>Customer phone</label>
          <input name="customerPhone" required />
        </div>
        <div class="field">
          <label>Customer email</label>
          <input name="customerEmail" type="email" />
        </div>
        <div class="field">
          <label>Service</label>
          <select name="serviceKey">
            ${SERVICE_CATALOG.map((service) => `<option value="${escapeHtml(service.key)}">${escapeHtml(service.title)}</option>`).join('')}
          </select>
        </div>
        <div class="field span-2">
          <label>Pickup address</label>
          <input name="pickupLabel" required />
        </div>
        <div class="field span-2">
          <label>Drop-off address</label>
          <input name="dropoffLabel" required />
        </div>
        <div class="field">
          <label>Recipient name</label>
          <input name="recipientName" />
        </div>
        <div class="field">
          <label>Recipient phone</label>
          <input name="recipientPhone" />
        </div>
        <div class="field">
          <label>Estimated total</label>
          <input name="amount" type="number" min="0" step="1" placeholder="42000" />
        </div>
        <div class="field">
          <label>Dispatch timing</label>
          <select name="timingMode">
            <option value="now">Dispatch now</option>
            <option value="later">Schedule for later</option>
          </select>
        </div>
        <div class="field">
          <label>Schedule date</label>
          <input name="scheduleDate" type="date" value="${escapeHtml(formatDateInputValue(Date.now()))}" />
        </div>
        <div class="field">
          <label>Schedule time</label>
          <input name="scheduleTime" type="time" />
        </div>
        <div class="field">
          <label>Pickup latitude</label>
          <input name="pickupLatitude" type="number" step="any" placeholder="-6.7924" />
        </div>
        <div class="field">
          <label>Pickup longitude</label>
          <input name="pickupLongitude" type="number" step="any" placeholder="39.2083" />
        </div>
        <div class="field">
          <label>Drop-off latitude</label>
          <input name="dropoffLatitude" type="number" step="any" />
        </div>
        <div class="field">
          <label>Drop-off longitude</label>
          <input name="dropoffLongitude" type="number" step="any" />
        </div>
        <div class="field span-2">
          <label>Notes</label>
          <textarea name="notes" placeholder="Handling instructions, cargo notes, access notes..."></textarea>
        </div>
        <div class="span-2 admin-inline-actions">
          <button class="btn primary" type="submit">Create order</button>
          <button class="btn soft" type="button" data-close-modal="true" data-keep-enabled="true">Cancel</button>
        </div>
      </form>
    `,
  });
}

function openAddDriverModal() {
  openModal({
    title: 'Add driver profile',
    eyebrow: 'Fleet management',
    wide: true,
    body: `
      <form class="form-grid" data-form="create-driver">
        <div class="field">
          <label>Full name</label>
          <input name="fullName" required />
        </div>
        <div class="field">
          <label>Phone number</label>
          <input name="phoneNumber" required />
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" />
        </div>
        <div class="field">
          <label>Driver auth UID</label>
          <input name="authUid" placeholder="Optional: link to an existing driver app account" />
        </div>
        <div class="field">
          <label>Vehicle type</label>
          <select name="vehicleType" required>
            <option value="bodaboda">Bodaboda / Motorcycle</option>
            <option value="toyo">TOYO</option>
            <option value="kirikuu">Kirikuu</option>
          </select>
        </div>
        <div class="field">
          <label>Vehicle label</label>
          <input name="vehicleLabel" required placeholder="Bodaboda / TOYO / Kirikuu" />
        </div>
        <div class="field">
          <label>Vehicle color</label>
          <input name="vehicleColor" />
        </div>
        <div class="field">
          <label>Plate number</label>
          <input name="plateNumber" required />
        </div>
        <div class="field">
          <label>Current latitude</label>
          <input name="currentLatitude" type="number" step="any" />
        </div>
        <div class="field">
          <label>Current longitude</label>
          <input name="currentLongitude" type="number" step="any" />
        </div>
        <div class="field span-2">
          <label><input name="isAvailable" type="checkbox" checked /> Available for dispatch immediately</label>
        </div>
        <div class="field span-2">
          <label><input name="isPriorityDriver" type="checkbox" /> Mark as priority doordrop driver</label>
          <small>Priority drivers are recommended first when they match the order vehicle and are within 4 km of pickup.</small>
        </div>
        <div class="span-2 admin-inline-actions">
          <button class="btn primary" type="submit">Save driver</button>
          <button class="btn soft" type="button" data-close-modal="true" data-keep-enabled="true">Cancel</button>
        </div>
      </form>
    `,
  });
}

function getDriverDocumentUrl(driver, key) {
  const documentRecord = driver?.verificationDocuments?.[key] || {};
  const url = safeText(documentRecord.downloadURL || (key === 'vehiclePhoto' ? driver?.vehiclePhotoURL : driver?.driverPhotoURL) || documentRecord.uri);
  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url) || /^blob:/i.test(url) ? url : '';
}

function renderDriverVerificationAsset(driver, key, label) {
  const documentRecord = driver?.verificationDocuments?.[key] || {};
  const url = getDriverDocumentUrl(driver, key);
  const uploadStatus = normalize(documentRecord.uploadStatus || (url ? 'uploaded' : 'not_submitted'));
  const fallbackLabel = uploadStatus === 'pending_upload'
    ? 'Photo pending upload'
    : uploadStatus === 'uploaded'
      ? 'Photo uploaded'
      : 'Photo optional / not submitted';
  const helper = safeText(documentRecord.uploadNote || documentRecord.fileName || documentRecord.mimeType);

  return `
    <div class="quick-card">
      <span>${escapeHtml(label)}</span>
      ${
        url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" style="width:100%;height:142px;object-fit:cover;border-radius:12px;margin-top:10px;border:1px solid var(--line);" /></a>`
          : `<strong>${escapeHtml(fallbackLabel)}</strong>${helper ? `<p class="muted">${escapeHtml(helper)}</p>` : ''}`
      }
    </div>
  `;
}

function openDriverDetails(driverId) {
  const driver = getDriverById(driverId);
  if (!driver) {
    setFeedback('Driver profile not found.', 'error');
    return;
  }

  const activeOrder = state.orders.find((order) => order.driverId === driver.id && !HISTORY_STATUSES.includes(getOrderStatus(order))) || null;
  const status = getDriverStatus(driver);
  const rating = getDriverRatingStats(driver);
  const fairness = getDriverFairnessStats(driver);
  const verification = getDriverVerification(driver);

  openModal({
    title: safeText(driver.fullName || driver.email, 'Driver profile'),
    eyebrow: 'Driver details',
    body: `
      <div class="quick-grid">
        <div class="quick-card"><span>Status</span><strong>${escapeHtml(status.label)}</strong></div>
        <div class="quick-card"><span>Vehicle</span><strong>${escapeHtml(getDriverVehicleLabel(driver, 'Vehicle pending'))}</strong></div>
        <div class="quick-card"><span>Phone</span><strong>${escapeHtml(safeText(driver.phoneNumber, 'No phone'))}</strong></div>
        <div class="quick-card"><span>Last active</span><strong>${escapeHtml(formatDateTime(driver.lastActiveAt || driver.lastLocationUpdatedAt || driver.updatedAt || driver.createdAt))}</strong></div>
        <div class="quick-card"><span>Rating</span><strong>${escapeHtml(rating.average.toFixed(1))}/5</strong></div>
        <div class="quick-card"><span>Assignments</span><strong>${escapeHtml(String(fairness.assignmentCount))}</strong></div>
        <div class="quick-card"><span>Priority</span><strong>${escapeHtml(isPriorityDriver(driver) ? 'Starred' : 'Standard')}</strong></div>
        <div class="quick-card"><span>Verification</span><strong>${escapeHtml(verification.label)}</strong></div>
        <div class="quick-card"><span>City</span><strong>${escapeHtml(safeText(driver.city, 'Not provided'))}</strong></div>
      </div>
      <div class="list-stack">
        <div class="list-card">
          <div class="list-head"><strong>Verification review</strong>${pill(verification.label, verification.className)}</div>
          <p class="muted">Review plate number, vehicle type, vehicle photo, and driver photo before allowing dispatch assignment.</p>
          <div class="quick-grid" style="margin-top:14px;">
            <div class="quick-card"><span>Driver name</span><strong>${escapeHtml(safeText(driver.fullName || driver.email, 'Not provided'))}</strong></div>
            <div class="quick-card"><span>Phone</span><strong>${escapeHtml(safeText(driver.phoneNumber, 'Not provided'))}</strong></div>
            <div class="quick-card"><span>Vehicle type</span><strong>${escapeHtml(formatVehicleTypeLabel(driver.vehicleType))}</strong></div>
            <div class="quick-card"><span>Plate number</span><strong>${escapeHtml(safeText(driver.plateNumber, 'Missing'))}</strong></div>
            <div class="quick-card"><span>Vehicle color</span><strong>${escapeHtml(safeText(driver.vehicleColor, 'Not provided'))}</strong></div>
            <div class="quick-card"><span>Submitted</span><strong>${escapeHtml(formatDateTime(driver.verificationSubmittedAt || driver.createdAt))}</strong></div>
          </div>
          <div class="quick-grid" style="margin-top:14px;">
            ${renderDriverVerificationAsset(driver, 'vehiclePhoto', 'Picha ya gari')}
            ${renderDriverVerificationAsset(driver, 'driverPhoto', 'Picha ya dereva')}
          </div>
          ${driver.verificationRejectionReason ? `<p class="muted">Rejection reason: ${escapeHtml(driver.verificationRejectionReason)}</p>` : ''}
        </div>
        <div class="list-card">
          <div class="list-head"><strong>doordrop priority</strong>${pill(getPriorityDriverLabel(driver), isPriorityDriver(driver) ? 'warning' : 'neutral')}</div>
          <p class="muted">Starred drivers are prioritized for matching when they are online, vehicle-compatible, and within 4 km of the order pickup point.</p>
        </div>
        <div class="list-card">
          <div class="list-head"><strong>Fairness profile</strong>${pill(`${fairness.recentAssignments} jobs today`, 'info')}</div>
          <p class="muted">Completed ${escapeHtml(String(fairness.completedOrders))} orders · cancelled ${escapeHtml(String(fairness.cancellationCount))} · last assigned ${escapeHtml(formatDateTime(fairness.lastAssignedAt))}</p>
        </div>
        <div class="list-card">
          <div class="list-head"><strong>Customer reviews</strong>${pill(`${rating.count} ratings`, 'success')}</div>
          <p class="muted">${escapeHtml(rating.reviews.length ? rating.reviews.map((review) => `${review.orderNumber}: ${review.rating}/5 ${review.review}`).join(' · ') : 'No written reviews yet.')}</p>
        </div>
        <div class="list-card">
          <div class="list-head"><strong>Plate number</strong>${pill(safeText(driver.plateNumber, 'Missing'), 'info')}</div>
          <p class="muted">Vehicle type: ${escapeHtml(formatVehicleTypeLabel(driver.vehicleType))}${driver.vehicleColor ? ` · ${escapeHtml(driver.vehicleColor)}` : ''}</p>
        </div>
        <div class="list-card">
          <div class="list-head"><strong>Current assignment</strong>${activeOrder ? pill(getOrderNumber(activeOrder), 'warning') : pill('No active order', 'success')}</div>
          <p class="muted">${activeOrder ? `${escapeHtml(getPickup(activeOrder))} -> ${escapeHtml(getDropoff(activeOrder))}` : 'This driver is currently free for new dispatches.'}</p>
        </div>
        <div class="list-card">
          <div class="list-head"><strong>Live coordinates</strong>${driver.currentLatitude !== undefined && driver.currentLongitude !== undefined ? pill('GPS ready', 'success') : pill('No GPS yet', 'neutral')}</div>
          <p class="muted">${driver.currentLatitude !== undefined && driver.currentLongitude !== undefined ? `${escapeHtml(String(driver.currentLatitude))}, ${escapeHtml(String(driver.currentLongitude))}` : 'The driver app has not pushed a live location yet.'}</p>
        </div>
      </div>
      <div class="admin-inline-actions">
        ${verification.status !== 'verified' ? `<button class="btn primary" type="button" data-verify-driver="${escapeHtml(driver.id)}">Verify driver</button>` : ''}
        ${verification.status !== 'rejected' ? `<button class="btn soft" type="button" data-reject-driver="${escapeHtml(driver.id)}">Reject verification</button>` : ''}
        <button class="btn ${isPriorityDriver(driver) ? 'soft' : 'primary'}" type="button" data-toggle-priority-driver="${escapeHtml(driver.id)}">${isPriorityDriver(driver) ? 'Remove star' : 'Add star'}</button>
        ${driver.phoneNumber ? `<button class="btn primary" type="button" data-contact-number="${escapeHtml(driver.phoneNumber)}" data-contact-label="driver">Contact driver</button>` : ''}
        <button class="btn soft" type="button" data-close-modal="true" data-keep-enabled="true">Close</button>
      </div>
    `,
  });
}

function handleCustomerSelection(select) {
  const form = select.closest('form');
  if (!form) {
    return;
  }

  const user = state.users.find((item) => item.id === select.value || item.uid === select.value);
  if (!user) {
    return;
  }

  const nameInput = form.querySelector('input[name="customerName"]');
  const phoneInput = form.querySelector('input[name="customerPhone"]');
  const emailInput = form.querySelector('input[name="customerEmail"]');
  if (nameInput) nameInput.value = safeText(user.fullName || user.email);
  if (phoneInput) phoneInput.value = safeText(user.phoneNumber);
  if (emailInput) emailInput.value = safeText(user.email);
}

function contactNumber(number, label) {
  const contact = safeText(number);
  if (!contact) {
    setFeedback(`No ${label} phone number is available.`, 'error');
    return;
  }

  const telHref = `tel:${contact.replace(/\s+/g, '')}`;
  try {
    window.location.href = telHref;
    setFeedback(`${label[0].toUpperCase()}${label.slice(1)} contact opened.`, 'success');
  } catch {
    navigator.clipboard?.writeText(contact).catch(() => null);
    setFeedback(`${label[0].toUpperCase()}${label.slice(1)} number copied: ${contact}`, 'info');
  }
}

function normalizeMapPoint(point, bounds) {
  const latitudeRange = Math.max(0.0025, bounds.maxLatitude - bounds.minLatitude);
  const longitudeRange = Math.max(0.0025, bounds.maxLongitude - bounds.minLongitude);

  return {
    ...point,
    x: 8 + ((point.longitude - bounds.minLongitude) / longitudeRange) * 84,
    y: 92 - ((point.latitude - bounds.minLatitude) / latitudeRange) * 76,
  };
}

function getMapLayout(order, drivers = []) {
  const pickup = getOrderPickupPoint(order);
  const dropoff = getOrderDropoffPoint(order);
  const routePoints = decodePolyline(order.routeGeometry);
  const driverPoints = drivers
    .map((driver, index) => {
      const point = getDriverCurrentPoint(driver);
      if (!point) {
        return null;
      }

      return {
        ...point,
        kind: 'driver',
        symbol: index === 0 ? 'R' : 'D',
        label: safeText(driver.fullName || driver.email, 'Driver'),
      };
    })
    .filter(Boolean);

  const keyPoints = [
    pickup ? { ...pickup, kind: 'pickup', symbol: 'P', label: 'Pickup' } : null,
    dropoff ? { ...dropoff, kind: 'dropoff', symbol: 'D', label: 'Drop-off' } : null,
    ...driverPoints,
  ].filter(Boolean);

  const allPoints = [...keyPoints, ...routePoints];
  if (!allPoints.length) {
    return null;
  }

  const latitudes = allPoints.map((point) => point.latitude);
  const longitudes = allPoints.map((point) => point.longitude);
  const bounds = {
    minLatitude: Math.min(...latitudes) - 0.0025,
    maxLatitude: Math.max(...latitudes) + 0.0025,
    minLongitude: Math.min(...longitudes) - 0.0025,
    maxLongitude: Math.max(...longitudes) + 0.0025,
  };

  const markers = keyPoints.map((point) => normalizeMapPoint(point, bounds));
  const path = routePoints.length
    ? routePoints.map((point) => normalizeMapPoint(point, bounds)).map((point) => `${point.x},${point.y}`).join(' ')
    : '';

  return {
    markers,
    path,
  };
}

function renderMapPlaceholder(title = 'Live route intelligence', text = 'Waiting for route data.') {
  return `
    <div class="map-placeholder">
      <div class="map-route"></div>
      <div class="map-pin pin-a"><span>P</span></div>
      <div class="map-pin pin-b"><span>D</span></div>
      <div class="map-pin pin-c"><span>R</span></div>
      <div class="map-panel-caption">
        <strong>${escapeHtml(title)}</strong>
        <p class="muted">${escapeHtml(text)}</p>
      </div>
    </div>
  `;
}

function renderLiveMap(order, drivers = [], title = 'Live route intelligence', text = 'Route intelligence is ready.') {
  const layout = order ? getMapLayout(order, drivers) : null;
  if (!order || !layout) {
    return renderMapPlaceholder(title, text);
  }

  const chips = [
    getPickup(order) ? `<span class="map-meta-chip">Pickup: ${escapeHtml(getPickup(order))}</span>` : '',
    getDropoff(order) ? `<span class="map-meta-chip">Drop-off: ${escapeHtml(getDropoff(order))}</span>` : '',
    order.distanceLabel ? `<span class="map-meta-chip">${escapeHtml(order.distanceLabel)}</span>` : '',
    order.durationLabel ? `<span class="map-meta-chip">${escapeHtml(order.durationLabel)}</span>` : '',
  ].filter(Boolean);

  return `
    <div class="map-placeholder">
      <svg class="map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${layout.path ? `<polyline points="${escapeHtml(layout.path)}"></polyline>` : ''}
        ${layout.markers
          .filter((marker) => marker.kind === 'driver')
          .map((marker) => {
            const pickup = layout.markers.find((item) => item.kind === 'pickup');
            if (!pickup) {
              return '';
            }

            return `<line x1="${escapeHtml(marker.x)}" y1="${escapeHtml(marker.y)}" x2="${escapeHtml(pickup.x)}" y2="${escapeHtml(pickup.y)}"></line>`;
          })
          .join('')}
      </svg>
      ${layout.markers
        .map((marker, index) => {
          const pinClass = marker.kind === 'pickup' ? 'pin-a' : marker.kind === 'dropoff' ? 'pin-b' : 'pin-c';
          return `<div class="map-pin ${pinClass}" style="left: calc(${marker.x}% - 20px); top: calc(${marker.y}% - 20px);"><span>${escapeHtml(marker.symbol)}</span></div>`;
        })
        .join('')}
      <div class="map-panel-caption">
        <strong>${escapeHtml(title)}</strong>
        <p class="muted">${escapeHtml(text)}</p>
        ${chips.length ? `<div class="map-meta-grid">${chips.join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function setPage(page, options = {}) {
  if (!PAGE_META[page]) {
    page = 'dashboard';
  }

  state.currentPage = page;
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.section === page));

  if (ui.pageTitle) ui.pageTitle.textContent = PAGE_META[page][0];
  if (ui.pageSubtitle) ui.pageSubtitle.textContent = PAGE_META[page][1];
  if (ui.sidebar) ui.sidebar.classList.remove('open');
  closeOrderDrawer({ preserveSelection: !!options.preserveSelection });

  renderCurrentPage();
}

function getOrCreateSection(id) {
  const section = document.createElement('section');
  section.id = id;
  section.className = 'section active';
  if (ui.content) {
    ui.content.replaceChildren(section);
  }
  return section;
}

function card(title, eyebrow, body, right = '') {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${right}
      </div>
      ${body}
    </article>
  `;
}

function kpi(label, value, note = '') {
  return `
    <article class="kpi-card">
      <span class="kpi-label">${escapeHtml(label)}</span>
      <strong class="kpi-value">${escapeHtml(value)}</strong>
      <p class="kpi-note">${escapeHtml(note)}</p>
    </article>
  `;
}

function serviceCard(service) {
  return `
    <article class="service-card">
      <div class="service-icon">${escapeHtml(service.icon)}</div>
      <h3>${escapeHtml(service.title)}</h3>
      <p>${escapeHtml(service.description)}</p>
      <div class="service-footer">
        <span>${service.orders.length} orders</span>
        <strong>${service.completion}% complete</strong>
      </div>
    </article>
  `;
}

function orderRow(order) {
  const status = getOrderStatus(order);
  return `
    <tr data-order="${escapeHtml(order.id)}">
      <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span></td>
      <td>
        <div class="person">
          <strong>${escapeHtml(getCustomerName(order))}</strong>
          <span class="mini">${escapeHtml(getCustomerContact(order))}</span>
        </div>
      </td>
      <td>${escapeHtml(getServiceLabel(order))}</td>
      <td>${escapeHtml(getPickup(order))} → ${escapeHtml(getDropoff(order))}</td>
      <td>${escapeHtml(getDriverName(order))}</td>
      <td>
        ${pill(getOrderStatusLabel(order), getStatusClass(status))}
        ${status === 'pending_assignment' || order.autoCancelledReason ? `<span class="mini">${escapeHtml(getDriverSearchMessage(order))}</span>` : ''}
      </td>
      <td>${escapeHtml(formatMoney(getOrderAmount(order)))}</td>
    </tr>
  `;
}

function driverCard(driver) {
  const status = getDriverStatus(driver);
  const priority = isPriorityDriver(driver);
  const verification = getDriverVerification(driver);
  const initials = safeText(driver.fullName || driver.email, 'DR')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return `
    <article class="staff-card">
      <div class="avatar-row">
        <div class="avatar">${escapeHtml(initials)}</div>
        <div>
          <h3>${escapeHtml(safeText(driver.fullName || driver.email, 'Driver'))}</h3>
          <p class="muted">${escapeHtml(getDriverVehicleLabel(driver, 'Vehicle pending'))} · ${escapeHtml(safeText(driver.phoneNumber, 'No phone'))}</p>
        </div>
      </div>
      <div class="admin-inline-actions">
        ${pill(status.label, status.className)}
        ${pill(verification.label, verification.className)}
        ${priority ? pill('Priority', 'warning') : ''}
      </div>
      <div class="progress"><span style="width:${driver.currentOrderId ? 76 : driver.isAvailable ? 92 : 30}%"></span></div>
      <div class="admin-inline-actions">
        <button class="btn ${priority ? 'soft' : 'primary'}" data-toggle-priority-driver="${escapeHtml(driver.id)}">${priority ? 'Remove star' : 'Add star'}</button>
        <button class="btn soft" data-select-driver="${escapeHtml(driver.id)}">View driver</button>
      </div>
    </article>
  `;
}

function userCard(user) {
  const isActive = isActiveRecently(user.lastActiveAt || user.updatedAt || user.createdAt);
  return `
    <div class="list-card">
      <div class="list-head">
        <strong>${escapeHtml(safeText(user.fullName || user.email, 'Customer'))}</strong>
        ${pill(isActive ? 'Active' : 'Quiet', isActive ? 'success' : 'neutral')}
      </div>
      <p class="muted">${escapeHtml(safeText(user.phoneNumber || user.email || user.uid || user.id, 'No contact'))}</p>
      <span class="mini">Last seen: ${escapeHtml(formatDateTime(user.lastActiveAt || user.updatedAt || user.createdAt))}</span>
    </div>
  `;
}

function getPaymentAmount(payment) {
  return parseAmount(
    payment?.reviewedAmount ||
    payment?.paymentAmount ||
    payment?.amount ||
    payment?.commissionAmount ||
    payment?.subscriptionFee
  );
}

function paymentReviewStatus(payment) {
  const status = normalize(payment.status || 'pending_admin_verification');
  if (status === 'verified' || status === 'approved') return { label: 'Verified', className: 'success' };
  if (status === 'rejected') return { label: 'Rejected', className: 'danger' };
  return { label: 'Pending review', className: 'warning' };
}

function paymentReviewRow(payment) {
  const status = paymentReviewStatus(payment);
  const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
  const orderCount = Array.isArray(payment.orderIds) ? payment.orderIds.length : 0;
  const amount = getPaymentAmount(payment);
  const isSubscription = normalize(payment.paymentType) === 'weekly_subscription' || parseAmount(payment.subscriptionFee) > 0 || orderCount === 0;
  const planLabel = isSubscription ? 'Legacy access record' : `${orderCount} order${orderCount === 1 ? '' : 's'}`;
  const isPending = normalize(payment.status) === 'pending_admin_verification' || !payment.status;

  return `
    <tr>
      <td>
        <div class="person">
          <strong>${escapeHtml(safeText(payment.driverName || driver?.fullName, 'Driver'))}</strong>
          <span class="mini">${escapeHtml(safeText(payment.driverPhone || driver?.phoneNumber || payment.driverId, 'No driver contact'))}</span>
        </div>
      </td>
      <td>${escapeHtml(formatMoney(amount))}</td>
      <td>${escapeHtml(safeText(payment.payerPhone, 'Not provided'))}</td>
      <td><span class="order-id">${escapeHtml(safeText(payment.transactionReference, payment.id))}</span></td>
      <td>${escapeHtml(planLabel)}</td>
      <td>${pill(status.label, status.className)}</td>
      <td>${escapeHtml(formatDateTime(payment.createdAt || payment.updatedAt))}</td>
      <td>
        <div class="admin-inline-actions">
          ${isPending ? `<button class="btn primary" data-verify-payment="${escapeHtml(payment.id)}">Mark reviewed</button>` : ''}
          ${isPending ? `<button class="btn soft" data-reject-payment="${escapeHtml(payment.id)}">Reject record</button>` : ''}
          <button class="btn soft" data-payment-pdf="${escapeHtml(payment.id)}">PDF</button>
        </div>
      </td>
    </tr>
  `;
}

function getPaymentReviewById(paymentId) {
  return state.paymentReviews.find((payment) => payment.id === paymentId) || null;
}

function getPaymentOrderIds(payment) {
  return Array.isArray(payment?.orderIds) ? payment.orderIds.filter(Boolean) : [];
}

function getPaymentSummary(payments = state.paymentReviews) {
  const pending = payments.filter((payment) => {
    const status = normalize(payment.status);
    return status === 'pending_admin_verification' || !status;
  });
  const verified = payments.filter((payment) => ['verified', 'approved'].includes(normalize(payment.status)));
  const rejected = payments.filter((payment) => normalize(payment.status) === 'rejected');
  const receivedAmount = payments.reduce((sum, payment) => sum + getPaymentAmount(payment), 0);
  const verifiedAmount = verified.reduce((sum, payment) => sum + getPaymentAmount(payment), 0);
  const pendingAmount = pending.reduce((sum, payment) => sum + getPaymentAmount(payment), 0);

  return {
    total: payments.length,
    pending,
    verified,
    rejected,
    receivedAmount,
    verifiedAmount,
    pendingAmount,
  };
}

async function verifyDriverPayment(paymentId) {
  const payment = getPaymentReviewById(paymentId);
  if (!payment) {
    throw new Error('Payment review was not found.');
  }

  const orderIds = getPaymentOrderIds(payment);
  const driverId = safeText(payment.driverId);
  if (!driverId) {
    throw new Error('Payment is missing a driver ID.');
  }

  const driver = getDriverById(driverId);
  const expectedAmount = getDriverWeeklySubscriptionFee(driver);
  const paymentAmount = getPaymentAmount(payment) || expectedAmount;
  if (paymentAmount < expectedAmount) {
    throw new Error(`Payment amount is below the expected legacy access amount (${formatMoney(expectedAmount)}).`);
  }
  const batch = writeBatch(db);
  const verifiedPayload = compact({
    status: 'verified',
    paymentType: safeText(payment.paymentType, 'legacy_access_record'),
    reviewedAmount: paymentAmount,
    accessImpact: 'none',
    legacyAccessRecordStatus: 'verified',
    subscriptionFee: deleteField(),
    subscriptionDurationDays: deleteField(),
    subscriptionStartsAt: deleteField(),
    subscriptionPaidUntil: deleteField(),
    subscriptionWeekStartsAt: deleteField(),
    subscriptionWeekEndsAt: deleteField(),
    subscriptionDueDay: deleteField(),
    verifiedAt: serverTimestamp(),
    verifiedByAdminId: state.user?.uid,
    verifiedByAdminEmail: state.user?.email,
    rejectedAt: deleteField(),
    rejectionReason: deleteField(),
    updatedAt: serverTimestamp(),
  });

  batch.update(paymentReviewRef(payment.id), verifiedPayload);

  if (safeText(payment.id)) {
    batch.set(driverCommissionPaymentRef(driverId, payment.id), verifiedPayload, { merge: true });
  }

  orderIds.forEach((orderId) => {
    batch.update(orderRef(orderId), compact({
      driverCommissionPaidAt: serverTimestamp(),
      driverCommissionPaymentId: payment.id,
      driverCommissionPaymentStatus: 'verified',
      updatedAt: serverTimestamp(),
    }));
  });

  batch.update(driverRef(driverId), compact({
    lastCommissionPaidAt: serverTimestamp(),
    lastCommissionPaidAmount: paymentAmount,
    totalCommissionPaid: increment(paymentAmount),
    lastCommissionPaymentStatus: 'verified',
    lastCommissionPaymentSubmissionId: payment.id,
    legacyAccessRecordStatus: 'verified',
    legacyAccessRecordUpdatedAt: serverTimestamp(),
    legacyAccessRecordId: payment.id,
    updatedAt: serverTimestamp(),
  }));

  await batch.commit();
}

async function rejectDriverPayment(paymentId, reason) {
  const payment = getPaymentReviewById(paymentId);
  if (!payment) {
    throw new Error('Payment review was not found.');
  }

  const driverId = safeText(payment.driverId);
  if (!driverId) {
    throw new Error('Payment is missing a driver ID.');
  }

  const rejectedPayload = compact({
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedByAdminId: state.user?.uid,
    rejectedByAdminEmail: state.user?.email,
    rejectionReason: safeText(reason, 'Rejected by admin'),
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.update(paymentReviewRef(payment.id), rejectedPayload);
  batch.set(driverCommissionPaymentRef(driverId, payment.id), rejectedPayload, { merge: true });
  batch.update(driverRef(driverId), compact({
    lastCommissionPaymentStatus: 'rejected',
    legacyAccessRecordStatus: 'rejected',
    legacyAccessRecordUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await batch.commit();
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderPriorityList(analytics) {
  const priority = sortByRecent([...analytics.pending, ...analytics.moving]).slice(0, 6);
  if (!priority.length) {
    return emptyState('No priority orders right now.');
  }

  return `
    <div class="list-stack">
      ${priority
        .map((order) => {
          const nearbyDriver = getNearbyDriverMatches(order)[0];
          return `
            <button class="list-card" data-open-order="${escapeHtml(order.id)}">
              <div class="list-head">
                <strong>${escapeHtml(getOrderNumber(order))}</strong>
                ${pill(getOrderStatusLabel(order), getStatusClass(getOrderStatus(order)))}
              </div>
              <p class="muted">${escapeHtml(getCustomerName(order))} · ${escapeHtml(getServiceLabel(order))}</p>
              <span class="mini">${escapeHtml(getPickup(order))}</span>
              <span class="mini">${escapeHtml(getDriverSearchMessage(order))}</span>
              ${nearbyDriver ? `<span class="mini">Nearest driver: ${escapeHtml(nearbyDriver.distanceLabel)} · ${escapeHtml(nearbyDriver.etaLabel)}</span>` : ''}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderDashboard() {
  const section = getOrCreateSection('dashboard');
  const analytics = getAnalytics();
  const featuredOrder = sortByRecent([...analytics.moving, ...analytics.pending])[0] || null;
  const featuredDrivers = featuredOrder ? getNearbyDriverMatches(featuredOrder).slice(0, 3) : analytics.activeDrivers.slice(0, 3);

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Executive command center</span>
        <h2>Professional delivery operations dashboard for doordrop.</h2>
        <p>One clean workspace for parcel delivery, cargo requests, driver allocation, finance tracking, customer support, and business intelligence.</p>
        <div class="hero-meta">
          ${pill('Cloud auto-dispatch on', 'success')}
          ${pill(`${analytics.total} total orders`, 'success')}
          ${pill(`${analytics.activeDrivers.length} active drivers`, 'info')}
          ${pill(`${analytics.pending.length} need attention`, 'warning')}
          ${pill(`${formatMoney(analytics.revenue)} delivered value`, 'purple')}
        </div>
      </div>
      <div class="hero-card">
        <div class="hero-card-row"><span>Completion rate</span><strong>${analytics.completionRate}%</strong></div>
        <div class="progress"><span style="width:${analytics.completionRate}%"></span></div>
        <div class="hero-card-row"><span>Driver utilization</span><strong>${analytics.driverUtilization}%</strong></div>
        <div class="progress"><span style="width:${analytics.driverUtilization}%"></span></div>
        <div class="hero-card-row"><span>Revenue today</span><strong>${formatMoney(analytics.revenueToday)}</strong></div>
      </div>
    </div>

    <div class="grid kpi">
      ${kpi('Total orders', String(analytics.total), `${analytics.pending.length} waiting for driver`)}
      ${kpi('Active pipeline', formatMoney(analytics.pipeline), 'Open delivery value')}
      ${kpi('Available fleet', String(analytics.activeDrivers.length), `${analytics.busyDrivers.length} drivers busy`)}
      ${kpi('Customers active', String(analytics.activeUsers.length), 'Active in the last 24 hours')}
    </div>

    <div class="grid two">
      ${card(
        'Operations floor',
        'Live map',
        renderLiveMap(
          featuredOrder,
          featuredDrivers,
          featuredOrder ? `Tracking ${getOrderNumber(featuredOrder)}` : 'Live route intelligence',
          featuredOrder
            ? `${getPickup(featuredOrder)} → ${getDropoff(featuredOrder)}`
            : `${analytics.moving.length} active trips and ${analytics.activeDrivers.length} available drivers.`
        ),
        pill(state.settings.defaultCity || 'Dispatch hub', 'info')
      )}
      ${card('Needs attention', 'Priority queue', renderPriorityList(analytics), pill(`${analytics.pending.length} waiting`, 'warning'))}
    </div>
  `;
}

function renderOrders() {
  const section = getOrCreateSection('orders');
  const visible = sortByRecent(state.orders.filter(orderMatchesQuery));

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Order management</span>
        <h2>Track every customer request from booking to delivery.</h2>
        <p>Review active, scheduled, pending, cancelled, and completed orders in one professional operating table.</p>
      </div>
      <button class="btn primary" data-action="create-order">Create manual order</button>
    </div>

    <article class="card">
      <div class="card-head">
        <div><span class="eyebrow">Live orders</span><h3>Order queue</h3></div>
        ${pill(`${visible.length} synced`, 'success')}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Service</th><th>Route</th><th>Driver</th><th>Status</th><th>Value</th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.map(orderRow).join('') : `<tr><td colspan="7">${emptyState('No orders match your search.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderAvailableDriversList(drivers, order) {
  if (!drivers.length) {
    return emptyState(order
      ? `No nearby online ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'doordrop')} driver right now. The order can wait briefly, then auto-cancel if no match appears.`
      : 'No available drivers right now.');
  }

  return `
    <div class="list-stack">
      ${drivers.slice(0, 8).map((driver) => `
        <div class="list-card">
          <div class="list-head">
            <strong>${escapeHtml(safeText(driver.fullName || driver.email, 'Driver'))}</strong>
            ${pill(driver.distanceLabel || getDriverVehicleLabel(driver, 'Vehicle'), driver.badgeType || 'info')}
            ${driver.isPriorityMatch ? pill('Priority match', 'warning') : ''}
          </div>
          <p class="muted">${escapeHtml(getDriverVehicleLabel(driver, 'Vehicle'))} · ${escapeHtml(safeText(driver.phoneNumber, 'Phone not provided'))}</p>
          <span class="mini">${escapeHtml(driver.etaLabel || safeText(driver.plateNumber, 'No plate'))}${driver.supportsOrder === false ? ' · Vehicle check needed' : ''}</span>
          <span class="mini">Fair score ${escapeHtml(String(Math.round(driver.matchScore ?? 0)))} · Rating ${escapeHtml(Number(driver.ratingAverage ?? 4.5).toFixed(1))}/5 · ${escapeHtml(String(driver.recentAssignments ?? 0))} jobs in 24h</span>
          <p class="muted">${escapeHtml(driver.matchReason || 'Balanced by distance, rating, vehicle fit, and workload.')}</p>
          <div class="admin-inline-actions">
            ${order ? `<button class="btn primary" data-assign-driver="${escapeHtml(driver.id)}" data-order-id="${escapeHtml(order.id)}">Assign this driver</button>` : ''}
            <button class="btn soft" data-select-driver="${escapeHtml(driver.id)}">View driver</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDispatch() {
  const section = getOrCreateSection('dispatch');
  const selected = getSelectedOrder() || getSuggestedDispatchOrder();
  const rankedDrivers = selected
    ? getNearbyDriverMatches(selected).filter(driverMatchesQuery)
    : sortDrivers(state.drivers.filter((driver) => driver.isAvailable && !driver.currentOrderId && driverMatchesQuery(driver)));

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Live dispatch</span>
        <h2>Fair automatic assignment with route, rating, reviews, and workload.</h2>
        <p>${selected ? `${getOrderNumber(selected)} is selected for dispatch.` : 'Cloud auto-dispatch assigns waiting orders automatically even when this admin web app is closed.'}</p>
      </div>
      <div class="admin-inline-actions">
        <button class="btn primary" data-action="optimize-routes">Optimize routes</button>
        <button class="btn soft" data-action="run-auto-assign">Run auto assignment</button>
        ${selected ? `<button class="btn soft" data-open-order="${escapeHtml(selected.id)}">Open selected order</button>` : ''}
      </div>
    </div>

    <div class="grid two">
      ${card(
        'Driver, pickup and destination',
        'Route map',
        renderLiveMap(
          selected,
          rankedDrivers.slice(0, 3),
          selected ? `Dispatching ${getOrderNumber(selected)}` : 'Dispatch view',
          selected ? `${getPickup(selected)} → ${getDropoff(selected)}` : 'No order selected.'
        ),
        pill(selected ? getOrderStatusLabel(selected) : 'Idle', selected ? getStatusClass(getOrderStatus(selected)) : 'neutral')
      )}
      ${card('Best matches', 'Recommended drivers', renderAvailableDriversList(rankedDrivers, selected), pill(`${rankedDrivers.length} ready`, 'success'))}
    </div>
  `;
}

function renderServices() {
  const section = getOrCreateSection('services');
  const services = getServiceStats();

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Service operations</span>
        <h2>Each doordrop service has its own operational section.</h2>
        <p>Separate parcel delivery, TOYO, Kirikuu, and business account performance.</p>
      </div>
    </div>

    <div class="service-grid">
      ${services.map(serviceCard).join('')}
    </div>

    <div class="grid three">
      ${services.map((service) => card(
        `${service.title} performance`,
        'Service data',
        `<div class="quick-grid">
          <div class="quick-card"><span>Orders</span><strong>${service.orders.length}</strong></div>
          <div class="quick-card"><span>Delivered</span><strong>${service.delivered.length}</strong></div>
          <div class="quick-card"><span>Revenue</span><strong>${formatMoney(service.revenue)}</strong></div>
          <div class="quick-card"><span>Completion</span><strong>${service.completion}%</strong></div>
        </div>`
      )).join('')}
    </div>
  `;
}

function renderCustomers() {
  const section = getOrCreateSection('customers');
  const visible = sortByRecent(state.users.filter(userMatchesQuery));
  const active = visible.filter((user) => isActiveRecently(user.lastActiveAt || user.updatedAt || user.createdAt));

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Customer intelligence</span>
        <h2>Understand who orders, where they send, and how often they return.</h2>
        <p>Manage customer profiles, support issues, merchant accounts, and retention activity.</p>
      </div>
    </div>
    <div class="grid kpi">
      ${kpi('Total customers', String(visible.length), 'Synced from users collection')}
      ${kpi('Active today', String(active.length), 'Used app in last 24 hours')}
      ${kpi('Business accounts', String(visible.filter((user) => user.accountType === 'business' || user.isBusiness).length), 'Merchant users')}
      ${kpi('App opens', String(visible.reduce((sum, user) => sum + Number(user.appOpenCount || 0), 0)), 'Tracked opens')}
    </div>
    ${card('Recent customers', 'Customer list', `<div class="list-stack">${visible.slice(0, 18).map(userCard).join('') || emptyState('No customers found.')}</div>`)}
  `;
}

function renderDrivers() {
  const section = getOrCreateSection('drivers');
  const visible = sortDrivers(state.drivers.filter(driverMatchesQuery));
  const ready = visible.filter((driver) => driver.isAvailable && !driver.currentOrderId);
  const busy = visible.filter((driver) => !!driver.currentOrderId);
  const pendingVerification = visible.filter((driver) => getDriverVerification(driver).status === 'pending_admin_verification');

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Fleet management</span>
        <h2>Control driver readiness, documents, ratings, and vehicle categories.</h2>
        <p>Verify plate numbers, vehicle photos, driver photos, and vehicle categories before dispatch.</p>
      </div>
      <button class="btn primary" data-action="add-driver">Add driver</button>
    </div>
    <div class="grid kpi">
      ${kpi('Total drivers', String(visible.length), 'All fleet users')}
      ${kpi('Ready drivers', String(ready.filter(isDriverVerifiedForDispatch).length), 'Verified and available')}
      ${kpi('Busy drivers', String(busy.length), 'Currently assigned')}
      ${kpi('Pending verification', String(pendingVerification.length), 'Needs admin review')}
    </div>
    <div class="staff-grid">${visible.slice(0, 24).map(driverCard).join('') || emptyState('No drivers found.')}</div>
  `;
}

function renderPayments() {
  const section = getOrCreateSection('payments');
  const visible = sortByRecent(state.paymentReviews.filter(paymentMatchesQuery));
  const summary = getPaymentSummary(visible);

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Driver access</span>
        <h2>Driver app access is free.</h2>
        <p>Review legacy access payment records only when needed. These records no longer block dispatch visibility or order assignment.</p>
      </div>
      <div class="admin-inline-actions">
        <button class="btn primary" data-action="export-payments-pdf">Export PDF</button>
      </div>
    </div>
    <div class="grid kpi">
      ${kpi('Legacy records', String(summary.total), 'Historical driver submissions')}
      ${kpi('Pending review', String(summary.pending.length), formatMoney(summary.pendingAmount))}
      ${kpi('Verified payments', String(summary.verified.length), formatMoney(summary.verifiedAmount))}
      ${kpi('Rejected payments', String(summary.rejected.length), 'Needs driver follow-up')}
    </div>
    <article class="card">
      <div class="card-head">
        <div><span class="eyebrow">Access records</span><h3>Legacy driver payment records</h3></div>
        ${pill(`${formatMoney(summary.receivedAmount)} submitted`, 'info')}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Driver</th><th>Amount</th><th>Payer phone</th><th>Reference</th><th>Plan</th><th>Status</th><th>Submitted</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.map(paymentReviewRow).join('') : `<tr><td colspan="8">${emptyState('No legacy payment records match your search.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function getPaymentPdfRows(payments) {
  return payments.map((payment) => {
    const status = paymentReviewStatus(payment);
    const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
    const orderCount = getPaymentOrderIds(payment).length;
    const isSubscription = normalize(payment.paymentType) === 'weekly_subscription' || parseAmount(payment.subscriptionFee) > 0 || orderCount === 0;
    const planLabel = isSubscription ? 'Legacy access record' : `${orderCount} order${orderCount === 1 ? '' : 's'}`;
    return `
      <tr>
        <td>${escapeHtml(safeText(payment.driverName || driver?.fullName, 'Driver'))}</td>
        <td>${escapeHtml(formatMoney(getPaymentAmount(payment)))}</td>
        <td>${escapeHtml(safeText(payment.payerPhone, 'Not provided'))}</td>
        <td>${escapeHtml(safeText(payment.transactionReference, payment.id))}</td>
        <td>${escapeHtml(planLabel)}</td>
        <td>${escapeHtml(status.label)}</td>
        <td>${escapeHtml(formatDateTime(payment.createdAt || payment.updatedAt))}</td>
      </tr>
    `;
  }).join('');
}

function openPaymentsPdf(payments, title = 'doordrop Driver Access Records') {
  const printablePayments = payments.length ? payments : [];
  const summary = getPaymentSummary(printablePayments);
  const reportWindow = window.open('', '_blank', 'width=980,height=720');
  if (!reportWindow) {
    throw new Error('Allow pop-ups so the payment PDF can open.');
  }

  reportWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 32px; color: #0f172a; font-family: Arial, sans-serif; }
          h1, h2, p { margin: 0; }
          h1 { font-size: 24px; }
          .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f9f6e; padding-bottom: 18px; }
          .muted { color: #64748b; font-size: 12px; margin-top: 6px; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 22px 0; }
          .box { border: 1px solid #dce5ee; border-radius: 8px; padding: 12px; }
          .box span { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; }
          .box strong { display: block; margin-top: 6px; font-size: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; color: #334155; background: #eef3f7; }
          th, td { padding: 10px; border: 1px solid #dce5ee; vertical-align: top; }
          .footer { margin-top: 22px; color: #64748b; font-size: 11px; }
          @media print { body { padding: 18px; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p class="muted">Generated from doordrop Admin on ${escapeHtml(new Date().toLocaleString('en-GB'))}</p>
          </div>
          <button class="no-print" onclick="window.print()">Print / Save PDF</button>
        </div>
        <div class="summary">
          <div class="box"><span>Records</span><strong>${escapeHtml(String(summary.total))}</strong></div>
          <div class="box"><span>Submitted</span><strong>${escapeHtml(formatMoney(summary.receivedAmount))}</strong></div>
          <div class="box"><span>Verified</span><strong>${escapeHtml(formatMoney(summary.verifiedAmount))}</strong></div>
          <div class="box"><span>Pending</span><strong>${escapeHtml(formatMoney(summary.pendingAmount))}</strong></div>
        </div>
        <table>
          <thead>
            <tr><th>Driver</th><th>Amount</th><th>Payer phone</th><th>Reference</th><th>Plan</th><th>Status</th><th>Submitted</th></tr>
          </thead>
          <tbody>${getPaymentPdfRows(printablePayments) || '<tr><td colspan="7">No payment data available.</td></tr>'}</tbody>
        </table>
        <p class="footer">Use browser Print and choose Save as PDF to keep this report.</p>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 350);
}

function renderFinance() {
  const section = getOrCreateSection('finance');
  const analytics = getAnalytics();
  const legacyAccessSummary = getPaymentSummary(state.paymentReviews);
  const legacyAccessRevenue = legacyAccessSummary.verifiedAmount;

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Finance</span>
        <h2>Revenue, payouts, refunds, and reconciliation.</h2>
        <p>Track delivery value, payout planning, legacy access records, and settlement status.</p>
      </div>
    </div>
    <div class="grid kpi">
      ${kpi('Gross delivered value', formatMoney(analytics.revenue), `${analytics.delivered.length} delivered orders`)}
      ${kpi('Active pipeline', formatMoney(analytics.pipeline), `${analytics.active.length} active orders`)}
      ${kpi('Legacy access verified', formatMoney(legacyAccessRevenue), 'Not required for dispatch')}
      ${kpi('Legacy access pending', formatMoney(legacyAccessSummary.pendingAmount), `${legacyAccessSummary.pending.length} pending review`)}
    </div>
    <div class="grid two">
      ${card(
        'Revenue by service',
        'Service finance',
        `<div class="list-stack">${analytics.services
          .map((service) => `<div class="list-card"><div class="list-head"><strong>${escapeHtml(service.title)}</strong><span>${formatMoney(service.revenue)}</span></div><div class="progress"><span style="width:${Math.min(100, service.revenue && analytics.revenue ? (service.revenue / analytics.revenue) * 100 : 0)}%"></span></div></div>`)
          .join('')}</div>`
      )}
      ${card(
        'Finance notes',
        'Reconciliation',
        `<div class="list-stack">
          <div class="list-card"><strong>Settlement workflow</strong><p class="muted">Live payout and refund feeds can be layered here once you connect your payment provider export.</p></div>
          <div class="list-card"><strong>Accounting export</strong><p class="muted">Use the Reports page export to reconcile delivered value against monthly operations.</p></div>
        </div>`
      )}
    </div>
  `;
}

function renderReports() {
  const section = getOrCreateSection('reports');
  const analytics = getAnalytics();
  const topService = [...analytics.services].sort((left, right) => right.orders.length - left.orders.length)[0];

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Reports</span>
        <h2>Professional reporting for management decisions.</h2>
        <p>Daily performance, service demand, fleet health, customer activity, and revenue insights.</p>
      </div>
      <button class="btn primary" data-action="export-report">Export report</button>
    </div>
    <div class="grid three">
      ${card('Service demand', 'Operations insight', `<p class="muted">${escapeHtml(topService?.title || 'Parcel Delivery')} is currently leading demand with ${topService?.orders.length || 0} orders.</p>`)}
      ${card('Fleet utilization', 'Fleet insight', `<p class="muted">Driver utilization is ${analytics.driverUtilization}%. ${analytics.activeDrivers.length} drivers are ready for new requests.</p>`)}
      ${card('Business health', 'Revenue insight', `<p class="muted">Delivered value is ${formatMoney(analytics.revenue)}, while active pipeline is ${formatMoney(analytics.pipeline)}.</p>`)}
    </div>
    <div class="grid kpi">
      ${kpi('Completion rate', `${analytics.completionRate}%`, 'Delivered vs cancelled')}
      ${kpi('Delivered today', String(analytics.deliveredToday.length), formatMoney(analytics.revenueToday))}
      ${kpi('Cancelled orders', String(analytics.cancelled.length), 'Operational risk')}
      ${kpi('Active customers', String(analytics.activeUsers.length), 'Last 24 hours')}
    </div>
  `;
}

function getActivityFeatureLabel(event) {
  return safeText(event.featureLabel || event.featureKey || event.route || event.screen || event.eventName, 'App activity')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
}

function getActivityActor(event) {
  const user = state.users.find((item) => item.id === event.userId || item.uid === event.userId);
  return safeText(event.userName || user?.fullName || user?.email || event.userId, 'Customer');
}

function buildCustomerHistoryEvents() {
  const appEvents = state.activityEvents.filter((event) => getEventRole(event) !== 'driver').map((event) => ({
    at: toMillis(event.createdAt || event.updatedAt),
    title: getActivityActor(event),
    badge: safeText(event.eventName, 'app_activity').replaceAll('_', ' '),
    body: `${getActivityFeatureLabel(event)}${event.route ? ` · ${event.route}` : ''}`,
  }));
  const orderEvents = state.orders.flatMap((order) => {
    const base = [
      {
        at: toMillis(order.createdAt),
        title: getCustomerName(order),
        badge: 'order created',
        body: `${getOrderNumber(order)} · ${getServiceLabel(order)} · ${getPickup(order)} to ${getDropoff(order)}`,
      },
    ];

    if (order.customerRating) {
      base.push({
        at: toMillis(order.customerRatedAt || order.updatedAt),
        title: getCustomerName(order),
        badge: `${order.customerRating}/5 rating`,
        body: `${getOrderNumber(order)} review: ${safeText(order.customerReview, 'No written review')}`,
      });
    }

    if (order.cancelledBy === 'customer') {
      base.push({
        at: toMillis(order.cancelledAt || order.updatedAt),
        title: getCustomerName(order),
        badge: 'customer cancelled',
        body: `${getOrderNumber(order)} · ${safeText(order.cancellationReason, 'No reason provided')}`,
      });
    }

    return base;
  });

  return [...appEvents, ...orderEvents].filter((event) => event.at).sort((left, right) => right.at - left.at);
}

function buildDriverHistoryEvents() {
  const driverAppEvents = state.activityEvents.filter((event) => getEventRole(event) === 'driver').map((event) => ({
    at: toMillis(event.createdAt || event.updatedAt),
    title: safeText(event.userName || event.userId, 'Driver'),
    badge: safeText(event.eventName, 'driver_activity').replaceAll('_', ' '),
    body: `${getActivityFeatureLabel(event)}${event.screen ? ` · ${event.screen}` : ''}`,
  }));

  const orderEvents = state.orders.flatMap((order) => {
    if (!order.driverId && !order.driverName) {
      return [];
    }

    const driver = getDriverById(order.driverId);
    const driverName = safeText(order.driverName || driver?.fullName, 'Driver');
    const events = [];

    if (order.assignedAt || order.driverId) {
      events.push({
        at: toMillis(order.assignedAt || order.updatedAt || order.createdAt),
        title: driverName,
        badge: safeText(order.assignmentMode, 'assigned'),
        body: `${getOrderNumber(order)} · ${getServiceLabel(order)} · ${safeText(order.assignmentReason, 'Matched by dispatch score')}`,
      });
    }

    if (getOrderStatus(order) === 'delivered') {
      events.push({
        at: toMillis(order.deliveredAt || order.updatedAt),
        title: driverName,
        badge: 'delivered',
        body: `${getOrderNumber(order)} · ${formatMoney(getOrderAmount(order))}${order.customerRating ? ` · customer rated ${order.customerRating}/5` : ''}`,
      });
    }

    if (getOrderStatus(order) === 'cancelled') {
      events.push({
        at: toMillis(order.cancelledAt || order.updatedAt),
        title: driverName,
        badge: 'cancelled',
        body: `${getOrderNumber(order)} · ${safeText(order.cancellationReason, 'No reason provided')}`,
      });
    }

    return events;
  });

  return [...driverAppEvents, ...orderEvents].filter((event) => event.at).sort((left, right) => right.at - left.at);
}

function renderHistoryList(events, emptyMessage) {
  if (!events.length) {
    return emptyState(emptyMessage);
  }

  return `<div class="list-stack">${events.slice(0, 40).map((event) => `
    <div class="list-card">
      <div class="list-head">
        <strong>${escapeHtml(event.title)}</strong>
        ${pill(event.badge, 'info')}
      </div>
      <p class="muted">${escapeHtml(event.body)}</p>
      <span class="mini">${escapeHtml(formatDateTime(event.at))}</span>
    </div>
  `).join('')}</div>`;
}

function renderHistory() {
  const section = getOrCreateSection('history');
  const customerEvents = buildCustomerHistoryEvents();
  const driverEvents = buildDriverHistoryEvents();

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">History</span>
        <h2>Driver and customer activity in one place.</h2>
        <p>Track order creation, auto assignment, delivery status, customer ratings, cancellations, and app usage events.</p>
      </div>
    </div>
    <div class="grid kpi">
      ${kpi('Customer events', String(customerEvents.length), 'Orders, ratings, and app touches')}
      ${kpi('Driver events', String(driverEvents.length), 'Assignments, deliveries, cancellations')}
      ${kpi('Reviews saved', String(state.orders.filter((order) => order.customerRating).length), 'Customer delivery feedback')}
      ${kpi('Auto assigned', String(state.orders.filter((order) => order.assignmentMode === 'auto').length), 'Orders matched without admin')}
    </div>
    <div class="grid two">
      ${card('Customer history', 'Customers', renderHistoryList(customerEvents, 'No customer activity has been collected yet.'))}
      ${card('Driver history', 'Drivers', renderHistoryList(driverEvents, 'No driver activity has been collected yet.'))}
    </div>
  `;
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = safeText(getKey(item), 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sortedCounts(counts) {
  return Object.entries(counts).sort((left, right) => right[1] - left[1]);
}

function mergeCountLists(...lists) {
  const counts = {};
  lists.flat().forEach(([label, count]) => {
    counts[label] = (counts[label] || 0) + count;
  });
  return sortedCounts(counts);
}

function renderCountList(items, emptyMessage) {
  if (!items.length) {
    return emptyState(emptyMessage);
  }

  const max = Math.max(...items.map(([, count]) => count), 1);
  return `<div class="list-stack">${items.slice(0, 12).map(([label, count]) => `
    <div class="list-card">
      <div class="list-head"><strong>${escapeHtml(label.replaceAll('_', ' '))}</strong><span>${escapeHtml(String(count))}</span></div>
      <div class="progress"><span style="width:${Math.max(4, Math.round((count / max) * 100))}%"></span></div>
    </div>
  `).join('')}</div>`;
}

function getEventMetadata(event, key) {
  const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  return metadata[key];
}

function getEventRole(event) {
  return safeText(event.userRole || getEventMetadata(event, 'userRole'), event.eventName?.startsWith('driver_') ? 'driver' : 'customer');
}

function getEventCount(events, eventName) {
  return events.filter((event) => event.eventName === eventName).length;
}

function getEventFamilyCount(events, patterns) {
  return events.filter((event) => patterns.some((pattern) => safeText(event.eventName).includes(pattern))).length;
}

function getPercent(numerator, denominator) {
  return denominator ? `${Math.round((numerator / denominator) * 100)}%` : '0%';
}

function getHourBucket(value) {
  const millis = toMillis(value);
  if (!millis) return 'unknown';
  const hour = new Date(millis).getHours();
  const start = `${hour}`.padStart(2, '0');
  const end = `${(hour + 1) % 24}`.padStart(2, '0');
  return `${start}:00-${end}:00`;
}

function getOrderVehicleLabel(order) {
  return safeText(order.cargoVehicleLabel || order.driverVehicleLabel || order.vehicleLabel || order.vehicleType || order.serviceLabel, 'Delivery');
}

function getEventVehicleLabel(event) {
  return safeText(getEventMetadata(event, 'vehicleLabel') || getEventMetadata(event, 'vehicleType'), '');
}

function renderFunnelList(items) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return `<div class="list-stack">${items.map((item) => `
    <div class="list-card">
      <div class="list-head"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(String(item.count))}</span></div>
      <p class="muted">${escapeHtml(item.note)}</p>
      <div class="progress"><span style="width:${Math.max(4, Math.round((item.count / max) * 100))}%"></span></div>
    </div>
  `).join('')}</div>`;
}

function buildFrictionSignals(events) {
  const cancellations = sortedCounts(countBy(state.orders.filter((order) => getOrderStatus(order) === 'cancelled'), (order) => order.cancellationReason || order.cancelledBy || 'cancelled'));
  const failures = sortedCounts(countBy(
    events.filter((event) => {
      const name = safeText(event.eventName);
      return name.includes('failed')
        || name.includes('denied')
        || name.includes('declined')
        || name.includes('no_nearby')
        || name.includes('auto_cancelled');
    }),
    (event) => event.eventName
  ));

  return [...failures, ...cancellations].slice(0, 12);
}

function renderData() {
  const section = getOrCreateSection('data');
  const events = state.activityEvents;
  const featureCounts = sortedCounts(countBy(events, (event) => event.featureKey || event.featureLabel || event.route || event.screen));
  const screenCounts = sortedCounts(countBy(events, (event) => event.screen || event.route));
  const eventCounts = sortedCounts(countBy(events, (event) => event.eventName));
  const roleCounts = sortedCounts(countBy(events, getEventRole));
  const platformCounts = sortedCounts(countBy(events, (event) => event.platform || 'unknown'));
  const hourCounts = sortedCounts(countBy(events, (event) => getHourBucket(event.createdAt)));
  const vehicleEventCounts = sortedCounts(countBy(events.filter(getEventVehicleLabel), getEventVehicleLabel));
  const vehicleOrderCounts = sortedCounts(countBy(state.orders.filter((order) => order.flow === 'cargo' || order.cargoVehicleLabel), getOrderVehicleLabel));
  const vehicleCounts = mergeCountLists(vehicleOrderCounts, vehicleEventCounts);
  const frictionSignals = buildFrictionSignals(events);
  const routeStarts = getEventCount(events, 'destination_search_started');
  const routeSuccess = getEventCount(events, 'destination_search_success');
  const checkoutStarts = getEventCount(events, 'checkout_started');
  const orderCreated = getEventCount(events, 'order_created');
  const driverAccepted = getEventCount(events, 'driver_order_accepted');
  const driverDeclined = getEventCount(events, 'driver_order_declined');
  const noNearbyDriver = getEventCount(events, 'no_nearby_driver');
  const autoCancelledNoDriver = getEventCount(events, 'order_auto_cancelled_no_driver');
  const failedSignals = getEventFamilyCount(events, ['failed', 'denied', 'declined', 'no_nearby', 'auto_cancelled']);
  const cancellationCount = state.orders.filter((order) => getOrderStatus(order) === 'cancelled').length;
  const bookingFunnel = [
    { label: 'Destination searched', count: routeStarts, note: `${getPercent(routeSuccess, routeStarts)} became priced routes` },
    { label: 'Route priced', count: routeSuccess, note: `${getPercent(checkoutStarts, routeSuccess)} moved to checkout` },
    { label: 'Checkout started', count: checkoutStarts, note: `${getPercent(orderCreated, checkoutStarts)} created orders` },
    { label: 'Orders created', count: orderCreated || state.orders.length, note: `${driverAccepted} driver accepts tracked` },
    { label: 'Driver declined', count: driverDeclined, note: 'Watch this when fairness, pricing, or distance feels wrong' },
  ];
  const uniqueUsers = new Set(events.map((event) => event.userId).filter(Boolean)).size;
  const topFeature = featureCounts[0]?.[0] || 'No data yet';

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Usage data</span>
        <h2>Growth signals from customers, drivers, bookings, and friction.</h2>
        <p>doordrop collects lightweight product events that show demand, conversion, route quality, vehicle choice, driver behavior, and places where customers get stuck.</p>
      </div>
    </div>
    <div class="grid kpi">
      ${kpi('Events collected', String(events.length), 'Recent app activity sample')}
      ${kpi('Unique users', String(uniqueUsers), 'Customers and drivers represented')}
      ${kpi('Order conversion', getPercent(orderCreated, checkoutStarts), `${orderCreated} orders from ${checkoutStarts} checkouts`)}
      ${kpi('Friction signals', String(failedSignals + cancellationCount), 'Failures, denied permissions, declines, cancellations')}
    </div>
    <div class="grid kpi">
      ${kpi('Top feature', topFeature.replaceAll('_', ' '), `${featureCounts[0]?.[1] || 0} touches`)}
      ${kpi('Driver accepts', String(driverAccepted), 'Driver response events')}
      ${kpi('No nearby driver', String(noNearbyDriver), `${autoCancelledNoDriver} auto-cancelled after waiting`)}
      ${kpi('Tracked screens', String(screenCounts.length), 'Routes with activity')}
    </div>
    <div class="grid two">
      ${card('Booking funnel', 'Conversion', renderFunnelList(bookingFunnel))}
      ${card('Friction to fix first', 'Growth blockers', renderCountList(frictionSignals, 'No failures, declines, denied permissions, or cancellations recorded yet.'))}
    </div>
    <div class="grid three">
      ${card('Feature usage', 'Product data', renderCountList(featureCounts, 'No feature usage data yet.'))}
      ${card('Vehicle demand', 'Supply planning', renderCountList(vehicleCounts, 'No vehicle choice data yet.'))}
      ${card('Peak usage hours', 'Timing', renderCountList(hourCounts, 'No event time data yet.'))}
    </div>
    <div class="grid three">
      ${card('Screens opened', 'Navigation', renderCountList(screenCounts, 'No screen views have been recorded yet.'))}
      ${card('Customer vs driver activity', 'Roles', renderCountList(roleCounts, 'No role data yet.'))}
      ${card('Platforms', 'Device mix', renderCountList(platformCounts, 'No platform data yet.'))}
    </div>
    <div class="grid three">
      ${card('Event types', 'Tiny signals', renderCountList(eventCounts, 'No activity events yet.'))}
      ${card('Top pickup areas', 'Demand geography', renderCountList(sortedCounts(countBy(state.orders, getPickup)), 'No pickup areas yet.'))}
      ${card('Top drop-off areas', 'Demand geography', renderCountList(sortedCounts(countBy(state.orders, getDropoff)), 'No drop-off areas yet.'))}
    </div>
  `;
}

function renderSettings() {
  const section = getOrCreateSection('settings');
  const settings = state.settings;

  section.innerHTML = `
    <div class="hero">
      <div>
        <span class="eyebrow">Settings</span>
        <h2>Control operations rules, zones, pricing, and team permissions.</h2>
        <p>Configure services, admin users, roles, pricing logic, notification templates, and security preferences.</p>
      </div>
    </div>
    <article class="card">
      <div class="card-head"><div><span class="eyebrow">Company settings</span><h3>Operational configuration</h3></div></div>
      <div class="form-grid" id="settingsForm">
        <div class="field"><label>Company name</label><input data-setting-field="companyName" value="${escapeHtml(settings.companyName)}" /></div>
        <div class="field"><label>Default city</label><input data-setting-field="defaultCity" value="${escapeHtml(settings.defaultCity)}" /></div>
        <div class="field"><label>Currency</label><input data-setting-field="currencyLabel" value="${escapeHtml(settings.currencyLabel)}" /></div>
        <div class="field"><label>Default service status</label><select data-setting-field="defaultServiceStatus"><option ${settings.defaultServiceStatus === 'Active' ? 'selected' : ''}>Active</option><option ${settings.defaultServiceStatus === 'Maintenance' ? 'selected' : ''}>Maintenance</option></select></div>
        <div class="field span-2"><label><input type="checkbox" data-setting-field="autoAssignEnabled" ${settings.autoAssignEnabled ? 'checked' : ''} /> Run admin-tab assignment helper</label><small>Cloud Functions assign orders without this browser. This helper is only a visible fallback while the dashboard is open.</small></div>
        <div class="field span-2"><label>Cloud auto-dispatch</label><small>Enabled in backend: order-created trigger, driver availability trigger, and one-minute pending-order queue.</small></div>
        <div class="field span-2"><label>Support message</label><textarea data-setting-field="supportMessage">${escapeHtml(settings.supportMessage)}</textarea></div>
        <div class="span-2 admin-inline-actions">
          <button class="btn primary" data-action="save-settings">Save settings</button>
        </div>
      </div>
    </article>
  `;
}

function renderCurrentPage() {
  if (state.currentPage === 'dashboard') renderDashboard();
  if (state.currentPage === 'orders') renderOrders();
  if (state.currentPage === 'dispatch') renderDispatch();
  if (state.currentPage === 'services') renderServices();
  if (state.currentPage === 'customers') renderCustomers();
  if (state.currentPage === 'drivers') renderDrivers();
  if (state.currentPage === 'payments') renderPayments();
  if (state.currentPage === 'finance') renderFinance();
  if (state.currentPage === 'history') renderHistory();
  if (state.currentPage === 'data') renderData();
  if (state.currentPage === 'reports') renderReports();
  if (state.currentPage === 'settings') renderSettings();
}

function renderAll() {
  updateTopbarBadges();
  renderCurrentPage();
  renderDrawer();
}

function scheduleRenderAll() {
  if (state.renderTimer) {
    return;
  }

  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    renderAll();
  }, 50);
}

function updateTopbarBadges() {
  const connected = document.querySelector('.topbar .pill.success');
  if (connected) {
    connected.textContent = Object.values(state.loading).some(Boolean) ? 'Syncing...' : state.user ? 'Connected' : 'Signed out';
  }

  const admin = document.querySelector('.topbar .pill.neutral');
  if (admin) {
    admin.textContent = state.user ? state.user.displayName || state.user.email || 'Admin' : 'Access locked';
  }
}

function getSelectedOrder() {
  if (!state.selectedOrderId) return null;
  return state.orders.find((order) => order.id === state.selectedOrderId) || null;
}

function openOrderDrawer(orderId) {
  state.selectedOrderId = orderId;
  if (ui.orderDrawer) ui.orderDrawer.style.display = 'grid';
  if (ui.content) ui.content.classList.add('has-drawer');
  renderDrawer();
}

function closeOrderDrawer(options = {}) {
  if (!options.preserveSelection) {
    state.selectedOrderId = '';
  }
  if (ui.orderDrawer) ui.orderDrawer.style.display = 'none';
  if (ui.content) ui.content.classList.remove('has-drawer');
}

function renderTimelineStep(step, index, currentStatus, order) {
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);
  const isCancelled = currentStatus === 'cancelled';
  const complete = !isCancelled && currentIndex > index;
  const current = !isCancelled && currentIndex === index;
  const pending = isCancelled || currentIndex < index;
  const dotText = complete ? '✓' : String(index + 1);

  return `
    <div class="timeline-item">
      <div class="dot ${pending ? 'pending' : ''}">${escapeHtml(dotText)}</div>
      <div class="timeline-body">
        <strong>${escapeHtml(getStatusLabel(step))}</strong>
        <p>${current ? 'Current stage' : complete ? 'Completed' : isCancelled ? 'Stopped because order was cancelled' : 'Pending'} · ${escapeHtml(formatDateTime(order.updatedAt || order.createdAt))}</p>
      </div>
    </div>
  `;
}

function renderStatusButtons(order) {
  const status = getOrderStatus(order);
  const buttons = [];
  const assignedDriver = getDriverById(order.driverId);
  const customerPhone = safeText(order.customerPhone || order.phoneNumber || order.senderPhone);
  const recipientPhone = safeText(order.recipientPhone || order.receiverPhone || order.dropoffPhone || order.recipientContact);
  const driverPhone = safeText(order.driverPhone || assignedDriver?.phoneNumber);

  if (status === 'pending_assignment') {
    buttons.push(`<button class="btn primary" data-page-jump="dispatch">Open dispatch board</button>`);
  }
  if (status !== 'pending_assignment') {
    buttons.push(`<button class="btn soft" data-update-status="pending_assignment" data-order-id="${escapeHtml(order.id)}">Unassign</button>`);
  }
  if (status === 'driver_assigned') {
    buttons.push(`<button class="btn primary" data-update-status="driver_at_pickup" data-order-id="${escapeHtml(order.id)}">Mark at pickup</button>`);
  }
  if (status === 'driver_at_pickup') {
    buttons.push(`<button class="btn primary" data-update-status="in_transit" data-order-id="${escapeHtml(order.id)}">Start transit</button>`);
  }
  if (status === 'in_transit') {
    buttons.push(`<button class="btn primary" data-update-status="delivered" data-order-id="${escapeHtml(order.id)}">Mark delivered</button>`);
  }
  if (!HISTORY_STATUSES.includes(status)) {
    buttons.push(`<button class="btn soft" data-update-status="cancelled" data-order-id="${escapeHtml(order.id)}">Cancel order</button>`);
  }
  if (customerPhone) {
    buttons.push(`<button class="btn soft" data-contact-number="${escapeHtml(customerPhone)}" data-contact-label="customer">Contact customer</button>`);
  }
  if (recipientPhone) {
    buttons.push(`<button class="btn soft" data-contact-number="${escapeHtml(recipientPhone)}" data-contact-label="recipient">Contact recipient</button>`);
  }
  if (driverPhone) {
    buttons.push(`<button class="btn soft" data-contact-number="${escapeHtml(driverPhone)}" data-contact-label="driver">Contact driver</button>`);
  }

  return buttons.join('') || `<button class="btn soft" data-close-drawer="true">Close</button>`;
}

function detailRow(label, value, fallback = 'Not provided') {
  return `<div class="detail-row"><label>${escapeHtml(label)}</label><p>${escapeHtml(safeText(value, fallback))}</p></div>`;
}

function optionalDetailRow(label, value) {
  const text = safeText(value);
  return text ? detailRow(label, text) : '';
}

function renderDrawer() {
  const drawer = ui.orderDrawer;
  if (!drawer) {
    return;
  }

  const drawerIsOpen = drawer.style.display && drawer.style.display !== 'none';
  let order = getSelectedOrder();
  if (!drawerIsOpen) {
    drawer.style.display = 'none';
    ui.content?.classList.remove('has-drawer');
    return;
  }

  if (!order && state.orders.length) {
    order = sortByRecent(state.orders)[0];
    state.selectedOrderId = order.id;
  }

  if (!order) {
    drawer.style.display = 'none';
    ui.content?.classList.remove('has-drawer');
    return;
  }

  drawer.style.display = 'grid';
  ui.content?.classList.add('has-drawer');
  if (ui.drawerOrderId) ui.drawerOrderId.textContent = getOrderNumber(order);

  const status = getOrderStatus(order);
  const driver = getDriverById(order.driverId);
  const availableDrivers = status === 'pending_assignment' ? getNearbyDriverMatches(order).slice(0, 6) : [];

  drawer.innerHTML = `
    <div class="drawer-head">
      <div class="drawer-title-row">
        <div>
          <span class="eyebrow">Selected order</span>
          <h2 id="drawerOrderId">${escapeHtml(getOrderNumber(order))}</h2>
          <p class="muted">${escapeHtml(getServiceLabel(order))} · ${escapeHtml(safeText(order.scheduleLabel || order.schedule || 'Dispatch now'))}</p>
        </div>
        <button class="drawer-close" id="closeDrawer" data-close-drawer="true">×</button>
      </div>
      <div class="quick-grid">
        <div class="quick-card"><span>Status</span><strong>${escapeHtml(getOrderStatusLabel(order))}</strong></div>
        <div class="quick-card"><span>Value</span><strong>${escapeHtml(formatMoney(getOrderAmount(order)))}</strong></div>
      </div>
    </div>

    <div class="drawer-body">
      <section class="drawer-section">
        <h3 class="drawer-section-title">Customer information</h3>
        <div class="detail-list">
          ${detailRow('Sender name', getCustomerName(order))}
          ${detailRow('Sender contact', getCustomerContact(order))}
          ${detailRow('Recipient name', getRecipientName(order))}
          ${detailRow('Recipient phone', getRecipientContact(order))}
          ${optionalDetailRow('Customer email', order.customerEmail || order.email)}
        </div>
      </section>

      <section class="drawer-section">
        <h3 class="drawer-section-title">Delivery route</h3>
        <div class="detail-list">
          ${detailRow('Pickup', getPickup(order))}
          ${detailRow('Drop-off', getDropoff(order))}
          ${optionalDetailRow('Route', order.routeLabel)}
          ${optionalDetailRow('Distance', order.distanceLabel || (order.distanceMeters ? formatDistance(order.distanceMeters) : ''))}
          ${optionalDetailRow('Travel time', order.durationLabel || (order.durationSeconds ? formatDuration(order.durationSeconds) : ''))}
        </div>
      </section>

      <section class="drawer-section">
        <h3 class="drawer-section-title">Driver</h3>
        <div class="detail-list">
          ${detailRow('Assigned driver', driver ? safeText(driver.fullName || driver.email, 'Driver') : getDriverName(order))}
          ${detailRow('Assignment search', getDriverSearchMessage(order))}
          ${detailRow('Vehicle', safeText(driver?.vehicleLabel || order.driverVehicleLabel || order.driverVehicleType, 'Vehicle not assigned'))}
          ${detailRow('Driver phone', safeText(driver?.phoneNumber || order.driverPhone, 'No phone'))}
        </div>
      </section>

      <section class="drawer-section">
        <h3 class="drawer-section-title">Order details</h3>
        <div class="detail-list">
          ${detailRow('Order number', getOrderNumber(order))}
          ${detailRow('Firestore ID', order.id)}
          ${optionalDetailRow('Linked user ID', order.userId || order.customerId)}
          ${detailRow('Service', getServiceLabel(order))}
          ${detailRow('Status', getOrderStatusLabel(order))}
          ${detailRow('Payment', getOrderPaymentLabel(order))}
          ${detailRow('Schedule', getOrderScheduleLabel(order))}
          ${detailRow('Package or cargo', getOrderItemDescription(order))}
          ${detailRow('Created', formatDateTime(order.createdAt))}
          ${detailRow('Updated', formatDateTime(order.updatedAt || order.createdAt))}
          ${optionalDetailRow('Cancellation reason', order.cancellationReason || order.autoCancelledReason)}
        </div>
      </section>

      <section class="drawer-section">
        <h3 class="drawer-section-title">Progress timeline</h3>
        <div class="timeline">
          ${STATUS_FLOW.map((step, index) => renderTimelineStep(step, index, status, order)).join('')}
        </div>
      </section>

      ${status === 'pending_assignment' ? `
        <section class="drawer-section">
          <h3 class="drawer-section-title">Assign driver</h3>
          <div class="detail-list">
            ${availableDrivers.length ? availableDrivers.map((driverMatch) => `
              <div class="list-card">
                <div class="list-head"><strong>${escapeHtml(safeText(driverMatch.fullName || driverMatch.email, 'Driver'))}</strong>${pill(driverMatch.distanceLabel, driverMatch.badgeType)}${driverMatch.isPriorityMatch ? pill('Priority match', 'warning') : ''}</div>
                <p class="muted">${escapeHtml(safeText(driverMatch.vehicleLabel || driverMatch.vehicleType, 'Vehicle'))} · ${escapeHtml(safeText(driverMatch.phoneNumber, 'No phone'))}</p>
                <span class="mini">${escapeHtml(driverMatch.etaLabel)}${driverMatch.supportsOrder === false ? ' · Vehicle check needed' : ''}${driverMatch.isPriorityMatch ? ' · priority within 4 km' : ''} · fair score ${escapeHtml(String(Math.round(driverMatch.matchScore)))}</span>
                <button class="btn primary" data-assign-driver="${escapeHtml(driverMatch.id)}" data-order-id="${escapeHtml(order.id)}">Assign this driver</button>
              </div>
            `).join('') : emptyState(`No nearby online ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'doordrop')} driver right now. The order will auto-cancel if no match appears in time.`)}
          </div>
        </section>
      ` : ''}
    </div>

    <div class="drawer-actions">
      ${renderStatusButtons(order)}
    </div>
  `;
}

function renderSession() {
  ui.authScreen?.classList.toggle('hidden', !!state.user);
  ui.appScreen?.classList.toggle('hidden', !state.user);
  if (ui.signOutButton) {
    ui.signOutButton.hidden = !state.user;
  }
}

function isAllowedAdminEmail(email) {
  return normalize(email) === ADMIN_ACCESS_EMAIL;
}

function activateAdminSession(firebaseUser) {
  cleanupSubscriptions();
  state.firebaseUser = firebaseUser;
  state.user = firebaseUser;
  renderSession();
  subscribeLiveData();
}

function resetAdminData() {
  cleanupSubscriptions();
  state.orders = [];
  state.drivers = [];
  state.users = [];
  state.paymentReviews = [];
  state.activityEvents = [];
  state.loading = { orders: false, drivers: false, users: false, paymentReviews: false, activityEvents: false };
  closeModal();
  closeOrderDrawer();
  renderAll();
}

function getLookupDocumentId(value) {
  const raw = safeText(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const ordersIndex = parts.lastIndexOf('orders');
    if (ordersIndex >= 0 && parts[ordersIndex + 1]) {
      return decodeURIComponent(parts[ordersIndex + 1]);
    }
  } catch {
    // Plain IDs and order numbers are the common path.
  }

  const pieces = raw.replace(/^orders\//i, '').split('/').filter(Boolean);
  const documentId = pieces[pieces.length - 1] || raw;
  return /\s/.test(documentId) ? '' : documentId;
}

function upsertLookupOrder(order) {
  const existingIndex = state.orders.findIndex((item) => item.id === order.id);
  if (existingIndex >= 0) {
    state.orders = sortByRecent(state.orders.map((item) => (item.id === order.id ? { ...item, ...order } : item)));
    return;
  }

  state.orders = sortByRecent([...state.orders, order]);
}

async function fetchOrderByLookupField(lookupValue) {
  const lookup = safeText(lookupValue);
  const lookupVariants = [...new Set([lookup, lookup.toUpperCase()].filter(Boolean))];
  const lookupFields = ['orderNumber', 'orderId', 'trackingId', 'reference'];

  for (const field of lookupFields) {
    for (const value of lookupVariants) {
      const snapshot = await getDocs(query(col.orders, where(field, '==', value), limit(1)));
      const match = snapshot.docs[0];
      if (match) {
        return { id: match.id, ...match.data() };
      }
    }
  }

  return null;
}

async function openOrderFromLookup(form) {
  const lookupValue = safeText(new FormData(form).get('orderLookupId'));
  if (!lookupValue) {
    throw new Error('Enter an order ID or order number.');
  }

  let order = findOrderByLookup(lookupValue);

  if (!order) {
    const documentId = getLookupDocumentId(lookupValue);
    if (documentId) {
      const snapshot = await getDoc(orderRef(documentId));
      if (snapshot.exists()) {
        order = { id: snapshot.id, ...snapshot.data() };
        upsertLookupOrder(order);
      }
    }
  }

  if (!order) {
    order = await fetchOrderByLookupField(lookupValue);
  }

  if (!order) {
    throw new Error(`No order found for ${lookupValue}. Check the ID and try again.`);
  }

  upsertLookupOrder(order);
  renderCurrentPage();
  openOrderDrawer(order.id);
  ui.sidebar?.classList.remove('open');

  const lookupInput = $('sidebarOrderLookup');
  if (lookupInput) {
    lookupInput.value = getOrderNumber(order);
  }

  setFeedback(`Opened ${getOrderNumber(order)}.`, 'success');
}

function setAuthMode() {
  ui.loginModeButton?.classList.add('active');
  const submit = $('authSubmitButton');
  if (submit) {
    submit.textContent = 'Sign in';
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = safeText(ui.emailInput?.value).toLowerCase();
  const password = safeText(ui.passwordInput?.value);

  try {
    if (!email || !password) {
      throw new Error('Enter admin email and password.');
    }

    if (!isAllowedAdminEmail(email)) {
      throw new Error('Only the doordrop admin email can open this dashboard.');
    }

    setBusy(true);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    activateAdminSession(credential.user);
    setFeedback('Admin access opened.', 'success');
  } catch (error) {
    setFeedback(error.message || 'Authentication failed.', 'error');
  } finally {
    setBusy(false);
  }
}

async function handleAdminSignOut() {
  state.user = null;
  state.firebaseUser = null;
  resetAdminData();
  renderSession();
  await signOut(auth).catch(() => null);
  setFeedback('Signed out.', 'info');
}

function cleanupSubscriptions() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  state.unsubscribers = [];
  clearTimeout(state.autoAssignTimer);
  state.autoAssignTimer = null;
  clearTimeout(state.renderTimer);
  state.renderTimer = null;
}

function subscribeLiveData() {
  cleanupSubscriptions();
  state.loading = { orders: true, drivers: true, users: true, paymentReviews: true, activityEvents: true };
  let activeOrders = [];
  let recentOrders = [];
  const orderStreamsReady = {
    active: false,
    recent: false,
  };

  const applyOrderStreams = () => {
    const ordersById = new Map();
    [...recentOrders, ...activeOrders].forEach((order) => {
      ordersById.set(order.id, { ...(ordersById.get(order.id) || {}), ...order });
    });

    state.orders = sortByRecent([...ordersById.values()]);
    state.loading.orders = !(orderStreamsReady.active && orderStreamsReady.recent);
    scheduleRenderAll();
    scheduleAutoAssignment();
  };

  const activeOrdersQuery = query(col.orders, where('status', 'in', ACTIVE_STATUSES));
  const recentOrdersQuery = query(col.orders, orderBy('createdAt', 'desc'), limit(ADMIN_RECENT_ORDER_LIMIT));

  const unsubActiveOrders = onSnapshot(
    activeOrdersQuery,
    (snapshot) => {
      activeOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      orderStreamsReady.active = true;
      applyOrderStreams();
    },
    (error) => {
      orderStreamsReady.active = true;
      setFeedback(error.message || 'Could not sync orders.', 'error');
      applyOrderStreams();
    }
  );

  const unsubRecentOrders = onSnapshot(
    recentOrdersQuery,
    (snapshot) => {
      recentOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      orderStreamsReady.recent = true;
      applyOrderStreams();
    },
    (error) => {
      orderStreamsReady.recent = true;
      setFeedback(error.message || 'Could not sync recent orders.', 'error');
      applyOrderStreams();
    }
  );

  const unsubDrivers = onSnapshot(
    col.drivers,
    (snapshot) => {
      state.drivers = sortDrivers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      state.loading.drivers = false;
      scheduleRenderAll();
      scheduleAutoAssignment();
    },
    (error) => {
      state.loading.drivers = false;
      setFeedback(error.message || 'Could not sync drivers.', 'error');
      scheduleRenderAll();
    }
  );

  const usersQuery = query(col.users, orderBy('createdAt', 'desc'), limit(ADMIN_RECENT_USER_LIMIT));
  const unsubUsers = onSnapshot(
    usersQuery,
    (snapshot) => {
      state.users = sortByRecent(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      state.loading.users = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.users = false;
      setFeedback(error.message || 'Could not sync users.', 'error');
      scheduleRenderAll();
    }
  );

  const paymentReviewsQuery = query(col.paymentReviews, orderBy('createdAt', 'desc'), limit(ADMIN_PAYMENT_REVIEW_LIMIT));
  const unsubPaymentReviews = onSnapshot(
    paymentReviewsQuery,
    (snapshot) => {
      state.paymentReviews = sortByRecent(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      state.loading.paymentReviews = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.paymentReviews = false;
      setFeedback(error.message || 'Could not sync payment reviews.', 'error');
      scheduleRenderAll();
    }
  );

  const activityQuery = query(col.activityEvents, orderBy('createdAt', 'desc'), limit(ADMIN_ACTIVITY_EVENT_LIMIT));
  const unsubActivityEvents = onSnapshot(
    activityQuery,
    (snapshot) => {
      state.activityEvents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      state.loading.activityEvents = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.activityEvents = false;
      setFeedback(error.message || 'Could not sync app activity data.', 'error');
      scheduleRenderAll();
    }
  );

  state.unsubscribers.push(unsubActiveOrders, unsubRecentOrders, unsubDrivers, unsubUsers, unsubPaymentReviews, unsubActivityEvents);
}

function saveSettingsFromPage() {
  const values = {};
  $$('[data-setting-field]').forEach((input) => {
    values[input.dataset.settingField] = input.type === 'checkbox' ? input.checked : input.value;
  });
  persistSettings(values);
  renderAll();
  scheduleAutoAssignment();
  setFeedback('Settings saved locally for this admin workstation.', 'success');
}

function optimizeDispatchBoard() {
  const suggested = getSuggestedDispatchOrder();
  if (!suggested) {
    setFeedback('There are no waiting orders to optimize right now.', 'info');
    return;
  }

  state.selectedOrderId = suggested.id;
  setPage('dispatch', { preserveSelection: true });
  setFeedback(`Dispatch recommendations refreshed for ${getOrderNumber(suggested)}.`, 'success');
}

function bindEvents() {
  ui.loginModeButton?.addEventListener('click', () => setAuthMode('login'));
  ui.authForm?.addEventListener('submit', handleAuthSubmit);
  ui.signOutButton?.addEventListener('click', handleAdminSignOut);
  ui.menuButton?.addEventListener('click', () => ui.sidebar?.classList.toggle('open'));
  ui.closeDrawer?.addEventListener('click', closeOrderDrawer);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('input[type="search"]')) {
      state.query = target.value;
      renderCurrentPage();
      return;
    }

    if (target.matches('select[name="linkedUserId"]')) {
      handleCustomerSelection(target);
    }

  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('select[name="linkedUserId"]')) {
      handleCustomerSelection(target);
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.dataset.form === 'order-lookup') {
      event.preventDefault();
      try {
        setBusy(true);
        await openOrderFromLookup(form);
      } catch (error) {
        setFeedback(error.message || 'Could not find that order.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'create-order') {
      event.preventDefault();
      try {
        setBusy(true);
        await createManualOrder(form);
        closeModal();
        setPage('orders', { preserveSelection: true });
        if (state.selectedOrderId) {
          openOrderDrawer(state.selectedOrderId);
        }
        setFeedback('Manual order created successfully.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not create the manual order.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'create-driver') {
      event.preventDefault();
      try {
        setBusy(true);
        await createDriverRecord(form);
        closeModal();
        setPage('drivers');
        setFeedback('Driver profile saved successfully.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not save the driver profile.', 'error');
      } finally {
        setBusy(false);
      }
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button, tr, .list-card');
    if (!target) {
      return;
    }

    const sidebarPage = target.dataset.section;
    const pageJump = target.dataset.pageJump;
    if (sidebarPage || pageJump) {
      setPage(sidebarPage || pageJump, { preserveSelection: !!pageJump });
      return;
    }

    if (target.dataset.closeDrawer) {
      closeOrderDrawer();
      return;
    }

    if (target.dataset.closeModal) {
      closeModal();
      return;
    }

    if (target.dataset.contactNumber) {
      contactNumber(target.dataset.contactNumber, safeText(target.dataset.contactLabel, 'contact'));
      return;
    }

    const orderId = target.dataset.order || target.dataset.openOrder;
    if (orderId) {
      openOrderDrawer(orderId);
      return;
    }

    const verifyDriverId = target.dataset.verifyDriver;
    if (verifyDriverId) {
      try {
        setBusy(true);
        await verifyDriverAccount(verifyDriverId);
        renderAll();
        if (ui.modalRoot && !ui.modalRoot.classList.contains('hidden')) {
          openDriverDetails(verifyDriverId);
        }
        setFeedback('Driver verified and unlocked for dispatch.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not verify driver.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const rejectDriverId = target.dataset.rejectDriver;
    if (rejectDriverId) {
      const reason = window.prompt('Why is this driver verification being rejected?', 'Photo or plate details need correction') || '';
      if (!reason.trim()) {
        return;
      }

      try {
        setBusy(true);
        await rejectDriverAccount(rejectDriverId, reason);
        renderAll();
        if (ui.modalRoot && !ui.modalRoot.classList.contains('hidden')) {
          openDriverDetails(rejectDriverId);
        }
        setFeedback('Driver verification rejected.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not reject driver verification.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const priorityDriverId = target.dataset.togglePriorityDriver;
    if (priorityDriverId) {
      try {
        setBusy(true);
        const isPriority = await togglePriorityDriver(priorityDriverId);
        renderAll();
        if (ui.modalRoot && !ui.modalRoot.classList.contains('hidden')) {
          openDriverDetails(priorityDriverId);
        }
        setFeedback(isPriority ? 'Driver starred for priority matching.' : 'Driver priority star removed.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not update driver priority.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const driverId = target.dataset.selectDriver;
    if (driverId) {
      openDriverDetails(driverId);
      return;
    }

    const assignDriverId = target.dataset.assignDriver;
    const assignOrderId = target.dataset.orderId;
    if (assignDriverId && assignOrderId) {
      try {
        setBusy(true);
        await assignDriver(assignOrderId, assignDriverId);
        setFeedback('Driver assigned successfully.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not assign driver.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const verifyPaymentId = target.dataset.verifyPayment;
    if (verifyPaymentId) {
      try {
        setBusy(true);
        await verifyDriverPayment(verifyPaymentId);
        setFeedback('Legacy access record marked reviewed. Driver dispatch remains free.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not review payment record.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const rejectPaymentId = target.dataset.rejectPayment;
    if (rejectPaymentId) {
      const reason = window.prompt('Why is this record being rejected?', 'Payment reference could not be verified') || '';
      if (!safeText(reason)) {
        return;
      }

      try {
        setBusy(true);
        await rejectDriverPayment(rejectPaymentId, reason);
        setFeedback('Legacy access record rejected. Driver dispatch remains free.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not reject payment record.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const paymentPdfId = target.dataset.paymentPdf;
    if (paymentPdfId) {
      try {
        const payment = getPaymentReviewById(paymentPdfId);
        if (!payment) {
          throw new Error('Payment review was not found.');
        }
        openPaymentsPdf([payment], `doordrop Payment ${safeText(payment.transactionReference, payment.id)}`);
      } catch (error) {
        setFeedback(error.message || 'Could not open payment PDF.', 'error');
      }
      return;
    }

    const updateStatus = target.dataset.updateStatus;
    const updateOrderId = target.dataset.orderId;
    if (updateStatus && updateOrderId) {
      try {
        let cancellationReason = '';
        if (updateStatus === 'cancelled') {
          cancellationReason = window.prompt('Why is this order being cancelled?', 'Cancelled by dispatch') || '';
          if (!safeText(cancellationReason)) {
            return;
          }
        }

        setBusy(true);
        await updateOrderStatus(updateOrderId, updateStatus, { cancellationReason });
        setFeedback(`Order status updated to ${getStatusLabel(updateStatus)}.`, 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not update order status.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const action = target.dataset.action;
    if (action === 'export-report') {
      exportReportCsv();
      return;
    }
    if (action === 'export-payments-pdf') {
      try {
        openPaymentsPdf(sortByRecent(state.paymentReviews.filter(paymentMatchesQuery)));
      } catch (error) {
        setFeedback(error.message || 'Could not export payments PDF.', 'error');
      }
      return;
    }
    if (action === 'create-order') {
      openCreateOrderModal();
      return;
    }
    if (action === 'add-driver') {
      openAddDriverModal();
      return;
    }
    if (action === 'save-settings') {
      saveSettingsFromPage();
      return;
    }
    if (action === 'optimize-routes') {
      optimizeDispatchBoard();
      return;
    }
    if (action === 'run-auto-assign') {
      await runAutoAssignmentQueue();
    }
  });
}

function exportReportCsv() {
  const rows = [
    ['Order ID', 'Customer', 'Service', 'Status', 'Driver', 'Pickup', 'Drop-off', 'Value', 'Updated'],
    ...sortByRecent(state.orders).map((order) => [
      getOrderNumber(order),
      getCustomerName(order),
      getServiceLabel(order),
      getOrderStatusLabel(order),
      getDriverName(order),
      getPickup(order),
      getDropoff(order),
      formatMoney(getOrderAmount(order)),
      formatDateTime(order.updatedAt || order.createdAt),
    ]),
  ];

  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `doordrop-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function boot() {
  ensureRuntimeShell();
  bindEvents();
  setAuthMode('login');
  setPage('dashboard');
  renderSession();

  onAuthStateChanged(auth, async (user) => {
    state.firebaseUser = user || null;

    if (!user || !isAllowedAdminEmail(user.email)) {
      cleanupSubscriptions();
      state.user = null;
      renderSession();
      resetAdminData();
      if (user) {
        await signOut(auth).catch(() => null);
        setFeedback('This account is not allowed to open doordrop admin.', 'error');
      }
      return;
    }

    activateAdminSession(user);
  });
}

boot();
