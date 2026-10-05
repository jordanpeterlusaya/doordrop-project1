import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
  Dimensions,
  Modal,
    Pressable,
    ScrollView,
    Share,
    StatusBar,
  Image,
  StyleSheet,
  Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openPhoneDialer, readablePhone } from '@/lib/phone-link';
import { BusParcelTrackSlot } from '@/components/bus-parcel-track-slot';
import { BottomNav, PrimaryButton } from '@/components/cargo-ui';
import { OutsideParcelReceiptModal } from '@/components/outside-parcel-receipt-modal';
import { CARGO_CALLOUT_LAYOUT, CargoBullseyePin, CargoRouteCallout, VehicleDriverMarker, getMapVehicleKey } from '@/components/map-markers';
import { projectMapCoordinate, type MapViewportRegion } from '@/components/nearby-live-vehicles';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { images } from '@/lib/images';
import { recordAppActivity } from '@/lib/app-analytics';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import {
    autoAssignDriverToOrder,
    cancelDeliveryOrderByUser,
    ensureOutsideOrderCountdownAnchor,
    formatDeliveryDateTime,
    getDeliveryOrderStatusLabel,
    hasDeliveryOrderRating,
    isNinunulieOrder,
    submitDeliveryOrderRating,
    subscribeToDrivers,
    subscribeToOrder,
    subscribeToUserOrders,
    type DeliveryOrder,
    type DeliveryOrderStatus,
    type DriverRecord,
} from '@/lib/delivery-data';
import {
  canCancelOutsideParcel,
  getOutsideLogisticsStatusLabel,
  getOutsideTransportIconName,
  getOutsideTransportLabel,
  isOutsideParcelOrder,
  isOutsidePostHubPhase,
} from '@/lib/outside-order-logistics';
import { getActiveOrderHeadline, getActiveOrderProgress, getBusParcelDetail, isBusCustomerParcel, isCargoNegotiationOpen } from '@/lib/active-order-display';
import { getReceiptTrackingCode } from '@/lib/outside-parcel-receipt';
import { fetchRouteEstimate, type RouteEstimate } from '@/lib/location-search';
import { lightMapStyle } from '@/lib/light-map-style';
import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { sendOrderMessage, subscribeToOrderMessages, type OrderMessage } from '@/lib/order-messages';
import { fetchRoadFollowingRoute } from '@/lib/road-route';
import {
    filterValidCoordinates,
    formatDistance,
    formatEtaByScope,
    getDistanceBetweenPoints,
    getNearestCoordinateIndex,
    getPolylineDistanceMeters,
    isValidCoordinate,
    trimRouteFromPoint,
    type RoutePoint,
    type SelectedRoute,
} from '@/lib/route-utils';
import { buildRecipientNotifyBody, isNotifiableRecipientPhone, openRecipientSms, openRecipientWhatsApp } from '@/lib/recipient-notify';
import { buildAdminWhatsAppOrderMessage, openSupportWhatsApp, SUPPORT_PHONE_LABEL } from '@/lib/support-contact';
import { lookupTrackOrderByCode, normalizeTrackCodeInput } from '@/lib/parcel-track-lookup';
import { getOrderRouteDisplay } from '@/lib/order-route-display';
import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';
import { nativeNotifications, registerDoorDropPushNotifications } from '@/lib/push-notifications';
import { findOutsideCityByLabel } from '@/lib/outside-parcel';
import {
  getOutsideParcelDurationSecondsForOrder,
  resolveOutsideTrackingCountdownPlan,
  resolveTimestampMillis,
} from '@/lib/outside-parcel-eta';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

const { height } = Dimensions.get('window');
const screenScope = 'TrackOrderScreen';

const statusRank: Record<DeliveryOrderStatus, number> = {
  pending_assignment: 0,
  driver_assigned: 1,
  driver_at_pickup: 2,
  in_transit: 3,
  at_hub: 3,
  delivered: 4,
  cancelled: 4,
};

const ratingOptions = [1, 2, 3, 4, 5] as const;
const LIVE_DRIVER_MARKER_ANIMATION_MS = 1100;
const INTERCITY_DISTANCE_METERS = 40000;
const MIN_CORRIDOR_SECONDS = 20 * 60;
const TRACK_CALLOUT_INSET = { top: 52, right: 8, bottom: 18, left: 8 };
const TRACK_NOTIFY_PROMPT_KEY = 'haul.track.notifyPrompt.v1';

const trackCancelReasons = [
  { key: 'not_closer', sw: 'Dereva hakaribii', en: 'Driver is not getting closer' },
  { key: 'driver_asked', sw: 'Dereva ameomba kufuta', en: 'Driver asked to cancel' },
  { key: 'alternative', sw: 'Nimepata njia nyingine', en: 'Found another way' },
  { key: 'price', sw: 'Mgogoro wa bei', en: 'Price dispute' },
  { key: 'pickup_long', sw: 'Muda wa kuchukua ni mrefu', en: 'Pickup is taking too long' },
  { key: 'outside_pay', sw: 'Dereva ameomba malipo nje ya app', en: 'Driver asked for payment outside the app' },
  { key: 'other', sw: 'Nyingine', en: 'Other' },
] as const;

