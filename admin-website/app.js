import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
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
import {
  analyzeOpsAttention,
  buildOpsStagePatch,
  buildOpsTimeline,
  formatDelay,
  formatOpsDateTime,
  getCurrentOpsStageId,
  getDeliveryType,
  getNextOpsAction,
  getOpsPipelineCounts,
  getOpsQueueOrders,
  getOpsStageDelay,
  getOpsStageLabel,
  getOrderEtaLabel,
  getRegionalShipmentCounts,
  getResponsibleTeam,
  isShipmentStuck,
  OPS_QUEUE_PAGES,
  OUTSIDE_ACTIVE_LOGISTICS_STATUSES,
  PRIORITY_META,
  DELIVERY_TYPES,
} from './ops-workflow.js';
import { renderShipmentManagementPage } from './shipment-page.js';

const DELIVERY_STATUS_LABELS = {
  pending_assignment: 'Waiting driver',
  driver_assigned: 'Driver assigned',
  driver_at_pickup: 'Driver at pickup',
  in_transit: 'In transit',
  at_hub: 'At DoorDrop office',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_FLOW = [
  'pending_assignment',
  'driver_assigned',
  'driver_at_pickup',
  'in_transit',
  'at_hub',
  'delivered',
];

const ACTIVE_STATUSES = ['pending_assignment', 'driver_assigned', 'driver_at_pickup', 'in_transit', 'at_hub'];
const HISTORY_STATUSES = ['delivered', 'cancelled'];

const OUTSIDE_LOGISTICS_LABELS = {
  awaiting_dispatch: '1 · Imethibitishwa',
  first_mile_assigned: '2 · Inachukuliwa',
  awaiting_hub_intake: '2 · Inaelekea ofisini',
  received_at_hub: '3 · Ofisini',
  in_transit_carrier: '4 · Njiani (basi/ndege)',
  arrived_destination: '5 · Imefika lengo',
  out_for_delivery: '5 · Inapelekwa nyumbani',
  completed: '6 · Imepokelewa',
  cancelled: 'Imefutwa',
};

const OUTSIDE_LOGISTICS_STEPS = [
  {
    id: 'awaiting_dispatch',
    title: '1 · Imethibitishwa',
    hint: 'Oda imewekwa. Panga dereva achukue mzigo kutoka kwa mteja.',
  },
  {
    id: 'first_mile_assigned',
    title: '2 · Inachukuliwa',
    hint: 'Dereva anakuja ofisini. Thibitisha mzigo umefika ofisini.',
  },
  {
    id: 'received_at_hub',
    title: '3 · Ofisini',
    hint: 'Mzigo uko ofisini. Pakia kwenye basi/ndege, kisha bonyeza “Imeondoka”.',
  },
  {
    id: 'in_transit_carrier',
    title: '4 · Njiani',
    hint: 'Mzigo uko kwenye basi/ndege. Bonyeza “Imefika” inapofika mji wa lengo.',
  },
  {
    id: 'arrived_destination',
    title: '5 · Imefika',
    hint: 'Mzigo umefika lengo. Mkabidhi mpokeaji au anza delivery ya nyumbani.',
  },
  {
    id: 'completed',
    title: '6 · Imepokelewa',
    hint: 'Mpokeaji amepokea. Oda inafungwa na inaenda kwenye History.',
  },
];
const ADMIN_SETTINGS_STORAGE_KEY = 'doordrop-admin-settings-v1';
const ADMIN_ACCESS_EMAIL = 'boyzeus11@gmail.com';
const ADMIN_RECENT_ORDER_LIMIT = 80;
const ADMIN_ACTIVE_ORDER_LIMIT = 120;
const ADMIN_DRIVER_LIMIT = 120;
const ADMIN_RECENT_USER_LIMIT = 80;
const ADMIN_PAYMENT_REVIEW_LIMIT = 80;
const ADMIN_ACTIVITY_EVENT_LIMIT = 80;

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
  {
    key: 'ninunulie',
    flow: 'ninunulie',
    icon: '🛒',
    title: 'Ninunulie (Buy for me)',
    aliases: ['ninunulie', 'buy for me', 'buy-for-me', 'kariakoo'],
    preferredVehicleTypes: [],
    description: 'Kariakoo buy-for-me requests handled by ops/agent via WhatsApp. Customer pays the seller; DoorDrop supervises purchase and delivers.',
  },
];

const PAGE_META = {
  dashboard: ['Dashboard', 'Orders, drivers, and revenue at a glance.'],
  orders: ['Orders', 'Track requests from booking to delivery.'],
  dispatch: ['Dispatch', 'Assign waiting orders to nearby drivers.'],
  services: ['Services', 'Parcel, TOYO, and Kirikuu performance.'],
  customers: ['Customers', 'Profiles, activity, and support.'],
  drivers: ['Drivers', 'Approve registrations and documents.'],
  carrierAgents: ['Uthibitisho wa mawakala', 'Thibitisha makampuni ya basi yaliyojiandikisha kwenye HAUL Cargo Agents.'],
  carrierCash: ['Fedha za kampuni', 'Ada ya HAUL. Tunadai jumla, tumepokea, na bado wazi.'],
  payments: ['Subscriptions', 'Driver access payments from M-Pesa and Mixx by Yas.'],
  finance: ['Finance', 'Revenue, payouts, and settlements.'],
  history: ['History', 'Customer and driver activity.'],
  data: ['Data', 'App screens and feature usage.'],
  reports: ['Reports', 'Operations and business summaries.'],
  settings: ['Settings', 'Company rules and dispatch preferences.'],
  airTransport: ['Air transport', 'Express controls, regions, and per-day flight schedules for customers.'],
  otherRegions: ['Bus & Air Parcels', 'Orodha ya oda. Bonyeza oda kufungua ukurasa wake — weka status kila hatua, mteja anaona kwenye app.'],
  ninunulie: ['Ninunulie (Buy for me)', 'Status tatu: Imenunuliwa → Inasafirishwa → Imekamilika. Unaweza Deny oda. Hakuna auto-driver / live track.'],
  myAttention: ['My Attention', 'Critical tasks and orders that need action now.'],
  overdue: ['Overdue orders', 'Orders that exceeded expected stage time.'],
  opsNew: ['New orders', 'Inter-region orders awaiting dispatch.'],
  opsPickups: ['Pickups', 'First-mile collection to origin office.'],
  opsOriginHub: ['Origin hub', 'Packages arriving at origin office.'],
  opsTransport: ['Transport', 'At origin hub — ready for carrier handover.'],
  opsInTransit: ['In transit', 'Shipments moving with bus or air carrier.'],
  opsDestinationHub: ['Destination hub', 'Arrived in destination region.'],
  opsLastMile: ['Last-mile', 'Final delivery leg to recipient.'],
  opsFinalDelivery: ['Out for delivery', 'Last-mile delivery to recipient.'],
  opsDelivered: ['Received', 'Closed parcels — History only for customer.'],
  opsFailed: ['Failed & cancelled', 'Problem orders needing follow-up.'],
  opsExceptions: ['Exceptions', 'Stuck, failed, or critical shipments.'],
  opsReturns: ['Returns', 'Return-to-sender and reversal shipments.'],
  shipmentPayments: ['Shipment payments', 'Unpaid active shipments.'],
  shipment: ['Parcel order', 'Taarifa kamili za oda, status, na hatua kwa mteja.'],
  transportDesk: ['Transport desk', 'Carrier movements and delay management.'],
  opsRegions: ['Regional view', 'Active shipments grouped by destination.'],
  orderTimeline: ['Order timeline', 'Full chronological history for one order.'],
};

const DEFAULT_SETTINGS = {
  companyName: 'DoorDrop',
  defaultCity: 'Dar es Salaam',
  currencyLabel: safeStoredValue(adminWebsiteConfig?.currencyLabel, 'TZS'),
  defaultServiceStatus: 'Active',
  supportMessage: 'Thank you for choosing doordrop. Our dispatch team is reviewing your delivery request.',
  commissionRate: Number(adminWebsiteConfig?.commissionRate ?? 0.15),
  weeklySubscriptionFee: 0,
  autoAssignEnabled: true,
  opsSla: {},
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
const ACCESS_SETTLEMENT_HOUR_EAT = 4;
const DRIVER_APP_ONLINE_WINDOW_MS = 1000 * 60 * 15;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => null);

const col = {
  orders: collection(db, 'orders'),
  drivers: collection(db, 'drivers'),
  carriers: collection(db, 'carriers'),
  users: collection(db, 'users'),
  notifications: collection(db, 'userNotifications'),
  paymentReviews: collection(db, 'commissionPaymentReviews'),
  driverPayments: collection(db, 'driverPayments'),
  activityEvents: collection(db, 'appActivityEvents'),
  outsideCities: collection(db, 'outsideDestinationCities'),
  outsideExpressRoutes: collection(db, 'outsideExpressRoutes'),
  customerPresence: collection(db, 'customerPresence'),
};

const outsideParcelConfigRef = doc(db, 'appConfig', 'outsideParcel');

const OUTSIDE_CITY_SEED = [
  {
    key: 'dar-es-salaam',
    label: 'Dar es Salaam',
    centerPoint: { latitude: -6.7924, longitude: 39.2083 },
    sortOrder: 10,
    homeDeliveryEnabled: true,
    stands: [
      { id: 'ubungo', label: 'Ubungo Bus Terminal', query: 'Ubungo Bus Terminal, Dar es Salaam, Tanzania', fallbackPoint: { latitude: -6.7867, longitude: 39.2078 } },
      { id: 'magufuli', label: 'Magufuli Bus Terminal', query: 'Magufuli Bus Terminal, Dar es Salaam, Tanzania', fallbackPoint: { latitude: -6.8124, longitude: 39.1538 } },
    ],
    airports: [
      { id: 'jnia', label: 'Julius Nyerere International Airport', query: 'Julius Nyerere International Airport, Dar es Salaam, Tanzania', fallbackPoint: { latitude: -6.8781, longitude: 39.2026 } },
    ],
  },
  {
    key: 'zanzibar',
    label: 'Zanzibar',
    centerPoint: { latitude: -6.1659, longitude: 39.2026 },
    sortOrder: 15,
    homeDeliveryEnabled: true,
    stands: [
      { id: 'ferry', label: 'Malindi Ferry Terminal', query: 'Malindi Ferry Terminal, Zanzibar, Tanzania', fallbackPoint: { latitude: -6.1598, longitude: 39.1925 } },
      { id: 'darajani', label: 'Darajani Market', query: 'Darajani Market, Stone Town, Zanzibar, Tanzania', fallbackPoint: { latitude: -6.1629, longitude: 39.1912 } },
    ],
    airports: [
      { id: 'znz', label: 'Abeid Amani Karume International Airport', query: 'Abeid Amani Karume International Airport, Zanzibar, Tanzania', fallbackPoint: { latitude: -6.222, longitude: 39.2249 } },
    ],
  },
  {
    key: 'mwanza',
    label: 'Mwanza',
    centerPoint: { latitude: -2.5164, longitude: 32.9175 },
    sortOrder: 20,
    homeDeliveryEnabled: true,
    stands: [
      { id: 'nyegezi', label: 'Nyegezi Bus Terminal', query: 'Nyegezi Bus Terminal, Mwanza, Tanzania', fallbackPoint: { latitude: -2.5732, longitude: 32.8709 } },
      { id: 'nyakato', label: 'Nyakato Bus Stand', query: 'Nyakato Bus Stand, Mwanza, Tanzania', fallbackPoint: { latitude: -2.5418, longitude: 32.9316 } },
    ],
    airports: [
      { id: 'mwanza-airport', label: 'Mwanza Airport', query: 'Mwanza Airport, Mwanza, Tanzania', fallbackPoint: { latitude: -2.4445, longitude: 32.9327 } },
    ],
  },
  {
    key: 'arusha',
    label: 'Arusha',
    centerPoint: { latitude: -3.3869, longitude: 36.683 },
    sortOrder: 30,
    homeDeliveryEnabled: true,
    stands: [
      { id: 'central', label: 'Arusha Central Bus Terminal', query: 'Arusha Central Bus Terminal, Arusha, Tanzania', fallbackPoint: { latitude: -3.3733, longitude: 36.6842 } },
      { id: 'kilombero', label: 'Kilombero Bus Stand', query: 'Kilombero Bus Stand, Arusha, Tanzania', fallbackPoint: { latitude: -3.3817, longitude: 36.6924 } },
    ],
    airports: [
      { id: 'arusha-airport', label: 'Arusha Airport', query: 'Arusha Airport, Arusha, Tanzania', fallbackPoint: { latitude: -3.3678, longitude: 36.6333 } },
      { id: 'kilimanjaro', label: 'Kilimanjaro International Airport', query: 'Kilimanjaro International Airport, Tanzania', fallbackPoint: { latitude: -3.4294, longitude: 37.0745 } },
    ],
  },
  {
    key: 'dodoma',
    label: 'Dodoma',
    centerPoint: { latitude: -6.163, longitude: 35.7516 },
    sortOrder: 40,
    homeDeliveryEnabled: true,
    stands: [
      { id: 'jamatini', label: 'Jamatini Bus Stand', query: 'Jamatini Bus Stand, Dodoma, Tanzania', fallbackPoint: { latitude: -6.175, longitude: 35.745 } },
    ],
    airports: [
      { id: 'dodoma-airport', label: 'Dodoma Airport', query: 'Dodoma Airport, Dodoma, Tanzania', fallbackPoint: { latitude: -6.17, longitude: 35.7526 } },
    ],
  },
  {
    key: 'kahama',
    label: 'Kahama',
    centerPoint: { latitude: -3.5922, longitude: 32.0089 },
    sortOrder: 50,
    homeDeliveryEnabled: false,
    stands: [
      { id: 'central', label: 'Kahama Bus Stand', query: 'Kahama Bus Stand, Kahama, Tanzania', fallbackPoint: { latitude: -3.5922, longitude: 32.0089 } },
    ],
    airports: [],
  },
  {
    key: 'mtwara',
    label: 'Mtwara',
    centerPoint: { latitude: -10.2667, longitude: 40.1833 },
    sortOrder: 60,
    homeDeliveryEnabled: false,
    stands: [
      { id: 'central', label: 'Mtwara Bus Stand', query: 'Mtwara Bus Stand, Mtwara, Tanzania', fallbackPoint: { latitude: -10.2706, longitude: 40.1822 } },
      { id: 'mikindani', label: 'Mikindani Bus Stand', query: 'Mikindani Bus Stand, Mtwara, Tanzania', fallbackPoint: { latitude: -10.2816, longitude: 40.1185 } },
    ],
    airports: [
      { id: 'mtwara-airport', label: 'Mtwara Airport', query: 'Mtwara Airport, Mtwara, Tanzania', fallbackPoint: { latitude: -10.3391, longitude: 40.1818 } },
    ],
  },
];

const EXPRESS_ROUTE_PAIRS = [
  {
    key: 'dar-zanzibar',
    title: 'Dar es Salaam ↔ Zanzibar',
    legs: [
      { id: 'dar-es-salaam__zanzibar', from: 'Dar es Salaam', to: 'Zanzibar' },
      { id: 'zanzibar__dar-es-salaam', from: 'Zanzibar', to: 'Dar es Salaam' },
    ],
  },
  {
    key: 'dar-mwanza',
    title: 'Dar es Salaam ↔ Mwanza',
    legs: [
      { id: 'dar-es-salaam__mwanza', from: 'Dar es Salaam', to: 'Mwanza' },
      { id: 'mwanza__dar-es-salaam', from: 'Mwanza', to: 'Dar es Salaam' },
    ],
  },
  {
    key: 'dar-arusha',
    title: 'Dar es Salaam ↔ Arusha',
    legs: [
      { id: 'dar-es-salaam__arusha', from: 'Dar es Salaam', to: 'Arusha' },
      { id: 'arusha__dar-es-salaam', from: 'Arusha', to: 'Dar es Salaam' },
    ],
  },
];

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
  orderFilter: 'all',
  driverFilter: 'all',
  paymentFilter: 'all',
  paymentPage: 1,
  selectedOrderId: '',
  shipmentId: '',
  orders: [],
  drivers: [],
  carriers: [],
  carrierShipments: [],
  carrierDecisions: [],
  carrierCashError: '',
  carrierDecisionsOk: false,
  users: [],
  paymentReviews: [],
  ussdPayments: [],
  activityEvents: [],
  outsideCities: [],
  outsideExpressRoutes: [],
  customerPresence: [],
  selectedExpressRouteId: '',
  selectedExpressScheduleDate: '',
  expressScheduleTab: 'day',
  outsideParcelConfig: {
    expressEnabledGlobally: true,
  },
  airTransportSelectedCity: '',
  airTransportEnableCity: '',
  otherRegionsFilter: 'all',
  otherRegionsMode: 'all',
  otherRegionsSearch: '',
  otherRegionsSelectedId: '',
  ninunulieSelectedId: '',
  ninunulieFilter: 'open',
  shipmentReturnPage: 'otherRegions',
  settings: readStoredSettings(),
  loading: {
    orders: true,
    drivers: true,
    carriers: true,
    carrierShipments: true,
    carrierDecisions: true,
    users: true,
    paymentReviews: true,
    activityEvents: true,
    outsideCities: true,
    outsideExpressRoutes: true,
    customerPresence: true,
  },
  busy: false,
  autoAssigning: false,
  autoAssignTimer: null,
  renderTimer: null,
  dispatchMap: null,
  dispatchMapMarkers: [],
  googleMapsLoader: null,
  unsubscribers: [],
  feedbackTimer: null,
  apiHealth: null,
  opsTimelineOrderId: '',
  opsRegionFilter: 'all',
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

function getTanzaniaDayEndMillis(value = Date.now()) {
  return getTanzaniaDayStartMillis(value) + DAY_MS;
}

function getTanzaniaWeekPeriodStartMillis(value = Date.now()) {
  const weekStart = getTanzaniaWeekStartMillis(value);
  const thisWeekSettlement = weekStart + ACCESS_SETTLEMENT_HOUR_EAT * 60 * 60 * 1000;
  if (value >= thisWeekSettlement) {
    return thisWeekSettlement;
  }

  return thisWeekSettlement - 7 * DAY_MS;
}

function getTanzaniaWeekEndMillis(value = Date.now()) {
  return getTanzaniaWeekPeriodStartMillis(value) + 7 * DAY_MS;
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
  // Ninunulie seller purchase is not DoorDrop delivery revenue.
  if (isNinunulieOrder(order)) {
    return 0;
  }
  return parseAmount(order.totalAmount ?? order.amount ?? order.price ?? order.totalLabel ?? order.deliveryFee);
}

function getNinunuliePurchaseAmount(order) {
  return parseAmount(
    order.ninunuliePurchaseAmountTzs ?? order.ninunulieExpectedPriceTzs ?? order.totalAmount ?? order.totalLabel
  );
}

function getOrderNumber(order) {
  return safeText(order.orderNumber || order.orderId || order.id, 'Unknown order');
}

async function sendDriverIncomingOrderPush(driver, order) {
  const token = String(driver?.latestPushToken || '').trim();
  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)) {
    return;
  }

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: token,
      title: 'New DoorDrive order',
      body: `${getOrderNumber(order)} is waiting. Accept or decline now.`,
      sound: 'default',
      priority: 'high',
      channelId: 'incoming_order_alarm',
      ttl: 90,
      data: {
        type: 'incoming_order',
        orderId: order.id || '',
        orderNumber: getOrderNumber(order),
      },
    }),
  }).catch(() => null);
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
    order.ninunulieItemTitle
      || order.itemDescription
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
  if (status === 'rejected') {
    return { status: 'rejected', label: 'Rejected', className: 'danger', rank: 1 };
  }
  if (status === 'pending_admin_verification' || status === 'pending' || status === 'submitted') {
    return { status: 'pending_admin_verification', label: 'Pending verification', className: 'warning', rank: 0 };
  }
  if (status === 'verified' || driver?.verifiedAt) {
    return { status: 'verified', label: 'Verified', className: 'success', rank: 2 };
  }
  if (!status && (driver?.isAvailable || Number(driver?.completedOrderCount || 0) > 0)) {
    return { status: 'verified', label: 'Verified', className: 'success', rank: 2 };
  }
  return { status: 'pending_admin_verification', label: 'Pending verification', className: 'warning', rank: 0 };
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
  if (isNinunulieOrder(order)) {
    return 'ninunulie';
  }

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
    ninunulie: 'ninunulie',
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

const DRIVER_ACCESS_PLANS = {
  bodaboda: {
    vehicleType: 'bodaboda',
    label: 'Bodaboda',
    feeTzs: 3500,
    minOrders: 4,
    period: 'day',
    periodLabel: 'siku',
  },
  toyo: {
    vehicleType: 'toyo',
    label: 'TOYO',
    feeTzs: 25000,
    minOrders: 3,
    period: 'week',
    periodLabel: 'wiki',
  },
  kirikuu: {
    vehicleType: 'kirikuu',
    label: 'Kirikuu',
    feeTzs: 25000,
    minOrders: 3,
    period: 'week',
    periodLabel: 'wiki',
  },
};

function getDriverAccessPlan(driver) {
  const vehicleType = normalizeDriverVehicleType(driver?.vehicleType || driver?.vehicleLabel);
  return DRIVER_ACCESS_PLANS[vehicleType] || DRIVER_ACCESS_PLANS.bodaboda;
}

function getDriverWeeklySubscriptionFee(driver) {
  return getDriverAccessPlan(driver).feeTzs;
}

function getDriverAccessFeeLabel(driver) {
  const plan = getDriverAccessPlan(driver);
  return `${formatMoney(plan.feeTzs)} / ${plan.periodLabel}`;
}

function getAccessPaidUntilMillis(plan, now = Date.now()) {
  return plan.period === 'week' ? getTanzaniaWeekEndMillis(now) : getTanzaniaDayEndMillis(now);
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
  const pendingOrders = sortByRecent(
    state.orders.filter(
      (order) =>
        getOrderStatus(order) === 'pending_assignment' &&
        !isOutsideParcelOrder(order) &&
        !isNinunulieOrder(order)
    )
  );
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

function isOutsideParcelOrder(order) {
  if (!order) return false;
  if (String(order.parcelScope || '').trim().toLowerCase() === 'outside') return true;
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

function isNinunulieOrder(order) {
  if (!order) return false;
  return normalize(order.flow) === 'ninunulie' || normalize(order.serviceLabel) === 'ninunulie';
}

function isOpsDeskOrder(order) {
  return (
    isNinunulieOrder(order) ||
    safeText(order.assignmentMode) === 'ops_desk' ||
    safeText(order.driverSearchStatus) === 'ops_desk'
  );
}

function isAutoAssignableOrder(order) {
  if (!state.settings.autoAssignEnabled) return false;
  if (isOutsideParcelOrder(order)) return false;
  if (String(order.fareType || '').trim() === 'negotiated') return false;
  if (isOpsDeskOrder(order)) return false;
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
  return (
    !isOutsideParcelOrder(order) &&
    safeText(order.driverSearchStatus) !== 'ops_desk' &&
    getOrderStatus(order) === 'pending_assignment' &&
    !order.driverId &&
    order.timingMode !== 'later'
  );
}

function getDriverSearchExpiryMillis(order) {
  if (isOutsideParcelOrder(order) || safeText(order.driverSearchStatus) === 'ops_desk') {
    return 0;
  }
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
  if (isOutsideParcelOrder(order) || safeText(order.driverSearchStatus) === 'ops_desk') {
    return false;
  }
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
    // DoorDrop delivery revenue (0 for Ninunulie). Purchase GMV tracked separately for Ninunulie.
    const revenue = delivered.reduce((sum, order) => sum + getOrderAmount(order), 0);
    const purchaseVolume = service.key === 'ninunulie'
      ? serviceOrders
          .filter((order) => order.ninunuliePurchased || getOrderStatus(order) === 'delivered')
          .reduce((sum, order) => sum + getNinunuliePurchaseAmount(order), 0)
      : 0;
    return { ...service, orders: serviceOrders, delivered, cancelled, completion, revenue, purchaseVolume };
  });
}