function formatArrivalClock(date: Date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hours % 12 || 12;
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function formatPickupMinutes(durationSeconds: number) {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) {
    return `dak ${minutes}`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remaining} dak`;
}

function attachTrackCallout(
  pin: { x: number; y: number },
  mapSize: { width: number; height: number },
  inset: { top: number; right: number; bottom: number; left: number }
) {
  const width = CARGO_CALLOUT_LAYOUT.width;
  const height = CARGO_CALLOUT_LAYOUT.overlayHeight;
  const ring = CARGO_CALLOUT_LAYOUT.bullseye / 2;
  const centeredX = pin.x - width / 2;
  const aboveY = pin.y - height - ring + 2;
  const belowY = pin.y + ring + 2;
  const minX = inset.left;
  const maxX = Math.max(minX, mapSize.width - inset.right - width);
  const minY = inset.top;
  const maxY = Math.max(minY, mapSize.height - inset.bottom - height);
  const aboveFits = aboveY >= minY;
  const belowFits = belowY <= maxY;
  const placement: 'above' | 'below' = !aboveFits && belowFits ? 'below' : 'above';
  const attachedY = placement === 'below' ? belowY : aboveY;
  const x = Math.max(minX, Math.min(maxX, centeredX));
  const y = Math.max(minY, Math.min(maxY, attachedY));

  return {
    x,
    y,
    placement,
    stemOffset: 0,
  };
}

function shortPlaceName(value: string) {
  return value.split('·')[0].split(',')[0].trim();
}

function cityChipPosition(
  pin: { x: number; y: number },
  mapSize: { width: number; height: number },
  callout: { x: number; y: number; placement: 'above' | 'below' } | null
) {
  const width = 132;
  const height = 28;
  const minX = 8;
  const maxX = Math.max(minX, mapSize.width - width - 8);
  const minY = 8;
  const maxY = Math.max(minY, mapSize.height - height - 8);
  const x = Math.max(minX, Math.min(maxX, pin.x - width / 2));
  let y = callout?.placement === 'below' ? pin.y - height - 20 : pin.y + 18;
  if (callout) {
    const calloutTop = callout.y;
    const calloutBottom = callout.y + CARGO_CALLOUT_LAYOUT.overlayHeight;
    const overlaps =
      y < calloutBottom + 6 &&
      y + height > calloutTop - 6 &&
      x < callout.x + CARGO_CALLOUT_LAYOUT.width &&
      x + width > callout.x;
    if (overlaps) {
      y = callout.placement === 'above' ? calloutBottom + 8 : calloutTop - height - 8;
    }
  }

  return {
    x,
    y: Math.max(minY, Math.min(maxY, y)),
    width,
  };
}

function quantizeRoutePoint(point: RoutePoint, step = 0.0009): RoutePoint {
  return {
    latitude: Math.round(point.latitude / step) * step,
    longitude: Math.round(point.longitude / step) * step,
  };
}

function isIntercityOrder(order?: DeliveryOrder | null) {
  if (!order) {
    return false;
  }

  if (order.parcelScope === 'outside' || order.outsideDestinationCity || order.outsideDestinationLabel) {
    return true;
  }

  return (order.distanceMeters ?? 0) >= INTERCITY_DISTANCE_METERS;
}

function getParamValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getTimestampMillis(value?: unknown) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null) {
    const maybeTimestamp = value as { toMillis?: () => number };
    if (typeof maybeTimestamp.toMillis === 'function') {
      return maybeTimestamp.toMillis();
    }
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function formatTrackStepTime(value?: unknown) {
  const millis = getTimestampMillis(value);
  if (!millis) {
    return '';
  }

  return new Date(millis).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function eventMillis(events: DeliveryOrder['logisticsEvents'], keys: string[]) {
  if (!events?.length) {
    return 0;
  }

  for (const event of events) {
    const status = String(event.status || '').toLowerCase();
    if (keys.includes(status)) {
      const millis = getTimestampMillis(event.at);
      if (millis) {
        return millis;
      }
    }
  }

  return 0;
}

function buildShipmentSteps(order: DeliveryOrder, language: 'en' | 'sw') {
  if (isBusCustomerParcel(order)) {
    return getActiveOrderProgress(order, language).map((step) => ({
      key: step.key,
      label: step.label,
      state: step.state,
      timeLabel: '',
    }));
  }

  const sw = language === 'sw';
  const logistics = String(order.logisticsStatus || '');
  let currentKey: 'created' | 'pickup' | 'transit' | 'delivered' = 'created';

  if (order.status === 'delivered' || logistics === 'completed') {
    currentKey = 'delivered';
  } else if (
    order.status === 'in_transit' ||
    order.status === 'at_hub' ||
    ['in_transit_carrier', 'arrived_destination', 'out_for_delivery'].includes(logistics)
  ) {
    currentKey = 'transit';
  } else if (
    order.status === 'driver_at_pickup' ||
    ['first_mile_assigned', 'awaiting_hub_intake', 'received_at_hub'].includes(logistics)
  ) {
    currentKey = 'pickup';
  }

  const keys = ['created', 'pickup', 'transit', 'delivered'] as const;
  const currentIndex = keys.indexOf(currentKey);
  const labels = {
    created: sw ? 'Imeandikwa' : 'Label created',
    pickup: sw ? 'Imechukuliwa' : 'Picked up',
    transit: sw ? 'Njiani' : 'In transit',
    delivered: sw ? 'Imefika' : 'Delivered',
  };
  const times = {
    created: getTimestampMillis(order.createdAt) || eventMillis(order.logisticsEvents, ['awaiting_dispatch', 'confirmed', 'label_created']),
    pickup:
      getTimestampMillis(order.outsidePickupAt) ||
      eventMillis(order.logisticsEvents, ['first_mile_assigned', 'driver_at_pickup', 'picked_up']),
    transit:
      getTimestampMillis(order.departedAt) ||
      eventMillis(order.logisticsEvents, ['in_transit', 'in_transit_carrier', 'departed']),
    delivered:
      getTimestampMillis(order.deliveredAt) || eventMillis(order.logisticsEvents, ['delivered', 'completed']),
  };

  return keys.map((key, index) => ({
    key,
    label: labels[key],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
    timeLabel: times[key] ? formatTrackStepTime(times[key]) : '',
  }));
}

function getRelativeAgeLabel(value?: unknown) {
  const millis = getTimestampMillis(value);

  if (!millis) {
    return 'No GPS ping yet';
  }

  const ageMs = Math.max(0, Date.now() - millis);
  if (ageMs < 45000) {
    return 'Updated just now';
  }

  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) {
    return `Updated ${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function getFallbackDropoff(start: { latitude: number; longitude: number }) {
  return {
    latitude: start.latitude + 0.014,
    longitude: start.longitude + 0.019,
  };
}

function getTrackingTitle(order: DeliveryOrder, language: 'en' | 'sw' = 'en') {
  if (order.status === 'cancelled' && order.autoCancelledReason) {
    return language === 'sw' ? 'Hakuna dereva karibu' : 'No nearby driver';
  }

  if (order.status === 'cancelled') {
    return language === 'sw' ? 'Oda imeghairiwa' : 'Order cancelled';
  }

  if (order.status === 'delivered') {
    return language === 'sw' ? 'Imefika' : 'Delivered';
  }

  return getActiveOrderHeadline(order, language);
}

function getTrackingBadgeLabel(order: DeliveryOrder, language: 'en' | 'sw' = 'en') {
  if (isOutsideParcelOrder(order) && order.logisticsStatus) {
    return getOutsideLogisticsStatusLabel(order.logisticsStatus, language);
  }

  if (order.status === 'cancelled' && order.autoCancelledReason) {
    return 'No driver found';
  }

  if (order.status === 'pending_assignment') {
    if (order.driverSearchStatus === 'ops_desk') {
      return 'Office arranging pickup';
    }
    if (order.flow === 'cargo') {
      return language === 'sw' ? 'Tunatafuta rider' : 'Looking for a rider';
    }
    return order.driverSearchStatus === 'waiting_for_driver' ? 'No nearby driver' : 'Finding driver';
  }

  return getDeliveryOrderStatusLabel(order.status);
}

function shouldRetryDriverSearch(order: DeliveryOrder) {
  if (isOutsideParcelOrder(order) || order.driverSearchStatus === 'ops_desk') {
    return false;
  }
  return order.status === 'pending_assignment' && !order.driverId && order.timingMode !== 'later';
}

function isLiveTrackableOrder(order: DeliveryOrder) {
  if (isNinunulieOrder(order)) {
    return false;
  }
  if (isCargoNegotiationOpen(order)) {
    return false;
  }
  if (isOutsideParcelOrder(order) && (order.logisticsStatus === 'completed' || order.status === 'delivered')) {
    return false;
  }
  return !['delivered', 'cancelled'].includes(order.status);
}

function shouldHideOrderOnTrack(order: DeliveryOrder | null) {
  return !!order && (order.status === 'cancelled' || isNinunulieOrder(order) || isCargoNegotiationOpen(order));
}

function getDriverSearchStatusText(order: DeliveryOrder) {
  if (order.status === 'cancelled' && order.autoCancelledReason) {
    return order.driverSearchMessage || 'No online nearby driver was found in time, so this order was cancelled automatically.';
  }

  if (order.status === 'cancelled') {
    return order.driverSearchMessage || 'This order has been cancelled and is no longer being tracked live.';
  }

  if (order.driverId) {
    return `${order.driverName} is linked to this order and updates will appear here${order.driverLocationUpdatedAt ? ` with live location from ${formatDeliveryDateTime(order.driverLocationUpdatedAt)}` : ' as the trip moves forward'}.`;
  }

  if (order.driverSearchStatus === 'waiting_for_driver') {
    return order.driverSearchMessage || 'No nearby online driver matches this order yet. DoorDrop is still checking for a fair match.';
  }

  return order.driverSearchMessage || 'DoorDrop is looking for the nearest online driver for this order.';
}

function getCancellationActorLabel(cancelledBy?: DeliveryOrder['cancelledBy']) {
  if (cancelledBy === 'customer') {
    return 'Customer';
  }

  if (cancelledBy === 'driver') {
    return 'Driver';
  }

  if (cancelledBy === 'dispatch') {
    return 'Dispatch';
  }

  return 'DoorDrop';
}

export default function TrackOrderScreen() {
  const router = useRouter();
  const { profile, user } = useAuthSession();
  const copy = useAppCopy();
  const { language } = useLanguage();
  const params = useLocalSearchParams<{
    orderId?: string;
    placed?: string;
    notifyRecipient?: string;
    code?: string;
    receipt?: string;
  }>();
  const orderId = getParamValue(params.orderId);
  const placedParam = getParamValue(params.placed);
  const notifyRecipientParam = getParamValue(params.notifyRecipient);
  const codeParam = getParamValue(params.code);
  const receiptParam = getParamValue(params.receipt);
  const mapRef = useRef<any>(null);
  const [trackMapSize, setTrackMapSize] = useState({ width: 0, height: 0 });
  const [trackMapRegion, setTrackMapRegion] = useState<MapViewportRegion | null>(null);
  const nativeMaps = useMemo(() => getNativeMaps(), []);
  const NativeMapView = nativeMaps.MapView;
  const Marker = nativeMaps.Marker;
  const MarkerAnimated = nativeMaps.MarkerAnimated;
  const Polyline = nativeMaps.Polyline;
  const AnimatedRegion = nativeMaps.AnimatedRegion;
  const mapProvider = nativeMaps.provider;
  const mapCanRender =
    nativeMaps.canRender && canRenderNativeGoogleMap() && Boolean(NativeMapView && Marker && Polyline);
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [otherReasonText, setOtherReasonText] = useState('');
  const [showNotifySheet, setShowNotifySheet] = useState(false);
  const [notifyRequesting, setNotifyRequesting] = useState(false);
  const [cancelReason, setCancelReason] = useState('not_closer');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [showRatingPanel, setShowRatingPanel] = useState(false);
  const [showPlacedSheet, setShowPlacedSheet] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [smsOpening, setSmsOpening] = useState(false);
  const [whatsAppOpening, setWhatsAppOpening] = useState(false);
  const [notifySentChannel, setNotifySentChannel] = useState<'sms' | 'whatsapp' | null>(null);
  const [trackCodeInput, setTrackCodeInput] = useState('');
  const [trackLookupError, setTrackLookupError] = useState('');
  const [trackLookupLoading, setTrackLookupLoading] = useState(false);
  const trackLookupAttemptRef = useRef('');
  const countdownAnchorAttemptRef = useRef('');
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingPromptDismissedOrderId, setRatingPromptDismissedOrderId] = useState<string | null>(null);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [showDriverFound, setShowDriverFound] = useState(false);
  const [liveDrivers, setLiveDrivers] = useState<DriverRecord[]>([]);
  const [liveDriverRoute, setLiveDriverRoute] = useState<SelectedRoute | null>(null);
  const [, setDriverAnimationVersion] = useState(0);
  const wasWaitingForDriverRef = useRef(false);
  const driverAnimatedCoordinateRef = useRef<any>(null);
  const driverCoordinateSnapshotRef = useRef<RoutePoint | null>(null);
  const loadingPulse = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const liveSweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (placedParam === '1' && notifyRecipientParam !== '1') {
      setShowPlacedSheet(true);
    }
  }, [notifyRecipientParam, orderId, placedParam]);

  useEffect(() => {
    if (!order?.id || !nativeNotifications?.getPermissionsAsync) {
      return;
    }

    let active = true;
    void (async () => {
      try {
        const dismissed = await getPersistedItem(TRACK_NOTIFY_PROMPT_KEY);
        if (!active || dismissed === '1') {
          return;
        }
        const permissions = await nativeNotifications.getPermissionsAsync();
        if (!active || permissions?.status === 'granted') {
          return;
        }
        setShowNotifySheet(true);
      } catch {
        // Permission check is optional. Skip the prompt if it fails.
      }
    })();

    return () => {
      active = false;
    };
  }, [order?.id]);

  useEffect(() => {
    if (receiptParam === '1' && order) {
      setShowReceipt(true);
    }
  }, [order, receiptParam]);

  const handleTrackCodeLookup = useCallback(
    async (raw?: string) => {
      const queryText = (raw ?? trackCodeInput).trim();
      if (!queryText) {
        return;
      }

      setTrackLookupLoading(true);
      setTrackLookupError('');
      logAsyncStart(screenScope, 'lookupTrackOrderByCode', { queryText });

      try {
        const result = await lookupTrackOrderByCode(queryText);
        if (!result) {
          setTrackLookupError(copy.track.trackCodeNotFound);
          logWarning(screenScope, 'lookupTrackOrderByCode.notFound', { queryText });
          return;
        }

        setTrackCodeInput(result.parcelCode || result.orderNumber || normalizeTrackCodeInput(queryText));
        router.setParams({
          orderId: result.orderId,
          placed: '',
          notifyRecipient: '',
          code: '',
        });
        logAsyncSuccess(screenScope, 'lookupTrackOrderByCode', {
          queryText,
          orderId: result.orderId,
          source: result.source,
        });
      } catch (error) {
        logAsyncFailure(screenScope, 'lookupTrackOrderByCode', error, { queryText });
        setTrackLookupError(copy.track.trackCodeLookupFailed);
      } finally {
        setTrackLookupLoading(false);
      }
    },
    [copy.track.trackCodeLookupFailed, copy.track.trackCodeNotFound, router, trackCodeInput]
  );

  useEffect(() => {
    if (!codeParam || orderId) {
      return;
    }

    if (trackLookupAttemptRef.current === codeParam) {
      return;
    }

    trackLookupAttemptRef.current = codeParam;
    setTrackCodeInput(normalizeTrackCodeInput(codeParam));
    void handleTrackCodeLookup(codeParam);
  }, [codeParam, handleTrackCodeLookup, orderId]);

  useEffect(() => {
    if (!order) {
      return;
    }

    setTrackCodeInput(String(order.parcelCode || order.trackingId || order.orderNumber || '').trim());
  }, [order?.id]);

  useEffect(() => {
    if (!order || !isOutsideParcelOrder(order)) {
      return;
    }

    if (['delivered', 'cancelled'].includes(order.status)) {
      return;
    }

    if (resolveOutsideTrackingCountdownPlan(order)) {
      return;
    }

    if (countdownAnchorAttemptRef.current === order.id) {
      return;
    }

    countdownAnchorAttemptRef.current = order.id;
    void ensureOutsideOrderCountdownAnchor(order).catch((error) => {
      logWarning(screenScope, 'ensureOutsideOrderCountdownAnchor failed', {
        orderId: order.id,
        message: error instanceof Error ? error.message : String(error),
      });
      countdownAnchorAttemptRef.current = '';
    });
  }, [order]);

  useEffect(() => {
    if (!order || ['delivered', 'cancelled'].includes(order.status)) {
      setLiveDrivers([]);
      return;
    }

    return subscribeToDrivers(setLiveDrivers, (error) => {
      logWarning(screenScope, 'live drivers subscription failed', { message: error.message });
    });
  }, [order?.id, order?.status]);

  useEffect(() => {
    if (!orderId) {
      if (!user) {
        logWarning(screenScope, 'subscribeToOrder skipped without order id or user');
        setOrder(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      logAsyncStart(screenScope, 'subscribeToUserOrders.latestForTracking', { userId: user.uid });
      const unsubscribe = subscribeToUserOrders(
        user.uid,
        (orders) => {
          const trackableOrder = orders.find(isLiveTrackableOrder) ?? null;

          logAsyncSuccess(screenScope, 'subscribeToUserOrders.latestForTracking.update', {
            userId: user.uid,
            orderId: trackableOrder?.id ?? null,
            totalOrders: orders.length,
          });
          if (trackableOrder) {
            void autoAssignDriverToOrder(trackableOrder).catch(() => {
              logWarning(screenScope, 'autoAssignDriverToOrder.latest', {
                orderId: trackableOrder.id,
              });
            });
          }
          setOrder(trackableOrder);
          setLoading(false);
        },
        (error) => {
          logAsyncFailure(screenScope, 'subscribeToUserOrders.latestForTracking', error, { userId: user.uid });
          setOrder(null);
          setLoading(false);
        }
      );

      return () => {
        logInfo(screenScope, 'unsubscribe-user-orders-latest', { userId: user.uid });
        unsubscribe();
      };
    }

    setLoading(true);
    setOrder(null);
    logAsyncStart(screenScope, 'subscribeToOrder', { orderId });
    const unsubscribe = subscribeToOrder(
      orderId,
      (nextOrder) => {
        logInfo(screenScope, 'order-update-received', {
          orderId,
          status: nextOrder?.status ?? null,
        });
        if (shouldHideOrderOnTrack(nextOrder)) {
          setOrder(null);
          setLoading(false);
          return;
        }
        if (nextOrder) {
          void autoAssignDriverToOrder(nextOrder).catch(() => {
            logWarning(screenScope, 'autoAssignDriverToOrder', { orderId });
          });
        }
        setOrder(nextOrder);
        setLoading(false);
      },
      (error) => {
        logAsyncFailure(screenScope, 'subscribeToOrder', error, { orderId });
        setOrder(null);
        setLoading(false);
      }
    );

    return () => {
      logInfo(screenScope, 'unsubscribe-order', { orderId });
      unsubscribe();
    };
  }, [orderId, user]);

  useEffect(() => {
    if (!order || !shouldRetryDriverSearch(order)) {
      return undefined;
    }

    const retryTimer = setInterval(() => {
      void autoAssignDriverToOrder(order).catch(() => {
        logWarning(screenScope, 'autoAssignDriverToOrder.retry', { orderId: order.id });
      });
    }, 20000);

    return () => {
      clearInterval(retryTimer);
    };
  }, [order]);

  useEffect(() => {
    if (!order?.id) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    setMessagesLoading(true);
    logAsyncStart(screenScope, 'subscribeToOrderMessages', { orderId: order.id });
    const unsubscribe = subscribeToOrderMessages(
      order.id,
      (nextMessages) => {
        setMessages(nextMessages);
        setMessagesLoading(false);
        logAsyncSuccess(screenScope, 'subscribeToOrderMessages.update', {
          orderId: order.id,
          totalMessages: nextMessages.length,
        });
      },
      (error) => {
        logAsyncFailure(screenScope, 'subscribeToOrderMessages', error, { orderId: order.id });
        setMessagesLoading(false);
      }
    );

    return () => {
      logInfo(screenScope, 'unsubscribe-order-messages', { orderId: order.id });
      unsubscribe();
    };
  }, [order?.id]);

  useEffect(() => {
    if (!order) {
      setShowRatingPanel(false);
      setRatingValue(0);
      setRatingReview('');
      setRatingPromptDismissedOrderId(null);
      return;
    }

    if (hasDeliveryOrderRating(order)) {
      setRatingValue(order.customerRating ?? 0);
      setRatingReview(order.customerReview?.trim() || '');
      return;
    }

    if (order.status !== 'delivered') {
      setShowRatingPanel(false);
      setRatingValue(0);
      setRatingReview('');
      setRatingPromptDismissedOrderId(null);
      return;
    }

    if (ratingPromptDismissedOrderId !== order.id && !showRatingPanel) {
      setShowRatingPanel(true);
    }
  }, [order, ratingPromptDismissedOrderId, showRatingPanel]);

  const pickupPoint = useMemo(() => {
    if (order?.pickupLatitude !== undefined && order.pickupLongitude !== undefined) {
      return {
        latitude: order.pickupLatitude,
        longitude: order.pickupLongitude,
      };
    }

    return {
      latitude: -6.7924,
      longitude: 39.2083,
    };
  }, [order?.pickupLatitude, order?.pickupLongitude]);

  const dropoffPoint = useMemo(() => {
    if (order && isIntercityOrder(order)) {
      if (
        typeof order.outsideDestinationLatitude === 'number' &&
        typeof order.outsideDestinationLongitude === 'number' &&
        isValidCoordinate({
          latitude: order.outsideDestinationLatitude,
          longitude: order.outsideDestinationLongitude,
        })
      ) {
        return {
          latitude: order.outsideDestinationLatitude,
          longitude: order.outsideDestinationLongitude,
        };
      }

      const destinationCity = findOutsideCityByLabel(order.outsideDestinationCity || order.outsideDestinationLabel);
      if (destinationCity?.centerPoint && isValidCoordinate(destinationCity.centerPoint)) {
        return destinationCity.centerPoint;
      }
    }

    if (order?.dropoffLatitude !== undefined && order.dropoffLongitude !== undefined) {
      return {
        latitude: order.dropoffLatitude,
        longitude: order.dropoffLongitude,
      };
    }

    return getFallbackDropoff(pickupPoint);
  }, [
    order,
    order?.dropoffLatitude,
    order?.dropoffLongitude,
    order?.outsideDestinationCity,
    order?.outsideDestinationLabel,
    order?.outsideDestinationLatitude,
    order?.outsideDestinationLongitude,
    pickupPoint,
  ]);

  const driverPoint = useMemo(() => {
    if (order?.driverLatitude !== undefined && order.driverLongitude !== undefined) {
      return {
        latitude: order.driverLatitude,
        longitude: order.driverLongitude,
      };
    }

    return null;
  }, [order?.driverLatitude, order?.driverLongitude]);
  const validPickupPoint = isValidCoordinate(pickupPoint) ? pickupPoint : null;
  const validDropoffPoint = isValidCoordinate(dropoffPoint) ? dropoffPoint : null;
  const validDriverPoint = isValidCoordinate(driverPoint) ? driverPoint : null;
  const routeLinePoints = useMemo(() => {
    if (routeEstimate?.coordinates.length) {
      return filterValidCoordinates(routeEstimate.coordinates);
    }

    return filterValidCoordinates([pickupPoint, dropoffPoint]);
  }, [dropoffPoint, pickupPoint, routeEstimate?.coordinates]);
  const isBusTrack = Boolean(order && isBusCustomerParcel(order));
  const hasLiveMap = mapCanRender && !isBusTrack;
  const isWaitingForDriver =
    !!order &&
    order.status === 'pending_assignment' &&
    !order.driverId &&
    !isOutsideParcelOrder(order);
  const isOrderAlive = !!order && !['delivered', 'cancelled'].includes(order.status);
  const orderVehicleKey = getMapVehicleKey({
    flow: order?.flow,
    cargoVehicleKey: order?.cargoVehicleKey,
    driverVehicleType: order?.driverVehicleType,
    serviceLabel: order?.serviceLabel,
  });
  const nearbyDriverMarkers = useMemo(() => {
    if (
      !validPickupPoint ||
      !order ||
      ['delivered', 'cancelled'].includes(order.status) ||
      order.driverId
    ) {
      return [];
    }

    return liveDrivers
      .filter((driver) => {
        if (!driver.isAvailable || driver.id === order.driverId) {
          return false;
        }

        const driverVehicleKey = getMapVehicleKey({
          cargoVehicleKey: driver.vehicleType,
          driverVehicleType: driver.vehicleType,
          serviceLabel: driver.vehicleLabel,
        });

        return driverVehicleKey === orderVehicleKey;
      })
      .map((driver) => {
        const coordinate = {
          latitude: driver.currentLatitude ?? Number.NaN,
          longitude: driver.currentLongitude ?? Number.NaN,
        };

        if (!isValidCoordinate(coordinate)) {
          return null;
        }

        const distanceMeters = getDistanceBetweenPoints(validPickupPoint, coordinate);
        if (distanceMeters > 12000) {
          return null;
        }

        return {
          id: driver.id,
          coordinate,
          title: driver.fullName || 'DoorDrop driver',
          description: `${driver.vehicleLabel || orderVehicleKey} • ${formatDistance(distanceMeters)} away`,
          distanceMeters,
        };
      })
      .filter((driver): driver is NonNullable<typeof driver> => Boolean(driver))
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .slice(0, 6);
  }, [liveDrivers, order, orderVehicleKey, validPickupPoint]);
  const driverLocationMillis = getTimestampMillis(order?.driverLocationUpdatedAt);
  const driverLocationAgeMs = driverLocationMillis ? Math.max(0, Date.now() - driverLocationMillis) : null;
  const hasDriverGpsPoint = !!order?.driverId && !!validDriverPoint;
  const hasFreshDriverGpsPoint =
    hasDriverGpsPoint && driverLocationAgeMs !== null && driverLocationAgeMs <= 1000 * 60 * 5;
  const driverGpsAgeLabel = getRelativeAgeLabel(order?.driverLocationUpdatedAt);
  const driverTelemetryLabel =
    typeof order?.driverSpeedKph === 'number' && Number.isFinite(order.driverSpeedKph)
      ? `${driverGpsAgeLabel} - ${Math.max(0, Math.round(order.driverSpeedKph))} km/h`
      : driverGpsAgeLabel;
  const liveRouteDestination = useMemo(() => {
    if (!order) {
      return null;
    }

    if (order.status === 'driver_assigned' && validPickupPoint) {
      return { point: validPickupPoint, key: `pickup:${order.id}`, kind: 'pickup' as const };
    }

    if (order.status === 'in_transit' && validDropoffPoint) {
      return { point: validDropoffPoint, key: `dropoff:${order.id}`, kind: 'dropoff' as const };
    }

    return null;
  }, [order?.id, order?.status, validDropoffPoint, validPickupPoint]);
  const quantizedDriverPoint = useMemo(() => {
    if (!validDriverPoint) {
      return null;
    }

    return quantizeRoutePoint(validDriverPoint);
  }, [
    validDriverPoint
      ? Math.round(validDriverPoint.latitude / 0.0009)
      : null,
    validDriverPoint
      ? Math.round(validDriverPoint.longitude / 0.0009)
      : null,
  ]);
  const driverApproachLinePoints = useMemo(() => {
    if (!validDriverPoint || !liveRouteDestination) {
      return [];
    }

    if (liveDriverRoute && liveDriverRoute.coordinates.length > 2) {
      return trimRouteFromPoint(liveDriverRoute.coordinates, validDriverPoint);
    }

    return [];
  }, [liveDriverRoute, liveRouteDestination, validDriverPoint]);
  const snappedDriverPoint = useMemo(() => {
    if (!validDriverPoint) {
      return null;
    }

    if (driverApproachLinePoints.length < 2) {
      return validDriverPoint;
    }

    const nearest = getNearestCoordinateIndex(driverApproachLinePoints, validDriverPoint);
    return nearest.distance <= 80 ? driverApproachLinePoints[nearest.index] : validDriverPoint;
  }, [driverApproachLinePoints, validDriverPoint]);
  const arrivalEtaSeconds = useMemo(() => {
    if (order?.status === 'driver_at_pickup' && routeEstimate?.durationSeconds) {
      return routeEstimate.durationSeconds;
    }

    if (liveDriverRoute) {
      const remainingPoints =
        driverApproachLinePoints.length >= 2 ? driverApproachLinePoints : liveDriverRoute.coordinates;
      const remainingDistance = getPolylineDistanceMeters(remainingPoints);
      const originalDistance = liveDriverRoute.distanceMeters || getPolylineDistanceMeters(liveDriverRoute.coordinates);

      if (originalDistance > 0 && liveDriverRoute.durationSeconds > 0) {
        return Math.max(45, Math.round(liveDriverRoute.durationSeconds * (remainingDistance / originalDistance)));
      }

      if (liveDriverRoute.durationSeconds > 0) {
        return liveDriverRoute.durationSeconds;
      }
    }

    if (validDriverPoint && liveRouteDestination) {
      const remainingMeters = getDistanceBetweenPoints(validDriverPoint, liveRouteDestination.point);
      const speedMps =
        typeof order?.driverSpeedKph === 'number' && order.driverSpeedKph > 8
          ? order.driverSpeedKph / 3.6
          : isIntercityOrder(order)
            ? 16
            : 8.5;
      return Math.max(45, Math.round(remainingMeters / speedMps));
    }

    return null;
  }, [
    driverApproachLinePoints,
    liveDriverRoute,
    liveRouteDestination,
    order,
    routeEstimate?.durationSeconds,
    validDriverPoint,
  ]);
  const arrivalEtaLabel = arrivalEtaSeconds
    ? formatEtaByScope(arrivalEtaSeconds, isIntercityOrder(order) ? 'intercity' : 'city')
    : '';
  const arrivalEtaHint =
    order?.status === 'driver_at_pickup' || liveRouteDestination?.kind === 'dropoff'
      ? copy.track.etaDropoff
      : copy.track.etaPickup;
  const outsideTrackingCountdown = useMemo(() => {
    if (!order || !isOutsideParcelOrder(order)) {
      return null;
    }

    return resolveOutsideTrackingCountdownPlan(order);
  }, [order]);
  const driverEtaDeadlineMs = useMemo(() => {
    if (!arrivalEtaSeconds || !order || isOutsideParcelOrder(order)) {
      return null;
    }

    return Date.now() + arrivalEtaSeconds * 1000;
  }, [arrivalEtaSeconds, order]);
  const driverEtaStartedAtMs = useMemo(() => {
    if (!arrivalEtaSeconds || !driverEtaDeadlineMs) {
      return null;
    }

    return driverEtaDeadlineMs - arrivalEtaSeconds * 1000;
  }, [arrivalEtaSeconds, driverEtaDeadlineMs]);
  const trackingCountdownDeadlineMs =
    outsideTrackingCountdown?.deadlineMs ?? driverEtaDeadlineMs;
  const trackingCountdownStartedAtMs =
    outsideTrackingCountdown?.startedAtMs ?? driverEtaStartedAtMs;
  const trackingCountdownLabel = outsideTrackingCountdown
    ? language === 'sw'
      ? 'Muda uliobaki'
      : 'Time left'
    : language === 'sw'
      ? 'Dereva'
      : 'Driver';
  const showTrackingCountdown =
    !!order &&
    !['delivered', 'cancelled'].includes(order.status) &&
    Boolean(trackingCountdownDeadlineMs);
  const mapLiveStatusLabel =
    order?.status === 'delivered'
      ? 'Delivery completed'
      : order?.status === 'cancelled'
        ? 'Tracking closed'
        : isWaitingForDriver
          ? 'Searching nearby drivers'
          : hasFreshDriverGpsPoint
            ? 'Live driver GPS'
            : hasDriverGpsPoint
              ? 'Last known driver GPS'
              : order?.driverId
                ? 'Waiting for driver GPS'
                : 'Driver not assigned yet';
  const mapLiveStatusDetail =
    order?.status === 'delivered'
      ? `Marked delivered ${formatDeliveryDateTime(order.deliveredAt ?? order.updatedAt)}.`
      : order?.status === 'cancelled'
        ? `Closed ${formatDeliveryDateTime(order.cancelledAt ?? order.updatedAt)}.`
        : isWaitingForDriver
          ? 'DoorDrop is still matching an online driver for this order.'
          : hasDriverGpsPoint
            ? driverTelemetryLabel
            : order?.driverId
              ? 'The driver app has not sent a location point yet.'
              : 'Pickup and drop-off route is ready.';
  const mapFocusPoints = useMemo(() => {
    if (validDriverPoint && order?.status && ['driver_assigned', 'driver_at_pickup'].includes(order.status)) {
      return filterValidCoordinates([validDriverPoint, validPickupPoint]);
    }

    if (validDriverPoint && order?.status && ['in_transit', 'delivered'].includes(order.status)) {
      return filterValidCoordinates([validPickupPoint, validDropoffPoint, validDriverPoint]);
    }

    if (routeLinePoints.length > 2) {
      return routeLinePoints;
    }

    return filterValidCoordinates([validPickupPoint, validDropoffPoint]);
  }, [order?.status, routeLinePoints, validDriverPoint, validDropoffPoint, validPickupPoint]);
  const mapEdgePadding = useMemo(
    () => ({ top: 76, right: 40, bottom: 44, left: 40 }),
    []
  );
  const outsideLogisticsRank: Record<string, number> = {
    awaiting_dispatch: 0,
    first_mile_assigned: 1,
    awaiting_hub_intake: 2,
    received_at_hub: 3,
    in_transit_carrier: 4,
    arrived_destination: 5,
    out_for_delivery: 5,
    completed: 6,
  };
  const progressSteps = order
    ? isOutsideParcelOrder(order)
      ? (() => {
          const rank = outsideLogisticsRank[String(order.logisticsStatus || 'awaiting_dispatch')] ?? 0;
          return [
            { title: language === 'sw' ? 'Imethibitishwa' : 'Confirmed', active: rank >= 0 },
            { title: language === 'sw' ? 'Inachukuliwa' : 'Collecting', active: rank >= 1 },
            { title: language === 'sw' ? 'Ofisini' : 'At office', active: rank >= 3 },
            { title: language === 'sw' ? 'Njiani' : 'In transit', active: rank >= 4 },
            { title: language === 'sw' ? 'Imefika' : 'Arrived', active: rank >= 5 },
            { title: language === 'sw' ? 'Imepokelewa' : 'Received', active: rank >= 6 },
          ];
        })()
      : [
          { title: copy.track.stepReceived, active: true },
          {
            title: copy.track.stepDriver,
            active: statusRank[order.status] >= statusRank.driver_assigned,
          },
          {
            title: copy.track.stepTransit,
            active: statusRank[order.status] >= statusRank.in_transit,
          },
          {
            title: copy.track.stepDelivered,
            active: statusRank[order.status] >= statusRank.delivered,
          },
        ]
    : [];
  const statusHeadline = order
    ? getTrackingTitle(order, language)
    : copy.track.cancelled;
  const statusDetail =
    order && isOutsideParcelOrder(order)
      ? (() => {
          const logisticsLabel = getOutsideLogisticsStatusLabel(order.logisticsStatus, language);
          const logistics = String(order.logisticsStatus || 'awaiting_dispatch');
          const preferLogistics =
            ['awaiting_hub_intake', 'received_at_hub', 'in_transit_carrier', 'arrived_destination', 'out_for_delivery', 'completed'].includes(
              logistics
            ) || !order.driverSearchMessage;
          const detail = preferLogistics ? logisticsLabel : order.driverSearchMessage || logisticsLabel;
          const codePrefix =
            order.parcelCode
              ? language === 'sw'
                ? `Namba ya mzigo ${order.parcelCode}. `
                : `Parcel code ${order.parcelCode}. `
              : '';
          return `${codePrefix}${detail}`;
        })()
      : order?.status === 'pending_assignment'
        ? order.flow === 'cargo'
          ? copy.track.searchingRiderBody.replace('{amount}', order.fareLabel || order.totalLabel)
          : copy.track.lookingText
        : arrivalEtaLabel
          ? copy.track.arrivesIn.replace('{eta}', arrivalEtaLabel)
          : order
            ? getDriverSearchStatusText(order)
            : '';
  const outsideParcelCode = order && isOutsideParcelOrder(order) ? String(order.parcelCode || order.trackingId || '').trim() : '';
  const isOutsideWaitingOffice =
    !!order && isOutsideParcelOrder(order) && !order.driverId && order.status === 'pending_assignment';
  const isOutsidePostHub =
    !!order && isOutsideParcelOrder(order) && isOutsidePostHubPhase(order);
  const outsideOriginLabel =
    order && isOutsideParcelOrder(order)
      ? String(order.outsideOriginCity || '').trim() || 'Dar es Salaam'
      : '';
  const outsideDestLabel =
    order && isOutsideParcelOrder(order)
      ? String(order.outsideDestinationCity || order.dropoffLabel || '').trim()
      : '';
  const outsideTransportIcon = getOutsideTransportIconName(order?.outsideShippingMode, order?.outsideHandoffMode);
  const outsideTransportLabel = getOutsideTransportLabel(order?.outsideShippingMode, order?.outsideHandoffMode);
  const routeDisplay = useMemo(() => getOrderRouteDisplay(order), [order]);
  const liveStatusLabel = isOutsideWaitingOffice
    ? 'Office desk'
    : isWaitingForDriver
    ? 'Searching live'
    : hasFreshDriverGpsPoint
      ? 'Live GPS active'
      : hasDriverGpsPoint
        ? 'Last GPS point saved'
        : order?.driverId
          ? 'Waiting for driver GPS'
      : 'Order channel active';
  const liveStatusDetail = isOutsideWaitingOffice
    ? 'Central office will assign a rider to bring your parcel to the DoorDrop hub.'
    : hasDriverGpsPoint
    ? `${driverTelemetryLabel} from ${order?.driverName || 'driver'}`
    : order?.driverId
      ? 'Listening for the first GPS point from the driver app.'
      : order?.updatedAt
      ? `Last order update ${formatDeliveryDateTime(order.updatedAt)}`
      : 'Listening for dispatch updates';
  const driverPhone = readablePhone(order?.driverPhone);
  const hasDriverPhone = driverPhone.length > 0;
  const busParcelCode = isBusTrack && order ? getReceiptTrackingCode(order) : '';
  const busAgentName = isBusTrack
    ? String(order?.carrierAgentName || order?.carrierName || '').trim()
    : '';
  const busLineName = isBusTrack
    ? String(order?.carrierBusName || order?.carrierRouteLabel || '').trim()
    : '';
  const busCarrierPhone = isBusTrack ? readablePhone(order?.carrierPhone) : '';
  const hasBusCarrierPhone = busCarrierPhone.length > 0;
  const isBusSearching =
    isBusTrack && order?.carrierMatchStatus !== 'offered' && order?.carrierMatchStatus !== 'accepted';
  const busAgentLabel = language === 'sw' ? 'Wakala' : 'Agent';
  const busNameLabel = language === 'sw' ? 'Basi' : 'Bus';
  const canCancelOrder =
    !!order &&
    !['delivered', 'cancelled'].includes(order.status) &&
    (!isOutsideParcelOrder(order) || canCancelOutsideParcel(order));
  const cancellationReason = order?.cancellationReason?.trim() || '';
  const canMessageDriver =
    !!order?.driverId &&
    !!user?.uid &&
    user.uid === order.userId &&
    !['delivered', 'cancelled'].includes(order.status) &&
    !(isOutsideParcelOrder(order) && isOutsidePostHubPhase(order));
  const orderHasRating = hasDeliveryOrderRating(order);
  const canRateOrder = !!order && order.status === 'delivered' && !!user?.uid && user.uid === order.userId;
  const ratingBadgeLabel = orderHasRating
    ? `${order?.customerRating}/5`
    : order?.status === 'delivered'
      ? 'Rate trip'
      : 'Live';

  useEffect(() => {
    if (isWaitingForDriver) {
      wasWaitingForDriverRef.current = true;
      setShowDriverFound(false);
      return;
    }

    if (wasWaitingForDriverRef.current && order?.driverId && order.status !== 'cancelled') {
      wasWaitingForDriverRef.current = false;
      setShowDriverFound(true);
      const timeoutId = setTimeout(() => {
        setShowDriverFound(false);
      }, 3800);
      return () => clearTimeout(timeoutId);
    }
  }, [isWaitingForDriver, order?.driverId, order?.status]);

  useEffect(() => {
    if (!loading) {
      loadingPulse.stopAnimation();
      loadingPulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(loadingPulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(loadingPulse, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [loading, loadingPulse]);

  useEffect(() => {
    if (!isOrderAlive) {
      livePulse.stopAnimation();
      liveSweep.stopAnimation();
      livePulse.setValue(0);
      liveSweep.setValue(0);
      return;
    }

    liveSweep.setValue(0);

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, {
          toValue: 1,
          duration: 950,
          useNativeDriver: true,
        }),
        Animated.timing(livePulse, {
          toValue: 0,
          duration: 950,
          useNativeDriver: true,
        }),
      ])
    );
    const sweepAnimation = Animated.loop(
      Animated.timing(liveSweep, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
      })
    );

    pulseAnimation.start();
    sweepAnimation.start();

    return () => {
      pulseAnimation.stop();
      sweepAnimation.stop();
    };
  }, [isOrderAlive, livePulse, liveSweep]);

  useEffect(() => {
    let isMounted = true;

    if (!order?.id || isBusCustomerParcel(order) || !validPickupPoint || !validDropoffPoint) {
      setRouteEstimate(null);
      return () => {
        isMounted = false;
      };
    }

    logAsyncStart(screenScope, 'fetchTrackingRouteEstimate', { orderId: order.id });
    fetchRouteEstimate(validPickupPoint, validDropoffPoint)
      .then((estimate) => {
        if (!isMounted) {
          return;
        }

        setRouteEstimate(estimate);
        logAsyncSuccess(screenScope, 'fetchTrackingRouteEstimate', {
          orderId: order.id,
          distanceMeters: estimate.distanceMeters,
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setRouteEstimate(null);
        logWarning(screenScope, 'fetchTrackingRouteEstimate:failure', { orderId: order.id });
      });

    return () => {
      isMounted = false;
    };
  }, [order, order?.id, validDropoffPoint, validPickupPoint]);

  useEffect(() => {
    if (!liveRouteDestination || !isOrderAlive || isBusCustomerParcel(order)) {
      setLiveDriverRoute(null);
      return;
    }

    if (!quantizedDriverPoint) {
      return;
    }

    let isMounted = true;
    fetchRoadFollowingRoute(quantizedDriverPoint, liveRouteDestination.point)
      .then((route) => {
        if (!isMounted || !route) {
          return;
        }

        setLiveDriverRoute(route);
      })
      .catch(() => {
        logWarning(screenScope, 'live driver road route missed', {
          orderId: order?.id,
          kind: liveRouteDestination.kind,
        });
      });

    return () => {
      isMounted = false;
    };
  }, [isOrderAlive, liveRouteDestination, order, order?.id, quantizedDriverPoint]);

  useEffect(() => {
    driverAnimatedCoordinateRef.current = null;
    driverCoordinateSnapshotRef.current = null;
  }, [order?.id]);

  useEffect(() => {
    if (!AnimatedRegion || !snappedDriverPoint) {
      driverAnimatedCoordinateRef.current = null;
      driverCoordinateSnapshotRef.current = null;
      return;
    }

    if (!driverAnimatedCoordinateRef.current) {
      driverAnimatedCoordinateRef.current = new AnimatedRegion({
        latitude: snappedDriverPoint.latitude,
        longitude: snappedDriverPoint.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
      });
      driverCoordinateSnapshotRef.current = snappedDriverPoint;
      setDriverAnimationVersion((value) => value + 1);
      return;
    }

    const previous = driverCoordinateSnapshotRef.current;
    if (previous && getDistanceBetweenPoints(previous, snappedDriverPoint) < 3) {
      return;
    }

    driverAnimatedCoordinateRef.current
      .timing({
        latitude: snappedDriverPoint.latitude,
        longitude: snappedDriverPoint.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration: LIVE_DRIVER_MARKER_ANIMATION_MS,
        toValue: 0,
        useNativeDriver: false,
      })
      .start();
    driverCoordinateSnapshotRef.current = snappedDriverPoint;
  }, [AnimatedRegion, snappedDriverPoint]);

  useEffect(() => {
    if (!hasLiveMap || mapFocusPoints.length === 0) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (mapFocusPoints.length === 1) {
        mapRef.current?.animateToRegion?.(
          {
            latitude: mapFocusPoints[0].latitude,
            longitude: mapFocusPoints[0].longitude,
            latitudeDelta: 0.028,
            longitudeDelta: 0.028,
          },
          500
        );
        return;
      }

      mapRef.current?.fitToCoordinates?.(mapFocusPoints, {
        edgePadding: mapEdgePadding,
        animated: true,
      });
    }, 250);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasLiveMap, mapEdgePadding, mapFocusPoints]);

  const handleOpenRatingPanel = () => {
    if (!order) {
      return;
    }

    setRatingValue(order.customerRating ?? 0);
    setRatingReview(order.customerReview?.trim() || '');
    setRatingPromptDismissedOrderId(null);
    setShowRatingPanel(true);
  };

  const handleCloseRatingPanel = () => {
    if (ratingSubmitting) {
      return;
    }

    if (order?.status === 'delivered' && !orderHasRating) {
      setRatingPromptDismissedOrderId(order.id);
    }

    setShowRatingPanel(false);
  };

  const handleCallBusAgent = async () => {
    if (!hasBusCarrierPhone) {
      return;
    }

    logAsyncStart(screenScope, 'handleCallBusAgent', { hasPhone: true });

    try {
      await openPhoneDialer(busCarrierPhone);
      logAsyncSuccess(screenScope, 'handleCallBusAgent');
    } catch (error) {
      logAsyncFailure(screenScope, 'handleCallBusAgent', error);
      Alert.alert(
        language === 'sw' ? 'Imeshindikana kufungua simu' : 'Unable to place call',
        busCarrierPhone
      );
    }
  };

  const handleCallDriver = async () => {
    if (!hasDriverPhone) {
      logWarning(screenScope, 'handleCallDriver without driver phone');
      Alert.alert(
        language === 'sw' ? 'Simu bado haijawekwa' : 'Driver phone pending',
        language === 'sw'
          ? 'Namba ya dereva itaonekana hapa akishapokea oda.'
          : 'The driver number will appear here as soon as they take the order.'
      );
      return;
    }

    logAsyncStart(screenScope, 'handleCallDriver', { hasPhone: true });

    try {
      await openPhoneDialer(driverPhone);
      logAsyncSuccess(screenScope, 'handleCallDriver');
    } catch (error) {
      logAsyncFailure(screenScope, 'handleCallDriver', error);
      Alert.alert(
        language === 'sw' ? 'Imeshindikana kufungua simu' : 'Unable to place call',
        driverPhone
      );
    }
  };

  const handleShareTrip = async () => {
    if (!order) {
      logWarning(screenScope, 'handleShareTrip skipped without order');
      return;
    }

    const shareMessage = [
      `DoorDrop trip ${order.orderNumber}`,
      routeDisplay.shareLabel,
      `Status: ${getDeliveryOrderStatusLabel(order.status)}`,
      order.driverName ? `Driver: ${order.driverName}` : '',
      driverPhone ? `Phone: ${driverPhone}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    logAsyncStart(screenScope, 'handleShareTrip', { orderId: order.id });

    try {
      await Share.share({
        title: order.orderNumber,
        message: shareMessage,
      });
      logAsyncSuccess(screenScope, 'handleShareTrip', { orderId: order.id });
    } catch (error) {
      logAsyncFailure(screenScope, 'handleShareTrip', error, { orderId: order.id });
      Alert.alert('Unable to share trip', 'Please try sharing this tracking update again.');
    }
  };

  const handleSmsRecipient = async () => {
    if (!order || !isNotifiableRecipientPhone(order.recipientPhone)) {
      return;
    }

    try {
      await openRecipientSms(
        order.recipientPhone,
        buildRecipientNotifyBody(order, {
          isSw: language === 'sw',
          senderName: order.customerName || profile?.fullName || 'DoorDrop',
          transportLabel: getOutsideTransportLabel(order.outsideShippingMode, order.outsideHandoffMode),
          isOutside: isOutsideParcelOrder(order),
        })
      );
    } catch {
      Alert.alert(copy.help.callFailed, copy.track.smsRecipient);
    }
  };

  const dismissPlacedSheet = () => {
    setShowPlacedSheet(false);
    setNotifySentChannel(null);
    router.setParams({ placed: '', notifyRecipient: '' });
  };

  const buildPlacedNotifyMessage = () => {
    if (!order) {
      return '';
    }

    return buildRecipientNotifyBody(order, {
      isSw: language === 'sw',
      senderName: order.customerName || profile?.fullName || 'DoorDrop',
      transportLabel: getOutsideTransportLabel(order.outsideShippingMode, order.outsideHandoffMode),
      isOutside: isOutsideParcelOrder(order),
    });
  };

  const handlePlacedNotifySms = async () => {
    if (!order || !isNotifiableRecipientPhone(order.recipientPhone)) {
      dismissPlacedSheet();
      return;
    }

    setSmsOpening(true);
    try {
      await openRecipientSms(order.recipientPhone, buildPlacedNotifyMessage());
      setNotifySentChannel('sms');
    } catch {
      Alert.alert(copy.help.callFailed, copy.track.smsRecipient);
    } finally {
      setSmsOpening(false);
    }
  };

  const handlePlacedNotifyWhatsApp = async () => {
    if (!order || !isNotifiableRecipientPhone(order.recipientPhone)) {
      dismissPlacedSheet();
      return;
    }

    setWhatsAppOpening(true);
    try {
      await openRecipientWhatsApp(order.recipientPhone, buildPlacedNotifyMessage());
      setNotifySentChannel('whatsapp');
    } catch {
      Alert.alert(copy.help.callFailed, copy.track.whatsAppUnavailable);
    } finally {
      setWhatsAppOpening(false);
    }
  };

  const handleOpenAdminWhatsApp = async () => {
    if (!order) {
      return;
    }

    try {
      await openSupportWhatsApp(
        buildAdminWhatsAppOrderMessage({
          orderNumber: order.orderNumber,
          isSw: language === 'sw',
          origin: outsideOriginLabel,
          destination: outsideDestLabel,
        })
      );
    } catch {
      Alert.alert(copy.help.whatsappFailed, copy.help.whatsappHint.replace('{phone}', SUPPORT_PHONE_LABEL));
    }
  };

  const handleCopyParcelCode = async () => {
    if (!outsideParcelCode) {
      return;
    }

    try {
      const clipboardModule = await import('expo-clipboard').catch(() => null);
      if (clipboardModule?.setStringAsync) {
        await clipboardModule.setStringAsync(outsideParcelCode);
        Alert.alert(language === 'sw' ? 'Imenakiliwa' : 'Copied', outsideParcelCode);
        return;
      }
    } catch {
      // Fall through to share sheet.
    }

    await Share.share({ message: outsideParcelCode });
  };

  const handleSubmitCancelOrder = (reason: string) => {
    if (!order || !canCancelOrder || cancelSubmitting) {
      return;
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 4) {
      setCancelError(copy.track.cancelReasonRequired);
      return;
    }

    void (async () => {
      try {
        logAsyncStart(screenScope, 'cancelDeliveryOrderByUser', {
          orderId: order.id,
          reason: trimmedReason,
        });
        setCancelSubmitting(true);
        setCancelError('');
        setShowCancelConfirm(false);
        setShowCancelPanel(false);
        setCancelReason(trimmedReason);
        void recordAppActivity({
          userId: user?.uid,
          userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
          userRole: 'customer',
          eventName: 'order_cancel_started',
          featureKey: 'order_cancellation',
          featureLabel: 'Order cancellation',
          screen: 'track_order',
          route: '/track-order',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            serviceLabel: order.serviceLabel,
            reason: trimmedReason,
          },
        });
        await cancelDeliveryOrderByUser(order.id, trimmedReason);
        setShowCancelPanel(false);
        setShowCancelConfirm(false);
        setCancelReason('not_closer');
        setOtherReasonText('');
        setOrder(null);
        router.replace('/home');
        logAsyncSuccess(screenScope, 'cancelDeliveryOrderByUser', { orderId: order.id });
        void recordAppActivity({
          userId: user?.uid,
          userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
          userRole: 'customer',
          eventName: 'order_cancelled',
          featureKey: 'order_cancellation',
          featureLabel: 'Order cancellation',
          screen: 'track_order',
          route: '/track-order',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            serviceLabel: order.serviceLabel,
            reason: trimmedReason,
          },
        });
      } catch (error) {
        logAsyncFailure(screenScope, 'cancelDeliveryOrderByUser', error, {
          orderId: order.id,
          reason: trimmedReason,
        });
        void recordAppActivity({
          userId: user?.uid,
          userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
          userRole: 'customer',
          eventName: 'order_cancel_failed',
          featureKey: 'order_cancellation',
          featureLabel: 'Order cancellation',
          screen: 'track_order',
          route: '/track-order',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            serviceLabel: order.serviceLabel,
            reason: trimmedReason,
          },
        });
        setCancelError(error instanceof Error ? error.message : copy.track.cancelReasonRequired);
      } finally {
        setCancelSubmitting(false);
      }
    })();
  };

  const handleSendMessage = async () => {
    if (!order || !user?.uid) {
      Alert.alert('Sign in required', 'Sign in with the account that placed this order to message the driver.');
      return;
    }

    if (user.uid !== order.userId) {
      Alert.alert('Chat unavailable', 'Only the account that placed this order can message the assigned driver.');
      return;
    }

    if (!order.driverId) {
      Alert.alert('Driver pending', 'Dispatch will enable in-app chat as soon as a driver is assigned.');
      return;
    }

    const trimmedMessage = messageDraft.trim();
    if (!trimmedMessage) {
      return;
    }

    setMessageSending(true);
    logAsyncStart(screenScope, 'sendOrderMessage.customer', { orderId: order.id });

    try {
      await sendOrderMessage({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.userId,
        driverId: order.driverId,
        senderId: user.uid,
        senderRole: 'customer',
        senderName: profile?.fullName?.trim() || user.displayName?.trim() || order.customerName || 'DoorDrop customer',
        message: trimmedMessage,
      });
      setMessageDraft('');
      logAsyncSuccess(screenScope, 'sendOrderMessage.customer', { orderId: order.id });
    } catch (error) {
      logAsyncFailure(screenScope, 'sendOrderMessage.customer', error, { orderId: order.id });
      Alert.alert(
        'Message not sent',
        error instanceof Error ? error.message : 'Please try sending your message again.'
      );
    } finally {
      setMessageSending(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!order || !user?.uid || user.uid !== order.userId) {
      Alert.alert('Rating unavailable', 'Please sign in with the account that placed this order to rate it.');
      return;
    }

    if (ratingValue < 1 || ratingValue > 5) {
      Alert.alert('Choose a star rating', 'Tap between 1 and 5 stars before submitting your review.');
      return;
    }

    setRatingSubmitting(true);
    void recordAppActivity({
      userId: user.uid,
      userName: profile?.fullName || user.displayName || user.email || 'DoorDrop User',
      userRole: 'customer',
      eventName: 'delivery_rating_started',
      featureKey: 'delivery_rating',
      featureLabel: 'Delivery rating',
      screen: 'track_order',
      route: '/track-order',
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        serviceLabel: order.serviceLabel,
        rating: ratingValue,
        hasReview: Boolean(ratingReview.trim()),
      },
    });
    logAsyncStart(screenScope, 'submitDeliveryOrderRating', {
      orderId: order.id,
      ratingValue,
    });

    try {
      await submitDeliveryOrderRating({
        orderId: order.id,
        userId: user.uid,
        rating: ratingValue,
        review: ratingReview,
      });
      setRatingPromptDismissedOrderId(null);
      setShowRatingPanel(false);
      logAsyncSuccess(screenScope, 'submitDeliveryOrderRating', {
        orderId: order.id,
        ratingValue,
      });
      void recordAppActivity({
        userId: user.uid,
        userName: profile?.fullName || user.displayName || user.email || 'DoorDrop User',
        userRole: 'customer',
        eventName: 'delivery_rating_submitted',
        featureKey: 'delivery_rating',
        featureLabel: 'Delivery rating',
        screen: 'track_order',
        route: '/track-order',
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          serviceLabel: order.serviceLabel,
          rating: ratingValue,
          hasReview: Boolean(ratingReview.trim()),
        },
      });
    } catch (error) {
      logAsyncFailure(screenScope, 'submitDeliveryOrderRating', error, {
        orderId: order.id,
        ratingValue,
      });
      void recordAppActivity({
        userId: user.uid,
        userName: profile?.fullName || user.displayName || user.email || 'DoorDrop User',
        userRole: 'customer',
        eventName: 'delivery_rating_failed',
        featureKey: 'delivery_rating',
        featureLabel: 'Delivery rating',
        screen: 'track_order',
        route: '/track-order',
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          serviceLabel: order.serviceLabel,
          rating: ratingValue,
          hasReview: Boolean(ratingReview.trim()),
        },
      });
      Alert.alert(
        'Rating not saved',
        error instanceof Error ? error.message : 'Please try sending your rating again.'
      );
    } finally {
      setRatingSubmitting(false);
    }
  };

  const showMap =
    hasLiveMap &&
    !!order &&
    Boolean(NativeMapView && Marker && Polyline) &&
    Boolean(validPickupPoint || validDropoffPoint || validDriverPoint || routeLinePoints.length >= 2);
  const shipmentSteps = order ? buildShipmentSteps(order, language) : [];
  const pickupCity = shortPlaceName(String(order?.outsideOriginCity || routeDisplay.from || ''));
  const dropoffCity = shortPlaceName(String(order?.outsideDestinationCity || routeDisplay.to || ''));
  const statusLine = showDriverFound
    ? language === 'sw'
      ? 'Dereva amepatikana'
      : 'Driver found'
    : statusHeadline;
  const vehicleLine = [order?.driverPlateNumber, order?.driverVehicleColor, order?.driverVehicleLabel]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' · ');
  const pickupMinutes =
    order &&
    !['delivered', 'cancelled', 'in_transit', 'at_hub', 'driver_at_pickup'].includes(order.status) &&
    liveRouteDestination?.kind === 'pickup' &&
    liveDriverRoute &&
    liveDriverRoute.durationSeconds > 0
      ? Math.max(1, Math.round(liveDriverRoute.durationSeconds / 60))
      : null;
  const trackVehicleImage =
    order?.driverVehicleType === 'kirikuu' || order?.cargoVehicleKey === 'kirikuu'
      ? images.cargoAvatarKirikuu
      : order?.driverVehicleType === 'canter' || order?.cargoVehicleKey === 'canter'
        ? images.cargoAvatarCanter
        : order?.flow === 'cargo'
          ? images.cargoAvatarToyo
          : null;
  const pickupPillDetail = useMemo(() => {
    if (!order || ['delivered', 'cancelled', 'in_transit', 'at_hub'].includes(order.status)) {
      return undefined;
    }
    if (order.status === 'driver_at_pickup') {
      return 'Sasa';
    }
    if (liveRouteDestination?.kind === 'pickup' && liveDriverRoute && liveDriverRoute.durationSeconds > 0) {
      return formatPickupMinutes(liveDriverRoute.durationSeconds);
    }
    if (!isIntercityOrder(order)) {
      return undefined;
    }
    if (order.outsideShippingMode === 'express') {
      const departureLabel = String(order.outsideExpressDepartureLabel || '').trim();
      if (departureLabel) {
        return departureLabel;
      }
      const departureAt = resolveTimestampMillis(order.outsideExpressDepartureAt);
      if (departureAt > 0) {
        return formatArrivalClock(new Date(departureAt));
      }
    }
    if (order.timingMode === 'later' && order.scheduleTime) {
      return order.scheduleTime;
    }
    return undefined;
  }, [liveDriverRoute, liveRouteDestination?.kind, order]);
  const dropoffPillDetail = useMemo(() => {
    if (!order || order.status === 'delivered' || order.status === 'cancelled') {
      return undefined;
    }

    if (isIntercityOrder(order)) {
      const flightArrivalAt = resolveTimestampMillis(order.outsideExpressArrivalAt);
      if (String(order.outsideShippingMode || '') === 'express' && flightArrivalAt > Date.now()) {
        return formatArrivalClock(new Date(flightArrivalAt));
      }

      const routedSeconds =
        routeEstimate?.durationSeconds && routeEstimate.durationSeconds >= MIN_CORRIDOR_SECONDS
          ? routeEstimate.durationSeconds
          : 0;
      const storedSeconds =
        typeof order.durationSeconds === 'number' && order.durationSeconds >= MIN_CORRIDOR_SECONDS
          ? order.durationSeconds
          : 0;
      const serviceSeconds = getOutsideParcelDurationSecondsForOrder(order);
      const durationSeconds =
        routedSeconds || storedSeconds || (serviceSeconds >= MIN_CORRIDOR_SECONDS ? serviceSeconds : 0);
      if (durationSeconds <= 0) {
        return undefined;
      }
      return formatArrivalClock(new Date(Date.now() + durationSeconds * 1000));
    }

    const durationSeconds =
      liveRouteDestination?.kind === 'dropoff' && liveDriverRoute && liveDriverRoute.durationSeconds > 0
        ? liveDriverRoute.durationSeconds
        : routeEstimate?.durationSeconds && routeEstimate.durationSeconds > 0
          ? routeEstimate.durationSeconds
          : 0;
    if (durationSeconds <= 0) {
      return undefined;
    }
    return formatArrivalClock(new Date(Date.now() + durationSeconds * 1000));
  }, [liveDriverRoute, liveRouteDestination?.kind, order, routeEstimate?.durationSeconds]);
  const pickupScreenPoint =
    trackMapRegion && validPickupPoint ? projectMapCoordinate(validPickupPoint, trackMapRegion, trackMapSize) : null;
  const dropoffScreenPoint =
    trackMapRegion && validDropoffPoint ? projectMapCoordinate(validDropoffPoint, trackMapRegion, trackMapSize) : null;
  const pickupCallout = pickupScreenPoint ? attachTrackCallout(pickupScreenPoint, trackMapSize, TRACK_CALLOUT_INSET) : null;
  const dropoffCallout = dropoffScreenPoint ? attachTrackCallout(dropoffScreenPoint, trackMapSize, TRACK_CALLOUT_INSET) : null;
  const pickupCityChip = pickupScreenPoint && pickupCity ? cityChipPosition(pickupScreenPoint, trackMapSize, pickupCallout) : null;
  const dropoffCityChip = dropoffScreenPoint && dropoffCity ? cityChipPosition(dropoffScreenPoint, trackMapSize, dropoffCallout) : null;
  useEffect(() => {
    if (trackMapRegion || !validPickupPoint) {
      return;
    }
    setTrackMapRegion({
      latitude: validPickupPoint.latitude,
      longitude: validPickupPoint.longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    });
  }, [trackMapRegion, validPickupPoint]);

  const rememberMapRegion = (region: MapViewportRegion) => {
    if (!region.latitudeDelta || !region.longitudeDelta) {
      return;
    }
    setTrackMapRegion({
      latitude: region.latitude,
      longitude: region.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    });
  };
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  };
  const dismissNotifySheet = () => {
    setShowNotifySheet(false);
    void setPersistedItem(TRACK_NOTIFY_PROMPT_KEY, '1');
  };
  const allowNotifySheet = async () => {
    if (notifyRequesting) {
      return;
    }
    setNotifyRequesting(true);
    try {
      if (user?.uid) {
        await registerDoorDropPushNotifications(user.uid);
      }
    } finally {
      setNotifyRequesting(false);
      setShowNotifySheet(false);
      void setPersistedItem(TRACK_NOTIFY_PROMPT_KEY, '1');
    }
  };
  const openCancelConfirm = () => {
    if (cancelReason === 'other' && otherReasonText.trim().length < 4) {
      setCancelError(copy.track.cancelReasonRequired);
      return;
    }
    setCancelError('');
    setShowCancelPanel(false);
    setShowCancelConfirm(true);
  };
  const confirmCancelOrder = () => {
    const match = trackCancelReasons.find((item) => item.key === cancelReason);
    const reasonText =
      cancelReason === 'other' ? otherReasonText.trim() : language === 'sw' ? match?.sw || '' : match?.en || '';
    handleSubmitCancelOrder(reasonText);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {showMap && NativeMapView && Marker && Polyline ? (
        <View
          style={styles.mapStage}
          onLayout={(event) => {
            const { width, height: layoutHeight } = event.nativeEvent.layout;
            setTrackMapSize({ width, height: layoutHeight });
          }}>
          <NativeMapView
            ref={mapRef}
            provider={mapProvider}
            style={styles.map}
            customMapStyle={lightMapStyle}
            toolbarEnabled={false}
            moveOnMarkerPress={false}
            onRegionChange={rememberMapRegion}
            onRegionChangeComplete={rememberMapRegion}
            initialRegion={{
              latitude: validPickupPoint?.latitude ?? -6.7924,
              longitude: validPickupPoint?.longitude ?? 39.2083,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}>
            {routeLinePoints.length >= 2 ? (
              <Polyline
                coordinates={routeLinePoints}
                strokeColor={driverApproachLinePoints.length >= 2 ? '#D6D3D1' : '#FFE500'}
                strokeWidth={driverApproachLinePoints.length >= 2 ? 4 : 5}
                lineJoin="round"
                lineCap="round"
              />
            ) : null}
            {driverApproachLinePoints.length >= 2 ? (
              <Polyline
                coordinates={driverApproachLinePoints}
                strokeColor="#FFE500"
                strokeWidth={5}
                lineJoin="round"
                lineCap="round"
              />
            ) : null}
            {validPickupPoint ? (
              <Marker
                coordinate={validPickupPoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={8}>
                <CargoBullseyePin kind="pickup" />
              </Marker>
            ) : null}
            {validDropoffPoint ? (
              <Marker
                coordinate={validDropoffPoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={9}>
                <CargoBullseyePin kind="dropoff" />
              </Marker>
            ) : null}
            {nearbyDriverMarkers.map((driver) => (
              <Marker
                key={driver.id}
                coordinate={driver.coordinate}
                title={driver.title}
                description={driver.description}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                zIndex={6}>
                <VehicleDriverMarker vehicleKey={orderVehicleKey} />
              </Marker>
            ))}
            {snappedDriverPoint && !isOutsidePostHub ? (
              MarkerAnimated && driverAnimatedCoordinateRef.current ? (
                <MarkerAnimated
                  coordinate={driverAnimatedCoordinateRef.current}
                  title={order?.driverName || 'Driver'}
                  description={arrivalEtaLabel ? `${arrivalEtaLabel} ${arrivalEtaHint}` : mapLiveStatusDetail}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={false}
                  zIndex={12}>
                  <VehicleDriverMarker
                    vehicleKey={orderVehicleKey}
                    assigned
                    label={order?.driverName || undefined}
                  />
                </MarkerAnimated>
              ) : (
                <Marker
                  coordinate={snappedDriverPoint}
                  title={order?.driverName || 'Driver'}
                  description={arrivalEtaLabel ? `${arrivalEtaLabel} ${arrivalEtaHint}` : mapLiveStatusDetail}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={false}
                  zIndex={12}>
                  <VehicleDriverMarker
                    vehicleKey={orderVehicleKey}
                    assigned
                    label={order?.driverName || undefined}
                  />
                </Marker>
              )
            ) : null}
          </NativeMapView>
          {pickupCallout ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCalloutLayer,
                {
                  width: CARGO_CALLOUT_LAYOUT.width,
                  height: CARGO_CALLOUT_LAYOUT.overlayHeight,
                  transform: [{ translateX: pickupCallout.x }, { translateY: pickupCallout.y }],
                },
              ]}>
              <CargoRouteCallout
                kind="pickup"
                title={copy.cargo.mapPickup}
                detail={pickupPillDetail}
                showPin={false}
                placement={pickupCallout.placement}
                stemOffset={pickupCallout.stemOffset}
              />
            </View>
          ) : null}
          {dropoffCallout ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCalloutLayer,
                {
                  width: CARGO_CALLOUT_LAYOUT.width,
                  height: CARGO_CALLOUT_LAYOUT.overlayHeight,
                  transform: [{ translateX: dropoffCallout.x }, { translateY: dropoffCallout.y }],
                },
              ]}>
              <CargoRouteCallout
                kind="dropoff"
                title={copy.cargo.mapDropoff}
                detail={dropoffPillDetail}
                showPin={false}
                placement={dropoffCallout.placement}
                stemOffset={dropoffCallout.stemOffset}
              />
            </View>
          ) : null}
          {pickupCityChip ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCityChip,
                {
                  width: pickupCityChip.width,
                  transform: [{ translateX: pickupCityChip.x }, { translateY: pickupCityChip.y }],
                },
              ]}>
              <Text style={styles.mapCityText} numberOfLines={1}>
                {pickupCity}
              </Text>
            </View>
          ) : null}
          {dropoffCityChip ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCityChip,
                {
                  width: dropoffCityChip.width,
                  transform: [{ translateX: dropoffCityChip.x }, { translateY: dropoffCityChip.y }],
                },
              ]}>
              <Text style={styles.mapCityText} numberOfLines={1}>
                {dropoffCity}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={language === 'sw' ? 'Rudi' : 'Back'}
            style={styles.mapBack}
            onPress={goBack}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#111827" />
          </TouchableOpacity>
        </View>
      ) : isBusTrack ? (
        <View style={styles.busTrackTopBar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={language === 'sw' ? 'Rudi nyumbani' : 'Back to home'}
            style={styles.headerBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={goBack}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitleCenter} numberOfLines={1}>
            {copy.track.title}
          </Text>
          <View style={styles.headerSideSpacer} />
        </View>
      ) : (
        <View style={styles.plainHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={language === 'sw' ? 'Rudi' : 'Back'}
            style={styles.headerBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={goBack}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{copy.track.title}</Text>
        </View>
      )}

      <View style={[styles.trackSheet, showMap && styles.sheetOverMap]}>
        <ScrollView contentContainerStyle={styles.trackSheetContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {loading && !order && !orderId ? (
            <View style={styles.quietState}>
              <Text style={styles.quietTitle}>{copy.common.loading}</Text>
            </View>
          ) : null}

          {!order && !loading ? (
            <View style={styles.quietState}>
              <Text style={styles.quietTitle}>{copy.track.emptyTitle}</Text>
              <View style={styles.codeRow}>
                <TextInput
                  value={trackCodeInput}
                  onChangeText={(value) => {
                    setTrackCodeInput(value);
                    if (trackLookupError) {
                      setTrackLookupError('');
                    }
                  }}
                  placeholder={copy.track.trackCodePlaceholder}
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.codeInput}
                  onSubmitEditing={() => {
                    void handleTrackCodeLookup();
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.track.trackCodeSearch}
                  style={[styles.codeButton, trackLookupLoading || !trackCodeInput.trim() ? styles.codeButtonDisabled : null]}
                  disabled={trackLookupLoading || !trackCodeInput.trim()}
                  onPress={() => {
                    void handleTrackCodeLookup();
                  }}>
                  {trackLookupLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.codeButtonLabel}>{copy.track.trackCodeSearch}</Text>
                  )}
                </Pressable>
              </View>
              {trackLookupError ? <Text style={styles.codeError}>{trackLookupError}</Text> : null}
            </View>
          ) : null}

          {order ? (
            <>
              {isBusTrack ? (
                <BusParcelTrackSlot
                  language={language}
                  searching={isBusSearching}
                  agentLabel={busAgentLabel}
                  agentName={busAgentName}
                  busLabel={busNameLabel}
                  busName={busLineName}
                  phone={busCarrierPhone}
                  hasPhone={hasBusCarrierPhone}
                  callAccessibilityLabel={copy.track.call}
                  onCallPhone={() => {
                    void handleCallBusAgent();
                  }}
                />
              ) : null}

              {order.driverId ? (
                <View style={styles.driverCard}>
                  {pickupMinutes ? (
                    <View style={styles.etaBlock}>
                      <Text style={styles.etaKicker}>{language === 'sw' ? 'Anakuja kwa' : 'Pickup in'}</Text>
                      <Text style={styles.etaValue}>
                        {pickupMinutes} {language === 'sw' ? 'dak' : 'min'}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.driverRow}>
                    <View style={styles.avatar}>
                      {order.driverPhotoURL ? (
                        <Image source={{ uri: order.driverPhotoURL }} style={styles.avatarPhoto} />
                      ) : (
                        <Text style={styles.avatarText}>
                          {(order.driverName || 'DD')
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() ?? '')
                            .join('')}
                        </Text>
                      )}
                    </View>
                    <View style={styles.haulDriverCopy}>
                      {vehicleLine ? (
                        <Text style={styles.haulDriverMeta} numberOfLines={2}>
                          {vehicleLine}
                        </Text>
                      ) : null}
                      <Text style={styles.haulDriverName} numberOfLines={1}>
                        {order.driverName || copy.track.assigned}
                      </Text>
                      {hasDriverPhone ? (
                        <Text
                          style={styles.haulDriverMeta}
                          numberOfLines={1}
                          onPress={() => {
                            void handleCallDriver();
                          }}>
                          {driverPhone}
                        </Text>
                      ) : null}
                    </View>
                    {trackVehicleImage ? (
                      <Image source={trackVehicleImage} style={styles.vehicleThumb} resizeMode="contain" />
                    ) : null}
                  </View>
                  <View style={styles.driverActions}>
                    {canMessageDriver ? (
                      <View style={styles.chatPill}>
                        <MaterialCommunityIcons name="message-text-outline" size={18} color="#111827" />
                        <Text style={styles.chatPillText}>{copy.track.chat}</Text>
                      </View>
                    ) : null}
                    {hasDriverPhone ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={copy.track.call}
                        style={styles.callButton}
                        onPress={() => {
                          void handleCallDriver();
                        }}>
                        <MaterialCommunityIcons name="phone" size={18} color="#111827" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View style={styles.statusBlock}>
                <Text style={styles.statusLine}>{statusLine}</Text>
                {order && isBusCustomerParcel(order) ? (
                  <Text style={styles.statusMeta}>{getBusParcelDetail(order, language)}</Text>
                ) : null}
                <View style={styles.statusPointer} />
              </View>
              <View style={styles.stepRail}>
                {shipmentSteps.map((step, index) => (
                  <View key={step.key} style={styles.stepCol}>
                    <View style={styles.stepDotRow}>
                      <View
                        style={[
                          styles.stepLink,
                          index === 0 && styles.stepLinkHidden,
                          index > 0 && (shipmentSteps[index - 1].state === 'done' || step.state !== 'upcoming') && styles.stepLinkOn,
                        ]}
                      />
                      <View
                        style={[
                          styles.stepDot,
                          step.state === 'done' && styles.stepDotDone,
                          step.state === 'current' && styles.stepDotCurrent,
                        ]}
                      />
                      <View
                        style={[
                          styles.stepLink,
                          index === shipmentSteps.length - 1 && styles.stepLinkHidden,
                          step.state === 'done' && styles.stepLinkOn,
                        ]}
                      />
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.stepLabel,
                        step.state === 'current' && styles.stepLabelCurrent,
                        step.state === 'upcoming' && styles.stepLabelUpcoming,
                      ]}>
                      {step.label}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.routeCard}>
                <View style={styles.routeRail}>
                  <View style={styles.routeDotFrom} />
                  <View style={styles.routeStem} />
                  <View style={styles.routeDotTo} />
                </View>
                <View style={styles.routeStops}>
                  <View style={styles.routeStop}>
                    <Text style={styles.routeKind}>{copy.cargo.mapPickup}</Text>
                    <Text style={styles.routePlace} numberOfLines={2}>
                      {routeDisplay.from || '—'}
                    </Text>
                  </View>
                  <View style={styles.routeStop}>
                    <Text style={styles.routeKind}>{copy.cargo.mapDropoff}</Text>
                    <Text style={styles.routePlace} numberOfLines={2}>
                      {routeDisplay.to || '—'}
                    </Text>
                  </View>
                </View>
              </View>

              {isBusTrack ? (
                <View style={styles.codeBlock}>
                  <Text style={styles.stopLabel}>{language === 'sw' ? 'Msimbo wa mzigo' : 'Parcel code'}</Text>
                  <Text style={styles.codeReadonly} selectable>
                    {busParcelCode || '—'}
                  </Text>
                </View>
              ) : (
                <View style={styles.codeBlock}>
                  <Text style={styles.stopLabel}>{language === 'sw' ? 'Msimbo wa mzigo' : 'Parcel code'}</Text>
                  <View style={styles.codeRow}>
                    <TextInput
                      value={trackCodeInput}
                      onChangeText={(value) => {
                        setTrackCodeInput(value);
                        if (trackLookupError) {
                          setTrackLookupError('');
                        }
                      }}
                      placeholder={copy.track.trackCodePlaceholder}
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.codeInput}
                      onSubmitEditing={() => {
                        void handleTrackCodeLookup();
                      }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.track.trackCodeSearch}
                      style={[styles.codeButton, trackLookupLoading || !trackCodeInput.trim() ? styles.codeButtonDisabled : null]}
                      disabled={trackLookupLoading || !trackCodeInput.trim()}
                      onPress={() => {
                        void handleTrackCodeLookup();
                      }}>
                      {trackLookupLoading ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.codeButtonLabel}>{copy.track.trackCodeSearch}</Text>
                      )}
                    </Pressable>
                  </View>
                  {trackLookupError ? <Text style={styles.codeError}>{trackLookupError}</Text> : null}
                </View>
              )}

              <View style={styles.iconActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.track.share}
                  style={styles.iconAction}
                  onPress={() => {
                    void handleShareTrip();
                  }}>
                  <View style={styles.iconBubble}>
                    <MaterialCommunityIcons name="share-variant" size={22} color="#111827" />
                  </View>
                  <Text style={styles.iconActionLabel}>{copy.track.share}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.parcel.receiptView}
                  style={styles.iconAction}
                  onPress={() => setShowReceipt(true)}>
                  <View style={[styles.iconBubble, styles.iconBubbleYellow]}>
                    <MaterialCommunityIcons name="receipt" size={22} color="#111827" />
                  </View>
                  <Text style={styles.iconActionLabel}>{copy.parcel.receiptView}</Text>
                </Pressable>
              </View>

              {order.status === 'delivered' ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.quietRow}
                  onPress={canRateOrder ? handleOpenRatingPanel : undefined}>
                  <Text style={styles.quietRowLabel}>{copy.track.rating}</Text>
                  <View style={styles.starRow}>
                    {ratingOptions.map((star) => (
                      <MaterialCommunityIcons
                        key={star}
                        name={star <= (order.customerRating ?? 0) ? 'star' : 'star-outline'}
                        size={16}
                        color="#111827"
                      />
                    ))}
                  </View>
                </Pressable>
              ) : null}

              {order.driverId && canMessageDriver ? (
                <View style={styles.chatBlock}>
                  <Text style={styles.chatTitle}>{copy.track.chat}</Text>
                  {messagesLoading ? (
                    <Text style={styles.chatHint}>{copy.common.loading}</Text>
                  ) : messages.length ? (
                    <View style={styles.messageThread}>
                      {messages.slice(-4).map((item) => {
                        const isCustomerMessage = item.senderRole === 'customer';
                        return (
                          <View
                            key={item.id}
                            style={[styles.messageRow, isCustomerMessage ? styles.messageRowSelf : styles.messageRowOther]}>
                            <View
                              style={[
                                styles.messageBubble,
                                isCustomerMessage ? styles.messageBubbleSelf : styles.messageBubbleOther,
                              ]}>
                              <Text
                                style={[
                                  styles.messageText,
                                  isCustomerMessage ? styles.messageTextSelf : styles.messageTextOther,
                                ]}>
                                {item.message}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.chatHint}>{copy.track.noMessages}</Text>
                  )}
                  <View style={styles.messageComposer}>
                    <TextInput
                      value={messageDraft}
                      onChangeText={setMessageDraft}
                      editable={!messageSending}
                      multiline
                      maxLength={240}
                      placeholder={copy.track.message}
                      placeholderTextColor="#9CA3AF"
                      style={styles.messageInput}
                      textAlignVertical="top"
                    />
                    <TouchableOpacity
                      activeOpacity={0.88}
                      disabled={!messageDraft.trim() || messageSending}
                      style={[
                        styles.messageSendButton,
                        (!messageDraft.trim() || messageSending) && styles.messageSendButtonDisabled,
                      ]}
                      onPress={() => {
                        void handleSendMessage();
                      }}>
                      <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <View style={styles.actionButtons}>
                {isNotifiableRecipientPhone(order.recipientPhone) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void handleSmsRecipient();
                    }}
                    style={styles.solidButton}>
                    <MaterialCommunityIcons name="message-text-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.solidButtonLabel}>{copy.track.smsRecipient}</Text>
                  </Pressable>
                ) : null}
                {isOutsidePostHub && order.status !== 'delivered' && order.status !== 'cancelled' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void handleOpenAdminWhatsApp();
                    }}
                    style={styles.outlineButton}>
                    <Text style={styles.outlineButtonLabel}>{copy.track.adminWhatsAppButton}</Text>
                  </Pressable>
                ) : null}
                {canCancelOrder ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCancelError('');
                      setCancelReason('not_closer');
                      setOtherReasonText('');
                      setShowCancelConfirm(false);
                      setShowCancelPanel(true);
                    }}
                    style={styles.dangerButton}>
                    <Text style={styles.dangerButtonLabel}>{language === 'sw' ? 'Futa oda' : 'Cancel order'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>
        <BottomNav />
      </View>
      <Modal animationType="slide" transparent visible={showCancelPanel} onRequestClose={() => setShowCancelPanel(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCancelPanel(false)} />
          <View style={styles.reasonSheet}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={language === 'sw' ? 'Funga' : 'Close'}
              style={styles.sheetClose}
              onPress={() => setShowCancelPanel(false)}>
              <MaterialCommunityIcons name="close" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.reasonTitle}>{language === 'sw' ? 'Nini kimeenda vibaya?' : 'What went wrong?'}</Text>
            {trackCancelReasons.map((reason) => {
              const selected = cancelReason === reason.key;
              const label = language === 'sw' ? reason.sw : reason.en;
              return (
                <View key={reason.key}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={styles.reasonRow}
                    onPress={() => {
                      setCancelReason(reason.key);
                      setCancelError('');
                    }}>
                    <Text style={styles.reasonRowLabel}>{label}</Text>
                    {reason.key === 'other' && !selected ? (
                      <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
                    ) : (
                      <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                    )}
                  </Pressable>
                  {reason.key === 'other' && selected ? (
                    <TextInput
                      value={otherReasonText}
                      onChangeText={setOtherReasonText}
                      placeholder={language === 'sw' ? 'Andika kwa ufupi' : 'Short note'}
                      placeholderTextColor="#9CA3AF"
                      style={styles.otherInput}
                      maxLength={160}
                    />
                  ) : null}
                </View>
              );
            })}
            {cancelError ? <Text style={styles.cancelErrorText}>{cancelError}</Text> : null}
            <Pressable accessibilityRole="button" style={styles.doneButton} onPress={openCancelConfirm}>
              <Text style={styles.doneLabel}>{language === 'sw' ? 'Tayari' : 'Done'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={showCancelConfirm} onRequestClose={() => setShowCancelConfirm(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!cancelSubmitting) {
                setShowCancelConfirm(false);
              }
            }}
          />
          <View style={styles.confirmSheet}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={language === 'sw' ? 'Funga' : 'Close'}
              style={styles.confirmClose}
              disabled={cancelSubmitting}
              onPress={() => setShowCancelConfirm(false)}>
              <MaterialCommunityIcons name="close" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.confirmTitle}>{language === 'sw' ? 'Una uhakika?' : 'Are you sure?'}</Text>
            <Text style={styles.confirmBody}>
              {language === 'sw'
                ? 'Kufuta kunaweza kukuchelewesha kufika.'
                : 'Cancelling may delay your delivery.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={cancelSubmitting}
              style={styles.destructiveButton}
              onPress={confirmCancelOrder}>
              <Text style={styles.destructiveLabel}>
                {cancelSubmitting ? (language === 'sw' ? 'Inafuta...' : 'Cancelling...') : language === 'sw' ? 'Futa oda' : 'Cancel order'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={cancelSubmitting}
              style={styles.waitButton}
              onPress={() => setShowCancelConfirm(false)}>
              <Text style={styles.waitLabel}>{language === 'sw' ? 'Subiri dereva' : 'Wait for driver'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={showNotifySheet} onRequestClose={dismissNotifySheet}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={dismissNotifySheet} />
          <View style={styles.confirmSheet}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={language === 'sw' ? 'Funga' : 'Close'}
              style={styles.confirmClose}
              onPress={dismissNotifySheet}>
              <MaterialCommunityIcons name="close" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.confirmTitle}>{language === 'sw' ? 'Pata taarifa za oda' : 'Stay updated'}</Text>
            <Text style={styles.confirmBody}>
              {language === 'sw'
                ? 'Utapata taarifa dereva akifika au mzigo ukisogea.'
                : 'Get notified when the driver arrives or the parcel moves.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={notifyRequesting}
              style={styles.doneButton}
              onPress={() => {
                void allowNotifySheet();
              }}>
              <Text style={styles.doneLabel}>
                {notifyRequesting ? (language === 'sw' ? 'Inaomba...' : 'Requesting...') : language === 'sw' ? 'Ruhusu arifa' : 'Allow notifications'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={showRatingPanel} onRequestClose={handleCloseRatingPanel}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={handleCloseRatingPanel} />
          <View style={styles.ratingCard}>
            <View style={styles.ratingHeader}>
              <Text style={styles.ratingTitle}>Rate this delivery</Text>
              <TouchableOpacity disabled={ratingSubmitting} onPress={handleCloseRatingPanel}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.subtext} />
              </TouchableOpacity>
            </View>
            <Text style={styles.ratingTextBody}>
              Your feedback helps DoorDrop improve rider quality, timing, and customer support after each completed trip.
            </Text>

            <View style={styles.ratingStarRow}>
              {ratingOptions.map((star) => {
                const active = star <= ratingValue;
                return (
                  <TouchableOpacity
                    key={star}
                    activeOpacity={0.88}
                    disabled={ratingSubmitting}
                    style={[styles.ratingStarButton, active && styles.ratingStarButtonActive]}
                    onPress={() => setRatingValue(star)}>
                    <MaterialCommunityIcons name={active ? 'star' : 'star-outline'} size={26} color="#F59E0B" />
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.ratingHint}>
              {ratingValue ? `You selected ${ratingValue} star${ratingValue > 1 ? 's' : ''}.` : 'Tap a star rating from 1 to 5.'}
            </Text>

            <TextInput
              value={ratingReview}
              onChangeText={setRatingReview}
              editable={!ratingSubmitting}
              multiline
              maxLength={240}
              placeholder="Optional note about the delivery experience"
              placeholderTextColor="#94A3B8"
              style={styles.ratingInput}
              textAlignVertical="top"
            />

            <View style={styles.ratingActionRow}>
              <PrimaryButton
                label="Maybe later"
                variant="secondary"
                style={styles.ratingSecondaryAction}
                onPress={handleCloseRatingPanel}
              />
              <PrimaryButton
                label={ratingSubmitting ? 'Saving...' : orderHasRating ? 'Update rating' : 'Submit rating'}
                icon="star-outline"
                style={styles.ratingPrimaryAction}
                onPress={() => {
                  void handleSubmitRating();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <OutsideParcelReceiptModal
        visible={showReceipt && Boolean(order)}
        order={order}
        originCity={order?.outsideOriginCity || routeDisplay.from}
        onContinue={() => setShowReceipt(false)}
        onDismiss={() => setShowReceipt(false)}
      />

      <Modal animationType="slide" transparent visible={showPlacedSheet} onRequestClose={dismissPlacedSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={dismissPlacedSheet} />
          <View style={styles.placedCard}>
            <View style={styles.placedIconWrap}>
              <MaterialCommunityIcons name="check" size={18} color="#166534" />
            </View>
            <Text style={styles.placedTitle}>
              {order && isOutsideParcelOrder(order) ? copy.track.outsideOrderPlaced : copy.track.orderPlaced}
            </Text>
            {order?.orderNumber ? <Text style={styles.placedOrderNumber}>{order.orderNumber}</Text> : null}
            <Text style={styles.placedBody}>
              {order && isBusCustomerParcel(order)
                ? language === 'sw'
                  ? 'Tunatafuta basi linaloenda huko. Hatua zitaonekana hapa.'
                  : 'We are matching a bus for this route. Progress will show here.'
                : order && isOutsideParcelOrder(order)
                  ? copy.track.outsideOrderPlacedBody
                  : copy.track.lookingDriver}
            </Text>
            <PrimaryButton label={copy.common.gotIt} style={styles.placedGotIt} onPress={dismissPlacedSheet} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  pageBar: {
    height: 28,
    backgroundColor: '#FFE500',
  },
  mapCityChip: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  mapCityText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  actionButtons: {
    marginTop: 16,
    gap: 10,
  },
  solidButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  solidButtonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#FFFFFF',
  },
  outlineButton: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  outlineButtonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  dangerButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#FFFFFF',
  },
  mapStage: {
    height: height * 0.22,
    backgroundColor: '#F3F4F6',
  },
  mapCalloutLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  mapBack: {
    position: 'absolute',
    top: 12,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busTrackTopBar: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitleCenter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  headerSideSpacer: {
    width: 44,
    height: 44,
  },
  plainHeader: {
    minHeight: 56,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  trackSheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  sheetOverMap: {
    marginTop: -18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  trackSheetContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 20,
  },
  quietState: {
    paddingTop: 28,
    gap: 18,
  },
  quietTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.3,
  },
  codeBlock: {
    marginTop: 16,
    gap: 6,
  },
  codeReadonly: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: 0.6,
  },
  busCarrierCard: {
    marginTop: 4,
    marginBottom: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  busCarrierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busCarrierCopy: {
    flex: 1,
    gap: 2,
  },
  busCarrierKicker: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  busCarrierName: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  busCarrierPhone: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.medium,
    color: '#2563EB',
    marginTop: 2,
  },
  stepRail: {
    marginTop: 16,
    flexDirection: 'row',
  },
  stepCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  stepDotRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepLink: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E7EB',
  },
  stepLinkOn: {
    backgroundColor: '#111827',
  },
  stepLinkHidden: {
    backgroundColor: 'transparent',
  },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  stepDotDone: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  stepDotCurrent: {
    backgroundColor: '#FFE500',
    borderColor: '#111827',
    borderWidth: 2,
  },
  stepLabel: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    fontFamily: typography.semibold,
    color: '#111827',
    paddingHorizontal: 2,
  },
  stepLabelCurrent: {
    color: '#111827',
  },
  stepLabelUpcoming: {
    color: '#9CA3AF',
    fontFamily: typography.body,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  routeCard: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#F7F7F5',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  routeRail: {
    width: 14,
    alignItems: 'center',
    paddingTop: 4,
  },
  routeDotFrom: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#111827',
  },
  routeStem: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginVertical: 4,
    backgroundColor: '#FFE500',
  },
  routeDotTo: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: '#FFE500',
    borderWidth: 1.5,
    borderColor: '#111827',
  },
  routeStops: {
    flex: 1,
    gap: 14,
  },
  routeStop: {
    gap: 2,
  },
  routeKind: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  routePlace: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  iconActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 12,
  },
  iconAction: {
    flex: 1,
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubbleYellow: {
    backgroundColor: '#FFE500',
  },
  iconActionLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  shareRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: typography.body,
    color: '#111827',
  },
  codeButton: {
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeButtonDisabled: {
    opacity: 0.4,
  },
  codeButtonLabel: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#FFFFFF',
  },
  codeError: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  statusLine: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.3,
  },
  statusBlock: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    maxWidth: '100%',
  },
  statusPointer: {
    marginTop: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#111827',
  },
  statusMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  barTrack: {
    marginTop: 10,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFE500',
  },
  shipTimeline: {
    marginTop: 16,
    gap: 0,
  },
  shipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  shipRail: {
    width: 16,
    alignItems: 'center',
  },
  shipDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    marginTop: 4,
  },
  shipDotDone: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  shipDotCurrent: {
    backgroundColor: '#FFE500',
    borderColor: '#111827',
    borderWidth: 2,
  },
  shipStem: {
    width: 2,
    flexGrow: 1,
    minHeight: 22,
    marginTop: 2,
    backgroundColor: '#E5E7EB',
  },
  shipStemDone: {
    backgroundColor: '#111827',
  },
  shipCopy: {
    flex: 1,
    paddingBottom: 10,
    gap: 1,
  },
  shipLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  shipLabelCurrent: {
    fontSize: 15,
    lineHeight: 20,
  },
  shipLabelUpcoming: {
    color: '#9CA3AF',
    fontFamily: typography.body,
  },
  shipTime: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  reasonSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  sheetClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  reasonTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  reasonRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  reasonRowLabel: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#111827',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: '#111827',
    backgroundColor: '#111827',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFE500',
  },
  otherInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 8,
    fontSize: 15,
    fontFamily: typography.body,
    color: '#111827',
  },
  doneButton: {
    marginTop: 18,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#FFFFFF',
  },
  confirmSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  confirmClose: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 4,
  },
  confirmBody: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#6B7280',
    textAlign: 'center',
  },
  destructiveButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#FFFFFF',
  },
  waitButton: {
    marginTop: 10,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  countdownWrap: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  driverCard: {
    marginBottom: 8,
    gap: 12,
  },
  etaBlock: {
    gap: 2,
  },
  etaKicker: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  etaValue: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -0.8,
  },
  driverRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarPhoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  vehicleThumb: {
    width: 72,
    height: 40,
  },
  driverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatPill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chatPillText: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  haulDriverCopy: {
    flex: 1,
    gap: 2,
  },
  haulDriverName: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  haulDriverMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  callButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  haulPickupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: '#111827',
  },
  haulDropoffDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    marginTop: 5,
    backgroundColor: '#FFE500',
    borderWidth: 1.5,
    borderColor: '#111827',
  },
  stopCopy: {
    flex: 1,
    gap: 2,
  },
  stopLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#6B7280',
  },
  stopValue: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  stopDetail: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  haulFareRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  haulFareValue: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  timelineWrap: {
    marginTop: 22,
  },
  quietRow: {
    marginTop: 22,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quietRowLabel: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },
  chatBlock: {
    marginTop: 22,
    gap: 8,
  },
  chatTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  chatHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  actions: {
    marginTop: 8,
    gap: 0,
  },
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  textActionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  cancelQuiet: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#6B7280',
  },
  mapWrap: {
    height: height * 0.42,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapUnavailableCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 24,
  },
  mapPreviewIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  mapUnavailableTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  mapUnavailableText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  routeMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  pickupMapMarker: {
    backgroundColor: '#F97316',
  },
  dropoffMapMarker: {
    backgroundColor: '#2563EB',
  },
  driverMapMarker: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverMarkerPulse: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(16, 185, 129, 0.24)',
  },
  driverMarkerCore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: cargoTheme.colors.primaryDark,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverMarkerCoreMuted: {
    backgroundColor: '#475569',
  },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapChrome: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.98)',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  mapChromeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapChromeTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EEF2F6',
  },
  titleChip: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.94)',
  },
  titleChipText: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: typography.bold,
    letterSpacing: -0.1,
    color: cargoTheme.colors.text,
  },
  trackSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackSearchField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    gap: 8,
  },
  trackSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    paddingVertical: 0,
  },
  trackSearchButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackSearchButtonDisabled: {
    opacity: 0.45,
  },
  trackSearchError: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
    color: '#DC2626',
    paddingHorizontal: 2,
  },
  mapLiveCardWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 52,
  },
  mapLiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.96)',
  },
  mapLiveIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLiveIconFresh: {
    backgroundColor: cargoTheme.colors.primaryDark,
  },
  mapLiveIconComplete: {
    backgroundColor: '#15803D',
  },
  mapLiveIconClosed: {
    backgroundColor: '#991B1B',
  },
  mapLiveIconKnown: {
    backgroundColor: '#475569',
  },
  mapLiveIconPending: {
    backgroundColor: '#94A3B8',
  },
  mapLiveCopy: {
    flex: 1,
  },
  mapLiveLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
  },
  mapLiveText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: cargoTheme.colors.subtext,
    fontWeight: '700',
  },
  sheet: {
    flex: 1,
    marginTop: -24,
    backgroundColor: cargoTheme.colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
  },
  receiptAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E8EEF2',
  },
  receiptActionLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: typography.bold,
    letterSpacing: -0.3,
    color: cargoTheme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  liveLoadingVisual: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  liveLoadingRing: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    padding: 16,
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: typography.bold,
    letterSpacing: -0.4,
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 12,
  },
  statusCountdownWrap: {
    marginTop: 2,
    marginBottom: 12,
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineStep: {
    flex: 1,
    alignItems: 'center',
  },
  timelineNodeRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  timelineLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E8F0',
  },
  timelineLineActive: {
    backgroundColor: cargoTheme.colors.primary,
  },
  timelineLineHidden: {
    backgroundColor: 'transparent',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#CBD5E1',
  },
  timelineDotActive: {
    backgroundColor: cargoTheme.colors.primary,
  },
  timelineLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  timelineLabelActive: {
    color: cargoTheme.colors.text,
    fontFamily: typography.bold,
  },
  liveActivityCard: {
    marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  liveActivityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  liveActivityPulseWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveActivityPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(74, 222, 128, 0.48)',
  },
  liveActivityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#86EFAC',
  },
  liveActivityCopy: {
    flex: 1,
  },
  liveActivityLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  liveActivityText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: '#BBF7D0',
  },
  liveActivityTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 11,
    overflow: 'hidden',
  },
  liveActivitySweep: {
    width: 92,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#86EFAC',
  },
  statusWaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  statusWaitingIndicator: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusWaitingPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(74, 222, 128, 0.55)',
  },
  statusWaitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#86EFAC',
  },
  statusWaitingText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#ECFDF5',
    fontWeight: '700',
  },
  driverCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
  },
  driverTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  driverAvatarText: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  driverCopy: {
    flex: 1,
    marginRight: 8,
  },
  driverName: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
    marginBottom: 2,
  },
  driverMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
  },
  driverGpsStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  driverGpsDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#94A3B8',
  },
  driverGpsDotFresh: {
    backgroundColor: cargoTheme.colors.primary,
  },
  driverGpsCopy: {
    flex: 1,
  },
  driverGpsLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: cargoTheme.colors.text,
  },
  driverGpsText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: cargoTheme.colors.subtext,
  },
  driverActions: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  adminWhatsAppCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  adminWhatsAppHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  adminWhatsAppIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminWhatsAppCopy: {
    flex: 1,
  },
  adminWhatsAppTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  adminWhatsAppSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  adminWhatsAppButton: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#25D366',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
    shadowColor: '#15803D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  adminWhatsAppButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
  phoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
    gap: 10,
  },
  phoneCardMuted: {
    opacity: 0.72,
  },
  phoneCardLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneCardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
  },
  phoneCardTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  phoneCardValue: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  phoneCardValueMuted: {
    color: cargoTheme.colors.subtext,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonDisabled: {
    opacity: 0.72,
  },
  smsRecipientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
  },
  smsRecipientText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  cancelToggleButton: {
    minHeight: 64,
    marginBottom: 18,
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  cancelToggleHitArea: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  cancelTextButton: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#DC2626',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  cancelCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    paddingBottom: 28,
  },
  ratingCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    paddingBottom: 28,
  },
  placedCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    alignItems: 'center',
  },
  placedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  placedTitle: {
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  placedOrderNumber: {
    marginTop: 2,
    fontFamily: typography.semibold,
    fontSize: 12,
    color: cargoTheme.colors.subtext,
  },
  placedParcelCode: {
    marginTop: 2,
    fontFamily: typography.extrabold,
    fontSize: 16,
    letterSpacing: 0.6,
    color: cargoTheme.colors.primary,
    textAlign: 'center',
  },
  placedCodeRow: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  copyCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  copyCodeText: {
    fontFamily: typography.bold,
    fontSize: 12,
    color: cargoTheme.colors.primaryDark,
  },
  placedBody: {
    marginTop: 8,
    marginBottom: 4,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  notifyPanel: {
    width: '100%',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F6',
    gap: 6,
  },
  notifyPanelTitle: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  notifyPreviewText: {
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: '#334155',
    textAlign: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  notifySentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  notifySentText: {
    fontFamily: typography.bold,
    fontSize: 12,
    color: '#15803D',
  },
  notifyActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  notifyChannelButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  notifyWhatsAppButton: {
    backgroundColor: '#25D366',
  },
  notifyWhatsAppText: {
    fontFamily: typography.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  notifySmsButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0F766E',
  },
  notifySmsText: {
    fontFamily: typography.bold,
    fontSize: 12,
    color: '#0F766E',
  },
  notifySkipButton: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  notifySkipText: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: '#94A3B8',
  },
  placedNotify: {
    marginTop: 14,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  placedActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  placedPrimaryAction: {
    flex: 1,
  },
  placedSecondaryAction: {
    flex: 1,
  },
  placedGotIt: {
    marginTop: 18,
    alignSelf: 'stretch',
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  ratingTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: typography.bold,
    letterSpacing: -0.3,
    color: cargoTheme.colors.text,
  },
  ratingTextBody: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 14,
  },
  ratingStarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  ratingStarButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingStarButtonActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7',
  },
  ratingHint: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginBottom: 12,
  },
  ratingInput: {
    minHeight: 110,
    maxHeight: 140,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    color: cargoTheme.colors.text,
    fontSize: 14,
    marginBottom: 14,
  },
  ratingActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ratingPrimaryAction: {
    flex: 1,
  },
  ratingSecondaryAction: {
    flex: 1,
  },
  cancelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cancelTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: typography.bold,
    letterSpacing: -0.3,
    color: cargoTheme.colors.text,
  },
  cancelText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 12,
  },
  cancelErrorText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: '#DC2626',
    marginBottom: 12,
  },
  reasonList: {
    gap: 10,
    marginBottom: 14,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonOptionSelected: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#ECFDF3',
  },
  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRadioSelected: {
    borderColor: cargoTheme.colors.primary,
  },
  reasonRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  reasonLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
  },
  reasonLabelSelected: {
    color: cargoTheme.colors.primaryDark,
    fontFamily: typography.semibold,
  },
  cancelActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelPrimaryAction: {
    flex: 1,
    minHeight: 60,
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  cancelSecondaryAction: {
    flex: 1,
    minHeight: 60,
  },
  cancelInfoCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 18,
    marginBottom: 18,
  },
  cancelInfoTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    color: '#991B1B',
    marginBottom: 6,
  },
  cancelInfoText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.body,
    color: '#991B1B',
    marginBottom: 8,
  },
  cancelInfoReason: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: typography.medium,
    color: cargoTheme.colors.text,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 14,
  },
  routeStop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pickupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: cargoTheme.colors.primary,
  },
  dropoffDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
    marginTop: 5,
    backgroundColor: cargoTheme.colors.ink,
  },
  routeLine: {
    width: 2,
    height: 14,
    marginLeft: 4,
    marginVertical: 4,
    borderRadius: 999,
    backgroundColor: '#86EFAC',
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  routeValue: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  routeDetail: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EEF4',
  },
  fareValue: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.ink,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  summaryLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
  },
  summaryValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    textAlign: 'right',
  },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 18,
    gap: 10,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  reviewHeaderCopy: {
    flex: 1,
  },
  reviewTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  reviewSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  reviewEditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  reviewEditChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewStarsText: {
    marginLeft: 2,
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  reviewBody: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
  },
  reviewEmptyText: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  reviewMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94A3B8',
  },
  messageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 18,
    gap: 12,
  },
  messageTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
  },
  messageSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  messageThread: {
    gap: 10,
  },
  messageRow: {
    flexDirection: 'row',
  },
  messageRowSelf: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  messageBubbleSelf: {
    backgroundColor: cargoTheme.colors.primaryDark,
    borderBottomRightRadius: 8,
  },
  messageBubbleOther: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderBottomLeftRadius: 8,
  },
  messageSender: {
    fontSize: 12,
    fontWeight: '800',
  },
  messageSenderSelf: {
    color: '#D1FAE5',
  },
  messageSenderOther: {
    color: cargoTheme.colors.primaryDark,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
  },
  messageTextSelf: {
    color: '#FFFFFF',
  },
  messageTextOther: {
    color: cargoTheme.colors.text,
  },
  messageTime: {
    fontSize: 11,
    fontWeight: '700',
  },
  messageTimeSelf: {
    color: '#BBF7D0',
  },
  messageTimeOther: {
    color: cargoTheme.colors.subtext,
  },
  messageEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  messageComposerDisabled: {
    opacity: 0.72,
  },
  messageInput: {
    flex: 1,
    minHeight: 52,
    maxHeight: 112,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    color: cargoTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
  },
  messageSendButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageSendButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  messageSendButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  messageHint: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  progressCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    borderRadius: 24,
    padding: 18,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 14,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 12,
  },
  progressRail: {
    width: 18,
    alignItems: 'center',
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#CBD5E1',
    marginTop: 4,
  },
  progressDotActive: {
    backgroundColor: cargoTheme.colors.primary,
  },
  progressDotCurrent: {
    borderWidth: 2,
    borderColor: '#DCFCE7',
  },
  progressDotPulse: {
    position: 'absolute',
    top: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.32)',
  },
  progressLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#E2E8F0',
    marginTop: 4,
    marginBottom: 4,
  },
  progressCopy: {
    flex: 1,
    paddingBottom: 16,
  },
  progressStepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
    marginBottom: 4,
  },
  progressStepTitleActive: {
    color: cargoTheme.colors.text,
  },
  progressStepNote: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94A3B8',
  },
});