function getNinunulieFinanceStats() {
  const orders = getNinunulieOrders();
  const open = orders.filter((order) => ACTIVE_STATUSES.includes(getOrderStatus(order)));
  const purchased = orders.filter((order) => Boolean(order.ninunuliePurchased));
  const delivered = orders.filter((order) => getOrderStatus(order) === 'delivered');
  const purchaseVolume = purchased.reduce((sum, order) => sum + getNinunuliePurchaseAmount(order), 0);
  return {
    total: orders.length,
    open: open.length,
    purchased: purchased.length,
    delivered: delivered.length,
    purchaseVolume,
  };
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
    payment.receiptNumber,
    payment.gatewayRef,
    payment.network,
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

  if (isNinunulieOrder(order)) {
    const ninunulieTitles = {
      pending_assignment: 'Ninunulie imepokelewa',
      driver_assigned: 'Ninunulie inashughulikiwa',
      driver_at_pickup: 'Bidhaa imenunuliwa',
      in_transit: 'Ninunulie inasafirishwa',
      delivered: 'Ninunulie imekamilika',
      cancelled: 'Ninunulie imekataliwa',
    };
    Object.assign(titleMap, ninunulieTitles);
    const statusHint = {
      pending_assignment: 'Oda mpya',
      driver_assigned: 'Inashughulikiwa',
      driver_at_pickup: 'Imenunuliwa',
      in_transit: 'Inasafirishwa',
      delivered: 'Imekamilika',
      cancelled: 'Imekataliwa',
    }[status] || getStatusLabel(status);
    message = `${getOrderNumber(order)} · ${statusHint}. Fuatilia kupitia WhatsApp / ofisi.`;
  }

  await setDoc(notificationRef(), compact({
    userId,
    orderId: order.id,
    orderNumber: getOrderNumber(order),
    orderStatus: status,
    serviceLabel: safeText(order.serviceLabel),
    flow: safeText(order.flow),
    title: titleMap[status] || 'Order updated',
    message,
    type: status === 'pending_assignment' ? 'order_created' : 'order_status',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

const LOGISTICS_NOTIFICATION_COPY = {
  awaiting_dispatch: { title: 'Shipment confirmed', message: 'Your parcel is confirmed and awaiting pickup.' },
  first_mile_assigned: { title: 'Pickup started', message: 'A rider is collecting your parcel.' },
  awaiting_hub_intake: { title: 'Arriving at origin hub', message: 'Your parcel is heading to the DoorDrop origin office.' },
  received_at_hub: { title: 'At origin hub', message: 'Your parcel has been received at the origin DoorDrop office.' },
  in_transit_carrier: { title: 'In transit', message: 'Your parcel is on its way to the destination region.' },
  arrived_destination: { title: 'Arrived at destination', message: 'Your parcel has arrived in the destination region.' },
  out_for_delivery: { title: 'Out for delivery', message: 'Your parcel is on the final delivery leg.' },
  completed: { title: 'Parcel received', message: 'Your parcel has been received. This order is now in History.' },
  cancelled: { title: 'Shipment cancelled', message: 'This shipment was cancelled. Contact support if unexpected.' },
  failed: { title: 'Delivery issue', message: 'There is an issue with your shipment. Our team is following up.' },
};

async function createLogisticsStatusNotification(order, logisticsStatus, options = {}) {
  const userId = order.userId || order.customerId;
  if (!userId || normalize(userId).startsWith('manual:')) {
    return;
  }

  const user = state.users.find((item) => item.id === userId || item.uid === userId);
  if (user?.notificationPreferences?.orderUpdates === false) {
    return;
  }

  const copy = LOGISTICS_NOTIFICATION_COPY[logisticsStatus] || {
    title: 'Shipment updated',
    message: `${getOrderNumber(order)} progress updated.`,
  };
  const message = safeText(options.note, copy.message);

  await setDoc(notificationRef(), compact({
    userId,
    orderId: order.id,
    orderNumber: getOrderNumber(order),
    logisticsStatus,
    orderStatus: logisticsStatus === 'completed' ? 'delivered' : order.status,
    title: copy.title,
    message,
    type: 'order_status',
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

    const outsideAssign = isOutsideParcelOrder(order);
    transaction.update(orderRef(orderId), compact({
      status: 'driver_assigned',
      ...driverPayload(driver),
      assignmentMode: safeText(assignment.mode, outsideAssign ? 'ops_desk' : 'manual'),
      assignmentScore: Number.isFinite(assignment.score) ? Math.round(assignment.score * 100) / 100 : undefined,
      assignmentReason: safeText(assignment.reason),
      driverSearchStatus: 'assigned',
      driverSearchMessage: `${safeText(driver.fullName, 'A driver')} has been assigned to this order.`,
      driverSearchResolvedAt: serverTimestamp(),
      ...(outsideAssign
        ? {
            logisticsStatus: 'first_mile_assigned',
            logisticsEvents: arrayUnion({
              status: 'first_mile_assigned',
              note: `${safeText(driver.fullName, 'Driver')} assigned to collect parcel to DoorDrop office.`,
              by: safeText(state.user?.email, 'admin'),
              at: new Date(),
            }),
          }
        : {}),
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
    await sendDriverIncomingOrderPush(assignedDriver, assignedOrder);
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

  if (
    !order.driverId &&
    !isOpsDeskOrder(order) &&
    ['driver_assigned', 'driver_at_pickup', 'in_transit', 'delivered'].includes(status)
  ) {
    throw new Error('Assign a driver first before moving this order forward.');
  }

  const actor = safeText(state.user?.email, 'admin');
  const opsPatch = buildOpsStagePatch(order, status, actor, {
    reason: options.reason || '',
    note: options.note || options.cancellationReason || '',
    manual: options.manual === true,
    slaOverrides: state.settings?.opsSla,
  });

  const batch = writeBatch(db);
  batch.update(orderRef(orderId), compact({
    status,
    ...opsPatch,
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

function getCarrierStatusKey(carrier) {
  return String(carrier?.status || 'pending').toLowerCase();
}

function getCarrierStatusLabel(status) {
  const map = {
    pending: 'Inasubiri uthibitisho',
    verified: 'Imethibitishwa',
    rejected: 'Imekataliwa',
    suspended: 'Imesimamishwa',
  };
  return map[String(status || '').toLowerCase()] || status || '—';
}

function carrierStatusPill(status) {
  const key = getCarrierStatusKey({ status });
  const tone = key === 'verified' ? 'success' : key === 'rejected' || key === 'suspended' ? 'danger' : 'warning';
  return pill(getCarrierStatusLabel(key), tone);
}

async function updateCarrierVerificationStatus(carrierId, nextStatus, reason = '') {
  if (!state.user) {
    throw new Error('Sign in to review carriers.');
  }
  const patch = {
    status: nextStatus,
    reviewedAt: serverTimestamp(),
    reviewedBy: state.user.email || '',
    updatedAt: serverTimestamp(),
  };
  if (nextStatus === 'verified') {
    patch.rejectionReason = deleteField();
  } else if (nextStatus === 'rejected') {
    patch.rejectionReason = safeText(reason, 'Imekataliwa na msimamizi');
  }
  await updateDoc(doc(db, 'carriers', carrierId), patch);
}

function ensureRuntimeShell() {
  injectRuntimeStyles();

  if (!ui.authScreen) {
    const overlay = document.createElement('div');
    overlay.id = 'authScreen';
    overlay.className = 'admin-auth-overlay';
    overlay.innerHTML = `
      <div class="admin-auth-card">
        <div class="auth-brand">
          <img class="auth-logo" src="./assets/doordrop.png" alt="DoorDrop" />
          <div>
            <strong>DoorDrop</strong>
            <small>Admin console</small>
          </div>
        </div>
        <h2>Welcome back</h2>
        <p class="muted">Sign in with your admin email.</p>
        <form id="authForm" class="form-grid">
          <div class="field span-2">
            <input id="emailInput" name="email" type="email" autocomplete="email" placeholder="Email" required />
          </div>
          <div class="field span-2">
            <input id="passwordInput" name="password" type="password" autocomplete="current-password" placeholder="Password" required />
          </div>
          <div class="span-2 admin-auth-actions">
            <button class="btn primary" id="authSubmitButton" type="submit" data-keep-enabled="true">Login</button>
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
      background:
        radial-gradient(circle at top, rgba(22, 163, 74, 0.12), transparent 36%),
        linear-gradient(180deg, #f7faf8 0%, #eef3f0 100%);
    }
    .admin-auth-card {
      width: min(420px, 100%);
      padding: 32px;
      display: grid;
      gap: 16px;
      border-radius: 24px;
      background: #ffffff;
      border: 1px solid var(--line);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
    }
    .auth-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .auth-brand strong {
      display: block;
      font-size: 0.98rem;
    }
    .auth-brand small {
      display: block;
      margin-top: 1px;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 600;
    }
    .brand-logo,
    .auth-logo {
      width: 40px;
      height: 40px;
      flex: 0 0 auto;
      object-fit: cover;
      border-radius: 12px;
    }
    .auth-logo {
      width: 52px;
      height: 52px;
      border-radius: 14px;
    }
    .admin-auth-card h2 {
      color: var(--ink);
      font-size: 1.55rem;
      line-height: 1.15;
    }
    .admin-auth-card > .muted {
      margin-top: -6px;
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
      background: rgba(15, 23, 42, 0.28);
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
      : 'Photo missing';
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

function getDriverLatestAccessPayment(driverId) {
  return sortByRecent(
    getAdminPaymentRecords().filter((payment) => payment.driverId === driverId && isAutomatedAccessPayment(payment))
  )[0] || null;
}

function getDriverAccessSummary(driver) {
  const plan = getDriverAccessPlan(driver);
  const paidUntil = toMillis(driver?.subscriptionPaidUntil);
  const now = Date.now();
  const isPaid = paidUntil > now;
  const completedOrders = plan.period === 'week'
    ? Number(driver?.weeklyCompletedOrderCount || 0)
    : Number(driver?.dailyCompletedOrderCount || 0);
  const latestPayment = getDriverLatestAccessPayment(driver.id);
  const paymentStatus = latestPayment ? paymentReviewStatus(latestPayment).label : safeText(driver?.lastSubscriptionPaymentStatus, 'No USSD record');

  return {
    plan,
    isPaid,
    paidUntil,
    completedOrders,
    minOrders: plan.minOrders,
    paymentStatus,
    latestPayment,
    duePeriodKey: safeText(driver?.accessPaymentDuePeriodKey),
  };
}

function renderDriverAccessCard(driver) {
  const access = getDriverAccessSummary(driver);
  const paymentRef = access.latestPayment
    ? safeText(access.latestPayment.transactionReference || access.latestPayment.gatewayRef || access.latestPayment.id)
    : 'None';

  return `
    <div class="list-card">
      <div class="list-head">
        <strong>Access & payments</strong>
        ${pill(access.isPaid ? 'Paid' : 'Payment required', access.isPaid ? 'success' : 'warning')}
      </div>
      <div class="quick-grid" style="margin-top:14px;">
        <div class="quick-card"><span>Plan</span><strong>${escapeHtml(access.plan.label)}</strong></div>
        <div class="quick-card"><span>Fee</span><strong>${escapeHtml(getDriverAccessFeeLabel(driver))}</strong></div>
        <div class="quick-card"><span>Orders this period</span><strong>${escapeHtml(`${access.completedOrders}/${access.minOrders}`)}</strong></div>
        <div class="quick-card"><span>Paid until</span><strong>${escapeHtml(access.isPaid ? formatDateTime(access.paidUntil) : 'Not active')}</strong></div>
        <div class="quick-card"><span>Last USSD</span><strong>${escapeHtml(access.paymentStatus)}</strong></div>
        <div class="quick-card"><span>Reference</span><strong>${escapeHtml(paymentRef)}</strong></div>
      </div>
      ${access.duePeriodKey ? `<p class="muted">Unpaid billing period: ${escapeHtml(access.duePeriodKey)}</p>` : ''}
      <div class="admin-inline-actions" style="margin-top:12px;">
        <button class="btn soft" type="button" data-page-jump="payments">Open subscriptions</button>
      </div>
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
        ${renderDriverAccessCard(driver)}
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
  if (state.user && !options.skipHash) {
    const nextUrl = `${location.pathname}${location.search}#${page}`;
    if (`${location.pathname}${location.search}${location.hash}` !== nextUrl) {
      history.replaceState(null, '', nextUrl);
    }
  }

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

function chartShare(value, total) {
  return total ? Math.max(0, Math.round((Number(value) / total) * 100)) : 0;
}

function barRow(label, value, total, tone = '', display = '') {
  return `
    <div class="bar-row">
      <div class="bar-row-meta"><span>${escapeHtml(label)}</span><strong>${escapeHtml(display || String(value))}</strong></div>
      <div class="bar-track"><span class="bar-fill ${tone}" style="width:${chartShare(value, total)}%"></span></div>
    </div>
  `;
}

function renderOrderMixChart(analytics) {
  const total = analytics.total || 0;
  return `
    <div class="chart">
      ${barRow('Waiting', analytics.pending.length, total, 'amber')}
      ${barRow('On the road', analytics.moving.length, total, 'blue')}
      ${barRow('Delivered', analytics.delivered.length, total, 'green')}
      ${barRow('Cancelled', analytics.cancelled.length, total, 'red')}
    </div>
  `;
}

function renderFleetChart(analytics) {
  const total = state.drivers.length || 0;
  return `
    <div class="chart">
      ${barRow('Available', analytics.activeDrivers.length, total)}
      ${barRow('Busy', analytics.busyDrivers.length, total, 'blue')}
      ${barRow('Offline', analytics.offlineDrivers.length, total, 'slate')}
    </div>
  `;
}

function renderFilterBar(filters, current, datasetKey) {
  const attr = datasetKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `
    <div class="filter-bar">
      ${filters.map((filter) => `
        <button type="button" class="filter-chip${current === filter.id ? ' active' : ''}" data-${attr}="${filter.id}">${escapeHtml(filter.label)}</button>
      `).join('')}
    </div>
  `;
}

const ORDER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending_assignment', label: 'Waiting' },
  { id: 'moving', label: 'On the road' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

const DRIVER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Needs review' },
  { id: 'ready', label: 'Ready' },
  { id: 'busy', label: 'Busy' },
  { id: 'offline', label: 'Offline' },
];

const PAYMENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'verified', label: 'Paid' },
  { id: 'rejected', label: 'Failed' },
];

function orderMatchesStatusFilter(order) {
  const filter = state.orderFilter || 'all';
  if (filter === 'all') {
    return true;
  }
  if (filter === 'moving') {
    return ['driver_assigned', 'driver_at_pickup', 'in_transit'].includes(getOrderStatus(order));
  }
  return getOrderStatus(order) === filter;
}

function driverMatchesStatusFilter(driver) {
  const filter = state.driverFilter || 'all';
  const verification = getDriverVerification(driver);
  if (filter === 'all') return true;
  if (filter === 'pending') return verification.status === 'pending_admin_verification';
  if (filter === 'ready') return driver.isAvailable && !driver.currentOrderId && isDriverVerifiedForDispatch(driver);
  if (filter === 'busy') return !!driver.currentOrderId;
  if (filter === 'offline') return !driver.isAvailable && !driver.currentOrderId;
  return true;
}

function isAutomatedAccessPayment(payment) {
  const type = normalize(payment?.paymentType);
  const source = normalize(payment?.source);
  const method = normalize(payment?.method);
  return type === 'driver_daily_access'
    || type === 'driver_weekly_access'
    || source === 'mongike_ussd'
    || method === 'mobile_money_ussd';
}

function getPaymentPlanLabel(payment) {
  const type = normalize(payment?.paymentType);
  const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
  const accessPlan = getDriverAccessPlan(driver);
  if (type === 'driver_daily_access') return `${accessPlan.label} · Kwa siku`;
  if (type === 'driver_weekly_access') return `${accessPlan.label} · Kwa wiki`;
  if (type === 'weekly_subscription') return `${accessPlan.label} · Legacy access`;
  const orderCount = Array.isArray(payment?.orderIds) ? payment.orderIds.length : 0;
  if (parseAmount(payment?.subscriptionFee) > 0 || orderCount === 0) return `${accessPlan.label} · Legacy access`;
  return `${orderCount} order${orderCount === 1 ? '' : 's'}`;
}

function getAccessPaymentSummary(payments = getAdminPaymentRecords()) {
  const ussd = payments.filter((payment) => isAutomatedAccessPayment(payment));
  const paidUssd = ussd.filter((payment) => isPaymentPaid(payment));
  const pendingUssd = ussd.filter((payment) => isPaymentPending(payment));
  const failedUssd = ussd.filter((payment) => isPaymentFailed(payment));
  const paidToday = paidUssd.filter((payment) => {
    const created = toMillis(payment.completedAt || payment.verifiedAt || payment.updatedAt || payment.createdAt);
    return created >= getTanzaniaDayStartMillis();
  });

  return {
    ussdTotal: ussd.length,
    ussdPaid: paidUssd.length,
    ussdPending: pendingUssd.length,
    ussdFailed: failedUssd.length,
    ussdPaidTodayAmount: paidToday.reduce((sum, payment) => sum + getPaymentAmount(payment), 0),
    ussdPaidAmount: paidUssd.reduce((sum, payment) => sum + getPaymentAmount(payment), 0),
  };
}

function isPaymentPending(payment) {
  const status = normalize(payment?.status || '');
  return !status || ['pending', 'creating', 'pending_admin_verification'].includes(status);
}

function isPaymentPaid(payment) {
  return ['completed', 'verified', 'approved'].includes(normalize(payment?.status));
}

function isPaymentFailed(payment) {
  return ['failed', 'expired', 'rejected'].includes(normalize(payment?.status));
}

function normalizeUssdPaymentForAdmin(payment) {
  const amount = parseAmount(payment?.amount || payment?.paymentAmount || payment?.subscriptionFee);
  return {
    ...payment,
    source: payment.source || 'mongike_ussd',
    method: payment.method || 'mobile_money_ussd',
    payerPhone: payment.payerPhone || payment.buyerPhone,
    paymentAmount: payment.paymentAmount || amount,
    subscriptionFee: payment.subscriptionFee || amount,
    transactionReference: payment.transactionReference || payment.gatewayRef || payment.reference || payment.receiptNumber || payment.orderId || payment.id,
  };
}

function getAdminPaymentRecords() {
  const merged = new Map();
  (state.ussdPayments || []).forEach((payment) => {
    merged.set(payment.id, normalizeUssdPaymentForAdmin(payment));
  });
  (state.paymentReviews || []).forEach((payment) => {
    const existing = merged.get(payment.id) || {};
    merged.set(payment.id, { ...existing, ...payment });
  });
  return sortByRecent([...merged.values()]);
}

function paymentMatchesStatusFilter(payment) {
  const filter = state.paymentFilter || 'all';
  if (filter === 'all') return true;
  if (filter === 'pending') return isPaymentPending(payment);
  if (filter === 'verified') return isPaymentPaid(payment);
  if (filter === 'rejected') return isPaymentFailed(payment);
  return true;
}

function renderOrderFilters() {
  return renderFilterBar(ORDER_FILTERS, state.orderFilter, 'orderFilter');
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

function customerRow(user) {
  const isActive = isActiveRecently(user.lastActiveAt || user.updatedAt || user.createdAt);
  return `
    <tr>
      <td>
        <div class="person">
          <strong>${escapeHtml(safeText(user.fullName || user.email, 'Customer'))}</strong>
          <span class="mini">${escapeHtml(safeText(user.email, 'No email'))}</span>
        </div>
      </td>
      <td>${escapeHtml(safeText(user.phoneNumber, 'No phone'))}</td>
      <td>${pill(isActive ? 'Active' : 'Quiet', isActive ? 'success' : 'neutral')}</td>
      <td>${escapeHtml(formatDateTime(user.lastActiveAt || user.updatedAt || user.createdAt))}</td>
    </tr>
  `;
}

function driverRow(driver) {
  const status = getDriverStatus(driver);
  const priority = isPriorityDriver(driver);
  const verification = getDriverVerification(driver);
  return `
    <tr>
      <td>
        <div class="person">
          <strong>${escapeHtml(safeText(driver.fullName || driver.email, 'Driver'))}</strong>
          <span class="mini">${escapeHtml(safeText(driver.phoneNumber, 'No phone'))}</span>
        </div>
      </td>
      <td>${escapeHtml(getDriverVehicleLabel(driver, 'Vehicle pending'))}${driver.plateNumber ? ` · ${escapeHtml(driver.plateNumber)}` : ''}</td>
      <td>${pill(status.label, status.className)}${priority ? pill('Priority', 'warning') : ''}</td>
      <td>${pill(verification.label, verification.className)}</td>
      <td>
        <div class="admin-inline-actions">
          ${
            verification.status === 'pending_admin_verification'
              ? `<button class="btn primary" type="button" data-verify-driver="${escapeHtml(driver.id)}">Verify</button>
                 <button class="btn soft" type="button" data-reject-driver="${escapeHtml(driver.id)}">Reject</button>`
              : ''
          }
          <button class="btn ${priority ? 'soft' : verification.status === 'pending_admin_verification' ? 'soft' : 'primary'}" data-toggle-priority-driver="${escapeHtml(driver.id)}">${priority ? 'Unstar' : 'Star'}</button>
          <button class="btn soft" data-select-driver="${escapeHtml(driver.id)}">View</button>
        </div>
      </td>
    </tr>
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
  if (isPaymentPaid(payment)) {
    return { label: isAutomatedAccessPayment(payment) ? 'Paid' : 'Verified', className: 'success' };
  }
  if (isPaymentFailed(payment)) {
    return { label: normalize(payment.status) === 'rejected' ? 'Rejected' : 'Failed', className: 'danger' };
  }
  if (normalize(payment.status) === 'creating') {
    return { label: 'Starting', className: 'warning' };
  }
  return { label: isAutomatedAccessPayment(payment) ? 'Pending USSD' : 'Pending review', className: 'warning' };
}

function paymentReviewRow(payment) {
  const status = paymentReviewStatus(payment);
  const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
  const amount = getPaymentAmount(payment);
  const planLabel = getPaymentPlanLabel(payment);
  const automated = isAutomatedAccessPayment(payment);
  const isPendingReview = !automated && isPaymentPending(payment);
  const reference = payment.receiptNumber || payment.transactionReference || payment.gatewayRef || payment.id;
  const driverName = safeText(payment.driverName || driver?.fullName, 'Driver');
  const initials = driverName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'D';
  const contact = safeText(payment.payerPhone || payment.driverPhone || driver?.phoneNumber || driver?.email, 'No contact');

  return `
    <tr>
      <td><span class="order-id">${escapeHtml(safeText(reference, payment.id))}</span></td>
      <td>
        <div class="person">
          <strong>${escapeHtml(formatShortDashDate(payment.createdAt || payment.updatedAt))}</strong>
          <span class="mini">${escapeHtml(formatTimeOnly(payment.createdAt || payment.updatedAt))}</span>
        </div>
      </td>
      <td>
        <div class="subs-recipient">
          <div class="subs-avatar">${escapeHtml(initials)}</div>
          <div class="person">
            <strong>${escapeHtml(driverName)}</strong>
            <span class="mini">${escapeHtml(planLabel)}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="person">
          <strong>${escapeHtml(contact)}</strong>
          <span class="mini">${escapeHtml(safeText(driver?.email || payment.driverEmail, '—'))}</span>
        </div>
      </td>
      <td>${escapeHtml(planLabel)}</td>
      <td>${escapeHtml(formatMoney(amount))}</td>
      <td>${pill(status.label, status.className)}</td>
      <td>
        <details class="subs-actions">
          <summary aria-label="Actions">⋯</summary>
          <div class="subs-actions-menu">
            ${isPendingReview ? `<button type="button" data-verify-payment="${escapeHtml(payment.id)}">Mark reviewed</button>` : ''}
            ${isPendingReview ? `<button type="button" data-reject-payment="${escapeHtml(payment.id)}">Reject record</button>` : ''}
            <button type="button" data-payment-pdf="${escapeHtml(payment.id)}">Download PDF</button>
            ${driver ? `<button type="button" data-select-driver="${escapeHtml(driver.id)}">Open driver</button>` : ''}
          </div>
        </details>
      </td>
    </tr>
  `;
}

function formatTimeOnly(value) {
  const millis = toMillis(value);
  if (!millis) return '';
  return new Date(millis).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPaymentReviewById(paymentId) {
  return getAdminPaymentRecords().find((payment) => payment.id === paymentId) || null;
}

function getPaymentOrderIds(payment) {
  return Array.isArray(payment?.orderIds) ? payment.orderIds.filter(Boolean) : [];
}

function getPaymentSummary(payments = getAdminPaymentRecords()) {
  const pending = payments.filter((payment) => isPaymentPending(payment));
  const verified = payments.filter((payment) => isPaymentPaid(payment));
  const rejected = payments.filter((payment) => isPaymentFailed(payment));
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

function renderActionRequired(analytics) {
  const pendingDrivers = state.drivers.filter(
    (driver) => getDriverVerification(driver).status === 'pending_admin_verification'
  );
  const paymentIssues = getAdminPaymentRecords().filter((payment) => isPaymentPending(payment) || isPaymentFailed(payment));
  const items = [
    {
      key: 'pending-orders',
      count: analytics.pending.length,
      label: 'Orders awaiting rider',
      section: 'dispatch',
      tone: 'warning',
    },
    {
      key: 'moving-orders',
      count: analytics.moving.length,
      label: 'Active deliveries in progress',
      section: 'orders',
      tone: 'info',
    },
    {
      key: 'driver-review',
      count: pendingDrivers.length,
      label: 'Drivers pending verification',
      section: 'drivers',
      tone: 'warning',
    },
    {
      key: 'payments',
      count: paymentIssues.length,
      label: 'Payment reviews needing attention',
      section: 'payments',
      tone: 'danger',
    },
    {
      key: 'cancelled',
      count: analytics.cancelled.length,
      label: 'Cancelled orders on record',
      section: 'orders',
      tone: 'neutral',
    },
  ].filter((item) => item.count > 0);

  if (!items.length) {
    return card('Action required', 'Operations', emptyState('No urgent actions right now.'), pill('Clear', 'success'));
  }

  return card(
    'Action required',
    'Operations',
    `
      <div class="action-required-grid">
        ${items
          .map(
            (item) => `
              <button class="action-required-item" type="button" data-action-section="${escapeHtml(item.section)}" data-action-filter="${escapeHtml(item.key)}">
                <strong>${escapeHtml(String(item.count))}</strong>
                <span>${escapeHtml(item.label)}</span>
                ${pill('Open', item.tone)}
              </button>
            `
          )
          .join('')}
      </div>
    `,
    pill(`${items.length} queues`, 'warning')
  );
}

async function refreshApiHealth() {
  const base = safeText(adminWebsiteConfig.apiBaseUrl);
  if (!base) {
    state.apiHealth = { ok: false, error: 'missing_api_base', checkedAt: Date.now() };
    return;
  }

  try {
    const response = await fetch(`${base}/health`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    state.apiHealth = {
      ok: response.ok && data.ok === true,
      mongikeConfigured: data.mongikeConfigured === true,
      status: response.status,
      checkedAt: Date.now(),
    };
  } catch (error) {
    state.apiHealth = {
      ok: false,
      error: error.message || 'network_error',
      checkedAt: Date.now(),
    };
  }
  updateSystemStatus();
}

function renderApiHealthBanner() {
  const health = state.apiHealth;
  if (!health || health.ok) {
    return '';
  }

  const detail = health.mongikeConfigured === false
    ? 'Mongike API key haijasanidi kwenye backend.'
    : health.status >= 500 || health.error
      ? 'API ya malipo haipatikani. Hakikisha billing na Blaze zimewashwa, kisha deploy backend.'
      : 'API ya malipo hairudishi hali nzuri.';

  return `
    <article class="card api-health-banner">
      <div class="list-head">
        <strong>Huduma ya malipo haipo mtandaoni</strong>
        <button class="btn soft" data-action="refresh-api-health">Angalia tena</button>
      </div>
      <p class="muted">${escapeHtml(detail)} Bei: Bodaboda ${escapeHtml(formatMoney(3500))}/siku · TOYO/Kirikuu ${escapeHtml(formatMoney(25000))}/wiki.</p>
    </article>
  `;
}

function getOpsSlaOverrides() {
  return state.settings?.opsSla || {};
}

function getAllOpsOrders() {
  return sortByRecent(state.orders);
}

function openShipmentPage(orderId, options = {}) {
  const id = safeText(orderId);
  if (!id) {
    return;
  }
  state.shipmentId = id;
  state.selectedOrderId = id;
  state.otherRegionsSelectedId = id;
  if (options.returnPage) {
    state.shipmentReturnPage = options.returnPage;
  } else if (state.currentPage && state.currentPage !== 'shipment') {
    state.shipmentReturnPage = state.currentPage;
  }
  setPage('shipment');
}

function getShipmentOrder() {
  const id = safeText(state.shipmentId);
  if (!id) {
    return null;
  }
  return getAllOpsOrders().find((item) => item.id === id) || state.orders.find((item) => item.id === id) || null;
}

function renderShipmentPage() {
  const section = getOrCreateSection('shipment');
  const order = getShipmentOrder();
  const attention = analyzeOpsAttention(getAllOpsOrders(), getOpsSlaOverrides()).items.find((item) => item.orderId === state.shipmentId);

  if (!order && state.shipmentId) {
    section.innerHTML = `
      <article class="card">
        <p class="muted">Loading shipment ${escapeHtml(state.shipmentId)}…</p>
        <button class="btn soft" type="button" data-page-jump="orders">Back to orders</button>
      </article>
    `;
    loadShipmentOrder(state.shipmentId).then(() => scheduleRenderAll());
    return;
  }

  section.innerHTML = renderShipmentManagementPage(order, {
    slaOverrides: getOpsSlaOverrides(),
    attentionItem: attention,
    getOrderNumber,
    getPickup,
    getDropoff,
    getCustomerName,
    getCustomerContact,
    getRecipientName,
    getRecipientContact,
    getOrderStatusLabel,
    formatMoney: (item) => formatMoney(getOrderAmount(item)),
    returnPage: state.shipmentReturnPage || 'otherRegions',
    renderOutsideDetail: isOutsideParcelOrder(order) ? renderOtherRegionsDetail : null,
  });
  if (isOutsideParcelOrder(order)) {
    paintOutsideQrCanvases(section);
  }
}

async function loadShipmentOrder(orderId) {
  const id = safeText(orderId);
  if (!id) {
    return null;
  }
  const existing = getShipmentOrder();
  if (existing) {
    return existing;
  }
  try {
    const snapshot = await getDoc(orderRef(id));
    if (!snapshot.exists()) {
      setFeedback('Shipment not found.', 'error');
      return null;
    }
    const order = { id: snapshot.id, ...snapshot.data() };
    const index = state.orders.findIndex((item) => item.id === id);
    if (index >= 0) {
      state.orders[index] = { ...state.orders[index], ...order };
    } else {
      state.orders.push(order);
    }
    return order;
  } catch (error) {
    setFeedback(error.message || 'Could not load shipment.', 'error');
    return null;
  }
}

function renderOpsAttentionSummary() {
  const attention = analyzeOpsAttention(getAllOpsOrders(), getOpsSlaOverrides());
  const groups = ['critical', 'high', 'medium'].map((priority) => ({
    priority,
    meta: PRIORITY_META[priority],
    items: attention.items.filter((item) => item.priority === priority).slice(0, 6),
  }));

  return card(
    'Attention required',
    'Operations',
    `
      <div class="ops-attention-counts">
        ${groups.map(({ priority, meta, items }) => `
          <button class="ops-attention-chip ${meta.tone}" type="button" data-page-jump="myAttention" data-attention-priority="${priority}">
            <strong>${meta.icon} ${attention.counts[priority] || 0}</strong>
            <span>${escapeHtml(meta.label)}</span>
          </button>
        `).join('')}
      </div>
      <div class="list-stack" style="margin-top:16px;">
        ${attention.items.length
          ? attention.items.slice(0, 8).map((item) => {
              const meta = PRIORITY_META[item.priority] || PRIORITY_META.normal;
              return `
                <button class="list-card ops-attention-row" type="button" data-open-shipment="${escapeHtml(item.orderId)}">
                  <div class="list-head">
                    <strong>${escapeHtml(item.orderRef)}</strong>
                    ${pill(meta.label, meta.tone)}
                  </div>
                  <p class="muted">${escapeHtml(item.message)}</p>
                  <span class="mini">Next: ${escapeHtml(item.nextAction?.label || 'Review')} · ${escapeHtml(item.responsibleTeam)}</span>
                </button>
              `;
            }).join('')
          : emptyState('No orders need urgent attention right now.')}
      </div>
    `,
    pill(`${attention.total} items`, attention.counts.critical ? 'danger' : attention.counts.high ? 'warning' : 'success')
  );
}

function renderOpsPipelineBoard() {
  const pipeline = getOpsPipelineCounts(getAllOpsOrders());
  const rows = [
    { key: 'opsNew', label: 'New', count: pipeline.newOrders },
    { key: 'opsPickups', label: 'Pickup', count: pipeline.pickups },
    { key: 'opsOriginHub', label: 'Origin hub', count: pipeline.originHub },
    { key: 'opsTransport', label: 'Transport', count: pipeline.transport },
    { key: 'opsInTransit', label: 'In transit', count: pipeline.inTransit || 0 },
    { key: 'opsDestinationHub', label: 'Dest. hub', count: pipeline.destinationHub },
    { key: 'opsLastMile', label: 'Last-mile', count: pipeline.finalDelivery },
    { key: 'opsDelivered', label: 'Received', count: pipeline.delivered },
  ];

  return card(
    'Order pipeline',
    'Inter-region',
    `
      <div class="ops-pipeline-grid">
        ${rows.map((row) => `
          <button class="ops-pipeline-item" type="button" data-page-jump="${escapeHtml(row.key)}">
            <strong>${escapeHtml(String(row.count))}</strong>
            <span>${escapeHtml(row.label)}</span>
          </button>
        `).join('')}
      </div>
      <p class="mini" style="margin-top:12px;">${pipeline.localActive} local city orders active · ${pipeline.failed} failed/cancelled inter-region</p>
    `,
    pill('Pipeline', 'info')
  );
}

function renderOpsDelayedOrders(limit = 6) {
  const delayed = getAllOpsOrders()
    .map((order) => ({ order, delay: getOpsStageDelay(order, getOpsSlaOverrides()) }))
    .filter((item) => item.delay.overdue)
    .sort((left, right) => right.delay.delayMs - left.delay.delayMs)
    .slice(0, limit);

  if (!delayed.length) {
    return card('Delayed', 'Operations', emptyState('No overdue stage delays detected.'), pill('On time', 'success'));
  }

  return card(
    'Delayed',
    'Operations',
    `
      <div class="table-wrap compact">
        <table>
          <thead>
            <tr><th>Order</th><th>Stage</th><th>Overdue</th><th>Team</th><th></th></tr>
          </thead>
          <tbody>
            ${delayed.map(({ order, delay }) => `
              <tr>
                <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span></td>
                <td>${escapeHtml(getOpsStageLabel(delay.stageId, getDeliveryType(order)))}</td>
                <td><span class="pill danger">${escapeHtml(formatDelay(delay.delayMs))}</span></td>
                <td>${escapeHtml(getResponsibleTeam(order))}</td>
                <td><button class="btn soft" type="button" data-open-shipment="${escapeHtml(order.id)}">Manage</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `,
    pill(`${delayed.length} overdue`, 'danger')
  );
}

function renderOpsOrderRow(order, options = {}) {
  const delay = getOpsStageDelay(order, getOpsSlaOverrides());
  const next = getNextOpsAction(order);
  const type = getDeliveryType(order);
  const stageLabel = getOpsStageLabel(getCurrentOpsStageId(order), type);
  const delayPill = delay.overdue
    ? pill(`${formatDelay(delay.delayMs)} late`, 'danger')
    : delay.approaching
      ? pill('Due soon', 'warning')
      : pill('On track', 'success');

  return `
    <tr class="ops-order-row" data-open-shipment="${escapeHtml(order.id)}">
      <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span><span class="mini">${escapeHtml(type === DELIVERY_TYPES.INTER_REGION ? 'Inter-region' : 'Local')}</span></td>
      <td>${escapeHtml(safeText(order.customerName, 'Customer'))}</td>
      <td>${escapeHtml(getPickup(order))} → ${escapeHtml(getDropoff(order))}</td>
      <td>${escapeHtml(stageLabel)}</td>
      <td>${escapeHtml(formatOpsDateTime(delay.startedAt))}</td>
      <td>${delay.expectedAt ? escapeHtml(formatOpsDateTime(delay.expectedAt)) : '—'}</td>
      <td>${delayPill}</td>
      <td>${escapeHtml(getResponsibleTeam(order))}</td>
      <td>
        <div class="admin-inline-actions">
          ${next.action ? `<button class="btn primary" type="button" data-action="${escapeHtml(next.action === 'outside-assign' ? 'open-ops-desk' : next.action)}" data-order-id="${escapeHtml(order.id)}">${escapeHtml(next.label)}</button>` : ''}
          <button class="btn soft" type="button" data-open-shipment="${escapeHtml(order.id)}">Manage</button>
          <button class="btn soft" type="button" data-open-timeline="${escapeHtml(order.id)}">Timeline</button>
          <button class="btn soft" type="button" data-change-ops-status="${escapeHtml(order.id)}">Change status</button>
        </div>
      </td>
    </tr>
  `;
}

function renderOpsQueuePage(pageKey) {
  const section = getOrCreateSection(pageKey);
  const meta = OPS_QUEUE_PAGES[pageKey] || { title: 'Operations', subtitle: '' };
  const orders = getOpsQueueOrders(getAllOpsOrders(), pageKey, getOpsSlaOverrides());

  if (pageKey === 'opsRegions') {
    const regions = getRegionalShipmentCounts(getAllOpsOrders());
    section.innerHTML = `
      <div class="context-bar"><p class="page-note">${escapeHtml(meta.subtitle)}</p></div>
      <div class="grid kpi">
        ${regions.length
          ? regions.map((row) => kpi(row.region, String(row.count), 'Active shipments')).join('')
          : kpi('Regions', '0', 'No active inter-region shipments')}
      </div>
      <article class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Region</th><th>Active</th><th></th></tr></thead>
            <tbody>
              ${regions.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.region)}</strong></td>
                  <td>${row.count}</td>
                  <td><button class="btn soft" type="button" data-ops-region-filter="${escapeHtml(row.region)}">View orders</button></td>
                </tr>
              `).join('') || `<tr><td colspan="3">${emptyState('No regional shipments.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    return;
  }

  if (pageKey === 'myAttention') {
    const attention = analyzeOpsAttention(getAllOpsOrders(), getOpsSlaOverrides());
    section.innerHTML = `
      <div class="grid kpi">
        ${kpi('Critical', String(attention.counts.critical || 0), 'Immediate action')}
        ${kpi('High', String(attention.counts.high || 0), 'Action soon')}
        ${kpi('Medium', String(attention.counts.medium || 0), 'Monitor')}
        ${kpi('Total', String(attention.total), 'Attention items')}
      </div>
      <article class="card">
        <div class="list-stack">
          ${attention.items.length
            ? attention.items.map((item) => {
                const metaPill = PRIORITY_META[item.priority] || PRIORITY_META.normal;
                return `
                  <button class="list-card" type="button" data-open-shipment="${escapeHtml(item.orderId)}">
                    <div class="list-head"><strong>${escapeHtml(item.orderRef)}</strong>${pill(metaPill.label, metaPill.tone)}</div>
                    <p class="muted">${escapeHtml(item.message)}</p>
                    <span class="mini">${escapeHtml(item.nextAction?.label || '')} · ${escapeHtml(item.responsibleTeam)}</span>
                  </button>
                `;
              }).join('')
            : emptyState('Nothing needs your attention right now.')}
        </div>
      </article>
    `;
    return;
  }

  if (pageKey === 'transportDesk') {
    const transportOrders = getOpsQueueOrders(getAllOpsOrders(), 'transportDesk', getOpsSlaOverrides());
    section.innerHTML = `
      <div class="context-bar"><p class="page-note">${escapeHtml(meta.subtitle)}</p></div>
      <div class="grid kpi">
        ${kpi('In transit', String(transportOrders.length), 'Carrier shipments')}
        ${kpi('Delayed', String(transportOrders.filter((order) => getOpsStageDelay(order, getOpsSlaOverrides()).overdue).length), 'Past expected arrival')}
      </div>
      <article class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Route</th><th>Carrier ref</th><th>Departed</th><th>ETA</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${transportOrders.length
                ? transportOrders.map((order) => {
                    const delay = getOpsStageDelay(order, getOpsSlaOverrides());
                    return `
                      <tr>
                        <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span></td>
                        <td>${escapeHtml(safeText(order.outsideOriginCity, 'Dar'))} → ${escapeHtml(safeText(order.outsideDestinationCity))}</td>
                        <td>${escapeHtml(safeText(order.carrierRef, '—'))}</td>
                        <td>${escapeHtml(formatOpsDateTime(order.departedAt))}</td>
                        <td>${escapeHtml(getOrderEtaLabel(order))}</td>
                        <td>${delay.overdue ? pill(`Delayed ${formatDelay(delay.delayMs)}`, 'danger') : pill('In transit', 'info')}</td>
                        <td>
                          <button class="btn soft" type="button" data-action="outside-arrive" data-order-id="${escapeHtml(order.id)}">Confirm arrival</button>
                          <button class="btn soft" type="button" data-open-timeline="${escapeHtml(order.id)}">Timeline</button>
                        </td>
                      </tr>
                    `;
                  }).join('')
                : `<tr><td colspan="7">${emptyState('No shipments in transport right now.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    return;
  }

  if (pageKey === 'orderTimeline') {
    const orderId = safeText(state.opsTimelineOrderId);
    const order = orderId ? getAllOpsOrders().find((item) => item.id === orderId) : null;
    section.innerHTML = `
      <div class="context-bar">
        <p class="page-note">Select an order from any ops queue, or search by order ID.</p>
        <form class="admin-inline-actions" data-form="timeline-lookup">
          <input name="timelineOrderId" placeholder="Order ID or number" value="${escapeHtml(orderId)}" />
          <button class="btn primary" type="submit">Load timeline</button>
        </form>
      </div>
      ${order ? renderOrderTimelinePanel(order) : emptyState('No order selected. Open an order from a queue or search above.')}
    `;
    return;
  }

  if (pageKey === 'opsExceptions') {
    const attentionMap = new Map(analyzeOpsAttention(getAllOpsOrders(), getOpsSlaOverrides()).items.map((item) => [item.orderId, item]));
    section.innerHTML = `
      <div class="context-bar"><p class="page-note">${escapeHtml(meta.subtitle)}</p><span class="mini">${orders.length} shown</span></div>
      <article class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Issue</th><th>Stage</th><th>Next action</th><th>Team</th><th></th></tr></thead>
            <tbody>
              ${orders.length ? orders.map((order) => {
                const attention = attentionMap.get(order.id);
                const stuck = isShipmentStuck(order, getOpsSlaOverrides());
                const next = getNextOpsAction(order);
                const issue = attention?.message || (stuck ? 'Shipment appears stuck beyond SLA' : 'Failed or cancelled');
                return `
                  <tr>
                    <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span></td>
                    <td>${escapeHtml(issue)}</td>
                    <td>${escapeHtml(getOpsStageLabel(getCurrentOpsStageId(order), getDeliveryType(order)))}</td>
                    <td>${escapeHtml(next.label)}</td>
                    <td>${escapeHtml(getResponsibleTeam(order))}</td>
                    <td><button class="btn primary" type="button" data-open-shipment="${escapeHtml(order.id)}">Manage</button></td>
                  </tr>
                `;
              }).join('') : `<tr><td colspan="6">${emptyState('No exceptions right now.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    return;
  }

  if (pageKey === 'shipmentPayments') {
    section.innerHTML = `
      <div class="context-bar"><p class="page-note">${escapeHtml(meta.subtitle)}</p><span class="mini">${orders.length} unpaid</span></div>
      <article class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Stage</th><th></th></tr></thead>
            <tbody>
              ${orders.length ? orders.map((order) => `
                <tr>
                  <td><span class="order-id">${escapeHtml(getOrderNumber(order))}</span></td>
                  <td>${escapeHtml(getCustomerName(order))}</td>
                  <td>${escapeHtml(formatMoney(getOrderAmount(order)))}</td>
                  <td>${escapeHtml(getOpsStageLabel(getCurrentOpsStageId(order), getDeliveryType(order)))}</td>
                  <td><button class="btn soft" type="button" data-open-shipment="${escapeHtml(order.id)}">Manage</button></td>
                </tr>
              `).join('') : `<tr><td colspan="5">${emptyState('All active shipments are paid.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    `;
    return;
  }

  section.innerHTML = `
    <div class="context-bar">
      <p class="page-note">${escapeHtml(meta.subtitle)}</p>
      <span class="mini">${orders.length} shown</span>
    </div>
    <article class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Route</th><th>Stage</th><th>Started</th><th>Expected</th><th>SLA</th><th>Team</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${orders.length ? orders.map((order) => renderOpsOrderRow(order)).join('') : `<tr><td colspan="9">${emptyState('No orders in this queue.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderOrderTimelinePanel(order) {
  const timeline = buildOpsTimeline(order);
  const delay = getOpsStageDelay(order, getOpsSlaOverrides());
  const next = getNextOpsAction(order);

  return `
    <article class="card">
      <div class="card-head">
        <div>
          <span class="eyebrow">${escapeHtml(getOrderNumber(order))}</span>
          <h3>${escapeHtml(getPickup(order))} → ${escapeHtml(getDropoff(order))}</h3>
        </div>
        ${pill(getOpsStageLabel(getCurrentOpsStageId(order), getDeliveryType(order)), delay.overdue ? 'danger' : 'info')}
      </div>
      <div class="quick-grid">
        <div class="quick-card"><span>Created</span><strong>${escapeHtml(formatOpsDateTime(order.createdAt))}</strong></div>
        <div class="quick-card"><span>Current stage since</span><strong>${escapeHtml(formatOpsDateTime(delay.startedAt))}</strong></div>
        <div class="quick-card"><span>Expected by</span><strong>${delay.expectedAt ? escapeHtml(formatOpsDateTime(delay.expectedAt)) : '—'}</strong></div>
        <div class="quick-card"><span>ETA</span><strong>${escapeHtml(getOrderEtaLabel(order))}</strong></div>
        <div class="quick-card"><span>Next action</span><strong>${escapeHtml(next.label)}</strong></div>
        <div class="quick-card"><span>Responsible</span><strong>${escapeHtml(getResponsibleTeam(order))}</strong></div>
      </div>
      <div class="ops-vertical-timeline">
        ${timeline.map((item, index) => `
          <div class="ops-timeline-node">
            <div class="ops-timeline-dot">${timeline.length - index}</div>
            <div class="ops-timeline-body">
              <div class="list-head">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="mini">${escapeHtml(formatOpsDateTime(item.at))}</span>
              </div>
              <p class="muted">${escapeHtml(item.detail || '—')}</p>
              <span class="mini">${escapeHtml(item.by)}${item.reason ? ` · Reason: ${escapeHtml(item.reason)}` : ''}${item.delayLabel ? ` · ${escapeHtml(item.delayLabel)}` : ''}</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="admin-inline-actions" style="margin-top:16px;">
        ${next.action ? `<button class="btn primary" type="button" data-action="${escapeHtml(next.action === 'outside-assign' ? 'open-ops-desk' : next.action)}" data-order-id="${escapeHtml(order.id)}">${escapeHtml(next.label)}</button>` : ''}
        <button class="btn soft" type="button" data-change-ops-status="${escapeHtml(order.id)}">Change status</button>
        <button class="btn soft" type="button" data-open-shipment="${escapeHtml(order.id)}">Shipment page</button>
      </div>
    </article>
  `;
}

function openOpsStatusChangeModal(orderId) {
  const order = getAllOpsOrders().find((item) => item.id === orderId);
  if (!order) {
    setFeedback('Order not found.', 'error');
    return;
  }

  const type = getDeliveryType(order);
  const statusOptions = type === DELIVERY_TYPES.INTER_REGION
    ? ['awaiting_dispatch', 'first_mile_assigned', 'awaiting_hub_intake', 'received_at_hub', 'in_transit_carrier', 'arrived_destination', 'out_for_delivery', 'completed', 'cancelled']
    : ['pending_assignment', 'driver_assigned', 'driver_at_pickup', 'in_transit', 'at_hub', 'delivered', 'cancelled'];

  openModal({
    title: `Change status · ${getOrderNumber(order)}`,
    eyebrow: 'Manual override',
    body: `
      <p class="muted">Manual changes are recorded in the audit log. Reason is required.</p>
      <form class="form-grid" data-form="ops-status-change">
        <input type="hidden" name="orderId" value="${escapeHtml(order.id)}" />
        <div class="field span-2">
          <label>New status</label>
          <select name="nextStatus" required>
            ${statusOptions.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(getOpsStageLabel(status, type))}</option>`).join('')}
          </select>
        </div>
        <div class="field span-2">
          <label>Reason</label>
          <input name="reason" required placeholder="Why is this change needed?" />
        </div>
        <div class="field span-2">
          <label>Note</label>
          <textarea name="note" placeholder="Optional operational note"></textarea>
        </div>
        <div class="span-2 admin-inline-actions">
          <button class="btn primary" type="submit">Save change</button>
          <button class="btn soft" type="button" data-close-modal="true">Cancel</button>
        </div>
      </form>
    `,
  });
}

async function submitOutsideStatusUpdate(form) {
  const formData = new FormData(form);
  const orderId = safeText(formData.get('orderId'));
  const nextStatus = safeText(formData.get('nextStatus'));
  const reason = safeText(formData.get('reason'));
  const note = safeText(formData.get('note'));
  if (!reason) {
    throw new Error('Sababu inahitajika kabla ya kubadilisha hali.');
  }

  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order not found.');
  }
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (!isOutsideParcelOrder(order)) {
    throw new Error('Hii si oda ya nje ya mkoa.');
  }

  const current = getOutsideLogisticsStatus(order);
  if (nextStatus === current) {
    throw new Error('Oda tayari iko kwenye hali hiyo.');
  }

  if (nextStatus === 'cancelled') {
    const confirmed = window.confirm(
      `Una uhakika unataka KUFUTA oda ${getOrderNumber(order)}?\n\nSababu: ${reason}\n\nHii inaonekana kwa mteja kwenye app.`
    );
    if (!confirmed) {
      return;
    }
  }

  await appendOutsideLogistics(orderId, nextStatus, note || reason, {
    manualOverride: true,
    manualReason: reason,
    status:
      nextStatus === 'completed'
        ? 'delivered'
        : nextStatus === 'cancelled'
          ? 'cancelled'
          : nextStatus === 'received_at_hub'
            ? 'at_hub'
            : order.status,
    ...(nextStatus === 'cancelled'
      ? {
          cancelledBy: 'dispatch',
          cancelledAt: serverTimestamp(),
          cancellationReason: reason,
        }
      : {}),
  });

  state.otherRegionsSelectedId = orderId;
}

async function submitOpsStatusChange(form) {
  const formData = new FormData(form);
  const orderId = safeText(formData.get('orderId'));
  const nextStatus = safeText(formData.get('nextStatus'));
  const reason = safeText(formData.get('reason'));
  const note = safeText(formData.get('note'));
  if (!reason) {
    throw new Error('Reason is required for manual status changes.');
  }

  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order not found.');
  }
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };

  if (getDeliveryType(order) === DELIVERY_TYPES.INTER_REGION) {
    await appendOutsideLogistics(orderId, nextStatus, note || reason, {
      manualOverride: true,
      manualReason: reason,
    });
    return;
  }

  await updateOrderStatus(orderId, nextStatus, { reason, note, manual: true, cancellationReason: nextStatus === 'cancelled' ? reason : '' });
}

function renderDashboard() {
  const section = getOrCreateSection('dashboard');
  const analytics = getAnalytics();
  const weekSeries = getDashboardWeekSeries();
  const topServices = [...(analytics.services || [])]
    .sort((left, right) => right.orders.length - left.orders.length)
    .slice(0, 4);
  const recentOrders = sortByRecent(state.orders).slice(0, 6);
  const topCustomers = getWeeklyTopCustomers(6);
  const adminName = safeText(
    state.user?.displayName || state.user?.email?.split('@')[0],
    'Admin'
  );
  const yesterdayRevenue = getRevenueForDayOffset(1);
  const revenueTrend = percentChange(analytics.revenueToday, yesterdayRevenue);
  const customersToday = state.users.filter((user) => isToday(user.createdAt)).length;
  const customersYesterday = state.users.filter((user) => {
    const created = toMillis(user.createdAt);
    const start = getTanzaniaDayStartMillis() - DAY_MS;
    return created >= start && created < getTanzaniaDayStartMillis();
  }).length;
  const customerTrend = percentChange(customersToday, customersYesterday);
  const avgOrderValue = analytics.delivered.length
    ? analytics.revenue / analytics.delivered.length
    : 0;
  const previousAvg = getPreviousAverageOrderValue();
  const avgTrend = percentChange(avgOrderValue, previousAvg);
  const activeShare = analytics.total
    ? Math.round((analytics.active.length / analytics.total) * 1000) / 10
    : 0;

  section.innerHTML = `
    <div class="dash-home">
      ${renderApiHealthBanner()}
      ${
        state.carriers.filter((item) => getCarrierStatusKey(item) === 'pending').length
          ? `<article class="card outside-howto-card">
              <div>
                <strong>${state.carriers.filter((item) => getCarrierStatusKey(item) === 'pending').length} mawakala wa basi wanasubiri uthibitisho</strong>
                <p class="muted">Thibitisha makampuni kwenye HAUL Cargo Agents ili yapokee oda za mizigo.</p>
              </div>
              <button class="btn primary" type="button" data-page-jump="carrierAgents">Uthibitisho wa mawakala</button>
            </article>`
          : ''
      }

      <div class="dash-welcome">
        <div>
          <h2>Welcome back, ${escapeHtml(adminName)}!</h2>
          <p class="muted">Here's what's happening with DoorDrop today.</p>
        </div>
        <div class="admin-inline-actions">
          <button class="btn soft" type="button" data-page-jump="reports">Reports</button>
          <button class="btn dark" type="button" data-page-jump="orders">View all orders</button>
        </div>
      </div>

      <div class="dash-metric-grid">
        ${renderDashMetric('Revenue today', formatMoney(analytics.revenueToday), revenueTrend, 'peach', `${analytics.deliveredToday.length} delivered`)}
        ${renderDashMetric('New customers', String(customersToday), customerTrend, 'mint', `${analytics.activeUsers.length} active now`)}
        ${renderDashMetric('Completion rate', `${analytics.completionRate}%`, null, 'sky', `${analytics.delivered.length} delivered / ${analytics.cancelled.length} cancelled`)}
        ${renderDashMetric('Avg order value', formatMoney(avgOrderValue), avgTrend, 'sand', 'Across completed orders')}
        ${renderDashMetric('Active share', `${activeShare}%`, null, 'rose', `${analytics.active.length} live · ${analytics.pending.length} waiting`)}
      </div>

      <div class="dash-main-grid">
        <article class="card dash-panel">
          <div class="card-head">
            <div>
              <h3>Summary</h3>
              <p class="muted">Orders vs revenue · last 7 days</p>
            </div>
            <span class="pill soft">Last 7 days</span>
          </div>
          ${renderDashboardSummaryChart(weekSeries)}
        </article>

        <article class="card dash-panel">
          <div class="card-head">
            <div>
              <h3>Top services</h3>
              <p class="muted">Highest order volume</p>
            </div>
            <button class="btn soft" type="button" data-page-jump="services">View all</button>
          </div>
          <div class="dash-product-list">
            ${
              topServices.length
                ? topServices
                    .map(
                      (service) => `
                        <div class="dash-product-row">
                          <div class="dash-product-thumb">${escapeHtml(service.icon || '📦')}</div>
                          <div class="dash-product-copy">
                            <strong>${escapeHtml(service.title)}</strong>
                            <span class="mini">${escapeHtml(service.key)} · ${escapeHtml(formatMoney(service.revenue))}</span>
                          </div>
                          <span class="pill soft">${service.orders.length} orders</span>
                        </div>
                      `
                    )
                    .join('')
                : emptyState('No service volume yet.')
            }
          </div>
        </article>
      </div>

      <div class="dash-main-grid dash-bottom-grid">
        <article class="card dash-panel dash-recent-card">
          <div class="card-head">
            <div>
              <h3>Recent orders</h3>
              <p class="muted">Latest city and intercity activity</p>
            </div>
            <button class="dash-view-all" type="button" data-page-jump="orders">View all</button>
          </div>
          <div class="dash-recent-list">
            ${
              recentOrders.length
                ? recentOrders
                    .map((order) => {
                      const status = isOutsideParcelOrder(order)
                        ? getOutsideLogisticsLabel(getOutsideLogisticsStatus(order))
                        : getOrderStatusLabel(order);
                      const tone = isOutsideParcelOrder(order)
                        ? getOutsideLogisticsStatus(order) === 'completed'
                          ? 'success'
                          : getOutsideLogisticsStatus(order) === 'cancelled'
                            ? 'danger'
                            : 'warning'
                        : getStatusClass(getOrderStatus(order));
                      const serviceIcon = getServiceConfig(serviceKeyFromOrder(order))?.icon || '📦';
                      return `
                        <button class="dash-recent-row" type="button" data-open-shipment="${escapeHtml(order.id)}">
                          <div class="dash-recent-thumb">${escapeHtml(serviceIcon)}</div>
                          <div class="dash-recent-main">
                            <strong>${escapeHtml(getServiceLabel(order))}</strong>
                            <span class="mini">${escapeHtml(getPickup(order))} → ${escapeHtml(getDropoff(order))}</span>
                          </div>
                          <div class="dash-recent-customer">
                            <strong>${escapeHtml(getCustomerName(order))}</strong>
                            <span class="mini">${escapeHtml(getOrderNumber(order))}</span>
                          </div>
                          <div class="dash-recent-meta">
                            <span class="mini">${escapeHtml(formatShortDashDate(order.createdAt))}</span>
                            ${pill(status, tone)}
                          </div>
                        </button>
                      `;
                    })
                    .join('')
                : emptyState('No recent orders yet.')
            }
          </div>
        </article>

        <article class="card dash-panel dash-customers-card">
          <div class="card-head">
            <div>
              <h3>Weekly top customers</h3>
              <p class="muted">Most orders this week</p>
            </div>
            <button class="dash-view-all" type="button" data-page-jump="customers">View all</button>
          </div>
          <div class="dash-customer-list">
            ${
              topCustomers.length
                ? topCustomers
                    .map(
                      (customer, index) => `
                        <div class="dash-customer-row">
                          <div class="dash-customer-lead">
                            <span class="dash-rank">${index + 1}</span>
                            <div class="dash-avatar tone-${(index % 4) + 1}">${escapeHtml(customer.initials)}</div>
                          </div>
                          <div class="dash-customer-copy">
                            <strong>${escapeHtml(customer.name)}</strong>
                            <span class="mini">${customer.orders} order${customer.orders === 1 ? '' : 's'} this week</span>
                          </div>
                          <div class="dash-customer-aside">
                            <span class="dash-spend">${escapeHtml(formatMoney(customer.spend))}</span>
                            <button class="dash-mini-view" type="button" data-page-jump="customers">View</button>
                          </div>
                        </div>
                      `
                    )
                    .join('')
                : emptyState('No customer activity this week.')
            }
          </div>
        </article>
      </div>
    </div>
  `;
}

function renderDashMetric(label, value, trend, tone, note = '') {
  const trendHtml =
    trend == null
      ? ''
      : `<span class="dash-trend ${trend >= 0 ? 'up' : 'down'}">${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend).toFixed(1)}%</span>`;
  return `
    <article class="dash-metric ${escapeHtml(tone)}">
      <div class="dash-metric-top">
        <span class="kpi-label">${escapeHtml(label)}</span>
        ${trendHtml}
      </div>
      <strong class="kpi-value">${escapeHtml(value)}</strong>
      <p class="kpi-note">${escapeHtml(note)}</p>
    </article>
  `;
}

function percentChange(current, previous) {
  const now = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (!prev && !now) return 0;
  if (!prev) return 100;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function getRevenueForDayOffset(daysAgo = 0) {
  const start = getTanzaniaDayStartMillis() - daysAgo * DAY_MS;
  const end = start + DAY_MS;
  return state.orders.reduce((sum, order) => {
    if (getOrderStatus(order) !== 'delivered') return sum;
    const stamp = toMillis(order.deliveredAt || order.updatedAt || order.createdAt);
    if (stamp < start || stamp >= end) return sum;
    return sum + getOrderAmount(order);
  }, 0);
}

function getPreviousAverageOrderValue() {
  const weekStart = getTanzaniaWeekStartMillis();
  const prevStart = weekStart - WEEK_MS;
  const previous = state.orders.filter((order) => {
    if (getOrderStatus(order) !== 'delivered') return false;
    const stamp = toMillis(order.deliveredAt || order.updatedAt || order.createdAt);
    return stamp >= prevStart && stamp < weekStart;
  });
  if (!previous.length) return 0;
  return previous.reduce((sum, order) => sum + getOrderAmount(order), 0) / previous.length;
}

function getDashboardWeekSeries() {
  const todayStart = getTanzaniaDayStartMillis();
  const days = [];
  for (let index = 6; index >= 0; index -= 1) {
    const start = todayStart - index * DAY_MS;
    const end = start + DAY_MS;
    const createdCount = state.orders.filter((order) => {
      const stamp = toMillis(order.createdAt);
      return stamp >= start && stamp < end;
    }).length;
    const revenue = state.orders.reduce((sum, order) => {
      if (getOrderStatus(order) !== 'delivered') return sum;
      const stamp = toMillis(order.deliveredAt || order.updatedAt || order.createdAt);
      if (stamp < start || stamp >= end) return sum;
      return sum + getOrderAmount(order);
    }, 0);
    const labelDate = new Date(start + TANZANIA_UTC_OFFSET_MS);
    const label = labelDate.toLocaleDateString('en-GB', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    days.push({ start, label, orders: createdCount, revenue });
  }
  return days;
}

function renderDashboardSummaryChart(series) {
  const width = 640;
  const height = 220;
  const padX = 28;
  const padY = 24;
  const maxOrders = Math.max(1, ...series.map((day) => day.orders));
  const maxRevenue = Math.max(1, ...series.map((day) => day.revenue));
  const step = series.length > 1 ? (width - padX * 2) / (series.length - 1) : 0;

  const orderPoints = series.map((day, index) => {
    const x = padX + index * step;
    const y = height - padY - (day.orders / maxOrders) * (height - padY * 2);
    return { x, y, ...day };
  });
  const revenuePoints = series.map((day, index) => {
    const x = padX + index * step;
    const y = height - padY - (day.revenue / maxRevenue) * (height - padY * 2);
    return { x, y, ...day };
  });

  const toPath = (points) =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  const peak = [...revenuePoints].sort((a, b) => b.revenue - a.revenue)[0];

  return `
    <div class="dash-chart-wrap">
      <div class="dash-chart-legend">
        <span><i class="swatch orders"></i> Orders</span>
        <span><i class="swatch income"></i> Revenue</span>
      </div>
      <svg class="dash-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Orders and revenue last 7 days">
        ${[0, 0.25, 0.5, 0.75, 1]
          .map((ratio) => {
            const y = padY + (height - padY * 2) * (1 - ratio);
            return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" class="dash-gridline" />`;
          })
          .join('')}
        <path d="${toPath(orderPoints)}" class="dash-line orders" fill="none" />
        <path d="${toPath(revenuePoints)}" class="dash-line income" fill="none" />
        ${orderPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" class="dash-dot orders" />`).join('')}
        ${revenuePoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" class="dash-dot income" />`).join('')}
        ${
          peak
            ? `<g class="dash-tooltip" transform="translate(${Math.min(peak.x + 8, width - 110)}, ${Math.max(peak.y - 36, 8)})">
                <rect width="100" height="28" rx="8"></rect>
                <text x="50" y="18" text-anchor="middle">${escapeHtml(formatMoney(peak.revenue))}</text>
              </g>`
            : ''
        }
      </svg>
      <div class="dash-chart-labels">
        ${series.map((day) => `<span>${escapeHtml(day.label)}</span>`).join('')}
      </div>
    </div>
  `;
}

function getWeeklyTopCustomers(limitCount = 6) {
  const weekStart = getTanzaniaWeekStartMillis();
  const counts = new Map();

  state.orders.forEach((order) => {
    const stamp = toMillis(order.createdAt);
    if (stamp < weekStart) return;
    const key = safeText(order.userId || order.customerId || getCustomerContact(order) || getCustomerName(order));
    if (!key) return;
    const current = counts.get(key) || {
      id: key,
      name: getCustomerName(order),
      orders: 0,
      spend: 0,
    };
    current.orders += 1;
    current.spend += getOrderAmount(order);
    current.name = getCustomerName(order) || current.name;
    counts.set(key, current);
  });

  return [...counts.values()]
    .sort((left, right) => right.orders - left.orders || right.spend - left.spend)
    .slice(0, limitCount)
    .map((customer) => ({
      ...customer,
      initials: String(customer.name || 'C')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('') || 'C',
    }));
}

function formatShortDashDate(value) {
  const millis = toMillis(value);
  if (!millis) return '—';
  return new Date(millis).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function renderOrders() {
  const section = getOrCreateSection('orders');
  const visible = sortByRecent(
    state.orders.filter(
      (order) =>
        !isOutsideParcelOrder(order) &&
        !isNinunulieOrder(order) &&
        orderMatchesQuery(order) &&
        orderMatchesStatusFilter(order)
    )
  );

  section.innerHTML = `
    <div class="page-panel">
    <article class="card">
      <div class="table-toolbar">
        ${renderOrderFilters()}
        <div class="admin-inline-actions">
          <span class="mini">${visible.length} shown</span>
          <button class="btn primary" data-action="create-order">New order</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Service</th><th>Route</th><th>Driver</th><th>Status</th><th>Value</th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.map(orderRow).join('') : `<tr><td colspan="7">${emptyState('No orders match your search or filter.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
    </div>
  `;
}

function renderDispatchMatches(drivers, order) {
  if (!drivers.length) {
    return emptyState(order
      ? `No nearby online ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'doordrop')} driver right now.`
      : 'No available drivers right now.');
  }

  return `
    <div class="table-wrap compact">
      <table>
        <thead>
          <tr><th>Driver</th><th>Vehicle</th><th>Distance</th><th>Score</th><th></th></tr>
        </thead>
        <tbody>
          ${drivers.slice(0, 8).map((driver) => `
            <tr>
              <td>
                <div class="person">
                  <strong>${escapeHtml(safeText(driver.fullName || driver.email, 'Driver'))}</strong>
                  <span class="mini">${escapeHtml(safeText(driver.phoneNumber, 'No phone'))}</span>
                </div>
              </td>
              <td>${escapeHtml(getDriverVehicleLabel(driver, 'Vehicle'))}${driver.isPriorityMatch ? ` ${pill('Priority', 'warning')}` : ''}</td>
              <td>${escapeHtml(driver.distanceLabel || '—')}<span class="mini">${escapeHtml(driver.etaLabel || '')}</span></td>
              <td>${escapeHtml(String(Math.round(driver.matchScore ?? 0)))}</td>
              <td>
                <div class="admin-inline-actions">
                  ${order ? `<button class="btn primary" data-assign-driver="${escapeHtml(driver.id)}" data-order-id="${escapeHtml(order.id)}">Assign</button>` : ''}
                  <button class="btn soft" data-select-driver="${escapeHtml(driver.id)}">View</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderWaitingQueue(orders, selectedId) {
  if (!orders.length) {
    return emptyState('No orders waiting for a driver.');
  }

  return `
    <div class="list-stack">
      ${orders.slice(0, 10).map((order) => `
        <button class="list-card${selectedId === order.id ? ' selected' : ''}" type="button" data-dispatch-select="${escapeHtml(order.id)}">
          <div class="list-head">
            <strong>${escapeHtml(getOrderNumber(order))}</strong>
            ${pill(getOrderStatusLabel(order), getStatusClass(getOrderStatus(order)))}
          </div>
          <p class="muted">${escapeHtml(getPickup(order))} → ${escapeHtml(getDropoff(order))}</p>
          <span class="mini">${escapeHtml(getServiceLabel(order))} · ${escapeHtml(formatMoney(getOrderAmount(order)))}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderDispatch() {
  const section = getOrCreateSection('dispatch');
  const waiting = sortByRecent(
    state.orders.filter(
      (order) =>
        getOrderStatus(order) === 'pending_assignment' &&
        !isOutsideParcelOrder(order) &&
        !isNinunulieOrder(order)
    )
  );
  const selected = getSelectedOrder() || getSuggestedDispatchOrder() || waiting[0] || null;
  const rankedDrivers = selected
    ? getNearbyDriverMatches(selected).filter(driverMatchesQuery)
    : sortDrivers(state.drivers.filter((driver) => driver.isAvailable && !driver.currentOrderId && driverMatchesQuery(driver)));
  const readyDrivers = state.drivers.filter((driver) => driver.isAvailable && !driver.currentOrderId && isDriverVerifiedForDispatch(driver));
  const onlineDriverPoints = getOnlineDriverMapPoints();
  const customerPoints = getOnlineCustomerMapPoints();

  if (selected && state.selectedOrderId !== selected.id) {
    state.selectedOrderId = selected.id;
  }

  let board = section.querySelector('.dispatch-board');
  if (!board) {
    section.innerHTML = `
      <div class="dispatch-board">
        <div id="dispatchLiveMap" class="dispatch-map-stage" role="presentation"></div>
        <div class="dispatch-map-legend">
          <span><i class="dot red"></i> Drivers online</span>
          <span><i class="dot green"></i> Customers online</span>
        </div>
        <div class="dispatch-overlay" id="dispatchOverlay"></div>
      </div>
    `;
    board = section.querySelector('.dispatch-board');
  }

  const overlay = board.querySelector('#dispatchOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div class="dispatch-overlay-top">
        <div class="dispatch-stat-row">
          ${kpi('Waiting', String(waiting.length), 'Need a driver')}
          ${kpi('Drivers on map', String(onlineDriverPoints.length), 'Online with GPS')}
          ${kpi('Customers on map', String(customerPoints.length), 'Live presence')}
          ${kpi('Ready', String(readyDrivers.length), 'Verified free')}
        </div>
        <div class="context-bar dispatch-context">
          <p class="page-note">${selected
            ? `${escapeHtml(getCustomerName(selected))} · ${escapeHtml(getPickup(selected))} → ${escapeHtml(getDropoff(selected))}`
            : 'Real Google Map · red = drivers · green = customers'}</p>
          <div class="admin-inline-actions">
            <button class="btn primary" data-action="optimize-routes">Optimize</button>
            <button class="btn soft" data-action="run-auto-assign">Auto assign</button>
            ${selected ? `<button class="btn soft" data-open-order="${escapeHtml(selected.id)}">Order details</button>` : ''}
          </div>
        </div>
      </div>
      <div class="dispatch-overlay-panels">
        <article class="card dispatch-side-card">
          <div class="card-head">
            <div>
              <h3>Waiting queue</h3>
              <p class="muted">${waiting.length} city orders</p>
            </div>
            ${pill(`${waiting.length}`, 'warning')}
          </div>
          ${renderWaitingQueue(waiting, selected?.id)}
        </article>
        <article class="card dispatch-side-card">
          <div class="table-toolbar">
            <h3>Best matches</h3>
            <span class="mini">${rankedDrivers.length} drivers</span>
          </div>
          ${renderDispatchMatches(rankedDrivers, selected)}
        </article>
      </div>
    `;
  }

  void ensureDispatchGoogleMap();
}

function getOnlineDriverMapPoints() {
  return state.drivers
    .filter((driver) => driver.isAvailable === true)
    .map((driver) => {
      const point = getDriverCurrentPoint(driver);
      if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
        return null;
      }
      return {
        id: driver.id,
        kind: 'driver',
        title: safeText(driver.fullName || driver.email, 'Driver'),
        subtitle: getDriverVehicleLabel(driver, 'Online'),
        latitude: point.latitude,
        longitude: point.longitude,
      };
    })
    .filter(Boolean);
}

function getOnlineCustomerMapPoints() {
  const byId = new Map();

  (state.customerPresence || []).forEach((presence) => {
    const latitude = Number(presence.latitude ?? presence.lastActiveLatitude);
    const longitude = Number(presence.longitude ?? presence.lastActiveLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    if (presence.isOnline === false && presence.isAppOnline === false) {
      return;
    }
    const id = safeText(presence.uid || presence.id);
    if (!id) return;
    byId.set(id, {
      id,
      kind: 'customer',
      title: safeText(presence.firstName || presence.fullName, 'Customer'),
      subtitle: 'Online',
      latitude,
      longitude,
    });
  });

  (state.users || []).forEach((user) => {
    const latitude = Number(user.latitude ?? user.lastActiveLatitude);
    const longitude = Number(user.longitude ?? user.lastActiveLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    const recentlyActive = isActiveRecently(user.lastActiveAt || user.updatedAt || user.lastSeenAt);
    if (!(user.isOnline === true || user.isAppOnline === true || recentlyActive)) {
      return;
    }
    const id = safeText(user.uid || user.id);
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      kind: 'customer',
      title: safeText(user.firstName || user.fullName || user.email, 'Customer'),
      subtitle: recentlyActive ? 'Recently active' : 'Online',
      latitude,
      longitude,
    });
  });

  return [...byId.values()];
}

function loadGoogleMapsSdk() {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (state.googleMapsLoader) {
    return state.googleMapsLoader;
  }

  const apiKey = safeText(adminWebsiteConfig.googleMapsApiKey);
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key missing in admin config.'));
  }

  state.googleMapsLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-doordrop-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps));
      existing.addEventListener('error', () => reject(new Error('Could not load Google Maps.')));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.doordropGoogleMaps = '1';
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('Could not load Google Maps.'));
    document.head.appendChild(script);
  });

  return state.googleMapsLoader;
}

function createDispatchDotIcon(color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="8" fill="${color}" stroke="#ffffff" stroke-width="3"/>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(22, 22),
    anchor: new window.google.maps.Point(11, 11),
  };
}

async function ensureDispatchGoogleMap() {
  const mapEl = $('dispatchLiveMap');
  if (!mapEl || state.currentPage !== 'dispatch') {
    return;
  }

  try {
    await loadGoogleMapsSdk();
  } catch (error) {
    mapEl.innerHTML = `<div class="dispatch-map-fallback"><strong>Google Map haipatikani</strong><p class="muted">${escapeHtml(error.message || 'Missing Maps key')}</p></div>`;
    return;
  }

  const center = adminWebsiteConfig.mapCenter || { lat: -6.7924, lng: 39.2083 };
  if (!state.dispatchMap || state.dispatchMap.getDiv() !== mapEl) {
    state.dispatchMapMarkers.forEach((marker) => marker.setMap(null));
    state.dispatchMapMarkers = [];
    state.dispatchMap = new window.google.maps.Map(mapEl, {
      center,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
      ],
    });
  }

  refreshDispatchMapMarkers();
}

function refreshDispatchMapMarkers() {
  if (!state.dispatchMap || !window.google?.maps) {
    return;
  }

  state.dispatchMapMarkers.forEach((marker) => marker.setMap(null));
  state.dispatchMapMarkers = [];

  const points = [...getOnlineDriverMapPoints(), ...getOnlineCustomerMapPoints()];
  const bounds = new window.google.maps.LatLngBounds();
  const driverIcon = createDispatchDotIcon('#dc2626');
  const customerIcon = createDispatchDotIcon('#16a34a');
  const info = new window.google.maps.InfoWindow();

  points.forEach((point) => {
    const position = { lat: point.latitude, lng: point.longitude };
    const marker = new window.google.maps.Marker({
      map: state.dispatchMap,
      position,
      title: point.title,
      icon: point.kind === 'driver' ? driverIcon : customerIcon,
      optimized: true,
    });
    marker.addListener('click', () => {
      info.setContent(`
        <div style="font:600 13px Manrope,system-ui,sans-serif;color:#0b1220;min-width:140px">
          <div>${escapeHtml(point.title)}</div>
          <div style="color:#64748b;font-weight:500;margin-top:4px">${escapeHtml(point.kind === 'driver' ? 'Driver · ' : 'Customer · ')}${escapeHtml(point.subtitle || '')}</div>
        </div>
      `);
      info.open({ map: state.dispatchMap, anchor: marker });
    });
    state.dispatchMapMarkers.push(marker);
    bounds.extend(position);
  });

  if (points.length === 1) {
    state.dispatchMap.setCenter({ lat: points[0].latitude, lng: points[0].longitude });
    state.dispatchMap.setZoom(14);
  } else if (points.length > 1) {
    state.dispatchMap.fitBounds(bounds, 72);
  }
}

function renderServices() {
  const section = getOrCreateSection('services');
  const services = getServiceStats();
  const totalOrders = services.reduce((sum, service) => sum + service.orders.length, 0);
  const totalRevenue = services.reduce((sum, service) => sum + service.revenue, 0);
  const activeCount = services.reduce((sum, service) => (
    sum + service.orders.filter((order) => ACTIVE_STATUSES.includes(getOrderStatus(order))).length
  ), 0);

  section.innerHTML = `
    <div class="grid kpi">
      ${kpi('Services', String(services.length), 'Parcel, TOYO, Kirikuu, Ninunulie')}
      ${kpi('Orders', String(totalOrders), `${activeCount} currently active`)}
      ${kpi('Delivered value', formatMoney(totalRevenue), 'Completed delivery jobs (excl. Ninunulie seller purchases)')}
      ${kpi('Top service', services.slice().sort((a, b) => b.orders.length - a.orders.length)[0]?.title || '—', 'Highest volume')}
    </div>
    <article class="card">
      <div class="table-toolbar">
        <h3>Performance</h3>
        <span class="mini">${totalOrders} orders</span>
      </div>
      <div class="table-wrap compact">
        <table>
          <thead>
            <tr><th>Service</th><th>Orders</th><th>Active</th><th>Delivered</th><th>Cancelled</th><th>Revenue</th><th>Completion</th></tr>
          </thead>
          <tbody>
            ${services.map((service) => {
              const active = service.orders.filter((order) => ACTIVE_STATUSES.includes(getOrderStatus(order))).length;
              return `
                <tr>
                  <td>
                    <div class="person">
                      <strong>${escapeHtml(service.title)}</strong>
                      <span class="mini">${escapeHtml(service.key)}</span>
                    </div>
                  </td>
                  <td>${service.orders.length}</td>
                  <td>${active}</td>
                  <td>${service.delivered.length}</td>
                  <td>${service.cancelled.length}</td>
                  <td>${escapeHtml(formatMoney(service.revenue))}</td>
                  <td>
                    <div class="bar-row">
                      <div class="bar-row-meta"><span></span><strong>${service.completion}%</strong></div>
                      <div class="bar-track"><span class="bar-fill" style="width:${service.completion}%"></span></div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderCustomers() {
  const section = getOrCreateSection('customers');
  const visible = sortByRecent(state.users.filter(userMatchesQuery));
  const active = visible.filter((user) => isActiveRecently(user.lastActiveAt || user.updatedAt || user.createdAt));

  section.innerHTML = `
    <div class="grid kpi">
      ${kpi('Customers', String(visible.length), 'Synced from the app')}
      ${kpi('Active today', String(active.length), 'Used the app in the last 24 hours')}
      ${kpi('Business accounts', String(visible.filter((user) => user.accountType === 'business' || user.isBusiness).length), 'Merchant users')}
      ${kpi('App opens', String(visible.reduce((sum, user) => sum + Number(user.appOpenCount || 0), 0)), 'Tracked opens')}
    </div>
    <article class="card">
      <div class="table-toolbar">
        <h3>Customers</h3>
        <span class="mini">${visible.length} shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Customer</th><th>Phone</th><th>Status</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.slice(0, 80).map(customerRow).join('') : `<tr><td colspan="4">${emptyState('No customers match your search.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

const CARRIER_CASH_TIERS = [
  { id: 'bronze', label: 'Bronze', minStreak: 0, ceiling: 30000 },
  { id: 'silver', label: 'Silver', minStreak: 100, ceiling: 60000 },
  { id: 'gold', label: 'Gold', minStreak: 250, ceiling: 100000 },
  { id: 'platinum', label: 'Platinum', minStreak: 500, ceiling: 150000 },
];

function carrierCompanyLabel(carrier) {
  return safeText(carrier?.companyName || carrier?.tradingName || carrier?.name, '—');
}

function isFinishedCarrierShipment(item) {
  const status = String(item?.shipmentStatus || '').toLowerCase();
  const step = String(item?.trackStep || '').toLowerCase();
  return status === 'arrived' || status === 'delivered' || step === 'arrived' || step === 'handed';
}

function carrierHaulFeeAmount(item) {
  return Math.max(0, Math.round(Number(item?.haulFee) || 0));
}

function isReconciledHaulFee(item) {
  return String(item?.cashStatus || '').toLowerCase() === 'reconciled';
}

function completionStreakCount(completionTimes, breakTimes, undatedBreak) {
  if (undatedBreak) return 0;
  const latestBreak = (breakTimes || []).reduce((max, ms) => Math.max(max, Math.floor(Number(ms) || 0)), 0);
  if (latestBreak <= 0) return (completionTimes || []).length;
  return (completionTimes || []).filter((ms) => Math.floor(Number(ms) || 0) > latestBreak).length;
}

function tierForStreakCount(streak) {
  let tier = CARRIER_CASH_TIERS[0];
  for (const rule of CARRIER_CASH_TIERS) {
    if (streak >= rule.minStreak) tier = rule;
  }
  return tier;
}

function standingForCarrierCash(carrier, completionTimes, decisions, owed) {
  const breaks = (decisions || []).filter((item) => {
    const decision = String(item.decision || '').toLowerCase();
    return decision === 'rejected' || decision === 'cancelled_after_accept';
  });
  const postAcceptDocs = breaks.filter(
    (item) => String(item.decision || '').toLowerCase() === 'cancelled_after_accept'
  ).length;
  const postAcceptCancels = Math.max(postAcceptDocs, Math.max(0, Math.floor(Number(carrier?.postAcceptCancels) || 0)));
  const rejects = Math.max(breaks.length, Math.max(0, Math.floor(Number(carrier?.rejected) || 0)));
  const breakTimes = [];
  let undated = false;
  for (const item of breaks) {
    const ms = toMillis(item.at) || toMillis(item.atIso);
    if (ms > 0) breakTimes.push(ms);
    else undated = true;
  }
  const decisionsKnown = Boolean(state.carrierDecisionsOk);
  const streakKnown = decisionsKnown || rejects === 0;
  const streak = streakKnown
    ? completionStreakCount(completionTimes, breakTimes, decisionsKnown ? undated || rejects > breaks.length : false)
    : null;
  const completed = completionTimes.length;
  const decisionCount = completed + rejects;
  const cancelRate = decisionCount > 0 ? rejects / decisionCount : 0;
  const punished =
    (cancelRate > 0.25 && decisionCount >= 8) ||
    postAcceptCancels >= 3 ||
    (cancelRate >= 0.4 && decisionCount >= 8);
  const tier = streak == null ? null : tierForStreakCount(streak);
  let ceiling = null;
  let ceilingLabel = state.loading.carrierDecisions ? '…' : '—';
  if (punished) {
    ceiling = CARRIER_CASH_TIERS[0].ceiling;
    ceilingLabel = tier ? `${tier.label} · ${formatMoney(ceiling)} · 20%` : `${formatMoney(ceiling)} · 20%`;
  } else if (tier) {
    ceiling = tier.ceiling;
    ceilingLabel = `${tier.label} · ${formatMoney(ceiling)}`;
  }
  const offersLabel = ceiling == null ? (state.loading.carrierDecisions ? '…' : '—') : owed >= ceiling ? 'Imesimama' : 'Wazi';
  return {
    streakLabel: streak == null ? (state.loading.carrierDecisions ? '…' : '—') : String(streak),
    cancelLabel: `${Math.round(cancelRate * 100)}%`,
    ceilingLabel,
    offersLabel,
  };
}

function carrierCashBook() {
  const byCarrier = new Map();
  const ensure = (id) => {
    if (!byCarrier.has(id)) byCarrier.set(id, { owed: 0, paid: 0, times: [], nameFromShipment: '' });
    return byCarrier.get(id);
  };

  for (const item of state.carrierShipments) {
    if (!isFinishedCarrierShipment(item)) continue;
    const carrierId = String(item.carrierId || '').trim();
    if (!carrierId) continue;
    const row = ensure(carrierId);
    row.times.push(toMillis(item.arrivedAt) || toMillis(item.deliveredAt) || 0);
    if (!row.nameFromShipment) row.nameFromShipment = safeText(item.carrierCompanyName, '');
    const fee = carrierHaulFeeAmount(item);
    if (fee <= 0) continue;
    if (isReconciledHaulFee(item)) row.paid += fee;
    else row.owed += fee;
  }

  const decisionsByCarrier = new Map();
  for (const item of state.carrierDecisions) {
    const id = String(item.carrierId || '').trim();
    if (!id) continue;
    const list = decisionsByCarrier.get(id) || [];
    list.push(item);
    decisionsByCarrier.set(id, list);
  }

  const carriers = [...state.carriers];
  const seen = new Set(carriers.map((item) => item.id));
  for (const [id, row] of byCarrier) {
    if (seen.has(id)) continue;
    carriers.push({ id, companyName: row.nameFromShipment || id });
  }

  const rows = carriers.map((carrier) => {
    const book = byCarrier.get(carrier.id) || { owed: 0, paid: 0, times: [] };
    return {
      carrier,
      owed: book.owed,
      paid: book.paid,
      ...standingForCarrierCash(carrier, book.times, decisionsByCarrier.get(carrier.id) || [], book.owed),
    };
  });
  rows.sort(
    (left, right) =>
      right.owed - left.owed || carrierCompanyLabel(left.carrier).localeCompare(carrierCompanyLabel(right.carrier))
  );

  return {
    rows,
    tunadai: rows.reduce((sum, row) => sum + row.owed + row.paid, 0),
    tumepokea: rows.reduce((sum, row) => sum + row.paid, 0),
    bado: rows.reduce((sum, row) => sum + row.owed, 0),
  };
}

function renderCarrierCash() {
  const section = getOrCreateSection('carrierCash');
  const loading = Boolean(state.loading.carriers || state.loading.carrierShipments);

  if (loading) {
    section.innerHTML = `
      <div class="page-panel">
        <div class="grid kpi">
          ${kpi('Tunadai jumla', '…', 'Ada za oda zilizofika')}
          ${kpi('Tumepokea jumla', '…', 'Zilizoreconcile')}
          ${kpi('Bado wazi', '…', 'Hazijalipwa')}
        </div>
        <article class="card"><p class="muted">Inapakia ada kutoka Firestore.</p></article>
      </div>
    `;
    return;
  }

  if (state.carrierCashError) {
    section.innerHTML = `
      <div class="page-panel">
        <article class="card">
          <h3>Ada hazijasomwa</h3>
          <p class="muted">${escapeHtml(state.carrierCashError)}</p>
        </article>
      </div>
    `;
    return;
  }

  const book = carrierCashBook();
  const rowHtml = book.rows
    .map((row) => {
      const name = carrierCompanyLabel(row.carrier);
      const trading = safeText(row.carrier.tradingName, '');
      const legal = safeText(row.carrier.companyName || row.carrier.name, '');
      const mini = trading && legal && trading !== legal ? trading : '';
      const offers =
        row.offersLabel === 'Imesimama'
          ? pill('Imesimama', 'danger')
          : row.offersLabel === 'Wazi'
            ? pill('Wazi', 'neutral')
            : escapeHtml(row.offersLabel);
      return `
        <tr>
          <td><strong>${escapeHtml(name)}</strong>${mini ? `<span class="mini">${escapeHtml(mini)}</span>` : ''}</td>
          <td class="cash-num">${escapeHtml(formatMoney(row.owed))}</td>
          <td class="cash-num">${escapeHtml(formatMoney(row.paid))}</td>
          <td>${escapeHtml(row.ceilingLabel)}</td>
          <td>${offers}</td>
          <td class="cash-num">${escapeHtml(row.streakLabel)}</td>
          <td class="cash-num">${escapeHtml(row.cancelLabel)}</td>
        </tr>
      `;
    })
    .join('');

  section.innerHTML = `
    <div class="page-panel">
      <div class="grid kpi">
        ${kpi('Tunadai jumla', formatMoney(book.tunadai), 'Ada za oda zilizofika')}
        ${kpi('Tumepokea jumla', formatMoney(book.tumepokea), 'Zilizoreconcile')}
        ${kpi('Bado wazi', formatMoney(book.bado), 'Hazijalipwa')}
      </div>
      <article class="card">
        <div class="table-toolbar">
          <h3>Kampuni</h3>
          <span class="mini">${book.rows.length} kampuni · Unadaiwa inashuka ikireconcile</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kampuni</th>
                <th class="cash-num">Unadaiwa</th>
                <th class="cash-num">Umelipwa</th>
                <th>Dari</th>
                <th>Ofa mpya</th>
                <th class="cash-num">Mfululizo</th>
                <th class="cash-num">Cancel</th>
              </tr>
            </thead>
            <tbody>
              ${rowHtml || `<tr><td colspan="7">${emptyState('Hakuna kampuni.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  `;
}

function renderCarrierAgents() {
  const section = getOrCreateSection('carrierAgents');
  const carriers = [...state.carriers].sort((left, right) =>
    String(left.companyName || '').localeCompare(String(right.companyName || ''))
  );
  const pending = carriers.filter((item) => getCarrierStatusKey(item) === 'pending');
  const needsReview = carriers.filter((item) => {
    const key = getCarrierStatusKey(item);
    return key === 'pending' || key === 'rejected' || key === 'suspended';
  });
  const verified = carriers.filter((item) => getCarrierStatusKey(item) === 'verified');

  const row = (item) => {
    const key = getCarrierStatusKey(item);
    const canVerify = key !== 'verified';
    return `
      <tr>
        <td>
          <strong>${escapeHtml(safeText(item.companyName, '—'))}</strong>
          <span class="mini">${escapeHtml(safeText(item.location, ''))}</span>
        </td>
        <td>${escapeHtml(safeText(item.contactPerson, '—'))}<br><span class="mini">${escapeHtml(safeText(item.phone, item.email || ''))}</span></td>
        <td>${carrierStatusPill(key)}</td>
        <td class="admin-inline-actions">
          ${canVerify ? `<button class="btn primary" type="button" data-verify-carrier="${escapeHtml(item.id)}">Thibitisha</button>` : ''}
          ${key !== 'rejected' ? `<button class="btn soft" type="button" data-reject-carrier="${escapeHtml(item.id)}">Kataa</button>` : ''}
        </td>
      </tr>
    `;
  };

  section.innerHTML = `
    <div class="page-panel">
      <article class="card outside-howto-card">
        <div>
          <strong>Uthibitisho wa mawakala wa basi</strong>
          <p class="muted">Makampuni yaliyothibitishwa tu ndiyo yanaweza kupokea oda za mizigo (status <code>verified</code> kwenye Firestore).</p>
        </div>
        ${pending.length ? `<button class="btn primary" type="button" disabled>${pending.length} inasubiri</button>` : '<span class="pill success">Hakuna inayosubiri</span>'}
      </article>
      <div class="grid kpi">
        ${kpi('Mawakala', String(carriers.length), 'Kampuni zote kwenye carriers')}
        ${kpi('Inasubiri', String(pending.length), 'Thibitisha kabla ya matching')}
        ${kpi('Imethibitishwa', String(verified.length), 'Wanaweza kupokea oda')}
        ${kpi('Imekataliwa / kusimamishwa', String(carriers.length - pending.length - verified.length), 'Hazipokei oda')}
      </div>
      <article class="card">
        <div class="table-toolbar">
          <h3>Inahitaji ukaguzi</h3>
          <span class="mini">${needsReview.length} kampuni</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kampuni</th><th>Mwasiliani</th><th>Hali</th><th>Vitendo</th></tr></thead>
            <tbody>
              ${needsReview.length ? needsReview.map(row).join('') : `<tr><td colspan="4">${emptyState('Hakuna kampuni inayosubiri uthibitisho.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
      <article class="card">
        <div class="table-toolbar">
          <h3>Imethibitishwa</h3>
          <span class="mini">${verified.length} kampuni</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kampuni</th><th>Mwasiliani</th><th>Hali</th><th>Vitendo</th></tr></thead>
            <tbody>
              ${verified.length ? verified.map(row).join('') : `<tr><td colspan="4">${emptyState('Bado hakuna kampuni iliyothibitishwa.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  `;
}

function renderDrivers() {
  const section = getOrCreateSection('drivers');
  const visible = sortDrivers(state.drivers.filter(driverMatchesQuery));
  const ready = visible.filter((driver) => driver.isAvailable && !driver.currentOrderId);
  const busy = visible.filter((driver) => !!driver.currentOrderId);
  const pendingVerification = visible.filter((driver) => getDriverVerification(driver).status === 'pending_admin_verification');
  const pendingCarriers = state.carriers.filter((item) => getCarrierStatusKey(item) === 'pending');

  const listed = visible.filter(driverMatchesStatusFilter);

  section.innerHTML = `
    <div class="page-panel">
    ${
      pendingCarriers.length
        ? `<article class="card outside-howto-card">
            <div>
              <strong>${pendingCarriers.length} mawakala wa basi wanasubiri uthibitisho</strong>
              <p class="muted">Fungua <strong>Uthibitisho wa mawakala</strong> kwenye menyu kuweka status verified au rejected.</p>
            </div>
            <button class="btn primary" type="button" data-page-jump="carrierAgents">Fungua uthibitisho</button>
          </article>`
        : ''
    }
    ${
      pendingVerification.length
        ? `<article class="card outside-howto-card">
            <div>
              <strong>${pendingVerification.length} driver${pendingVerification.length === 1 ? '' : 's'} waiting for verification</strong>
              <p class="muted">Open the driver, check photos, then tap Verify. Unverified drivers cannot take orders.</p>
            </div>
            <button class="btn primary" type="button" data-driver-filter="pending">Show pending</button>
          </article>`
        : ''
    }
    <div class="grid kpi">
      ${kpi('Drivers', String(visible.length), 'All fleet accounts')}
      ${kpi('Ready', String(ready.filter(isDriverVerifiedForDispatch).length), 'Verified and available')}
      ${kpi('Busy', String(busy.length), 'Currently assigned')}
      ${kpi('Needs review', String(pendingVerification.length), 'Waiting for verification')}
    </div>
    <article class="card">
      <div class="table-toolbar">
        ${renderFilterBar(DRIVER_FILTERS, state.driverFilter, 'driverFilter')}
        <div class="admin-inline-actions">
          <span class="mini">${listed.length} shown</span>
          <button class="btn primary" data-action="add-driver">Add driver</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Driver</th><th>Vehicle</th><th>Status</th><th>Verification</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${listed.length ? listed.slice(0, 80).map(driverRow).join('') : `<tr><td colspan="5">${emptyState('No drivers match your search or filter.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
    </div>
  `;
}

function renderPayments() {
  const section = getOrCreateSection('payments');
  const visible = sortByRecent(getAdminPaymentRecords().filter(paymentMatchesQuery));
  const summary = getPaymentSummary(visible);
  const accessSummary = getAccessPaymentSummary(visible);
  const listed = visible.filter(paymentMatchesStatusFilter);
  const pageSize = 10;
  const page = Math.max(1, Number(state.paymentPage || 1));
  const totalPages = Math.max(1, Math.ceil(listed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  if (state.paymentPage !== currentPage) {
    state.paymentPage = currentPage;
  }
  const start = (currentPage - 1) * pageSize;
  const pageRows = listed.slice(start, start + pageSize);

  section.innerHTML = `
    <div class="subs-page">
      ${renderApiHealthBanner()}

      <div class="subs-hero">
        <div>
          <h2>Subscriptions</h2>
          <p class="muted">Driver access payments · USSD auto-sync + legacy review</p>
        </div>
        <div class="admin-inline-actions">
          <button class="btn soft" data-action="refresh-api-health">Check API</button>
          <button class="btn primary" data-action="export-payments-pdf">Export PDF</button>
        </div>
      </div>

      <div class="subs-summary-grid">
        ${renderSubsSummaryCard('Total records', String(summary.total), 'All access payment rows', 'total')}
        ${renderSubsSummaryCard('Paid', String(summary.verified.length), formatMoney(summary.verifiedAmount), 'paid')}
        ${renderSubsSummaryCard('Pending', String(summary.pending.length), formatMoney(summary.pendingAmount), 'unpaid')}
        ${renderSubsSummaryCard('Collected today', formatMoney(accessSummary.ussdPaidTodayAmount), `${accessSummary.ussdFailed} failed USSD`, 'sent')}
      </div>

      <div class="subs-plan-strip">
        <div class="subs-plan-chip"><strong>Bodaboda</strong><span>${escapeHtml(formatMoney(DRIVER_ACCESS_PLANS.bodaboda.feeTzs))} · ${DRIVER_ACCESS_PLANS.bodaboda.minOrders}/day</span></div>
        <div class="subs-plan-chip"><strong>TOYO</strong><span>${escapeHtml(formatMoney(DRIVER_ACCESS_PLANS.toyo.feeTzs))} · ${DRIVER_ACCESS_PLANS.toyo.minOrders}/week</span></div>
        <div class="subs-plan-chip"><strong>Kirikuu</strong><span>${escapeHtml(formatMoney(DRIVER_ACCESS_PLANS.kirikuu.feeTzs))} · ${DRIVER_ACCESS_PLANS.kirikuu.minOrders}/week</span></div>
      </div>

      <article class="card subs-history-card">
        <div class="subs-history-head">
          <div>
            <h3>Payment history</h3>
            <p class="muted">USSD payments sync automatically. Legacy rows may need review.</p>
          </div>
          <div class="admin-inline-actions">
            ${renderFilterBar(PAYMENT_FILTERS, state.paymentFilter, 'paymentFilter')}
          </div>
        </div>

        <div class="table-wrap subs-table-wrap">
          <table class="subs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Driver</th>
                <th>Payer / Email</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${
                pageRows.length
                  ? pageRows.map(paymentReviewRow).join('')
                  : `<tr><td colspan="8">${emptyState('No records match your search or filter.')}</td></tr>`
              }
            </tbody>
          </table>
        </div>

        <div class="subs-pagination">
          <span class="mini">Showing ${listed.length ? start + 1 : 0}-${Math.min(start + pageSize, listed.length)} from ${listed.length} data</span>
          <div class="subs-page-controls">
            <button class="subs-page-btn" type="button" data-payment-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
            ${Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
              const pageNumber = totalPages <= 5 ? index + 1 : Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + index;
              return `<button class="subs-page-btn ${pageNumber === currentPage ? 'active' : ''}" type="button" data-payment-page="${pageNumber}">${pageNumber}</button>`;
            }).join('')}
            <button class="subs-page-btn" type="button" data-payment-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderSubsSummaryCard(label, value, note, tone) {
  return `
    <article class="subs-summary-card ${escapeHtml(tone)}">
      <div class="subs-summary-icon" aria-hidden="true"></div>
      <div>
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
        <p class="mini">${escapeHtml(note)}</p>
      </div>
    </article>
  `;
}

function getPaymentPdfRows(payments) {
  return payments.map((payment) => {
    const status = paymentReviewStatus(payment);
    const driver = state.drivers.find((item) => item.id === payment.driverId) || null;
    const planLabel = getPaymentPlanLabel(payment);
    const reference = payment.receiptNumber || payment.transactionReference || payment.gatewayRef || payment.id;
    return `
      <tr>
        <td>${escapeHtml(safeText(payment.driverName || driver?.fullName, 'Driver'))}</td>
        <td>${escapeHtml(formatMoney(getPaymentAmount(payment)))}</td>
        <td>${escapeHtml(safeText(payment.payerPhone, 'Not provided'))}</td>
        <td>${escapeHtml(safeText(reference, payment.id))}</td>
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
          <div class="box"><span>Paid</span><strong>${escapeHtml(formatMoney(summary.verifiedAmount))}</strong></div>
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
  const legacyAccessSummary = getPaymentSummary();
  const commissionRate = Number(state.settings.commissionRate || 0);
  const estimatedCommission = analytics.revenue * commissionRate;
  const ninunulieFinance = getNinunulieFinanceStats();

  section.innerHTML = `
    <div class="grid kpi">
      ${kpi('Delivered', formatMoney(analytics.revenue), `${analytics.delivered.length} completed orders`)}
      ${kpi('Pipeline', formatMoney(analytics.pipeline), `${analytics.active.length} open orders`)}
      ${kpi('Today', formatMoney(analytics.revenueToday), `${analytics.deliveredToday.length} delivered`)}
      ${kpi('Est. commission', formatMoney(estimatedCommission), `${Math.round(commissionRate * 100)}% of delivered value`)}
    </div>
    <div class="grid kpi" style="margin-top:12px;">
      ${kpi('Ninunulie open', String(ninunulieFinance.open), `${ninunulieFinance.total} total Buy-for-me`)}
      ${kpi('Imenunuliwa', String(ninunulieFinance.purchased), 'Marked purchased at Kariakoo')}
      ${kpi('Purchase volume', formatMoney(ninunulieFinance.purchaseVolume), 'Customer→seller (not DoorDrop fare)')}
      ${kpi('Ninunulie delivered', String(ninunulieFinance.delivered), 'Completed handovers')}
    </div>
    <article class="card">
      <div class="table-toolbar">
        <h3>Revenue by service</h3>
        <span class="mini">${formatMoney(legacyAccessSummary.verifiedAmount)} access fees collected · Ninunulie purchase volume is separate from delivery revenue</span>
      </div>
      <div class="table-wrap compact">
        <table>
          <thead>
            <tr><th>Service</th><th>Delivered</th><th>Active</th><th>Revenue</th><th>Extra</th><th>Share</th></tr>
          </thead>
          <tbody>
            ${analytics.services.map((service) => {
              const share = analytics.revenue ? Math.round((service.revenue / analytics.revenue) * 100) : 0;
              const active = service.orders.filter((order) => ACTIVE_STATUSES.includes(getOrderStatus(order))).length;
              const extra = service.key === 'ninunulie'
                ? `Purchases ${formatMoney(service.purchaseVolume || 0)}`
                : '—';
              return `
                <tr>
                  <td><strong>${escapeHtml(service.title)}</strong></td>
                  <td>${service.delivered.length}</td>
                  <td>${active}</td>
                  <td>${escapeHtml(formatMoney(service.revenue))}</td>
                  <td><span class="mini">${escapeHtml(extra)}</span></td>
                  <td>
                    <div class="bar-row">
                      <div class="bar-row-meta"><span></span><strong>${share}%</strong></div>
                      <div class="bar-track"><span class="bar-fill" style="width:${share}%"></span></div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderReports() {
  const section = getOrCreateSection('reports');
  const analytics = getAnalytics();
  const topService = [...analytics.services].sort((left, right) => right.orders.length - left.orders.length)[0];

  section.innerHTML = `
    <div class="context-bar">
      <p class="page-note">Daily operations snapshot for ${escapeHtml(state.settings.defaultCity || 'DoorDrop')}.</p>
      <button class="btn primary" data-action="export-report">Export report</button>
    </div>
    <div class="grid kpi">
      ${kpi('Completion', `${analytics.completionRate}%`, 'Delivered vs cancelled')}
      ${kpi('Delivered today', String(analytics.deliveredToday.length), formatMoney(analytics.revenueToday))}
      ${kpi('Cancelled', String(analytics.cancelled.length), 'Operational risk')}
      ${kpi('Active customers', String(analytics.activeUsers.length), 'Last 24 hours')}
    </div>
    <div class="grid three">
      ${card('Demand', 'Services', `<p class="muted">${escapeHtml(topService?.title || 'Parcel')} leads with ${topService?.orders.length || 0} orders.</p>`)}
      ${card('Fleet', 'Utilization', `<p class="muted">${analytics.driverUtilization}% in use. ${analytics.activeDrivers.length} drivers are ready.</p>`)}
      ${card('Revenue', 'Health', `<p class="muted">${formatMoney(analytics.revenue)} delivered. Pipeline ${formatMoney(analytics.pipeline)}.</p>`)}
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
    <div class="grid kpi">
      ${kpi('Customer events', String(customerEvents.length), 'Orders, ratings, and app use')}
      ${kpi('Driver events', String(driverEvents.length), 'Assignments and deliveries')}
      ${kpi('Reviews', String(state.orders.filter((order) => order.customerRating).length), 'Customer feedback')}
      ${kpi('Auto assigned', String(state.orders.filter((order) => order.assignmentMode === 'auto').length), 'Matched without admin')}
    </div>
    <div class="grid two">
      ${card('Customers', 'Activity', renderHistoryList(customerEvents, 'No customer activity yet.'))}
      ${card('Drivers', 'Activity', renderHistoryList(driverEvents, 'No driver activity yet.'))}
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

  section.innerHTML = `
    <div class="grid kpi">
      ${kpi('Events', String(events.length), 'Recent app activity')}
      ${kpi('Users', String(uniqueUsers), 'Customers and drivers')}
      ${kpi('Checkout conversion', getPercent(orderCreated, checkoutStarts), `${orderCreated} orders from ${checkoutStarts} checkouts`)}
      ${kpi('Friction', String(failedSignals + cancellationCount), 'Failures, declines, cancellations')}
    </div>
    <div class="grid two">
      ${card('Booking funnel', 'Conversion', renderFunnelList(bookingFunnel))}
      ${card('Friction', 'To fix first', renderCountList(frictionSignals, 'No friction signals yet.'))}
    </div>
    <div class="grid three">
      ${card('Features', 'Usage', renderCountList(featureCounts, 'No feature usage yet.'))}
      ${card('Vehicles', 'Demand', renderCountList(vehicleCounts, 'No vehicle data yet.'))}
      ${card('Peak hours', 'Timing', renderCountList(hourCounts, 'No time data yet.'))}
    </div>
    <div class="grid three">
      ${card('Screens', 'Navigation', renderCountList(screenCounts, 'No screen views yet.'))}
      ${card('Roles', 'Activity', renderCountList(roleCounts, 'No role data yet.'))}
      ${card('Platforms', 'Devices', renderCountList(platformCounts, 'No platform data yet.'))}
    </div>
  `;
}

function renderSettings() {
  const section = getOrCreateSection('settings');
  const settings = state.settings;

  section.innerHTML = `
    <div class="settings-stack">
      <article class="card">
        <div class="card-head"><div><h3>Company</h3></div></div>
        <div class="form-grid" id="settingsForm">
          <div class="field"><label>Company name</label><input data-setting-field="companyName" value="${escapeHtml(settings.companyName)}" /></div>
          <div class="field"><label>Default city</label><input data-setting-field="defaultCity" value="${escapeHtml(settings.defaultCity)}" /></div>
          <div class="field"><label>Currency</label><input data-setting-field="currencyLabel" value="${escapeHtml(settings.currencyLabel)}" /></div>
          <div class="field"><label>Service status</label><select data-setting-field="defaultServiceStatus"><option ${settings.defaultServiceStatus === 'Active' ? 'selected' : ''}>Active</option><option ${settings.defaultServiceStatus === 'Maintenance' ? 'selected' : ''}>Maintenance</option></select></div>
        </div>
      </article>

      <article class="card">
        <div class="card-head"><div><h3>Dispatch</h3></div></div>
        <div class="setting-row">
          <div>
            <strong>Admin assignment helper</strong>
            <p class="muted">Visible fallback while this dashboard is open. Cloud dispatch still runs if this is off.</p>
          </div>
          <input type="checkbox" data-setting-field="autoAssignEnabled" ${settings.autoAssignEnabled ? 'checked' : ''} />
        </div>
        <div class="setting-row">
          <div>
            <strong>Cloud auto-dispatch</strong>
            <p class="muted">Order-created trigger, driver availability trigger, and one-minute pending queue.</p>
          </div>
          ${pill('On', 'success')}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><div><h3>Support</h3></div></div>
        <div class="field">
          <label>Customer message</label>
          <textarea data-setting-field="supportMessage">${escapeHtml(settings.supportMessage)}</textarea>
        </div>
        <div class="admin-inline-actions">
          <button class="btn primary" data-action="save-settings">Save settings</button>
        </div>
      </article>
    </div>
  `;
}

function slugifyOutsideCityKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function getOutsideLogisticsStatus(order) {
  return safeText(order.logisticsStatus, isOutsideParcelOrder(order) ? 'awaiting_dispatch' : '');
}

function getOutsideLogisticsLabel(status) {
  return OUTSIDE_LOGISTICS_LABELS[status] || String(status || 'Unknown').replace(/_/g, ' ');
}

function getOutsideParcelCode(order) {
  return safeText(order.parcelCode || order.trackingId, getOrderNumber(order));
}

function getOutsideOrders() {
  return sortByRecent(state.orders.filter((order) => isOutsideParcelOrder(order)));
}

function outsideOrderMatchesFilter(order) {
  const filter = state.otherRegionsFilter || 'all';
  const mode = state.otherRegionsMode || 'all';
  const search = safeText(state.otherRegionsSearch).toLowerCase();
  const logistics = getOutsideLogisticsStatus(order);
  const shippingMode = safeText(order.outsideShippingMode) === 'express' ? 'express' : 'standard';

  if (mode === 'express' && shippingMode !== 'express') return false;
  if (mode === 'standard' && shippingMode !== 'standard') return false;

  if (search) {
    const haystack = [
      getOrderNumber(order),
      getOutsideParcelCode(order),
      order.customerName,
      order.customerPhone,
      order.recipientName,
      order.recipientPhone,
      order.outsideOriginCity,
      order.outsideDestinationCity,
      order.outsideDestinationStand,
      order.declaredValueTzs,
    ]
      .map((value) => safeText(value).toLowerCase())
      .join(' ');
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filter === 'all') return true;
  if (filter === 'first_mile_assigned') {
    return ['first_mile_assigned', 'awaiting_hub_intake'].includes(logistics);
  }
  if (filter === 'arrived_destination') {
    return ['arrived_destination', 'out_for_delivery'].includes(logistics);
  }
  return logistics === filter;
}

function formatDeclaredValueAdmin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  return `TZS ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function buildOutsideQrPayload(order) {
  const code = getOutsideParcelCode(order);
  const params = new URLSearchParams({
    c: code,
    id: order.id,
  });
  const summary = {
    c: code,
    id: order.id,
    on: getOrderNumber(order),
    origin: safeText(order.outsideOriginCity, 'Dar es Salaam'),
    dest: safeText(order.outsideDestinationCity),
    stand: safeText(order.outsideDestinationStand || order.outsideDestinationLabel),
    mode: safeText(order.outsideShippingMode),
    handoff: safeText(order.outsideHandoffMode),
    weight: safeText(order.outsideParcelWeightKg),
    declaredValue: safeText(order.declaredValueTzs),
    contentsOk: order.contentsDeclarationAccepted === true ? 'yes' : '',
    recipient: safeText(order.recipientName),
    phone: safeText(order.recipientPhone),
    fare: safeText(order.totalLabel || order.fareLabel),
    status: getOutsideLogisticsStatus(order),
    customer: safeText(order.customerName),
    driver: safeText(order.driverName),
    createdAt: formatDateTime(order.createdAt),
  };
  params.set('d', encodeURIComponent(JSON.stringify(summary)));
  return `https://efootball-app-9d175.web.app/parcel?${params.toString()}`;
}

function resolveOutsideWorkflowStep(logisticsStatus) {
  const status = safeText(logisticsStatus, 'awaiting_dispatch');
  if (['awaiting_hub_intake', 'at_hub', 'first_mile_assigned'].includes(status)) {
    return 'first_mile_assigned';
  }
  if (status === 'out_for_delivery') {
    return 'arrived_destination';
  }
  const match = OUTSIDE_LOGISTICS_STEPS.find((step) => step.id === status);
  return match?.id || 'awaiting_dispatch';
}

function getOutsideNextAction(order) {
  const logistics = getOutsideLogisticsStatus(order);
  const handoff = safeText(order.outsideHandoffMode, 'bus');
  const mode = safeText(order.outsideShippingMode, 'standard') === 'express' ? 'ndege' : 'basi';
  const canAssign = logistics === 'awaiting_dispatch' || (getOrderStatus(order) === 'pending_assignment' && !order.driverId);
  const canIntake = ['awaiting_hub_intake', 'first_mile_assigned', 'at_hub'].includes(logistics) || getOrderStatus(order) === 'at_hub';
  const canDepart = logistics === 'received_at_hub';
  const canArrive = logistics === 'in_transit_carrier';

  if (canAssign) {
    return {
      title: 'Panga dereva wa pickup',
      detail: 'Chagua dereva hapa chini achukue mzigo kutoka kwa mteja hadi ofisi.',
      action: '',
      tone: 'primary',
      stepNumber: 1,
    };
  }
  if (canIntake) {
    return {
      title: 'Thibitisha mzigo umefika ofisini',
      detail: 'Dereva amefika? Bonyeza hapa kuthibitisha mzigo umepokelewa ofisini.',
      action: 'outside-intake',
      tone: 'primary',
      stepNumber: 2,
    };
  }
  if (canDepart) {
    return {
      title: `Thibitisha imeondoka kwa ${mode}`,
      detail: `Pakia mzigo kwenye ${mode}, kisha bonyeza hapa. Mteja ataona “Njiani”.`,
      action: 'outside-depart',
      tone: 'primary',
      stepNumber: 3,
    };
  }
  if (canArrive) {
    return {
      title: 'Thibitisha imefika mji wa lengo',
      detail: `${mode.charAt(0).toUpperCase() + mode.slice(1)} imefika? Bonyeza hapa. Mteja ataona “Imefika”.`,
      action: 'outside-arrive',
      tone: 'primary',
      stepNumber: 4,
    };
  }
  if (logistics === 'out_for_delivery') {
    return {
      title: 'Thibitisha mpokeaji amepokea',
      detail: 'Mpokeaji amepokea mzigo nyumbani? Bonyeza hapa — track itaonyesha “Imepokelewa” na oda itaenda History.',
      action: 'outside-complete',
      tone: 'primary',
      stepNumber: 6,
    };
  }
  if (logistics === 'arrived_destination' && handoff === 'home') {
    return {
      title: 'Anza delivery ya nyumbani',
      detail: 'Bonyeza hapa mzigo unapoanza kupelekwa nyumbani kwa mpokeaji.',
      action: 'outside-out-for-delivery',
      tone: 'primary',
      stepNumber: 5,
    };
  }
  if (logistics === 'arrived_destination') {
    return {
      title: 'Thibitisha mpokeaji amepokea',
      detail: 'Mpokeaji ameshachukua mzigo? Bonyeza hapa — track itaonyesha “Imepokelewa” na oda itaenda History.',
      action: 'outside-complete',
      tone: 'primary',
      stepNumber: 6,
    };
  }
  if (logistics === 'completed') {
    return {
      title: 'Imepokelewa',
      detail: 'Oda imefungwa. Mteja anaiona kwenye History tu.',
      action: '',
      tone: 'success',
      stepNumber: 6,
    };
  }
  if (logistics === 'cancelled') {
    return {
      title: 'Imefutwa',
      detail: 'Oda hii imefutwa na admin. Haiwezi kuendelea.',
      action: '',
      tone: 'info',
      stepNumber: 0,
    };
  }
  return {
    title: 'Angalia hali',
    detail: 'Fuatilia QR na timeline. Kitufe cha hatua kitafunguka hatua inayofuata.',
    action: '',
    tone: 'info',
    stepNumber: 0,
  };
}

function buildOutsideTrainingRecord(order) {
  const events = Array.isArray(order.logisticsEvents) ? order.logisticsEvents : [];
  return {
    orderId: order.id,
    orderNumber: getOrderNumber(order),
    parcelCode: getOutsideParcelCode(order),
    parcelScope: 'outside',
    logisticsStatus: getOutsideLogisticsStatus(order),
    workflowStep: resolveOutsideWorkflowStep(getOutsideLogisticsStatus(order)),
    originCity: safeText(order.outsideOriginCity, 'Dar es Salaam'),
    destinationCity: safeText(order.outsideDestinationCity),
    destinationLabel: safeText(order.outsideDestinationLabel, getDropoff(order)),
    destinationStand: safeText(order.outsideDestinationStand),
    shippingMode: safeText(order.outsideShippingMode),
    handoffMode: safeText(order.outsideHandoffMode),
    weightKg: safeText(order.outsideParcelWeightKg),
    fareLabel: safeText(order.totalLabel || order.fareLabel),
    fareAmount: getOrderAmount(order),
    customerName: safeText(order.customerName),
    customerPhone: safeText(order.customerPhone),
    recipientName: safeText(order.recipientName),
    recipientPhone: safeText(order.recipientPhone),
    driverName: safeText(order.driverName),
    driverPhone: safeText(order.driverPhone),
    pickupLabel: getPickup(order),
    dropoffLabel: getDropoff(order),
    qrUrl: buildOutsideQrPayload(order),
    createdAt: formatDateTime(order.createdAt),
    updatedAt: formatDateTime(order.updatedAt || order.createdAt),
    eventCount: events.length,
    events: events.map((event) => ({
      status: safeText(event.status),
      label: getOutsideLogisticsLabel(event.status),
      note: safeText(event.note),
      by: safeText(event.by),
      at: formatDateTime(event.at),
    })),
  };
}

function renderOutsideWorkflowStepper(order) {
  const current = resolveOutsideWorkflowStep(getOutsideLogisticsStatus(order));
  const currentIndex = OUTSIDE_LOGISTICS_STEPS.findIndex((step) => step.id === current);

  return `
    <div class="outside-workflow">
      ${OUTSIDE_LOGISTICS_STEPS.map((step, index) => {
        const stateClass =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
        return `
          <div class="outside-workflow-step ${stateClass}">
            <div class="outside-workflow-dot">${index < currentIndex ? '✓' : index + 1}</div>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p class="muted">${escapeHtml(step.hint)}</p>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderOutsideFact(label, value) {
  return `
    <div class="outside-fact">
      <span class="outside-fact-label">${escapeHtml(label)}</span>
      <strong class="outside-fact-value">${escapeHtml(safeText(value, '—'))}</strong>
    </div>
  `;
}

function renderOutsideQrPanel(order) {
  const code = getOutsideParcelCode(order);
  const qrUrl = buildOutsideQrPayload(order);
  return `
    <div class="outside-qr-panel">
      <div class="outside-qr-head">
        <div>
          <span class="outside-fact-label">Parcel QR label</span>
          <strong class="outside-qr-code">${escapeHtml(code)}</strong>
        </div>
        <div class="admin-inline-actions">
          <button class="btn soft" type="button" data-action="outside-copy-code" data-copy-text="${escapeHtml(code)}">Copy code</button>
          <button class="btn soft" type="button" data-action="outside-copy-link" data-copy-text="${escapeHtml(qrUrl)}">Copy scan link</button>
          <button class="btn primary" type="button" data-action="outside-print-qr" data-order-id="${escapeHtml(order.id)}">Print label</button>
        </div>
      </div>
      <div class="outside-qr-body">
        <div class="outside-qr-canvas-wrap">
          <canvas data-outside-qr="${escapeHtml(qrUrl)}" width="220" height="220"></canvas>
        </div>
        <div class="outside-qr-meta">
          <p class="muted">Scan at office intake, hub handoff, and destination collection. QR opens structured parcel data for staff apps and AI training.</p>
          <div class="outside-fact-grid">
            ${renderOutsideFact('Order', getOrderNumber(order))}
            ${renderOutsideFact('Route', `${safeText(order.outsideOriginCity, 'Dar es Salaam')} → ${safeText(order.outsideDestinationCity)}`)}
            ${renderOutsideFact('Transport', `${safeText(order.outsideShippingMode, '—')} · ${safeText(order.outsideHandoffMode, '—')}`)}
            ${renderOutsideFact('Status', getOutsideLogisticsLabel(getOutsideLogisticsStatus(order)))}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function appendOutsideLogistics(orderId, nextStatus, note, extra = {}) {
  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order not found.');
  }
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (!isOutsideParcelOrder(order)) {
    throw new Error('Not an other-region parcel.');
  }

  const actor = safeText(state.user?.email, 'admin');
  const opsPatch = buildOpsStagePatch(order, nextStatus, actor, {
    note: safeText(note, getOutsideLogisticsLabel(nextStatus)),
    reason: safeText(extra.manualReason, ''),
    manual: extra.manualOverride === true,
    slaOverrides: state.settings?.opsSla,
  });
  const payload = compact({
    logisticsStatus: nextStatus,
    logisticsEvents: arrayUnion({
      status: nextStatus,
      note: safeText(note, getOutsideLogisticsLabel(nextStatus)),
      by: actor,
      at: new Date(),
    }),
    ...opsPatch,
    ...extra,
    updatedAt: serverTimestamp(),
  });

  // Prefer live logistics copy on customer track over a stale assignment message.
  if (
    ['awaiting_hub_intake', 'received_at_hub', 'in_transit_carrier', 'arrived_destination', 'out_for_delivery', 'completed', 'cancelled'].includes(
      nextStatus
    )
  ) {
    payload.driverSearchMessage = deleteField();
    payload.driverSearchStatus = nextStatus === 'completed' ? 'completed' : deleteField();
  }

  if (nextStatus === 'completed') {
    payload.status = 'delivered';
    payload.deliveredAt = serverTimestamp();
  }

  if (nextStatus === 'cancelled') {
    payload.status = 'cancelled';
    payload.cancelledAt = payload.cancelledAt || serverTimestamp();
    payload.cancelledBy = payload.cancelledBy || 'dispatch';
    payload.cancellationReason = payload.cancellationReason || safeText(note, 'Cancelled by admin');
  }

  await updateDoc(orderRef(orderId), payload);

  try {
    await createLogisticsStatusNotification(order, nextStatus, { note });
  } catch {
    // notifications are best-effort
  }

  const code = safeText(order.parcelCode || order.trackingId);
  if (code) {
    try {
      await setDoc(
        doc(db, 'publicParcels', code),
        compact({
          parcelCode: code,
          orderId: order.id,
          orderNumber: getOrderNumber(order),
          originCity: safeText(order.outsideOriginCity),
          destinationCity: safeText(order.outsideDestinationCity),
          destinationStand: safeText(order.outsideDestinationStand || order.outsideDestinationLabel),
          shippingMode: safeText(order.outsideShippingMode),
          handoffMode: safeText(order.outsideHandoffMode),
          weightKg: safeText(order.outsideParcelWeightKg),
          declaredValueTzs: safeText(order.declaredValueTzs),
          contentsDeclarationAccepted: order.contentsDeclarationAccepted === true,
          recipientName: safeText(order.recipientName),
          recipientPhone: safeText(order.recipientPhone),
          customerName: safeText(order.customerName),
          fareLabel: safeText(order.totalLabel || order.fareLabel),
          logisticsStatus: nextStatus,
          workflowStep: resolveOutsideWorkflowStep(nextStatus),
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );
    } catch {
      // public mirror is best-effort
    }
  }

  setFeedback(`${getOrderNumber(order)} → ${getOutsideLogisticsLabel(nextStatus)}`, 'success');
  scheduleRenderAll();
}

function paintOutsideQrCanvases(root) {
  if (!root || typeof window.QRCode === 'undefined') {
    return;
  }
  root.querySelectorAll('[data-outside-qr]').forEach((canvas) => {
    const payload = canvas.getAttribute('data-outside-qr');
    if (!payload) return;
    window.QRCode.toCanvas(
      canvas,
      payload,
      { width: 220, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } },
      () => undefined
    );
  });
}

function getOutsideOrderById(orderId) {
  const id = safeText(orderId);
  if (!id) {
    return null;
  }

  return (
    getOutsideOrders().find((order) => order.id === id) ||
    state.orders.find((order) => order.id === id && isOutsideParcelOrder(order)) ||
    null
  );
}

function openOutsideRegionsDesk(orderId) {
  const order = getOutsideOrderById(orderId);
  if (!order) {
    setFeedback('Order not found.', 'error');
    return;
  }

  state.otherRegionsSelectedId = order.id;
  openShipmentPage(order.id, { returnPage: 'otherRegions' });
}

function refreshOutsideRegionsDeskIfOpen() {
  if (state.currentPage === 'shipment' && safeText(state.shipmentId)) {
    return;
  }
}

function renderOtherRegionsDetail(order) {
  if (!order) {
    return emptyState('Chagua oda kutoka orodha kushoto ili uone hatua inayofuata.');
  }

  const logistics = getOutsideLogisticsStatus(order);
  const drivers = getNearbyDriverMatches(order).slice(0, 6);
  const events = Array.isArray(order.logisticsEvents) ? [...order.logisticsEvents].reverse() : [];
  const next = getOutsideNextAction(order);
  const canAssign = logistics === 'awaiting_dispatch' || (getOrderStatus(order) === 'pending_assignment' && !order.driverId);
  const modeLabel = safeText(order.outsideShippingMode) === 'express' ? 'Ndege' : 'Basi';
  const routeLabel = `${safeText(order.outsideOriginCity, 'Dar')} → ${safeText(order.outsideDestinationCity, order.dropoffLabel)}`;

  return `
    <div class="outside-detail-stack">
      <div class="outside-easy-banner">
        <strong>Jinsi ya kutumia (rahisi)</strong>
        <ol>
          <li>Angalia <em>hatua ya sasa</em> hapa chini.</li>
          <li>Bonyeza kitufe kikubwa kijani cha <em>hatua inayofuata</em>.</li>
          <li>Mteja ataona mabadiliko kwenye app mara moja.</li>
        </ol>
      </div>

      <div class="outside-order-summary">
        <div>
          <span class="outside-fact-label">Oda</span>
          <strong>${escapeHtml(getOrderNumber(order))}</strong>
          <span class="mini">${escapeHtml(getOutsideParcelCode(order))} · ${escapeHtml(modeLabel)}</span>
        </div>
        <div>
          <span class="outside-fact-label">Njia</span>
          <strong>${escapeHtml(routeLabel)}</strong>
          <span class="mini">${escapeHtml(safeText(order.recipientName, 'Mpokeaji'))} · ${escapeHtml(safeText(order.recipientPhone))}</span>
        </div>
        <div>
          <span class="outside-fact-label">Hali sasa</span>
          ${pill(getOutsideLogisticsLabel(logistics), logistics === 'completed' ? 'success' : logistics === 'cancelled' ? 'danger' : 'info')}
        </div>
      </div>

      <div class="outside-section">
        <div class="outside-section-head">
          <strong>Hatua za mzigo</strong>
          <p class="muted">Fuata namba 1 → 5. Rangi ya kijani inaonyesha umefikia wapi.</p>
        </div>
        ${renderOutsideWorkflowStepper(order)}
      </div>

      <div class="outside-next-card ${escapeHtml(next.tone)} outside-next-card-hero">
        <div>
          <span class="outside-fact-label">${next.stepNumber ? `Hatua ${next.stepNumber}` : 'Hali'}</span>
          <strong>${escapeHtml(next.title)}</strong>
          <p class="muted">${escapeHtml(next.detail)}</p>
        </div>
        ${
          next.action
            ? `<button class="btn primary outside-big-action" type="button" data-action="${escapeHtml(next.action)}" data-order-id="${escapeHtml(order.id)}">${escapeHtml(next.title)}</button>`
            : logistics === 'completed'
              ? pill('Imekamilika', 'success')
              : canAssign
                ? `<span class="mini">Chagua dereva hapa chini ↓</span>`
                : pill(getOutsideLogisticsLabel(logistics), 'info')
        }
      </div>

      ${
        canAssign
          ? `
            <div class="outside-section outside-assign-box">
              <div class="outside-section-head">
                <strong>Chagua dereva wa pickup</strong>
                <p class="muted">Bonyeza “Panga” kwenye dereva wa karibu.</p>
              </div>
              ${
                drivers.length
                  ? `<div class="table-wrap compact">
                      <table>
                        <thead><tr><th>Dereva</th><th>Umbali</th><th></th></tr></thead>
                        <tbody>
                          ${drivers
                            .map(
                              (driver) => `
                                <tr>
                                  <td>
                                    <strong>${escapeHtml(safeText(driver.fullName, 'Dereva'))}</strong>
                                    <span class="mini">${escapeHtml(safeText(driver.phoneNumber))}</span>
                                  </td>
                                  <td>${escapeHtml(driver.distanceLabel || '—')}</td>
                                  <td><button class="btn primary" type="button" data-action="outside-assign" data-order-id="${escapeHtml(order.id)}" data-driver-id="${escapeHtml(driver.id)}">Panga</button></td>
                                </tr>
                              `
                            )
                            .join('')}
                        </tbody>
                      </table>
                    </div>`
                  : emptyState('Hakuna dereva wa karibu online sasa. Jaribu tena baadaye.')
              }
            </div>
          `
          : ''
      }

      <details class="outside-more-details">
        <summary>Maelezo zaidi (QR, simu, timeline)</summary>
        <div class="outside-more-body">
          ${renderOutsideQrPanel(order)}

          <div class="outside-section">
            <div class="outside-section-head"><strong>Watu</strong></div>
            <div class="outside-fact-grid">
              ${renderOutsideFact('Mteja', safeText(order.customerName))}
              ${renderOutsideFact('Simu ya mteja', safeText(order.customerPhone))}
              ${renderOutsideFact('Mpokeaji', safeText(order.recipientName))}
              ${renderOutsideFact('Simu ya mpokeaji', safeText(order.recipientPhone))}
              ${renderOutsideFact('Dereva wa pickup', safeText(order.driverName, 'Bado hajapangiwa'))}
            </div>
          </div>

          <div class="outside-section">
            <div class="outside-section-head"><strong>Rekodi ya oda</strong></div>
            <div class="outside-fact-grid">
              ${renderOutsideFact('Pickup', getPickup(order))}
              ${renderOutsideFact('Lengo', safeText(order.outsideDestinationLabel, getDropoff(order)))}
              ${renderOutsideFact('Standi / hub', safeText(order.outsideDestinationStand, '—'))}
              ${renderOutsideFact('Uzito (kg)', safeText(order.outsideParcelWeightKg))}
              ${renderOutsideFact('Thamani', formatDeclaredValueAdmin(order.declaredValueTzs) || '—')}
              ${renderOutsideFact('Tamko la sheria', order.contentsDeclarationAccepted === true ? 'Limekubaliwa' : 'Halijarekodiwa')}
              ${renderOutsideFact('Nauli', formatMoney(getOrderAmount(order)))}
              ${renderOutsideFact('Imeundwa', formatDateTime(order.createdAt))}
            </div>
          </div>

          <div class="outside-section">
            <div class="outside-section-head"><strong>Historia ya mabadiliko</strong></div>
            <div class="outside-timeline">
              ${
                events.length
                  ? events
                      .map(
                        (event) => `
                          <div class="outside-timeline-item">
                            <div class="outside-timeline-dot"></div>
                            <div>
                              <div class="outside-timeline-top">
                                <strong>${escapeHtml(getOutsideLogisticsLabel(event.status))}</strong>
                                <span class="mini">${escapeHtml(formatDateTime(event.at))}</span>
                              </div>
                              <p class="muted">${escapeHtml(safeText(event.note, '—'))}</p>
                              <span class="mini">${escapeHtml(safeText(event.by, 'system'))}</span>
                            </div>
                          </div>
                        `
                      )
                      .join('')
                  : emptyState('Bado hakuna mabadiliko.')
              }
            </div>
          </div>
        </div>
      </details>

      ${
        logistics !== 'completed'
          ? `
            <div class="outside-section">
              <div class="outside-section-head">
                <strong>Weka status (hatua zote)</strong>
                <p class="muted">Chagua hali yoyote. Mteja ataona mabadiliko kwenye app.</p>
              </div>
              ${renderOutsideStatusUpdateForm(order)}
            </div>
          `
          : ''
      }
    </div>
  `;
}

function renderOtherRegions() {
  const section = getOrCreateSection('otherRegions');
  const orders = getOutsideOrders().sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  const visible = orders.filter(outsideOrderMatchesFilter);

  const counts = {
    awaiting_dispatch: orders.filter((o) => getOutsideLogisticsStatus(o) === 'awaiting_dispatch').length,
    first_mile_assigned: orders.filter((o) => ['first_mile_assigned', 'awaiting_hub_intake'].includes(getOutsideLogisticsStatus(o))).length,
    received_at_hub: orders.filter((o) => getOutsideLogisticsStatus(o) === 'received_at_hub').length,
    in_transit_carrier: orders.filter((o) => getOutsideLogisticsStatus(o) === 'in_transit_carrier').length,
    arrived_destination: orders.filter((o) => ['arrived_destination', 'out_for_delivery'].includes(getOutsideLogisticsStatus(o))).length,
    completed: orders.filter((o) => getOutsideLogisticsStatus(o) === 'completed').length,
    express: orders.filter((o) => safeText(o.outsideShippingMode) === 'express').length,
    standard: orders.filter((o) => safeText(o.outsideShippingMode) !== 'express').length,
  };

  const filters = [
    ['all', 'Zote'],
    ['awaiting_dispatch', '1 Pickup'],
    ['first_mile_assigned', '2 Ofisini'],
    ['received_at_hub', '3 Ofisini tayari'],
    ['in_transit_carrier', '4 Njiani'],
    ['arrived_destination', '5 Imefika'],
    ['completed', 'Imekamilika'],
  ];

  const modeFilters = [
    ['all', 'Ndege + Basi'],
    ['express', `Ndege (${counts.express})`],
    ['standard', `Basi (${counts.standard})`],
  ];

  section.innerHTML = `
    <div class="page-panel">
    <div class="outside-howto-card">
      <div>
        <strong>Bus &amp; air parcels</strong>
        <p class="muted">Bonyeza oda kufungua ukurasa wake. Huko utaona taarifa zote na kuweka status kila hatua — mteja anaona mabadiliko kwenye app.</p>
      </div>
      <div class="outside-howto-steps">
        <span>1 Chagua oda</span>
        <span>2 Fungua ukurasa</span>
        <span>3 Weka status</span>
      </div>
    </div>

    <div class="grid kpi">
      ${kpi('1 · Pickup', String(counts.awaiting_dispatch), 'Panga dereva')}
      ${kpi('2 · Ofisini', String(counts.first_mile_assigned), 'Inakuja / intake')}
      ${kpi('3 · Tayari', String(counts.received_at_hub), 'Pakia basi/ndege')}
      ${kpi('4 · Njiani', String(counts.in_transit_carrier), 'Kwenye basi/ndege')}
      ${kpi('5 · Imefika', String(counts.arrived_destination), 'Mkabidhi')}
      ${kpi('Imekamilika', String(counts.completed), 'Zimefungwa na admin')}
    </div>

    <article class="card">
      <div class="card-head">
        <div>
          <h3>Orodha ya oda</h3>
          <p class="muted">${orders.length} jumla · ${visible.length} zinazoonekana · bonyeza oda kufungua</p>
        </div>
        <input
          type="search"
          data-other-regions-search
          value="${escapeHtml(state.otherRegionsSearch || '')}"
          placeholder="Tafuta namba, mzigo, mteja, mji…"
          style="min-width:min(280px,100%);height:42px;border:1px solid var(--line);border-radius:12px;padding:0 14px;"
        />
      </div>
      <div class="table-toolbar">
        <div class="filter-bar">
          ${modeFilters
            .map(
              ([id, label]) => `
                <button class="filter-chip ${state.otherRegionsMode === id ? 'active' : ''}" type="button" data-action="outside-mode" data-mode="${id}">${escapeHtml(label)}</button>
              `
            )
            .join('')}
        </div>
      </div>
      <div class="table-toolbar">
        <div class="filter-bar">
          ${filters
            .map(
              ([id, label]) => `
                <button class="filter-chip ${state.otherRegionsFilter === id ? 'active' : ''}" type="button" data-action="outside-filter" data-filter="${id}">${escapeHtml(label)}</button>
              `
            )
            .join('')}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Oda #</th>
              <th>Mzigo</th>
              <th>Njia</th>
              <th>Aina</th>
              <th>Thamani</th>
              <th>Hatua</th>
              <th>Nauli</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              visible.length
                ? visible
                    .map((order) => {
                      const logistics = getOutsideLogisticsStatus(order);
                      const mode = safeText(order.outsideShippingMode) === 'express' ? 'Ndege' : 'Basi';
                      const declared = formatDeclaredValueAdmin(order.declaredValueTzs);
                      return `
                        <tr data-action="outside-open" data-order-id="${escapeHtml(order.id)}" class="ops-order-row">
                          <td>
                            <strong>${escapeHtml(getOrderNumber(order))}</strong>
                            <span class="mini">${escapeHtml(formatDateTime(order.createdAt))}</span>
                          </td>
                          <td>
                            <strong>${escapeHtml(getOutsideParcelCode(order))}</strong>
                            <span class="mini">${escapeHtml(safeText(order.customerName, 'Mteja'))}</span>
                          </td>
                          <td>
                            ${escapeHtml(safeText(order.outsideOriginCity, 'Dar'))} → ${escapeHtml(safeText(order.outsideDestinationCity, order.dropoffLabel))}
                            <span class="mini">${escapeHtml(safeText(order.recipientName, 'Mpokeaji'))} · ${escapeHtml(safeText(order.recipientPhone))}</span>
                          </td>
                          <td>${escapeHtml(mode)}<span class="mini">${escapeHtml(safeText(order.outsideHandoffMode))}${order.outsideParcelWeightKg ? ` · ${escapeHtml(String(order.outsideParcelWeightKg))} kg` : ''}</span></td>
                          <td>${escapeHtml(declared || '—')}${order.contentsDeclarationAccepted === true ? `<span class="mini">Tamko ✓</span>` : ''}</td>
                          <td>${pill(getOutsideLogisticsLabel(logistics), logistics === 'completed' ? 'success' : logistics === 'cancelled' ? 'danger' : logistics === 'in_transit_carrier' ? 'warning' : 'info')}</td>
                          <td>${escapeHtml(formatMoney(getOrderAmount(order)))}</td>
                          <td><button class="btn primary" type="button" data-action="outside-open" data-order-id="${escapeHtml(order.id)}">Fungua</button></td>
                        </tr>
                      `;
                    })
                    .join('')
                : `<tr><td colspan="8">${emptyState('Hakuna oda zinazolingana na filter hii.')}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </article>
    </div>
  `;
}

function getSortedOutsideCities() {
  return [...state.outsideCities].sort((left, right) => {
    const sortDelta = Number(left.sortOrder ?? 999) - Number(right.sortOrder ?? 999);
    if (sortDelta !== 0) {
      return sortDelta;
    }
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

function getSortedOutsideExpressRoutes() {
  return [...(state.outsideExpressRoutes || [])].sort((left, right) =>
    String(left.label || left.id || '').localeCompare(String(right.label || right.id || ''))
  );
}

function getExpressRouteCityLabel(cityKey) {
  const city = getSortedOutsideCities().find((item) => item.key === cityKey);
  return city?.label || cityKey;
}

function buildExpressRouteId(originCityKey, destinationCityKey) {
  return `${safeText(originCityKey)}__${safeText(destinationCityKey)}`;
}

function normalizeExpressDeparture(raw, index = 0) {
  const localTime = safeText(raw?.localTime);
  if (!/^\d{2}:\d{2}$/.test(localTime)) {
    return null;
  }
  return {
    id: safeText(raw?.id, `d${localTime.replace(':', '')}`),
    localTime,
    label: safeText(raw?.label, formatExpressClockLabel(localTime)),
    daysOfWeek: Array.isArray(raw?.daysOfWeek) ? raw.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
    active: raw?.active !== false,
  };
}

function padExpress2(value) {
  return String(value).padStart(2, '0');
}

function getExpressTodayIso() {
  const now = new Date(Date.now() + TANZANIA_UTC_OFFSET_MS);
  return `${now.getUTCFullYear()}-${padExpress2(now.getUTCMonth() + 1)}-${padExpress2(now.getUTCDate())}`;
}

function getExpressScheduleDateValue() {
  const value = safeText(state.selectedExpressScheduleDate, getExpressTodayIso());
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : getExpressTodayIso();
}

function formatExpressClockLabel(localTime) {
  const [hourText, minuteText = '00'] = String(localTime || '').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour)) {
    return localTime;
  }
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${padExpress2(minute)} ${suffix}`;
}

function formatExpressDayLabel(isoDate) {
  const date = new Date(`${isoDate}T12:00:00+03:00`);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function getExpressDateOverrideMode(route, isoDate) {
  const override = route?.dateOverrides?.[isoDate];
  if (!override) {
    return 'template';
  }
  if (override.mode === 'cancelled' || override.active === false) {
    return 'cancelled';
  }
  if (override.mode === 'custom' || (override.departures || []).length) {
    return 'custom';
  }
  return 'template';
}

function resolveExpressDayOverrideDepartures(route, isoDate) {
  const override = route?.dateOverrides?.[isoDate];
  if (override?.mode === 'cancelled' || override?.active === false) {
    return [];
  }
  if (override?.mode === 'custom' || (override?.departures || []).length) {
    return (override.departures || []).filter((departure) => departure.active !== false);
  }
  return [];
}

function resolveExpressDeparturesForDate(route, isoDate) {
  // Customer + preview use per-day schedules only (never weekly template fallback).
  return resolveExpressDayOverrideDepartures(route, isoDate);
}

function buildExpressPreviewDays(route, daysAhead = 7) {
  const isoDate = getExpressScheduleDateValue();
  const start = Date.parse(`${isoDate}T12:00:00+03:00`);
  const rows = [];
  for (let index = 0; index < daysAhead; index += 1) {
    const dayMs = start + index * DAY_MS;
    const day = new Date(dayMs + TANZANIA_UTC_OFFSET_MS);
    const dayIso = `${day.getUTCFullYear()}-${padExpress2(day.getUTCMonth() + 1)}-${padExpress2(day.getUTCDate())}`;
    const mode = getExpressDateOverrideMode(route, dayIso);
    const departures = resolveExpressDeparturesForDate(route, dayIso);
    rows.push({
      isoDate: dayIso,
      label: formatExpressDayLabel(dayIso),
      mode,
      departures,
    });
  }
  return rows;
}

function renderExpressScheduleModePill(mode) {
  if (mode === 'custom') {
    return pill('Imewekwa', 'info');
  }
  if (mode === 'cancelled') {
    return pill('Hakuna ndege', 'warning');
  }
  return pill('Bado haijawekwa', 'warning');
}

const OUTSIDE_STATUS_OPTIONS = [
  'awaiting_dispatch',
  'first_mile_assigned',
  'awaiting_hub_intake',
  'received_at_hub',
  'in_transit_carrier',
  'arrived_destination',
  'out_for_delivery',
  'completed',
  'cancelled',
];

function parseExpressRouteId(routeId) {
  const [originCityKey, destinationCityKey] = String(routeId || '').split('__');
  if (!originCityKey || !destinationCityKey) {
    return null;
  }
  return { originCityKey, destinationCityKey };
}

function findExpressRouteLeg(routeId) {
  return EXPRESS_ROUTE_PAIRS.flatMap((pair) => pair.legs).find((leg) => leg.id === routeId) || null;
}

function buildExpressRouteSkeleton(routeId) {
  const parsed = parseExpressRouteId(routeId);
  const leg = findExpressRouteLeg(routeId);
  if (!parsed) {
    return null;
  }
  return {
    id: routeId,
    originCityKey: parsed.originCityKey,
    destinationCityKey: parsed.destinationCityKey,
    label: leg ? `${leg.from} → ${leg.to}` : routeId,
    active: true,
    bookingOpenDaysAhead: 14,
    bookingCloseMinutesBefore: 120,
    airportHandoffMinutesBefore: 90,
    firstMileBufferMinutes: 90,
    arrivalOffsetMinutes: 120,
    departures: [],
    dateOverrides: {},
  };
}

function renderOutsideStatusUpdateForm(order) {
  const current = getOutsideLogisticsStatus(order);
  const advanceOptions = OUTSIDE_STATUS_OPTIONS.filter((status) => status !== 'cancelled');
  return `
    <form class="outside-status-form form-grid" data-form="outside-status-update">
      <input type="hidden" name="orderId" value="${escapeHtml(order.id)}" />
      <div class="field span-2">
        <label>Weka status ya oda (hatua zote)</label>
        <select name="nextStatus" required>
          ${advanceOptions.map((status) => `
            <option value="${escapeHtml(status)}" ${status === current ? 'selected' : ''}>${escapeHtml(getOutsideLogisticsLabel(status))}</option>
          `).join('')}
          <option value="cancelled">Futa oda (cancelled)</option>
        </select>
      </div>
      <div class="field span-2">
        <label>Sababu / maelezo kwa rekodi</label>
        <input name="reason" required placeholder="Mfano: mzigo umefika ofisini / umeondoka kwa ndege" />
      </div>
      <div class="field span-2">
        <label>Ujumbe kwa mteja (si lazima)</label>
        <textarea name="note" placeholder="Maelezo yanayoonekana kwenye app / notification"></textarea>
      </div>
      <div class="span-2 admin-inline-actions">
        <button class="btn primary" type="submit">Hifadhi status · mteja ataona</button>
        <span class="mini">Unaweza kuweka status yoyote. Kitufe kikubwa cha juu ni cha hatua inayofuata.</span>
      </div>
    </form>
  `;
}

function buildExpressRoutePairs() {
  const remoteById = Object.fromEntries(getSortedOutsideExpressRoutes().map((route) => [route.id, route]));
  return EXPRESS_ROUTE_PAIRS.map((pair) => ({
    ...pair,
    legs: pair.legs.map((leg) => ({
      ...leg,
      route: remoteById[leg.id] || null,
    })),
  }));
}

function getExpressRouteRecord(routeId) {
  const remote = getSortedOutsideExpressRoutes().find((route) => route.id === routeId);
  if (remote) {
    return remote;
  }
  return buildExpressRouteSkeleton(routeId);
}

async function ensureExpressRouteDocument(routeId) {
  const existing = getSortedOutsideExpressRoutes().find((route) => route.id === routeId);
  if (existing) {
    return existing;
  }
  const skeleton = buildExpressRouteSkeleton(routeId);
  if (!skeleton) {
    throw new Error('Route not found.');
  }
  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      ...skeleton,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
  return skeleton;
}

function renderExpressRouteLegButton(leg, selectedId) {
  const active = leg.id === selectedId;
  const routeRecord = leg.route || null;
  const times = routeRecord ? resolveExpressDeparturesForDate(routeRecord, getExpressScheduleDateValue()).length : 0;
  return `
    <button
      type="button"
      class="express-leg-btn ${active ? 'active' : ''}"
      data-express-route-pick="${escapeHtml(leg.id)}"
      aria-pressed="${active ? 'true' : 'false'}">
      <span class="express-leg-direction">${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</span>
      <span class="express-leg-meta">${active ? '✓ Route imechaguliwa' : 'Bonyeza kuchagua'}</span>
      <span class="express-leg-meta">${times ? `${times} flight${times === 1 ? '' : 's'} leo` : 'Hakuna ratiba bado'}</span>
    </button>
  `;
}

function renderExpressRoutePicker(routePairs, selectedId) {
  return `
    <article class="card express-route-picker">
      <div class="card-head">
        <div>
          <h3>Chagua route</h3>
          <p class="muted">Hatua ya 1 — bonyeza mwelekeo wa ndege unaotaka kupanga.</p>
        </div>
        <div class="admin-inline-actions">
          <button class="btn soft" type="button" data-action="seed-express-routes">Tengeneza routes</button>
        </div>
      </div>
      ${
        !routePairs.length
          ? emptyState('Sync routes to start.')
          : `
            <div class="express-route-pairs">
              ${routePairs
                .map((pair) => {
                  const pairSelected = pair.legs.some((leg) => leg.id === selectedId);
                  return `
                    <div class="express-route-pair-card ${pairSelected ? 'selected' : ''}">
                      <div class="express-route-pair-head">
                        <span class="express-route-pair-icon" aria-hidden="true">✈</span>
                        <div>
                          <strong>${escapeHtml(pair.title)}</strong>
                          <p class="muted">${pairSelected ? 'Route imechaguliwa' : 'Chagua mwelekeo mmoja'}</p>
                        </div>
                      </div>
                      <div class="express-route-pair-legs">
                        ${pair.legs.map((leg) => renderExpressRouteLegButton(leg, selectedId)).join('')}
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          `
      }
    </article>
  `;
}

function renderExpressScheduleWorkspace(selected, selectedLeg) {
  if (!selected) {
    return `
      <article class="card express-schedule-workspace">
        <div class="express-schedule-idle">
          <div class="express-schedule-idle-icon" aria-hidden="true">✈</div>
          <strong>Chagua route kwanza</strong>
          <p class="muted">Baada ya kubonyeza route box upande wa kushoto, ratiba ya siku itaonekana hapa.</p>
        </div>
      </article>
    `;
  }

  const scheduleDate = getExpressScheduleDateValue();
  const dayMode = getExpressDateOverrideMode(selected, scheduleDate);
  const dayDepartures = resolveExpressDayOverrideDepartures(selected, scheduleDate);
  const configuredDays = Object.entries(selected.dateOverrides || {})
    .filter(
      ([, override]) =>
        override &&
        override.mode !== 'cancelled' &&
        override.active !== false &&
        Array.isArray(override.departures) &&
        override.departures.length > 0
    )
    .map(([isoDate, override]) => ({
      isoDate,
      label: formatExpressDayLabel(isoDate),
      count: override.departures.length,
    }))
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  return `
    <article class="card express-schedule-workspace">
      <div class="card-head">
        <div>
          <h3>Ratiba ya siku moja</h3>
          <p class="muted">Chagua tarehe → weka masaa → Save. Siku nyingine hazijazwi kiotomatiki. Mteja anaona tu siku ulizojaza.</p>
        </div>
        ${pill(`${selectedLeg?.from || getExpressRouteCityLabel(selected.originCityKey)} → ${selectedLeg?.to || getExpressRouteCityLabel(selected.destinationCityKey)}`, 'success')}
      </div>

      <div class="outside-easy-banner">
        <strong>Muhimu</strong>
        <ol>
          <li>Ratiba ni ya <em>tarehe husika tu</em> — si timetable ya wiki.</li>
          <li>Ukimaliza kazi, rudi hapa ujaze siku unazofanya kazi.</li>
          <li>Siku usizojaza hazitaonekana kwenye app ya mteja.</li>
        </ol>
      </div>

      ${
        configuredDays.length
          ? `<div class="outside-section">
              <div class="outside-section-head"><strong>Siku zilizojazwa</strong><p class="muted">${configuredDays.length} siku zinaonekana kwa mteja</p></div>
              <div class="express-time-list">
                ${configuredDays
                  .map(
                    (day) => `
                      <button type="button" class="express-time-row" data-action="express-jump-day" data-iso-date="${escapeHtml(day.isoDate)}" style="width:100%;text-align:left;">
                        <span class="express-time-value">${escapeHtml(day.label)} · ${escapeHtml(day.isoDate)}</span>
                        <span class="mini">${day.count} ndege</span>
                      </button>
                    `
                  )
                  .join('')}
              </div>
            </div>`
          : `<div class="express-empty"><p class="muted">Bado hakuna siku iliyojazwa kwa route hii.</p></div>`
      }

      <div class="express-schedule-panel">
        <div class="express-schedule-panel-head">
          <div>
            <strong>${escapeHtml(formatExpressDayLabel(scheduleDate))}</strong>
            <p class="muted">${escapeHtml(scheduleDate)} · ${escapeHtml(selected.label || selected.id)}</p>
          </div>
          ${renderExpressScheduleModePill(dayMode)}
        </div>

        <form data-form="express-day-schedule" class="express-save-form">
          <input type="hidden" name="routeId" value="${escapeHtml(selected.id)}" />
          <input type="hidden" name="isoDate" value="${escapeHtml(scheduleDate)}" />

          <div class="field">
            <label>Tarehe ya kujaza</label>
            <input type="date" data-express-schedule-date value="${escapeHtml(scheduleDate)}" />
          </div>

          <div class="field express-times-field">
            <label>Masaa ya kuondoka (siku hii tu)</label>
            ${
              dayDepartures.length
                ? `<div class="express-time-list">
                    ${dayDepartures
                      .map(
                        (departure) => `
                          <div class="express-time-row">
                            <span class="express-time-value">${escapeHtml(departure.label || formatExpressClockLabel(departure.localTime))}</span>
                            <button type="button" class="btn soft express-time-remove" data-action="remove-express-day-departure" data-route-id="${escapeHtml(selected.id)}" data-iso-date="${escapeHtml(scheduleDate)}" data-departure-id="${escapeHtml(departure.id)}">Remove</button>
                          </div>
                        `
                      )
                      .join('')}
                  </div>`
                : `<div class="express-empty"><p class="muted">${dayMode === 'cancelled' ? 'Hakuna ndege siku hii.' : 'Ongeza muda wa ndege hapa chini.'}</p></div>`
            }
          </div>

          <div class="express-save-bar">
            <input name="newDepartureTime" type="time" step="60" class="express-time-input" />
            <button class="btn soft" type="button" data-action="add-express-day-departure" data-route-id="${escapeHtml(selected.id)}" data-iso-date="${escapeHtml(scheduleDate)}">Add</button>
            <button class="btn primary" type="submit">Hifadhi siku hii</button>
          </div>

          <div class="express-secondary-actions">
            <button class="btn soft" type="button" data-action="express-use-template-day" data-route-id="${escapeHtml(selected.id)}" data-iso-date="${escapeHtml(scheduleDate)}">Futa ratiba ya siku</button>
            <button class="btn soft" type="button" data-action="express-cancel-day" data-route-id="${escapeHtml(selected.id)}" data-iso-date="${escapeHtml(scheduleDate)}">Hakuna ndege siku hii</button>
          </div>
        </form>
      </div>

      <details class="express-advanced">
        <summary>Mipangilio ya booking (si ratiba)</summary>
        <form data-form="express-route-schedule" class="form-grid express-advanced-form">
          <input type="hidden" name="routeId" value="${escapeHtml(selected.id)}" />
          <div class="field">
            <label>Book ahead (days)</label>
            <input name="bookingOpenDaysAhead" type="number" min="1" max="30" value="${Number(selected.bookingOpenDaysAhead || 14)}" />
          </div>
          <div class="field">
            <label>Close booking (minutes before)</label>
            <input name="bookingCloseMinutesBefore" type="number" min="30" max="720" value="${Number(selected.bookingCloseMinutesBefore || 120)}" />
          </div>
          <div class="field">
            <label>Airport handoff (minutes before departure)</label>
            <input name="airportHandoffMinutesBefore" type="number" min="15" max="360" value="${Number(selected.airportHandoffMinutesBefore || 90)}" />
          </div>
          <div class="field">
            <label>Pickup buffer (minutes to collect & reach airport)</label>
            <input name="firstMileBufferMinutes" type="number" min="15" max="360" value="${Number(selected.firstMileBufferMinutes || 90)}" />
          </div>
          <div class="field">
            <label>Delivery after departure (minutes)</label>
            <input name="arrivalOffsetMinutes" type="number" min="15" max="360" value="${Number(selected.arrivalOffsetMinutes || 30)}" />
          </div>
          <div class="field" style="grid-column:1/-1;">
            <button class="btn primary" type="submit">Hifadhi mipangilio</button>
          </div>
        </form>
      </details>
    </article>
  `;
}

function renderExpressRouteScheduleCard() {
  const routePairs = buildExpressRoutePairs();
  const selectedId = safeText(state.selectedExpressRouteId);
  const selected = selectedId ? getExpressRouteRecord(selectedId) : null;
  const selectedLeg = selected
    ? routePairs.flatMap((pair) => pair.legs).find((leg) => leg.id === selected.id)
    : null;

  return `
    <div class="express-air-layout">
      ${renderExpressRoutePicker(routePairs, selectedId)}
      ${renderExpressScheduleWorkspace(selected, selectedLeg)}
    </div>
  `;
}

async function seedExpressRoutes() {
  const batch = writeBatch(db);
  const actor = safeText(state.user?.email, 'admin');
  EXPRESS_ROUTE_PAIRS.flatMap((pair) => pair.legs).forEach((leg) => {
    const existing = getSortedOutsideExpressRoutes().find((route) => route.id === leg.id);
    if (existing) {
      return;
    }
    const skeleton = buildExpressRouteSkeleton(leg.id);
    if (!skeleton) {
      return;
    }
    batch.set(
      doc(col.outsideExpressRoutes, leg.id),
      {
        ...skeleton,
        departures: [],
        dateOverrides: {},
        updatedAt: serverTimestamp(),
        updatedBy: actor,
      },
      { merge: true }
    );
  });
  await batch.commit();
}

async function saveExpressRouteSchedule(form) {
  const routeId = safeText(form.routeId?.value);
  if (!routeId) {
    throw new Error('Select a route first.');
  }

  await ensureExpressRouteDocument(routeId);
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const hasOverrideFlights = Object.values(existing.dateOverrides || {}).some(
    (override) =>
      override &&
      override.mode !== 'cancelled' &&
      override.active !== false &&
      Array.isArray(override.departures) &&
      override.departures.length > 0
  );

  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      ...existing,
      bookingOpenDaysAhead: Number(form.bookingOpenDaysAhead?.value || 14),
      bookingCloseMinutesBefore: Number(form.bookingCloseMinutesBefore?.value || 120),
      airportHandoffMinutesBefore: Number(form.airportHandoffMinutesBefore?.value || 90),
      firstMileBufferMinutes: Number(form.firstMileBufferMinutes?.value || 90),
      arrivalOffsetMinutes: Number(form.arrivalOffsetMinutes?.value || 30),
      // Weekly template is retired — schedules are per calendar day only.
      departures: [],
      scheduleConfigured: hasOverrideFlights || existing.scheduleConfigured === true,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

async function saveExpressDayScheduleFromForm(form) {
  const routeId = safeText(form.routeId?.value);
  const isoDate = safeText(
    form.querySelector('[data-express-schedule-date]')?.value,
    safeText(form.isoDate?.value, getExpressScheduleDateValue())
  );
  state.selectedExpressScheduleDate = isoDate;
  const pendingTime = safeText(form.newDepartureTime?.value);
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  let departures = Array.isArray(existing.dateOverrides?.[isoDate]?.departures)
    ? existing.dateOverrides[isoDate].departures.filter((departure) => departure.active !== false)
    : [];
  if (/^\d{2}:\d{2}$/.test(pendingTime)) {
    const id = `d${pendingTime.replace(':', '')}`;
    if (!departures.some((item) => item.id === id || item.localTime === pendingTime)) {
      departures = [
        ...departures,
        {
          id,
          localTime: pendingTime,
          label: formatExpressClockLabel(pendingTime),
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          active: true,
        },
      ].sort((left, right) => String(left.localTime).localeCompare(String(right.localTime)));
    }
  }

  await saveExpressDateSchedule(routeId, isoDate, departures);
}

async function saveExpressDateSchedule(routeId, isoDate, departures) {
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Pick a valid date.');
  }

  const normalizedDepartures = (Array.isArray(departures) ? departures : [])
    .map((item, index) => normalizeExpressDeparture(item, index))
    .filter(Boolean)
    .sort((left, right) => String(left.localTime).localeCompare(String(right.localTime)));

  const dateOverrides = { ...(existing.dateOverrides || {}) };
  dateOverrides[isoDate] = {
    mode: 'custom',
    active: true,
    departures: normalizedDepartures,
    updatedAt: serverTimestamp(),
    updatedBy: safeText(state.user?.email, 'admin'),
  };

  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      // Never keep a weekly template — only explicit calendar days are bookable.
      departures: [],
      dateOverrides,
      scheduleConfigured: Object.values(dateOverrides).some(
        (override) =>
          override &&
          override.mode !== 'cancelled' &&
          override.active !== false &&
          Array.isArray(override.departures) &&
          override.departures.length > 0
      ),
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

async function clearExpressDateOverride(routeId, isoDate) {
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const dateOverrides = { ...(existing.dateOverrides || {}) };
  delete dateOverrides[isoDate];

  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      dateOverrides,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

async function cancelExpressDate(routeId, isoDate) {
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const dateOverrides = { ...(existing.dateOverrides || {}) };
  dateOverrides[isoDate] = {
    mode: 'cancelled',
    active: false,
    departures: [],
    updatedAt: serverTimestamp(),
    updatedBy: safeText(state.user?.email, 'admin'),
  };

  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      dateOverrides,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

async function addExpressDayDeparture(routeId, isoDate, localTime) {
  const normalizedTime = safeText(localTime);
  if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
    throw new Error('Enter a valid time.');
  }

  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const current = resolveExpressDayOverrideDepartures(existing, isoDate);
  const departures = [...current];
  const id = `d${normalizedTime.replace(':', '')}`;

  if (departures.some((item) => item.id === id || item.localTime === normalizedTime)) {
    throw new Error('That departure time already exists for this day.');
  }

  departures.push({
    id,
    localTime: normalizedTime,
    label: formatExpressClockLabel(normalizedTime),
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    active: true,
  });

  await saveExpressDateSchedule(routeId, isoDate, departures);
}

async function removeExpressDayDeparture(routeId, isoDate, departureId) {
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const current = resolveExpressDayOverrideDepartures(existing, isoDate);
  const departures = current.filter((item) => item.id !== departureId);
  await saveExpressDateSchedule(routeId, isoDate, departures);
}

async function addExpressDeparture(routeId, localTime) {
  const normalizedTime = safeText(localTime);
  if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
    throw new Error('Enter a valid time.');
  }

  await ensureExpressRouteDocument(routeId);
  const existing = getExpressRouteRecord(routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const departures = Array.isArray(existing.departures) ? [...existing.departures] : [];
  const id = `d${normalizedTime.replace(':', '')}`;
  if (departures.some((item) => item.id === id || item.localTime === normalizedTime)) {
    throw new Error('That departure time already exists.');
  }

  departures.push({
    id,
    localTime: normalizedTime,
    label: formatExpressClockLabel(normalizedTime),
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    active: true,
  });
  departures.sort((left, right) => String(left.localTime).localeCompare(String(right.localTime)));

  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      ...existing,
      departures,
      scheduleConfigured: departures.length > 0,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

async function clearAllLegacyExpressSchedules() {
  const snapshot = await getDocs(col.outsideExpressRoutes);
  if (!snapshot.docs.length) {
    return 0;
  }
  const batch = writeBatch(db);
  const actor = safeText(state.user?.email, 'admin');
  snapshot.docs.forEach((item) => {
    batch.set(
      doc(col.outsideExpressRoutes, item.id),
      {
        departures: [],
        dateOverrides: {},
        scheduleConfigured: false,
        updatedAt: serverTimestamp(),
        updatedBy: actor,
      },
      { merge: true }
    );
  });
  await batch.commit();
  return snapshot.docs.length;
}

async function removeExpressDeparture(routeId, departureId) {
  const existing = getSortedOutsideExpressRoutes().find((route) => route.id === routeId);
  if (!existing) {
    throw new Error('Route not found.');
  }

  const departures = (existing.departures || []).filter((item) => item.id !== departureId);
  await setDoc(
    doc(col.outsideExpressRoutes, routeId),
    {
      departures,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
}

function renderAirTransport() {
  const section = getOrCreateSection('airTransport');
  const cities = getSortedOutsideCities();
  const globalOn = state.outsideParcelConfig?.expressEnabledGlobally !== false;
  if (!state.selectedExpressScheduleDate) {
    state.selectedExpressScheduleDate = getExpressTodayIso();
  }

  section.innerHTML = `
    <div class="settings-stack">
      <article class="card">
        <div class="card-head">
          <div>
            <h3>Express service</h3>
            <p class="muted">Washe au zima Express kwa mkoa au kwa nchi nzima. Basi inaendelea kawaida.</p>
          </div>
          ${pill(globalOn ? 'Global ON' : 'Global OFF', globalOn ? 'success' : 'warning')}
        </div>

        <div class="air-simple-block">
          <div class="air-simple-row">
            <div>
              <strong>All regions</strong>
              <p class="muted">Disable or enable Express everywhere</p>
            </div>
            <button
              class="btn ${globalOn ? 'soft' : 'primary'}"
              type="button"
              data-action="${globalOn ? 'air-global-off' : 'air-global-on'}">
              ${globalOn ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      </article>

      ${renderExpressRouteScheduleCard()}

      <article class="card">
        <div class="card-head">
          <div>
            <h3>Ratiba kwa mteja</h3>
            <p class="muted">APK inaonyesha ndege tu ukishaweka ratiba na kubofya Save. Ratiba za zamani (mfano) zinaweza kubaki Firestore — futa hapa chini.</p>
          </div>
          <div class="admin-inline-actions">
            <button class="btn soft" type="button" data-action="clear-legacy-express-schedules">Futa ratiba zote za ndege</button>
          </div>
        </div>
        <p class="muted" style="padding:0 20px 16px;">Baada ya kufuta, weka ratiba mpya kwa kila route. APK mpya inahitajika ikiwa bado unaona ndege za zamani (build ya zamani).</p>
      </article>

      <article class="card">
        <div class="card-head">
          <div>
            <h3>Regions</h3>
            <p class="muted">Mikoa inayopokea Express na vituo vyake.</p>
          </div>
          <div class="admin-inline-actions">
            <button class="btn soft" data-action="seed-outside-cities" type="button">Sync</button>
            <button class="btn soft" data-action="add-outside-city" type="button">Add</button>
          </div>
        </div>
        ${
          state.loading.outsideCities
            ? emptyState('Loading regions...')
            : cities.length
              ? `<div class="air-simple-list">
                  ${cities
                    .map((city) => {
                      const expressOn = city.expressEnabled !== false;
                      return `
                        <div class="air-simple-row">
                          <div>
                            <strong>${escapeHtml(city.label || city.key)}</strong>
                            <p class="muted">${expressOn ? 'Express active' : 'Express disabled'}</p>
                          </div>
                          <button
                            class="btn ${expressOn ? 'soft' : 'primary'}"
                            type="button"
                            data-action="${expressOn ? 'air-disable-city' : 'air-enable-city'}"
                            data-city-key="${escapeHtml(city.key)}">
                            ${expressOn ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      `;
                    })
                    .join('')}
                </div>`
              : emptyState('No regions yet. Press Sync.')
        }
      </article>
    </div>
  `;
}

function openAddOutsideCityModal() {
  openModal({
    title: 'Add destination region',
    eyebrow: 'Outside parcels',
    body: `
      <form data-form="create-outside-city" class="form-grid">
        <div class="field">
          <label>Region name</label>
          <input name="label" required placeholder="Dodoma" />
        </div>
        <div class="field">
          <label>Airport name</label>
          <input name="airportLabel" required placeholder="Dodoma Airport" />
        </div>
        <div class="field">
          <label>Bus stand name</label>
          <input name="standLabel" required placeholder="Dodoma Bus Stand" />
        </div>
        <div class="field">
          <label>Latitude (optional)</label>
          <input name="latitude" type="number" step="any" placeholder="-6.1630" />
        </div>
        <div class="field">
          <label>Longitude (optional)</label>
          <input name="longitude" type="number" step="any" placeholder="35.7516" />
        </div>
        <div class="setting-row" style="grid-column:1/-1;">
          <div>
            <strong>Express active today</strong>
            <p class="muted">Customers can book air transport for this region.</p>
          </div>
          <input type="checkbox" name="expressEnabled" checked />
        </div>
        <div class="admin-inline-actions" style="grid-column:1/-1;">
          <button class="btn primary" type="submit">Save region</button>
        </div>
      </form>
    `,
  });
}

async function seedOutsideCities(force = false) {
  const existingSnapshot = await getDocs(col.outsideCities);
  if (!force && !existingSnapshot.empty) {
    setFeedback('Regions already exist. Use Add region for new destinations.', 'info');
    return;
  }

  const existingKeys = new Set(existingSnapshot.docs.map((item) => item.id));
  const batch = writeBatch(db);
  const actor = safeText(state.user?.email, 'admin');

  OUTSIDE_CITY_SEED.forEach((city) => {
    const payload = {
      ...city,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    };

    if (!existingKeys.has(city.key)) {
      payload.expressEnabled = true;
      payload.active = true;
      payload.createdAt = serverTimestamp();
    }

    batch.set(doc(col.outsideCities, city.key), payload, { merge: true });
  });

  batch.set(
    outsideParcelConfigRef,
    {
      expressEnabledGlobally: state.outsideParcelConfig?.expressEnabledGlobally !== false,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true }
  );
  await batch.commit();
  setFeedback('Default outside regions synced to Firestore.', 'success');
}

async function setOutsideExpressGlobal(enabled) {
  await setDoc(
    outsideParcelConfigRef,
    {
      expressEnabledGlobally: enabled === true,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
  setFeedback(enabled ? 'Air transport enabled globally.' : 'Air transport disabled globally.', 'success');
}

async function setOutsideCityExpressEnabled(cityKey, enabled) {
  await setDoc(
    doc(col.outsideCities, cityKey),
    {
      expressEnabled: enabled === true,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
  setFeedback(`${cityKey}: Express ${enabled ? 'on' : 'off'}.`, 'success');
}

async function setOutsideCityActive(cityKey, enabled) {
  await setDoc(
    doc(col.outsideCities, cityKey),
    {
      active: enabled === true,
      updatedAt: serverTimestamp(),
      updatedBy: safeText(state.user?.email, 'admin'),
    },
    { merge: true }
  );
  setFeedback(`${cityKey}: region ${enabled ? 'listed' : 'hidden'}.`, 'success');
}

async function createOutsideCityFromForm(form) {
  const label = safeText(form.label?.value);
  if (!label) {
    throw new Error('Enter a region name.');
  }

  const key = slugifyOutsideCityKey(label);
  if (!key) {
    throw new Error('Could not build a region key from that name.');
  }

  const existing = await getDoc(doc(col.outsideCities, key));
  if (existing.exists()) {
    throw new Error('That region already exists. Pick another name or edit the existing one.');
  }

  const latitude = Number(form.latitude?.value);
  const longitude = Number(form.longitude?.value);
  const centerPoint = {
    latitude: Number.isFinite(latitude) ? latitude : -6.369,
    longitude: Number.isFinite(longitude) ? longitude : 34.8888,
  };
  const airportLabel = safeText(form.airportLabel?.value, `${label} Airport`);
  const standLabel = safeText(form.standLabel?.value, `${label} Bus Stand`);
  const expressEnabled = form.expressEnabled?.checked !== false;
  const sortOrder = (getSortedOutsideCities().length + 1) * 10;
  const actor = safeText(state.user?.email, 'admin');

  await setDoc(doc(col.outsideCities, key), {
    key,
    label,
    centerPoint,
    sortOrder,
    expressEnabled,
    active: true,
    stands: [
      {
        id: `${key}-stand`,
        label: standLabel,
        query: `${standLabel}, ${label}, Tanzania`,
        fallbackPoint: centerPoint,
      },
    ],
    airports: [
      {
        id: `${key}-airport`,
        label: airportLabel,
        query: `${airportLabel}, ${label}, Tanzania`,
        fallbackPoint: centerPoint,
      },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor,
  });
}

function getNinunulieOrders() {
  return sortByRecent(state.orders.filter((order) => isNinunulieOrder(order)));
}

function renderNinunuliePhotoThumbs(order) {
  const urls = Array.isArray(order.ninunuliePhotoUrls)
    ? order.ninunuliePhotoUrls.map((url) => safeText(url)).filter(Boolean)
    : [];
  if (!urls.length) {
    return `<p class="muted">Hakuna picha zilizotumwa.</p>`;
  }
  return `
    <div class="outside-section-head" style="margin-bottom:8px;">
      <strong>Picha za mteja (${urls.length})</strong>
      <p class="muted">Bonyeza kufungua ukubwa kamili.</p>
    </div>
    <div class="ninunulie-photo-grid">
      ${urls
        .map(
          (url, index) => `
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="ninunulie-photo-thumb" title="Picha ${index + 1}">
          <img src="${escapeHtml(url)}" alt="Bidhaa ${index + 1}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mini',textContent:'Picha haikufunguka'}))" />
        </a>
      `
        )
        .join('')}
    </div>
  `;
}

const NINUNULIE_PHASES = [
  { id: 'purchased', title: 'Imenunuliwa', hint: 'Bidhaa imenunuliwa dukani' },
  { id: 'shipping', title: 'Inasafirishwa', hint: 'Mzigo unaelekea kwa mteja' },
  { id: 'completed', title: 'Imekamilika', hint: 'Mzigo umekabidhiwa' },
];

function isNinunuliePurchased(order) {
  return Boolean(order?.ninunuliePurchased) || Boolean(toMillis(order?.ninunuliePurchasedAt));
}

/** Simple ops phase: new | purchased | shipping | completed | denied */
function getNinunuliePhase(order) {
  const status = getOrderStatus(order);
  if (status === 'cancelled') return 'denied';
  if (status === 'delivered') return 'completed';
  if (status === 'in_transit') return 'shipping';
  if (isNinunuliePurchased(order)) return 'purchased';
  return 'new';
}

function getNinunuliePhaseLabel(phase) {
  return (
    {
      new: 'Mpya',
      purchased: 'Imenunuliwa',
      shipping: 'Inasafirishwa',
      completed: 'Imekamilika',
      denied: 'Imekataliwa',
    }[phase] || 'Mpya'
  );
}

function getNinunulieStatusLabel(_status, order) {
  return getNinunuliePhaseLabel(getNinunuliePhase(order));
}

function getNinunulieStepIndex(order) {
  const phase = getNinunuliePhase(order);
  if (phase === 'denied') return -1;
  if (phase === 'completed') return 2;
  if (phase === 'shipping') return 1;
  if (phase === 'purchased') return 0;
  return -1;
}

function getNinunulieNextAction(order) {
  const phase = getNinunuliePhase(order);
  if (phase === 'denied') {
    return { title: 'Imekataliwa', detail: 'Oda imefungwa.', tone: 'danger', action: null };
  }
  if (phase === 'completed') {
    return { title: 'Imekamilika', detail: 'Mzigo umekabidhiwa kwa mteja.', tone: 'success', action: null };
  }
  if (phase === 'new') {
    return {
      title: 'Imenunuliwa',
      detail: 'Baada ya kununua dukani, weka bei na thibitisha — mteja atapata notification.',
      tone: 'primary',
      action: null,
      needsPurchase: true,
    };
  }
  if (phase === 'purchased') {
    return {
      title: 'Inasafirishwa',
      detail: 'Anza usafirishaji kwa mteja.',
      tone: 'primary',
      action: 'in_transit',
      actionLabel: 'Inasafirishwa',
    };
  }
  return {
    title: 'Imekamilika',
    detail: 'Mzigo umefika? Thibitisha ukabidhaji.',
    tone: 'primary',
    action: 'delivered',
    actionLabel: 'Imekamilika',
  };
}

function renderNinunulieWorkflowStepper(order) {
  const phase = getNinunuliePhase(order);
  if (phase === 'denied') {
    return `
      <div class="outside-workflow">
        <div class="outside-workflow-step current">
          <div class="outside-workflow-dot">!</div>
          <div><strong>Imekataliwa</strong><p class="muted">Oda imefungwa</p></div>
        </div>
      </div>
    `;
  }

  const currentIndex = getNinunulieStepIndex(order);
  return `
    <div class="outside-workflow ninunulie-workflow ninunulie-workflow-simple">
      ${NINUNULIE_PHASES.map((step, index) => {
        const stateClass =
          currentIndex < 0
            ? 'upcoming'
            : index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'upcoming';
        return `
          <div class="outside-workflow-step ${stateClass}">
            <div class="outside-workflow-dot">${index < currentIndex ? '✓' : index + 1}</div>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p class="muted">${escapeHtml(step.hint)}</p>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderNinunuliePurchasePanel(order) {
  const phase = getNinunuliePhase(order);

  if (phase === 'denied' || phase === 'completed') {
    return '';
  }

  if (isNinunuliePurchased(order)) {
    return `
      <div class="outside-section" id="ninunulie-purchase">
        <div class="outside-section-head">
          <strong>Imenunuliwa</strong>
          <p class="muted">Mteja alipata notification ya ununuzi.</p>
        </div>
        <div class="outside-fact-grid">
          ${renderOutsideFact('Bei', getNinunuliePurchaseAmount(order) > 0 ? formatMoney(getNinunuliePurchaseAmount(order)) : '—')}
          ${renderOutsideFact('Wakati', formatDateTime(order.ninunuliePurchasedAt))}
          ${renderOutsideFact('Maelezo', safeText(order.ninunuliePurchaseNote, '—'))}
        </div>
      </div>
    `;
  }

  return `
    <div class="outside-section ninunulie-purchase-panel" id="ninunulie-purchase">
      <div class="outside-section-head">
        <strong>1 · Imenunuliwa</strong>
        <p class="muted">Thibitisha ununuzi — notification inaenda kwa mteja mara moja.</p>
      </div>
      <form class="form-grid" data-form="ninunulie-mark-purchased">
        <input type="hidden" name="orderId" value="${escapeHtml(order.id)}" />
        <div class="field">
          <label>Bei ya ununuzi (TZS)</label>
          <input name="purchaseAmount" type="number" min="0" step="100" placeholder="${escapeHtml(safeText(order.ninunulieExpectedPriceTzs, '45000'))}" />
        </div>
        <div class="field span-2">
          <label>Ujumbe kwa mteja (si lazima)</label>
          <input name="note" placeholder="Bidhaa imenunuliwa, tunaendelea na usafirishaji" />
        </div>
        <div class="span-2">
          <button class="btn primary" type="submit">Imenunuliwa · notify mteja</button>
        </div>
      </form>
    </div>
  `;
}

function renderNinunulieStatusActions(order) {
  const next = getNinunulieNextAction(order);
  const phase = getNinunuliePhase(order);
  const buttons = [];

  if (next.action) {
    buttons.push(
      `<button class="btn primary" type="button" data-update-status="${escapeHtml(next.action)}" data-order-id="${escapeHtml(order.id)}">${escapeHtml(next.actionLabel || next.title)}</button>`
    );
  }

  if (phase === 'new' || phase === 'purchased' || phase === 'shipping') {
    buttons.push(
      `<button class="btn soft" type="button" data-update-status="cancelled" data-order-id="${escapeHtml(order.id)}">Deny oda</button>`
    );
  }

  return buttons.join('') || `<span class="mini">Hakuna action</span>`;
}

async function markNinunuliePurchased(orderId, options = {}) {
  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order not found.');
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (!isNinunulieOrder(order)) {
    throw new Error('Order is not a Ninunulie request.');
  }
  if (getOrderStatus(order) === 'cancelled' || getOrderStatus(order) === 'delivered') {
    throw new Error('Cannot mark a closed order as purchased.');
  }

  const amount = parseAmount(options.amount);
  const note = safeText(options.note);
  const actor = safeText(state.user?.email, 'admin');
  const nextStatus = 'driver_at_pickup';

  await updateDoc(orderRef(orderId), compact({
    ninunuliePurchased: true,
    ninunuliePurchasedAt: serverTimestamp(),
    ninunuliePurchasedBy: actor,
    ninunuliePurchaseAmountTzs: amount > 0 ? String(Math.round(amount)) : deleteField(),
    ninunuliePurchaseNote: note || deleteField(),
    assignmentMode: 'ops_desk',
    driverSearchStatus: 'ops_desk',
    status: nextStatus,
    updatedAt: serverTimestamp(),
  }));

  const userId = order.userId || order.customerId;
  if (userId && !normalize(userId).startsWith('manual:')) {
    const amountLabel = amount > 0 ? formatMoney(amount) : '';
    await setDoc(notificationRef(), compact({
      userId,
      orderId: order.id,
      orderNumber: getOrderNumber(order),
      orderStatus: nextStatus,
      serviceLabel: 'Ninunulie',
      flow: 'ninunulie',
      title: 'Bidhaa imenunuliwa',
      message: amountLabel
        ? `${getOrderNumber(order)} · imenunuliwa Kariakoo (${amountLabel}).${note ? ` ${note}` : ''}`
        : `${getOrderNumber(order)} · imenunuliwa Kariakoo.${note ? ` ${note}` : ''}`,
      type: 'order_status',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  return { ...order, status: nextStatus, ninunuliePurchased: true };
}

function renderNinunulieDetail(order) {
  if (!order) {
    return `
      <div class="ninunulie-detail-empty">
        <strong>Chagua oda</strong>
        <p class="muted">Chagua oda kushoto — status ni Imenunuliwa → Inasafirishwa → Imekamilika.</p>
      </div>
    `;
  }

  const productUrl = safeText(order.ninunulieProductUrl);
  const sellerPhone = safeText(order.ninunulieSellerPhone);
  const customerPhone = safeText(order.customerPhone || order.recipientPhone);
  const phase = getNinunuliePhase(order);
  const whatsappPhone = safeText(order.ninunulieWhatsAppPhone, '0785019093');
  const next = getNinunulieNextAction(order);
  const itemTitle = safeText(order.ninunulieItemTitle, 'Bidhaa');
  const pillTone =
    phase === 'completed' ? 'success' : phase === 'denied' ? 'danger' : phase === 'new' ? 'warning' : 'info';

  return `
    <div class="outside-detail-stack ninunulie-detail-stack">
      <div class="outside-order-summary">
        <div>
          <span class="outside-fact-label">Oda</span>
          <strong>${escapeHtml(getOrderNumber(order))}</strong>
          <span class="mini">${escapeHtml(formatDateTime(order.createdAt))}</span>
        </div>
        <div>
          <span class="outside-fact-label">Bidhaa</span>
          <strong>${escapeHtml(itemTitle)}</strong>
          <span class="mini">${escapeHtml(safeText(order.ninunulieSellerRegion, 'Kariakoo'))} · ${escapeHtml(whatsappPhone)}</span>
        </div>
        <div>
          <span class="outside-fact-label">Hali</span>
          ${pill(getNinunuliePhaseLabel(phase), pillTone)}
        </div>
      </div>

      <div class="outside-section">
        <div class="outside-section-head">
          <strong>Status</strong>
          <p class="muted">Hatua 3 tu · au Deny oda.</p>
        </div>
        ${renderNinunulieWorkflowStepper(order)}
      </div>

      <div class="outside-next-card ${escapeHtml(next.tone)} outside-next-card-hero">
        <div>
          <span class="outside-fact-label">Hatua inayofuata</span>
          <strong>${escapeHtml(next.title)}</strong>
          <p class="muted">${escapeHtml(next.detail)}</p>
        </div>
        <div class="admin-inline-actions">
          ${renderNinunulieStatusActions(order)}
        </div>
      </div>

      ${renderNinunuliePurchasePanel(order)}

      <div class="outside-section">
        <div class="outside-section-head">
          <strong>Taarifa</strong>
          <p class="muted">Bidhaa, duka, na mteja.</p>
        </div>
        <div class="outside-fact-grid">
          ${renderOutsideFact('Bidhaa', itemTitle)}
          ${renderOutsideFact('Bei iliyotarajiwa', safeText(order.ninunulieExpectedPriceTzs, '—'))}
          ${renderOutsideFact('Duka', safeText(order.ninunulieSellerName))}
          ${renderOutsideFact('Simu duka', sellerPhone || '—')}
          ${renderOutsideFact('Mteja', getCustomerName(order))}
          ${renderOutsideFact('Simu mteja', customerPhone || '—')}
          ${renderOutsideFact('Ukabidhaji', getDropoff(order))}
          ${renderOutsideFact('Ratiba', getOrderScheduleLabel(order))}
        </div>
        ${
          productUrl
            ? `<p class="mini" style="margin-top:10px;"><a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">Fungua link ya bidhaa</a></p>`
            : ''
        }
        ${
          [order.ninunulieItemDescription, order.ninunulieSellerNotes, order.ninunulieCustomerNotes].some((v) => safeText(v))
            ? `<div class="detail-list" style="margin-top:10px;">
                ${optionalDetailRow('Maelezo ya bidhaa', order.ninunulieItemDescription)}
                ${optionalDetailRow('Maelezo duka', order.ninunulieSellerNotes)}
                ${optionalDetailRow('Maelezo mteja', order.ninunulieCustomerNotes)}
              </div>`
            : ''
        }
        ${renderNinunuliePhotoThumbs(order)}
      </div>

      <div class="outside-section">
        <form data-form="ninunulie-ops-notes" data-order-id="${escapeHtml(order.id)}">
          <div class="field">
            <label>Ops notes</label>
            <textarea name="opsNotes" rows="2" placeholder="Follow-up…">${escapeHtml(safeText(order.ninunulieOpsNotes))}</textarea>
          </div>
          <button class="btn soft" type="submit">Hifadhi notes</button>
        </form>
      </div>
    </div>
  `;
}

function renderNinunulie() {
  const section = getOrCreateSection('ninunulie');
  const allOrders = getNinunulieOrders();
  const filter = state.ninunulieFilter || 'open';
  const orders = allOrders.filter((order) => {
    const phase = getNinunuliePhase(order);
    if (filter === 'open') return phase === 'new';
    if (filter === 'purchased') return phase === 'purchased';
    if (filter === 'shipping') return phase === 'shipping';
    if (filter === 'done') return phase === 'completed' || phase === 'denied';
    return true;
  });
  const selected =
    orders.find((order) => order.id === state.ninunulieSelectedId)
    || allOrders.find((order) => order.id === state.ninunulieSelectedId)
    || orders[0]
    || allOrders[0]
    || null;

  if (selected && state.ninunulieSelectedId !== selected.id) {
    state.ninunulieSelectedId = selected.id;
  }

  const counts = {
    open: allOrders.filter((o) => getNinunuliePhase(o) === 'new').length,
    purchased: allOrders.filter((o) => getNinunuliePhase(o) === 'purchased').length,
    shipping: allOrders.filter((o) => getNinunuliePhase(o) === 'shipping').length,
    done: allOrders.filter((o) => ['completed', 'denied'].includes(getNinunuliePhase(o))).length,
  };
  const stats = getNinunulieFinanceStats();
  const filterButtons = [
    ['open', 'Mpya', counts.open],
    ['purchased', 'Imenunuliwa', counts.purchased],
    ['shipping', 'Inasafirishwa', counts.shipping],
    ['done', 'Imekamilika / Deny', counts.done],
    ['all', 'Zote', allOrders.length],
  ];

  section.innerHTML = `
    <div class="page-panel ninunulie-page">
      <div class="outside-howto-card">
        <div>
          <strong>Buy for me · Kariakoo</strong>
          <p class="muted">Status tatu tu: Imenunuliwa → Inasafirishwa → Imekamilika. Unaweza pia Deny oda.</p>
        </div>
        <div class="outside-howto-steps">
          <span>1 Imenunuliwa</span>
          <span>2 Inasafirishwa</span>
          <span>3 Imekamilika</span>
        </div>
      </div>

      <div class="grid kpi">
        ${kpi('Mpya', String(counts.open), 'Zinasubiri ununuzi')}
        ${kpi('Imenunuliwa', String(counts.purchased), 'Zimenunuliwa dukani')}
        ${kpi('Inasafirishwa', String(counts.shipping), 'Njiani kwa mteja')}
        ${kpi('Purchase volume', formatMoney(stats.purchaseVolume), 'Customer → seller')}
      </div>

      <div class="grid two ninunulie-workspace">
        <article class="card ninunulie-list-card">
          <div class="card-head">
            <div>
              <h3>Orodha</h3>
              <p class="muted">${orders.length} zinazoonekana · WhatsApp 0785019093</p>
            </div>
          </div>
          <div class="table-toolbar">
            <div class="filter-bar">
              ${filterButtons
                .map(
                  ([key, label, count]) => `
                <button class="filter-chip ${filter === key ? 'active' : ''}" type="button" data-ninunulie-filter="${escapeHtml(key)}">
                  ${escapeHtml(label)} (${count})
                </button>
              `
                )
                .join('')}
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Oda</th>
                  <th>Bidhaa</th>
                  <th>Mteja</th>
                  <th>Hali</th>
                </tr>
              </thead>
              <tbody>
                ${
                  orders.length
                    ? orders
                        .map((order) => {
                          const active = selected && selected.id === order.id;
                          const phase = getNinunuliePhase(order);
                          const tone =
                            phase === 'completed'
                              ? 'success'
                              : phase === 'denied'
                                ? 'danger'
                                : phase === 'new'
                                  ? 'warning'
                                  : 'info';
                          return `
                            <tr class="ops-order-row${active ? ' selected' : ''}" data-ninunulie-select="${escapeHtml(order.id)}">
                              <td>
                                <strong>${escapeHtml(getOrderNumber(order))}</strong>
                                <span class="mini">${escapeHtml(formatDateTime(order.createdAt))}</span>
                              </td>
                              <td>
                                <strong>${escapeHtml(safeText(order.ninunulieItemTitle, 'Bidhaa'))}</strong>
                                <span class="mini">${escapeHtml(safeText(order.ninunulieSellerRegion, 'Kariakoo'))}</span>
                              </td>
                              <td>
                                <strong>${escapeHtml(getCustomerName(order))}</strong>
                                <span class="mini">${escapeHtml(getCustomerContact(order))}</span>
                              </td>
                              <td>${pill(getNinunuliePhaseLabel(phase), tone)}</td>
                            </tr>
                          `;
                        })
                        .join('')
                    : `<tr><td colspan="4">${emptyState('Hakuna oda kwenye filter hii.')}</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </article>

        <article class="card ninunulie-detail-card">
          <div class="card-head">
            <div>
              <h3>Oda</h3>
              <p class="muted">${selected ? escapeHtml(getOrderNumber(selected)) : 'Hakuna iliyochaguliwa'}</p>
            </div>
          </div>
          <div class="ninunulie-detail-body">
            ${renderNinunulieDetail(selected)}
          </div>
        </article>
      </div>
    </div>
  `;
}

function renderCurrentPage() {
  if (state.currentPage === 'dashboard') renderDashboard();
  if (state.currentPage === 'orders') renderOrders();
  if (state.currentPage === 'dispatch') renderDispatch();
  if (state.currentPage === 'services') renderServices();
  if (state.currentPage === 'customers') renderCustomers();
  if (state.currentPage === 'drivers') renderDrivers();
  if (state.currentPage === 'carrierAgents') renderCarrierAgents();
  if (state.currentPage === 'carrierCash') renderCarrierCash();
  if (state.currentPage === 'payments') renderPayments();
  if (state.currentPage === 'finance') renderFinance();
  if (state.currentPage === 'history') renderHistory();
  if (state.currentPage === 'data') renderData();
  if (state.currentPage === 'reports') renderReports();
  if (state.currentPage === 'settings') renderSettings();
  if (state.currentPage === 'airTransport') renderAirTransport();
  if (state.currentPage === 'otherRegions') renderOtherRegions();
  if (state.currentPage === 'ninunulie') renderNinunulie();
  if (state.currentPage === 'shipment') renderShipmentPage();
  if (OPS_QUEUE_PAGES[state.currentPage]) renderOpsQueuePage(state.currentPage);
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

function updateSystemStatus() {
  const syncing = Object.values(state.loading).some(Boolean);
  const paymentsOffline = state.apiHealth && state.apiHealth.ok === false;

  let statusText = 'Connected';
  let statusClass = 'pill success';
  if (!state.user) {
    statusText = 'Signed out';
    statusClass = 'pill neutral';
  } else if (syncing) {
    statusText = 'Syncing...';
    statusClass = 'pill warning';
  } else if (paymentsOffline) {
    statusText = 'Payments offline';
    statusClass = 'pill danger';
  } else if (state.apiHealth?.ok) {
    statusText = 'Live';
    statusClass = 'pill success';
  }

  const sidebarStatus = $('sidebarSystemStatus');
  if (sidebarStatus) {
    sidebarStatus.textContent = statusText;
    sidebarStatus.className = statusClass;
  }

  const topbarStatus = $('topbarStatusPill') || document.querySelector('.topbar .pill.success, .topbar .pill.warning, .topbar .pill.danger, .topbar .pill.neutral');
  if (topbarStatus && topbarStatus.id !== 'sidebarSystemStatus') {
    topbarStatus.textContent = statusText;
    topbarStatus.className = statusClass;
  }

  const adminLabel = state.user ? state.user.displayName || state.user.email || 'Admin' : 'Access locked';
  const adminPill = $('topbarAdminPill') || document.querySelector('.topbar .pill.soft, .topbar .pill.neutral');
  if (adminPill && adminPill.id !== 'topbarStatusPill') {
    adminPill.textContent = adminLabel;
  }

  const profileName = $('sidebarProfileName');
  const profileEmail = $('sidebarProfileEmail');
  const profileAvatar = $('sidebarAvatar');
  if (profileName) {
    profileName.textContent = state.user?.displayName || state.user?.email?.split('@')[0] || 'Admin';
  }
  if (profileEmail) {
    profileEmail.textContent = state.user?.email || 'Signed out';
  }
  if (profileAvatar) {
    const seed = safeText(state.user?.displayName || state.user?.email, 'AD');
    profileAvatar.textContent = seed
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'AD';
  }
}

function updateTopbarBadges() {
  updateSystemStatus();
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

  if (isNinunulieOrder(order)) {
    buttons.push(`<button class="btn soft" type="button" data-page-jump="ninunulie" data-ninunulie-select="${escapeHtml(order.id)}">Open Buy for me</button>`);
    const phase = getNinunuliePhase(order);
    if (phase === 'purchased') {
      buttons.push(`<button class="btn primary" data-update-status="in_transit" data-order-id="${escapeHtml(order.id)}">Inasafirishwa</button>`);
    }
    if (phase === 'shipping') {
      buttons.push(`<button class="btn primary" data-update-status="delivered" data-order-id="${escapeHtml(order.id)}">Imekamilika</button>`);
    }
    if (phase === 'new' || phase === 'purchased' || phase === 'shipping') {
      buttons.push(`<button class="btn soft" data-update-status="cancelled" data-order-id="${escapeHtml(order.id)}">Deny oda</button>`);
    }
  } else if (status === 'pending_assignment') {
    buttons.push(`<button class="btn primary" data-page-jump="dispatch">Open dispatch board</button>`);
  }
  if (!isNinunulieOrder(order) && status !== 'pending_assignment') {
    buttons.push(`<button class="btn soft" data-update-status="pending_assignment" data-order-id="${escapeHtml(order.id)}">Unassign</button>`);
  }
  if (!isNinunulieOrder(order) && status === 'driver_assigned') {
    buttons.push(`<button class="btn primary" data-update-status="driver_at_pickup" data-order-id="${escapeHtml(order.id)}">Mark at pickup</button>`);
  }
  if (!isNinunulieOrder(order) && status === 'driver_at_pickup') {
    buttons.push(`<button class="btn primary" data-update-status="in_transit" data-order-id="${escapeHtml(order.id)}">Start transit</button>`);
  }
  if (!isNinunulieOrder(order) && status === 'in_transit') {
    buttons.push(`<button class="btn primary" data-update-status="delivered" data-order-id="${escapeHtml(order.id)}">Mark delivered</button>`);
  }
  if (!isNinunulieOrder(order) && !HISTORY_STATUSES.includes(status)) {
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

function formatAuthError(error) {
  const code = normalize(error?.code || '');
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email au password si sahihi. Jaribu tena au tumia "Reset password".';
  }
  if (code === 'auth/too-many-requests') {
    return 'Majaribio mengi. Subiri kidogo kisha jaribu tena.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Mtandao una tatizo. Angalia internet yako kisha jaribu tena.';
  }
  return error?.message || 'Authentication failed.';
}

function setAuthFeedback(message, type = 'error') {
  const target = $('authFeedback');
  if (!target) {
    setFeedback(message, type);
    return;
  }

  target.textContent = message;
  target.className = `auth-feedback ${type}`;
  target.hidden = !message;
}

function activateAdminSession(firebaseUser) {
  cleanupSubscriptions();
  state.firebaseUser = firebaseUser;
  state.user = firebaseUser;
  renderSession();
  subscribeLiveData();
  refreshApiHealth().catch(() => null);
  const hashed = location.hash.replace(/^#/, '');
  if (PAGE_META[hashed]) setPage(hashed);
}

function resetAdminData() {
  cleanupSubscriptions();
  state.orders = [];
  state.drivers = [];
  state.carriers = [];
  state.carrierShipments = [];
  state.carrierDecisions = [];
  state.carrierCashError = '';
  state.carrierDecisionsOk = false;
  state.users = [];
  state.paymentReviews = [];
  state.ussdPayments = [];
  state.activityEvents = [];
  state.outsideCities = [];
  state.outsideParcelConfig = { expressEnabledGlobally: true };
  state.loading = {
    orders: false,
    drivers: false,
    carriers: false,
    carrierShipments: false,
    carrierDecisions: false,
    users: false,
    paymentReviews: false,
    activityEvents: false,
    outsideCities: false,
  };
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
  openShipmentPage(order.id);
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
    submit.textContent = 'Login';
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
      throw new Error(`Tumia admin email: ${ADMIN_ACCESS_EMAIL}`);
    }

    setBusy(true);
    setAuthFeedback('');
    const credential = await signInWithEmailAndPassword(auth, email, password);
    activateAdminSession(credential.user);
    setAuthFeedback('');
    setFeedback('Admin access opened.', 'success');
  } catch (error) {
    const message = formatAuthError(error);
    setAuthFeedback(message, 'error');
    setFeedback(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function handlePasswordReset() {
  const email = safeText(ui.emailInput?.value).toLowerCase();

  try {
    if (!email) {
      throw new Error('Weka admin email kwanza.');
    }

    if (!isAllowedAdminEmail(email)) {
      throw new Error(`Tumia admin email: ${ADMIN_ACCESS_EMAIL}`);
    }

    setBusy(true);
    await sendPasswordResetEmail(auth, email, {
      url: window.location.origin + window.location.pathname,
    });
    setAuthFeedback('Kiungo cha kubadilisha password kimetumwa kwenye email yako.', 'success');
    setFeedback('Password reset email sent.', 'success');
  } catch (error) {
    const message = formatAuthError(error);
    setAuthFeedback(message, 'error');
    setFeedback(message, 'error');
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
  state.dispatchMapMarkers.forEach((marker) => marker.setMap(null));
  state.dispatchMapMarkers = [];
  state.dispatchMap = null;
}

function subscribeLiveData() {
  cleanupSubscriptions();
  state.loading = {
    orders: true,
    drivers: true,
    carriers: true,
    carrierShipments: true,
    carrierDecisions: true,
    users: true,
    paymentReviews: true,
    activityEvents: true,
    outsideCities: true,
    outsideExpressRoutes: true,
    customerPresence: true,
  };
  let activeOrders = [];
  let recentOrders = [];
  let outsideActiveOrders = [];
  const orderStreamsReady = {
    active: false,
    recent: false,
    outside: false,
  };

  const applyOrderStreams = () => {
    const ordersById = new Map();
    [...recentOrders, ...activeOrders, ...outsideActiveOrders].forEach((order) => {
      ordersById.set(order.id, { ...(ordersById.get(order.id) || {}), ...order });
    });

    state.orders = sortByRecent([...ordersById.values()]);
    state.loading.orders = !(orderStreamsReady.active && orderStreamsReady.recent && orderStreamsReady.outside);
    scheduleRenderAll();
    scheduleAutoAssignment();
  };

  const activeOrdersQuery = query(col.orders, where('status', 'in', ACTIVE_STATUSES), limit(ADMIN_ACTIVE_ORDER_LIMIT));
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

  const outsideActiveQuery = query(
    col.orders,
    where('logisticsStatus', 'in', OUTSIDE_ACTIVE_LOGISTICS_STATUSES),
    limit(250)
  );

  const unsubOutsideOrders = onSnapshot(
    outsideActiveQuery,
    (snapshot) => {
      outsideActiveOrders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      orderStreamsReady.outside = true;
      applyOrderStreams();
    },
    (error) => {
      orderStreamsReady.outside = true;
      setFeedback(error.message || 'Could not sync inter-region shipments.', 'error');
      applyOrderStreams();
    }
  );

  let availableDrivers = [];
  let recentDrivers = [];
  let reviewDrivers = [];
  const driverStreamsReady = {
    available: false,
    recent: false,
    review: false,
  };

  const applyDriverStreams = () => {
    const driversById = new Map();
    [...recentDrivers, ...availableDrivers, ...reviewDrivers].forEach((driver) => {
      driversById.set(driver.id, { ...(driversById.get(driver.id) || {}), ...driver });
    });

    state.drivers = sortDrivers([...driversById.values()]);
    state.loading.drivers = !(driverStreamsReady.available && driverStreamsReady.recent && driverStreamsReady.review);
    scheduleRenderAll();
    scheduleAutoAssignment();
  };

  const unsubAvailableDrivers = onSnapshot(
    query(col.drivers, where('isAvailable', '==', true), limit(ADMIN_DRIVER_LIMIT)),
    (snapshot) => {
      availableDrivers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      driverStreamsReady.available = true;
      applyDriverStreams();
    },
    (error) => {
      driverStreamsReady.available = true;
      setFeedback(error.message || 'Could not sync available drivers.', 'error');
      applyDriverStreams();
    }
  );

  const unsubRecentDrivers = onSnapshot(
    query(col.drivers, orderBy('createdAt', 'desc'), limit(ADMIN_DRIVER_LIMIT)),
    (snapshot) => {
      recentDrivers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      driverStreamsReady.recent = true;
      applyDriverStreams();
    },
    (error) => {
      driverStreamsReady.recent = true;
      setFeedback(error.message || 'Could not sync recent drivers.', 'error');
      applyDriverStreams();
    }
  );

  const unsubReviewDrivers = onSnapshot(
    query(
      col.drivers,
      where('verificationStatus', 'in', ['pending_admin_verification', 'rejected']),
      limit(ADMIN_DRIVER_LIMIT)
    ),
    (snapshot) => {
      reviewDrivers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      driverStreamsReady.review = true;
      applyDriverStreams();
    },
    (error) => {
      driverStreamsReady.review = true;
      setFeedback(error.message || 'Could not sync drivers waiting for verification.', 'error');
      applyDriverStreams();
    }
  );

  const unsubCarriers = onSnapshot(
    col.carriers,
    (snapshot) => {
      state.carriers = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((left, right) => String(left.companyName || '').localeCompare(String(right.companyName || '')));
      state.loading.carriers = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.carriers = false;
      state.carriers = [];
      if (!/permission/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync cargo agents.', 'error');
      }
      scheduleRenderAll();
    }
  );

  let arrivedByStatus = [];
  let arrivedByStep = [];
  const shipmentReady = { status: false, step: false };
  let shipmentStatusError = '';
  let shipmentStepError = '';
  const applyCarrierShipments = () => {
    const ready = shipmentReady.status && shipmentReady.step;
    state.loading.carrierShipments = !ready;
    if (!ready) {
      scheduleRenderAll();
      return;
    }
    if (shipmentStatusError || shipmentStepError) {
      state.carrierCashError = shipmentStatusError || shipmentStepError;
      state.carrierShipments = [];
    } else {
      state.carrierCashError = '';
      const byId = new Map();
      for (const item of [...arrivedByStatus, ...arrivedByStep]) byId.set(item.id, item);
      state.carrierShipments = [...byId.values()];
    }
    scheduleRenderAll();
  };

  const unsubShipmentsByStatus = onSnapshot(
    query(collection(db, 'carrierShipments'), where('shipmentStatus', 'in', ['arrived', 'delivered'])),
    (snapshot) => {
      arrivedByStatus = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      shipmentReady.status = true;
      shipmentStatusError = '';
      applyCarrierShipments();
    },
    (error) => {
      shipmentReady.status = true;
      shipmentStatusError = error.message || 'Haikuweza kusoma ada.';
      arrivedByStatus = [];
      applyCarrierShipments();
    }
  );

  const unsubShipmentsByStep = onSnapshot(
    query(collection(db, 'carrierShipments'), where('trackStep', 'in', ['arrived', 'handed'])),
    (snapshot) => {
      arrivedByStep = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      shipmentReady.step = true;
      shipmentStepError = '';
      applyCarrierShipments();
    },
    (error) => {
      shipmentReady.step = true;
      shipmentStepError = error.message || 'Haikuweza kusoma ada.';
      arrivedByStep = [];
      applyCarrierShipments();
    }
  );

  const unsubDecisions = onSnapshot(
    collectionGroup(db, 'decisions'),
    (snapshot) => {
      state.carrierDecisions = snapshot.docs.map((item) => {
        const parent = item.ref.parent;
        const carrierId = parent?.id === 'decisions' ? parent.parent?.id || '' : '';
        return {
          id: item.id,
          ...item.data(),
          carrierId,
        };
      });
      state.carrierDecisionsOk = true;
      state.loading.carrierDecisions = false;
      scheduleRenderAll();
    },
    (error) => {
      state.carrierDecisions = [];
      state.carrierDecisionsOk = false;
      state.loading.carrierDecisions = false;
      if (!/permission|index/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync company cancel history.', 'error');
      }
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

  const unsubCustomerPresence = onSnapshot(
    query(col.customerPresence, limit(120)),
    (snapshot) => {
      state.customerPresence = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      state.loading.customerPresence = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.customerPresence = false;
      state.customerPresence = [];
      if (!/permission|index/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync customer presence.', 'error');
      }
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

  const ussdPaymentsQuery = query(col.driverPayments, orderBy('createdAt', 'desc'), limit(ADMIN_PAYMENT_REVIEW_LIMIT));
  const unsubUssdPayments = onSnapshot(
    ussdPaymentsQuery,
    (snapshot) => {
      state.ussdPayments = sortByRecent(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      scheduleRenderAll();
    },
    (error) => {
      state.ussdPayments = [];
      if (!/permission/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync driver USSD payments.', 'error');
      }
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

  const unsubOutsideCities = onSnapshot(
    col.outsideCities,
    (snapshot) => {
      state.outsideCities = snapshot.docs.map((item) => ({ id: item.id, key: item.id, ...item.data() }));
      state.loading.outsideCities = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.outsideCities = false;
      state.outsideCities = [];
      setFeedback(error.message || 'Could not sync outside destination regions.', 'error');
      scheduleRenderAll();
    }
  );

  const unsubOutsideConfig = onSnapshot(
    outsideParcelConfigRef,
    (snapshot) => {
      const data = snapshot.data() || {};
      state.outsideParcelConfig = {
        expressEnabledGlobally: data.expressEnabledGlobally !== false,
        ...data,
      };
      scheduleRenderAll();
    },
    (error) => {
      state.outsideParcelConfig = { expressEnabledGlobally: true };
      if (!/permission/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync air transport config.', 'error');
      }
      scheduleRenderAll();
    }
  );

  const unsubOutsideExpressRoutes = onSnapshot(
    col.outsideExpressRoutes,
    (snapshot) => {
      state.outsideExpressRoutes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      state.loading.outsideExpressRoutes = false;
      scheduleRenderAll();
    },
    (error) => {
      state.loading.outsideExpressRoutes = false;
      state.outsideExpressRoutes = [];
      if (!/permission/i.test(String(error.message || ''))) {
        setFeedback(error.message || 'Could not sync express flight routes.', 'error');
      }
      scheduleRenderAll();
    }
  );

  state.unsubscribers.push(
    unsubActiveOrders,
    unsubRecentOrders,
    unsubOutsideOrders,
    unsubAvailableDrivers,
    unsubRecentDrivers,
    unsubReviewDrivers,
    unsubCarriers,
    unsubShipmentsByStatus,
    unsubShipmentsByStep,
    unsubDecisions,
    unsubUsers,
    unsubCustomerPresence,
    unsubPaymentReviews,
    unsubUssdPayments,
    unsubActivityEvents,
    unsubOutsideCities,
    unsubOutsideConfig,
    unsubOutsideExpressRoutes
  );
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
  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    const page = location.hash.replace(/^#/, '');
    if (PAGE_META[page] && page !== state.currentPage) setPage(page, { skipHash: true });
  });
  ui.loginModeButton?.addEventListener('click', () => setAuthMode('login'));
  ui.authForm?.addEventListener('submit', handleAuthSubmit);
  $('authResetButton')?.addEventListener('click', handlePasswordReset);
  ui.signOutButton?.addEventListener('click', handleAdminSignOut);
  ui.menuButton?.addEventListener('click', () => ui.sidebar?.classList.toggle('open'));
  $('sidebarScrim')?.addEventListener('click', () => ui.sidebar?.classList.remove('open'));
  ui.closeDrawer?.addEventListener('click', closeOrderDrawer);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('input[type="search"]')) {
      if (target.matches('[data-other-regions-search]')) {
        state.otherRegionsSearch = target.value || '';
        renderOtherRegions();
        return;
      }
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

    if (target.matches('[data-air-disable-select]')) {
      state.airTransportSelectedCity = target.value || '';
      return;
    }

    if (target.matches('[data-air-enable-select]')) {
      state.airTransportEnableCity = target.value || '';
      return;
    }

    if (target.matches('[data-express-route-select]')) {
      state.selectedExpressRouteId = target.value || '';
      renderAirTransport();
      return;
    }

    if (target.matches('[data-express-schedule-date]')) {
      state.selectedExpressScheduleDate = target.value || getExpressTodayIso();
      renderAirTransport();
      return;
    }

    if (target.matches('[data-express-global]')) {
      const enabled = target instanceof HTMLInputElement ? target.checked : false;
      setBusy(true);
      setOutsideExpressGlobal(enabled)
        .catch((error) => setFeedback(error.message || 'Could not update global air transport.', 'error'))
        .finally(() => setBusy(false));
      return;
    }

    if (target.matches('[data-express-city]')) {
      const cityKey = target.dataset.expressCity;
      if (!cityKey) {
        return;
      }
      const enabled = target instanceof HTMLInputElement ? target.checked : false;
      setBusy(true);
      setOutsideCityExpressEnabled(cityKey, enabled)
        .catch((error) => setFeedback(error.message || 'Could not update region Express status.', 'error'))
        .finally(() => setBusy(false));
      return;
    }

    if (target.matches('[data-active-city]')) {
      const cityKey = target.dataset.activeCity;
      if (!cityKey) {
        return;
      }
      const enabled = target instanceof HTMLInputElement ? target.checked : false;
      setBusy(true);
      setOutsideCityActive(cityKey, enabled)
        .catch((error) => setFeedback(error.message || 'Could not update region listing.', 'error'))
        .finally(() => setBusy(false));
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
      return;
    }

    if (form.dataset.form === 'create-outside-city') {
      event.preventDefault();
      try {
        setBusy(true);
        await createOutsideCityFromForm(form);
        closeModal();
        setPage('airTransport');
        setFeedback('Region added. Customers will see it for outside parcels.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not add the region.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'express-route-schedule') {
      event.preventDefault();
      try {
        setBusy(true);
        await saveExpressRouteSchedule(form);
        setFeedback('Mipangilio ya booking imehifadhiwa.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not save booking settings.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'express-day-schedule') {
      event.preventDefault();
      try {
        setBusy(true);
        await saveExpressDayScheduleFromForm(form);
        setFeedback('Ratiba imehifadhiwa. Mteja ataiona kwenye app.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not save schedule.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'outside-status-update') {
      event.preventDefault();
      try {
        setBusy(true);
        await submitOutsideStatusUpdate(form);
        setFeedback('Hali ya mzigo imesasishwa. Mteja ataona mabadiliko kwenye app.', 'success');
        if (state.currentPage === 'shipment') {
          renderShipmentPage();
        } else {
          renderOtherRegions();
        }
      } catch (error) {
        setFeedback(error.message || 'Imeshindikana kusasisha hali.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'ops-status-change') {
      event.preventDefault();
      try {
        setBusy(true);
        await submitOpsStatusChange(form);
        closeModal();
        setFeedback('Order status updated and recorded in audit log.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not update order status.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'ninunulie-mark-purchased') {
      event.preventDefault();
      const formData = new FormData(form);
      const orderId = safeText(formData.get('orderId'));
      const purchaseAmount = safeText(formData.get('purchaseAmount'));
      const note = safeText(formData.get('note'));
      if (!orderId) {
        setFeedback('Order not found.', 'error');
        return;
      }
      try {
        setBusy(true);
        await markNinunuliePurchased(orderId, { amount: purchaseAmount, note });
        setFeedback('Imenunuliwa · mteja amepata notification.', 'success');
        scheduleRenderAll();
      } catch (error) {
        setFeedback(error.message || 'Imeshindikana ku-mark imenunuliwa.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'ninunulie-status-update') {
      event.preventDefault();
      const formData = new FormData(form);
      const orderId = safeText(formData.get('orderId'));
      const nextStatus = safeText(formData.get('nextStatus'));
      const reason = safeText(formData.get('reason'));
      const note = safeText(formData.get('note'));
      if (!orderId || !nextStatus) {
        setFeedback('Chagua status.', 'error');
        return;
      }
      try {
        setBusy(true);
        await updateOrderStatus(orderId, nextStatus, {
          reason,
          note,
          manual: true,
          cancellationReason: nextStatus === 'cancelled' ? reason : '',
        });
        setFeedback('Status ya Ninunulie imesasishwa. Mteja ataona mabadiliko.', 'success');
        scheduleRenderAll();
      } catch (error) {
        setFeedback(error.message || 'Imeshindikana kusasisha status.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'ninunulie-ops-notes') {
      event.preventDefault();
      const orderId = safeText(form.dataset.orderId);
      const opsNotes = safeText(new FormData(form).get('opsNotes'));
      if (!orderId) {
        setFeedback('Order not found.', 'error');
        return;
      }
      try {
        setBusy(true);
        await updateDoc(orderRef(orderId), compact({
          ninunulieOpsNotes: opsNotes,
          updatedAt: serverTimestamp(),
        }));
        setFeedback('Ops notes zimehifadhiwa.', 'success');
        scheduleRenderAll();
      } catch (error) {
        setFeedback(error.message || 'Could not save notes.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (form.dataset.form === 'timeline-lookup') {
      event.preventDefault();
      const lookup = safeText(new FormData(form).get('timelineOrderId'));
      const order = lookup ? findOrderByLookup(lookup) : null;
      if (!order) {
        setFeedback('Order not found.', 'error');
        return;
      }
      state.opsTimelineOrderId = order.id;
      setPage('orderTimeline');
      return;
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button, tr, .list-card');
    if (!target) {
      return;
    }

    const actionSection = target.dataset.actionSection;
    if (actionSection) {
      if (target.dataset.actionFilter === 'pending-orders') {
        state.orderFilter = 'waiting';
      }
      if (target.dataset.actionFilter === 'driver-review') {
        state.driverFilter = 'review';
      }
      if (target.dataset.actionFilter === 'payments') {
        state.paymentFilter = 'pending';
      }
      setPage(actionSection);
      return;
    }

    const sidebarPage = target.dataset.section;
    const pageJump = target.dataset.pageJump;
    if (sidebarPage || pageJump) {
      setPage(sidebarPage || pageJump, { preserveSelection: !!pageJump });
      return;
    }

    const copyValue = target.dataset.copyValue;
    if (copyValue) {
      try {
        await navigator.clipboard.writeText(copyValue);
        setFeedback('Copied to clipboard.', 'success');
      } catch {
        setFeedback('Could not copy.', 'error');
      }
      return;
    }

    const openShipmentId = target.dataset.openShipment || (target.closest('[data-open-shipment]')?.dataset.openShipment);
    if (openShipmentId) {
      openShipmentPage(openShipmentId);
      return;
    }

    const openOpsOrderId = target.dataset.openOpsOrder || (target.closest('[data-open-ops-order]')?.dataset.openOpsOrder);
    if (openOpsOrderId) {
      openShipmentPage(openOpsOrderId);
      return;
    }

    const openOrderDrawerId = target.dataset.openOrderDrawer;
    if (openOrderDrawerId) {
      openOrderDrawer(openOrderDrawerId);
      return;
    }

    const timelineOrderId = target.dataset.openTimeline;
    if (timelineOrderId) {
      state.opsTimelineOrderId = timelineOrderId;
      setPage('orderTimeline');
      return;
    }

    const changeOpsStatusId = target.dataset.changeOpsStatus;
    if (changeOpsStatusId) {
      openOpsStatusChangeModal(changeOpsStatusId);
      return;
    }

    const opsAction = target.dataset.opsAction;
    const opsOrderId = target.dataset.orderId;
    if (opsAction && opsOrderId) {
      if (opsAction === 'open-dispatch') {
        setPage('dispatch');
        state.selectedOrderId = opsOrderId;
        renderCurrentPage();
        return;
      }
      if (opsAction === 'open-order') {
        openOrderDrawer(opsOrderId);
        return;
      }
      if (opsAction === 'open-ops-desk') {
        openOutsideRegionsDesk(opsOrderId);
        return;
      }
      if (opsAction.startsWith('status:')) {
        const nextStatus = opsAction.split(':')[1];
        try {
          setBusy(true);
          await updateOrderStatus(opsOrderId, nextStatus, { manual: false });
          setFeedback(`Order updated to ${getOrderStatusLabel({ status: nextStatus })}.`, 'success');
        } catch (error) {
          setFeedback(error.message || 'Could not update order.', 'error');
        } finally {
          setBusy(false);
        }
        return;
      }
    }

    const opsRegionFilter = target.dataset.opsRegionFilter;
    if (opsRegionFilter) {
      state.opsRegionFilter = opsRegionFilter;
      state.otherRegionsFilter = 'all';
      setPage('otherRegions');
      return;
    }

    if (target.dataset.orderFilter) {
      state.orderFilter = target.dataset.orderFilter;
      renderCurrentPage();
      return;
    }

    if (target.dataset.driverFilter) {
      state.driverFilter = target.dataset.driverFilter;
      renderCurrentPage();
      return;
    }

    if (target.dataset.paymentFilter) {
      state.paymentFilter = target.dataset.paymentFilter;
      state.paymentPage = 1;
      renderCurrentPage();
      return;
    }

    if (target.dataset.paymentPage) {
      const nextPage = Number(target.dataset.paymentPage);
      if (Number.isFinite(nextPage) && nextPage >= 1) {
        state.paymentPage = nextPage;
        renderCurrentPage();
      }
      return;
    }

    if (target.dataset.dispatchSelect) {
      state.selectedOrderId = target.dataset.dispatchSelect;
      renderCurrentPage();
      return;
    }

    const ninunulieFilter = target.dataset.ninunulieFilter;
    if (ninunulieFilter) {
      state.ninunulieFilter = ninunulieFilter;
      renderCurrentPage();
      return;
    }

    const ninunulieSelectId = target.dataset.ninunulieSelect || target.closest('[data-ninunulie-select]')?.dataset.ninunulieSelect;
    if (ninunulieSelectId) {
      state.ninunulieSelectedId = ninunulieSelectId;
      if (state.currentPage !== 'ninunulie') {
        setPage('ninunulie');
      } else {
        renderCurrentPage();
      }
      return;
    }

    const expressRoutePickId = target.getAttribute('data-express-route-pick');
    if (expressRoutePickId) {
      state.selectedExpressRouteId = expressRoutePickId;
      try {
        setBusy(true);
        await ensureExpressRouteDocument(expressRoutePickId);
        renderAirTransport();
        setFeedback('Route imechaguliwa. Weka ratiba ya siku upande wa kulia.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Imeshindikana kuchagua route.', 'error');
      } finally {
        setBusy(false);
      }
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

    const verifyCarrierId = target.dataset.verifyCarrier;
    if (verifyCarrierId) {
      try {
        setBusy(true);
        await updateCarrierVerificationStatus(verifyCarrierId, 'verified');
        renderAll();
        setFeedback('Kampuni imethibitishwa — inaweza kupokea oda za mizigo.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Imeshindwa kuthibitisha kampuni.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const rejectCarrierId = target.dataset.rejectCarrier;
    if (rejectCarrierId) {
      const reason = window.prompt('Sababu fupi ya kukataa (si lazima):', '') || '';
      try {
        setBusy(true);
        await updateCarrierVerificationStatus(rejectCarrierId, 'rejected', reason);
        renderAll();
        setFeedback('Kampuni imekataliwa.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Imeshindwa kukataa kampuni.', 'error');
      } finally {
        setBusy(false);
      }
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
        openPaymentsPdf(sortByRecent(getAdminPaymentRecords().filter(paymentMatchesQuery)));
      } catch (error) {
        setFeedback(error.message || 'Could not export payments PDF.', 'error');
      }
      return;
    }
    if (action === 'refresh-api-health') {
      try {
        setBusy(true);
        await refreshApiHealth();
        scheduleRenderAll();
        if (state.apiHealth?.ok) {
          setFeedback('API ya malipo iko mtandaoni.', 'success');
        } else {
          setFeedback('API ya malipo bado haipatikani. Angalia billing na deploy backend.', 'error');
        }
      } catch (error) {
        setFeedback(error.message || 'Could not check payment API.', 'error');
      } finally {
        setBusy(false);
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
    if (action === 'add-outside-city') {
      openAddOutsideCityModal();
      return;
    }
    if (action === 'air-global-on') {
      try {
        setBusy(true);
        await setOutsideExpressGlobal(true);
      } catch (error) {
        setFeedback(error.message || 'Could not enable air transport globally.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'air-global-off') {
      try {
        const confirmed = window.confirm('Disable air transport for ALL regions? Bus will stay available.');
        if (!confirmed) {
          return;
        }
        setBusy(true);
        await setOutsideExpressGlobal(false);
      } catch (error) {
        setFeedback(error.message || 'Could not disable air transport globally.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'air-disable-region') {
      const select = document.querySelector('[data-air-disable-select]');
      const cityKey = safeText(select?.value || state.airTransportSelectedCity);
      if (!cityKey) {
        setFeedback('Select a region to disable.', 'error');
        return;
      }
      try {
        setBusy(true);
        state.airTransportSelectedCity = cityKey;
        await setOutsideCityExpressEnabled(cityKey, false);
      } catch (error) {
        setFeedback(error.message || 'Could not disable region Express.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'air-enable-region') {
      const select = document.querySelector('[data-air-enable-select]');
      const cityKey = safeText(select?.value || state.airTransportEnableCity);
      if (!cityKey) {
        setFeedback('Select a region to enable.', 'error');
        return;
      }
      try {
        setBusy(true);
        state.airTransportEnableCity = cityKey;
        await setOutsideCityExpressEnabled(cityKey, true);
      } catch (error) {
        setFeedback(error.message || 'Could not enable region Express.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'air-disable-city') {
      const cityKey = safeText(target.dataset.cityKey);
      if (!cityKey) {
        return;
      }
      try {
        setBusy(true);
        await setOutsideCityExpressEnabled(cityKey, false);
      } catch (error) {
        setFeedback(error.message || 'Could not disable region Express.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'air-enable-city') {
      const cityKey = safeText(target.dataset.cityKey);
      if (!cityKey) {
        return;
      }
      try {
        setBusy(true);
        await setOutsideCityExpressEnabled(cityKey, true);
      } catch (error) {
        setFeedback(error.message || 'Could not enable region Express.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'seed-outside-cities') {
      try {
        const confirmed = window.confirm(
          'Sync default regions (Dar, Zanzibar, Mwanza, Arusha, Dodoma, Kahama, Mtwara) into Firestore? Existing Express on/off toggles are kept.'
        );
        if (!confirmed) {
          return;
        }
        setBusy(true);
        await seedOutsideCities(true);
      } catch (error) {
        setFeedback(error.message || 'Could not sync default regions.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'clear-legacy-express-schedules') {
      try {
        const confirmed = window.confirm(
          'Futa ratiba ZOTE za ndege kwenye Firestore? Mteja hataona ndege hadi uweke ratiba mpya mwenyewe.'
        );
        if (!confirmed) {
          return;
        }
        setBusy(true);
        const count = await clearAllLegacyExpressSchedules();
        setFeedback(`Ratiba ${count} route zimefutwa. Weka ratiba mpya sasa.`, 'success');
        renderAirTransport();
      } catch (error) {
        setFeedback(error.message || 'Imeshindikana kufuta ratiba.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'seed-express-routes') {
      try {
        const confirmed = window.confirm(
          'Tengeneza route shells bila ratiba? Utaweka masaa ya ndege mwenyewe baadaye.'
        );
        if (!confirmed) {
          return;
        }
        setBusy(true);
        await seedExpressRoutes();
        setFeedback('Flight routes synced.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not sync flight routes.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'add-express-day-departure') {
      const routeId = target.getAttribute('data-route-id');
      const isoDate = target.getAttribute('data-iso-date') || getExpressScheduleDateValue();
      const form = target.closest('form[data-form="express-day-schedule"]');
      const localTime = form?.newDepartureTime?.value;
      if (!routeId || !localTime) {
        setFeedback('Pick a departure time first.', 'error');
        return;
      }
      try {
        setBusy(true);
        await addExpressDayDeparture(routeId, isoDate, localTime);
        setFeedback('Departure added for this day.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not add departure for this day.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'remove-express-day-departure') {
      const routeId = target.getAttribute('data-route-id');
      const isoDate = target.getAttribute('data-iso-date');
      const departureId = target.getAttribute('data-departure-id');
      if (!routeId || !isoDate || !departureId) {
        return;
      }
      try {
        setBusy(true);
        await removeExpressDayDeparture(routeId, isoDate, departureId);
        setFeedback('Departure removed for this day.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not remove departure for this day.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'express-use-template-day') {
      const routeId = target.getAttribute('data-route-id');
      const isoDate = target.getAttribute('data-iso-date');
      if (!routeId || !isoDate) {
        return;
      }
      try {
        setBusy(true);
        await clearExpressDateOverride(routeId, isoDate);
        setFeedback('Ratiba ya siku hii imefutwa.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not clear day schedule.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'express-cancel-day') {
      const routeId = target.getAttribute('data-route-id');
      const isoDate = target.getAttribute('data-iso-date');
      if (!routeId || !isoDate) {
        return;
      }
      try {
        const confirmed = window.confirm(`Cancel all flights on ${formatExpressDayLabel(isoDate)} for this route?`);
        if (!confirmed) {
          return;
        }
        setBusy(true);
        await cancelExpressDate(routeId, isoDate);
        setFeedback('Flights cancelled for this day.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not cancel flights for this day.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'add-express-departure') {
      const routeId = target.getAttribute('data-route-id');
      const form = target.closest('form[data-form="express-route-schedule"]');
      const localTime = form?.newDepartureTime?.value;
      if (!routeId || !localTime) {
        setFeedback('Pick a departure time first.', 'error');
        return;
      }
      try {
        setBusy(true);
        await addExpressDeparture(routeId, localTime);
        setFeedback('Departure time added.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not add departure time.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'remove-express-departure') {
      const routeId = target.getAttribute('data-route-id');
      const departureId = target.getAttribute('data-departure-id');
      if (!routeId || !departureId) {
        return;
      }
      try {
        setBusy(true);
        await removeExpressDeparture(routeId, departureId);
        setFeedback('Departure time removed.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not remove departure time.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-filter') {
      state.otherRegionsFilter = target.getAttribute('data-filter') || 'all';
      renderOtherRegions();
      return;
    }

    if (action === 'outside-mode') {
      state.otherRegionsMode = target.getAttribute('data-mode') || 'all';
      renderOtherRegions();
      return;
    }

    if (action === 'express-jump-day') {
      const isoDate = target.getAttribute('data-iso-date') || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        state.selectedExpressScheduleDate = isoDate;
        renderAirTransport();
      }
      return;
    }

    if (action === 'open-ops-desk') {
      const orderId = target.getAttribute('data-order-id');
      if (orderId) {
        openOutsideRegionsDesk(orderId);
      }
      return;
    }

    if (action === 'outside-open' || action === 'outside-select') {
      const orderId = target.getAttribute('data-order-id') || '';
      if (!orderId) {
        return;
      }
      state.otherRegionsSelectedId = orderId;
      openShipmentPage(orderId, { returnPage: 'otherRegions' });
      return;
    }

    if (action === 'outside-assign') {
      const orderId = target.getAttribute('data-order-id');
      const driverId = target.getAttribute('data-driver-id');
      if (!orderId || !driverId) return;
      try {
        setBusy(true);
        await assignDriver(orderId, driverId, { mode: 'ops_desk', reason: 'Other regions first-mile' });
        state.otherRegionsSelectedId = orderId;
        setFeedback('First-mile driver assigned.', 'success');
      } catch (error) {
        setFeedback(error.message || 'Could not assign driver.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-intake') {
      const orderId = target.getAttribute('data-order-id');
      if (!orderId) return;
      try {
        setBusy(true);
        await appendOutsideLogistics(orderId, 'received_at_hub', 'Parcel scanned / received at DoorDrop office.', {
          status: 'at_hub',
        });
      } catch (error) {
        setFeedback(error.message || 'Could not confirm intake.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-depart') {
      const orderId = target.getAttribute('data-order-id');
      if (!orderId) return;
      const carrierRef = window.prompt('Carrier / ticket reference (optional)') || '';
      try {
        setBusy(true);
        await appendOutsideLogistics(orderId, 'in_transit_carrier', carrierRef ? `Departed. Ref: ${carrierRef}` : 'Departed via bus/air.', {
          carrierRef: carrierRef || undefined,
          departedAt: serverTimestamp(),
        });
      } catch (error) {
        setFeedback(error.message || 'Could not mark departed.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-arrive') {
      const orderId = target.getAttribute('data-order-id');
      if (!orderId) return;
      try {
        setBusy(true);
        await appendOutsideLogistics(orderId, 'arrived_destination', 'Parcel arrived at destination stand/airport.');
      } catch (error) {
        setFeedback(error.message || 'Could not mark arrived.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-out-for-delivery') {
      const orderId = target.getAttribute('data-order-id');
      if (!orderId) return;
      try {
        setBusy(true);
        await appendOutsideLogistics(orderId, 'out_for_delivery', 'Out for home delivery.');
      } catch (error) {
        setFeedback(error.message || 'Could not update status.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-complete') {
      const orderId = target.getAttribute('data-order-id');
      if (!orderId) return;
      try {
        setBusy(true);
        await appendOutsideLogistics(orderId, 'completed', 'Parcel received by recipient. Order closed to History.');
      } catch (error) {
        setFeedback(error.message || 'Could not complete order.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'outside-export-training') {
      exportOutsideTrainingDataset();
      return;
    }

    if (action === 'outside-copy-code' || action === 'outside-copy-link') {
      const text = target.getAttribute('data-copy-text') || '';
      copyTextToClipboard(text)
        .then(() => setFeedback(action === 'outside-copy-code' ? 'Parcel code copied.' : 'Scan link copied.', 'success'))
        .catch((error) => setFeedback(error.message || 'Could not copy.', 'error'));
      return;
    }

    if (action === 'outside-print-qr') {
      const orderId = target.getAttribute('data-order-id');
      const order = state.orders.find((item) => item.id === orderId);
      if (!order) return;
      const code = getOutsideParcelCode(order);
      const payload = buildOutsideQrPayload(order);
      const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=480,height=760');
      if (!printWindow) {
        setFeedback('Allow pop-ups to print the parcel label.', 'error');
        return;
      }
      const route = `${safeText(order.outsideOriginCity, 'Dar es Salaam')} → ${safeText(order.outsideDestinationCity)}`;
      const transport = `${safeText(order.outsideShippingMode, '—')} · ${safeText(order.outsideHandoffMode, '—')}`;
      printWindow.document.write(`<!doctype html><html><head><title>${code}</title>
        <style>
          body{font-family:Manrope,system-ui,sans-serif;margin:0;padding:24px;color:#0b1220}
          .label{max-width:360px;margin:0 auto;border:2px solid #0b1220;border-radius:18px;padding:20px;text-align:center}
          .brand{font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#16a34a}
          .code{font-size:28px;font-weight:800;letter-spacing:0.08em;margin:10px 0 14px}
          canvas{margin:0 auto 14px;display:block}
          .route{font-size:15px;font-weight:700;margin:0 0 6px}
          .meta{font-size:12px;color:#475569;line-height:1.5}
          .footer{margin-top:14px;font-size:11px;color:#64748b}
        </style>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"><\/script></head><body>
        <article class="label">
          <div class="brand">DoorDrop parcel</div>
          <div class="code">${code}</div>
          <canvas id="qr"></canvas>
          <p class="route">${route}</p>
          <p class="meta">${transport}<br/>${escapeHtml(safeText(order.recipientName))} · ${escapeHtml(safeText(order.outsideParcelWeightKg))} kg<br/>${escapeHtml(formatMoney(getOrderAmount(order)))}</p>
          <p class="footer">Scan at office intake and destination handoff.</p>
        </article>
        <script>QRCode.toCanvas(document.getElementById('qr'), ${JSON.stringify(payload)}, {width:240,margin:2,errorCorrectionLevel:'M'}, function(){ setTimeout(function(){ window.print(); }, 300); });<\/script>
        </body></html>`);
      printWindow.document.close();
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

function exportOutsideTrainingDataset() {
  const records = getOutsideOrders().map((order) => buildOutsideTrainingRecord(order));
  if (!records.length) {
    setFeedback('No intercity parcels to export yet.', 'error');
    return;
  }

  const jsonBlob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json;charset=utf-8;' });
  const jsonUrl = URL.createObjectURL(jsonBlob);
  const jsonLink = document.createElement('a');
  jsonLink.href = jsonUrl;
  jsonLink.download = `doordrop-outside-training-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(jsonLink);
  jsonLink.click();
  jsonLink.remove();
  URL.revokeObjectURL(jsonUrl);

  const headers = [
    'orderNumber',
    'parcelCode',
    'logisticsStatus',
    'workflowStep',
    'originCity',
    'destinationCity',
    'shippingMode',
    'handoffMode',
    'weightKg',
    'fareAmount',
    'customerName',
    'recipientName',
    'driverName',
    'eventCount',
    'createdAt',
    'updatedAt',
    'qrUrl',
  ];
  const rows = [
    headers,
    ...records.map((record) =>
      headers.map((key) => {
        if (key === 'qrUrl') return record.qrUrl;
        return record[key] ?? '';
      })
    ),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const csvUrl = URL.createObjectURL(csvBlob);
  const csvLink = document.createElement('a');
  csvLink.href = csvUrl;
  csvLink.download = `doordrop-outside-training-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(csvLink);
  csvLink.click();
  csvLink.remove();
  URL.revokeObjectURL(csvUrl);

  setFeedback(`Exported ${records.length} training records (JSON + CSV).`, 'success');
}

function copyTextToClipboard(text) {
  const value = safeText(text);
  if (!value) {
    return Promise.reject(new Error('Nothing to copy.'));
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }
  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  document.execCommand('copy');
  helper.remove();
  return Promise.resolve();
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
