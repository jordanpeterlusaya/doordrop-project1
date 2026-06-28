import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    Linking,
    Modal,
    Pressable,
    SafeAreaView,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { BottomNav, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { recordAppActivity } from '@/lib/app-analytics';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import {
    autoAssignDriverToOrder,
    cancelDeliveryOrderByUser,
    formatDeliveryDateTime,
    getDeliveryOrderStatusLabel,
    hasDeliveryOrderRating,
    submitDeliveryOrderRating,
    subscribeToOrder,
    subscribeToUserOrders,
    type DeliveryOrder,
    type DeliveryOrderStatus,
} from '@/lib/delivery-data';
import { fetchRouteEstimate, type RouteEstimate } from '@/lib/location-search';
import { lightMapStyle } from '@/lib/light-map-style';
import { runMapsDiagnostics } from '@/lib/maps-diagnostics';
import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { sendOrderMessage, subscribeToOrderMessages, type OrderMessage } from '@/lib/order-messages';
import { filterValidCoordinates, isValidCoordinate } from '@/lib/route-utils';
import { useAuthSession } from '@/providers/auth-provider';

const { height } = Dimensions.get('window');
const screenScope = 'TrackOrderScreen';

const statusRank: Record<DeliveryOrderStatus, number> = {
  pending_assignment: 0,
  driver_assigned: 1,
  driver_at_pickup: 2,
  in_transit: 3,
  delivered: 4,
  cancelled: 4,
};

const cancellationReasons = [
  'I entered the wrong pickup or drop-off details',
  'The price is higher than expected',
  'I no longer need this delivery',
  'I want to change the vehicle or service type',
  'Pickup is taking too long',
] as const;

const ratingOptions = [1, 2, 3, 4, 5] as const;

function getParamValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getDialablePhoneNumber(phone?: string) {
  if (!phone) {
    return '';
  }

  const trimmed = phone.trim();
  const hasPlusPrefix = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');

  return hasPlusPrefix ? `+${digitsOnly}` : digitsOnly;
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

function getTrackingTitle(order: DeliveryOrder) {
  if (order.status === 'pending_assignment') {
    if (order.driverSearchStatus === 'waiting_for_driver') {
      return 'No nearby driver yet';
    }

    return 'Dispatch is matching your driver';
  }

  if (order.status === 'cancelled' && order.autoCancelledReason) {
    return 'No nearby driver was found';
  }

  if (order.status === 'driver_assigned') {
    return order.flow === 'cargo' ? 'Cargo driver is heading to pickup' : 'Parcel rider is heading to pickup';
  }

  if (order.status === 'driver_at_pickup') {
    return 'Driver has arrived at pickup';
  }

  if (order.status === 'in_transit') {
    return order.flow === 'cargo' ? 'Cargo is now on the move' : 'Parcel is now on the move';
  }

  if (order.status === 'delivered') {
    return 'Order delivered successfully';
  }

  return 'This order was cancelled';
}

function getTrackingBadgeLabel(order: DeliveryOrder) {
  if (order.status === 'cancelled' && order.autoCancelledReason) {
    return 'No driver found';
  }

  if (order.status === 'pending_assignment') {
    return order.driverSearchStatus === 'waiting_for_driver' ? 'No nearby driver' : 'Finding driver';
  }

  return getDeliveryOrderStatusLabel(order.status);
}

function shouldRetryDriverSearch(order: DeliveryOrder) {
  return order.status === 'pending_assignment' && !order.driverId && order.timingMode !== 'later';
}

function isLiveTrackableOrder(order: DeliveryOrder) {
  return !['delivered', 'cancelled'].includes(order.status);
}

function shouldHideOrderOnTrack(order: DeliveryOrder | null) {
  return !!order && order.status === 'cancelled';
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
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = getParamValue(params.orderId);
  const mapRef = useRef<any>(null);
  const nativeMaps = useMemo(() => getNativeMaps(), []);
  const NativeMapView = nativeMaps.MapView;
  const Marker = nativeMaps.Marker;
  const Polyline = nativeMaps.Polyline;
  const mapProvider = nativeMaps.provider;
  const mapCanRender =
    nativeMaps.canRender && canRenderNativeGoogleMap() && Boolean(NativeMapView && Marker && Polyline);
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState<(typeof cancellationReasons)[number] | ''>('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [showRatingPanel, setShowRatingPanel] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingPromptDismissedOrderId, setRatingPromptDismissedOrderId] = useState<string | null>(null);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const waitingPulse = useRef(new Animated.Value(0)).current;
  const loadingPulse = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const liveSweep = useRef(new Animated.Value(0)).current;

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
            void autoAssignDriverToOrder(trackableOrder).catch((error) => {
              logAsyncFailure(screenScope, 'autoAssignDriverToOrder.latest', error, {
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
          void autoAssignDriverToOrder(nextOrder).catch((error) => {
            logAsyncFailure(screenScope, 'autoAssignDriverToOrder', error, { orderId });
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
      void autoAssignDriverToOrder(order).catch((error) => {
        logAsyncFailure(screenScope, 'autoAssignDriverToOrder.retry', error, { orderId: order.id });
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
    if (order?.dropoffLatitude !== undefined && order.dropoffLongitude !== undefined) {
      return {
        latitude: order.dropoffLatitude,
        longitude: order.dropoffLongitude,
      };
    }

    return getFallbackDropoff(pickupPoint);
  }, [order?.dropoffLatitude, order?.dropoffLongitude, pickupPoint]);

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
  const hasLiveMap = mapCanRender;
  const isWaitingForDriver = !!order && order.status === 'pending_assignment' && !order.driverId;
  const isOrderAlive = !!order && !['delivered', 'cancelled'].includes(order.status);
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
  const driverApproachLinePoints = useMemo(() => {
    if (!validDriverPoint || !order?.status) {
      return [];
    }

    if (['driver_assigned', 'driver_at_pickup'].includes(order.status)) {
      return filterValidCoordinates([validDriverPoint, validPickupPoint]);
    }

    if (order.status === 'in_transit') {
      return filterValidCoordinates([validDriverPoint, validDropoffPoint]);
    }

    return [];
  }, [order?.status, validDriverPoint, validDropoffPoint, validPickupPoint]);
  const mapFocusPoints = useMemo(() => {
    if (validDriverPoint && order?.status && ['driver_assigned', 'driver_at_pickup'].includes(order.status)) {
      return filterValidCoordinates([validDriverPoint, validPickupPoint]);
    }

    if (validDriverPoint && order?.status && ['in_transit', 'delivered'].includes(order.status)) {
      return filterValidCoordinates([validPickupPoint, validDropoffPoint, validDriverPoint]);
    }

    return filterValidCoordinates([validPickupPoint, validDropoffPoint]);
  }, [order?.status, validDriverPoint, validDropoffPoint, validPickupPoint]);
  const mapEdgePadding = useMemo(() => {
    if (validDriverPoint && order?.status && ['driver_assigned', 'driver_at_pickup'].includes(order.status)) {
      return { top: 116, right: 44, bottom: 72, left: 44 };
    }

    if (validDriverPoint && order?.status === 'in_transit') {
      return { top: 124, right: 52, bottom: 84, left: 52 };
    }

    return { top: 118, right: 50, bottom: 80, left: 50 };
  }, [order?.status, validDriverPoint]);
  const progressSteps = order
    ? [
        { title: 'Order received', note: 'Dispatch received the booking from your app.', active: true },
        {
          title: 'Driver assigned',
          note: 'A driver is chosen by DoorDrop dispatch and linked to your order.',
          active: statusRank[order.status] >= statusRank.driver_assigned,
        },
        {
          title: 'Driver at pickup',
          note: 'Pickup checks happen before the trip starts.',
          active: statusRank[order.status] >= statusRank.driver_at_pickup,
        },
        {
          title: 'In transit',
          note: 'The order is on the road to the destination.',
          active: statusRank[order.status] >= statusRank.in_transit,
        },
        {
          title: 'Delivered',
          note: 'Trip is completed and marked delivered by the driver.',
          active: statusRank[order.status] >= statusRank.delivered,
        },
      ]
    : [];
  const activeProgressIndex = progressSteps.reduce((latestIndex, step, index) => (step.active ? index : latestIndex), -1);
  const liveStatusLabel = isWaitingForDriver
    ? 'Searching live'
    : hasFreshDriverGpsPoint
      ? 'Live GPS active'
      : hasDriverGpsPoint
        ? 'Last GPS point saved'
        : order?.driverId
          ? 'Waiting for driver GPS'
      : 'Order channel active';
  const liveStatusDetail = hasDriverGpsPoint
    ? `${driverTelemetryLabel} from ${order?.driverName || 'driver'}`
    : order?.driverId
      ? 'Listening for the first GPS point from the driver app.'
      : order?.updatedAt
      ? `Last order update ${formatDeliveryDateTime(order.updatedAt)}`
      : 'Listening for dispatch updates';
  const driverPhone = order?.driverPhone?.trim() || '';
  const hasDriverPhone = driverPhone.length > 0;
  const canCancelOrder = !!order && !['delivered', 'cancelled'].includes(order.status);
  const cancellationReason = order?.cancellationReason?.trim() || '';
  const canMessageDriver =
    !!order?.driverId &&
    !!user?.uid &&
    user.uid === order.userId &&
    !['delivered', 'cancelled'].includes(order.status);
  const orderHasRating = hasDeliveryOrderRating(order);
  const canRateOrder = !!order && order.status === 'delivered' && !!user?.uid && user.uid === order.userId;
  const ratingBadgeLabel = orderHasRating
    ? `${order?.customerRating}/5`
    : order?.status === 'delivered'
      ? 'Rate trip'
      : 'Live';

  useEffect(() => {
    void runMapsDiagnostics(screenScope);
  }, []);

  useEffect(() => {
    if (!isWaitingForDriver) {
      waitingPulse.stopAnimation();
      waitingPulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(waitingPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(waitingPulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [isWaitingForDriver, waitingPulse]);

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

    if (!order?.id || !validPickupPoint || !validDropoffPoint) {
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
        logAsyncFailure(screenScope, 'fetchTrackingRouteEstimate', error, { orderId: order.id });
      });

    return () => {
      isMounted = false;
    };
  }, [order?.id, validDropoffPoint, validPickupPoint]);

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

  const handleCallDriver = async () => {
    if (!hasDriverPhone) {
      logWarning(screenScope, 'handleCallDriver without driver phone');
      Alert.alert('Driver phone pending', 'The driver number will appear here as soon as dispatch assigns or updates it.');
      return;
    }

    const dialablePhone = getDialablePhoneNumber(driverPhone);
    const callUrl = `tel:${dialablePhone}`;
    logAsyncStart(screenScope, 'handleCallDriver', { callUrl });

    try {
      const supported = await Linking.canOpenURL(callUrl);
      if (!supported) {
        throw new Error('Phone calls are not available on this device.');
      }

      await Linking.openURL(callUrl);
      logAsyncSuccess(screenScope, 'handleCallDriver', { callUrl });
    } catch (error) {
      logAsyncFailure(screenScope, 'handleCallDriver', error, { callUrl });
      Alert.alert('Unable to place call', `Try calling the driver directly on ${driverPhone}.`);
    }
  };

  const handleShareTrip = async () => {
    if (!order) {
      logWarning(screenScope, 'handleShareTrip skipped without order');
      return;
    }

    const shareMessage = [
      `DoorDrop trip ${order.orderNumber}`,
      `${order.pickupLabel} to ${order.dropoffLabel}`,
      `Status: ${getDeliveryOrderStatusLabel(order.status)}`,
      order.driverName ? `Driver: ${order.driverName}` : '',
      driverPhone ? `Phone: ${driverPhone}` : '',
      `Fare: ${order.totalLabel}`,
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

  const handleSubmitCancelOrder = () => {
    if (!order || !canCancelOrder || cancelSubmitting) {
      return;
    }

    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 4) {
      Alert.alert('Reason required', 'Please choose a cancellation reason before submitting.');
      return;
    }

    Alert.alert('Cancel this order?', `Reason: ${trimmedReason}`, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              logAsyncStart(screenScope, 'cancelDeliveryOrderByUser', {
                orderId: order.id,
                reason: trimmedReason,
              });
              setCancelSubmitting(true);
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
              setCancelReason('');
              setOrder(null);
              router.replace('/track-order');
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
              Alert.alert(
                'Unable to cancel order',
                error instanceof Error ? error.message : 'Please try cancelling this order again.'
              );
            } finally {
              setCancelSubmitting(false);
            }
          })();
        },
      },
    ]);
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <View style={styles.mapWrap}>
        {hasLiveMap && NativeMapView && Marker && Polyline ? (
          <NativeMapView
            ref={mapRef}
            provider={mapProvider}
            style={styles.map}
            customMapStyle={lightMapStyle}
            toolbarEnabled={false}
            moveOnMarkerPress={false}
            initialRegion={{
              latitude: validPickupPoint?.latitude ?? -6.7924,
              longitude: validPickupPoint?.longitude ?? 39.2083,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}>
            {routeLinePoints.length >= 2 ? (
              <Polyline coordinates={routeLinePoints} strokeColor="rgba(15, 118, 110, 0.52)" strokeWidth={5} />
            ) : null}
            {driverApproachLinePoints.length >= 2 ? (
              <Polyline
                coordinates={driverApproachLinePoints}
                strokeColor={hasFreshDriverGpsPoint ? '#059669' : '#475569'}
                strokeWidth={5}
                lineDashPattern={[10, 7]}
              />
            ) : null}
            {validPickupPoint ? (
              <Marker coordinate={validPickupPoint} title="Pickup" description={order?.pickupLabel || 'Pickup point'} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={[styles.routeMarker, styles.pickupMapMarker]}>
                  <MaterialCommunityIcons name="package-variant-closed" size={17} color="#FFFFFF" />
                </View>
              </Marker>
            ) : null}
            {validDropoffPoint ? (
              <Marker coordinate={validDropoffPoint} title="Drop-off" description={order?.dropoffLabel || 'Drop-off point'} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={[styles.routeMarker, styles.dropoffMapMarker]}>
                  <MaterialCommunityIcons name="flag-checkered" size={16} color="#FFFFFF" />
                </View>
              </Marker>
            ) : null}
            {validDriverPoint ? (
              <Marker
                coordinate={validDriverPoint}
                title={order?.driverName || 'Driver'}
                description={mapLiveStatusDetail}
                anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.driverMapMarker}>
                  {hasFreshDriverGpsPoint && isOrderAlive ? (
                    <Animated.View style={[styles.driverMarkerPulse, { opacity: livePulse }]} />
                  ) : null}
                  <View style={[styles.driverMarkerCore, !hasFreshDriverGpsPoint && styles.driverMarkerCoreMuted]}>
                    <MaterialCommunityIcons
                      name={order?.flow === 'cargo' ? 'truck-delivery-outline' : 'motorbike'}
                      size={20}
                      color="#FFFFFF"
                    />
                  </View>
                </View>
              </Marker>
            ) : null}
          </NativeMapView>
        ) : (
          <View style={[styles.map, styles.mapUnavailableCard]}>
            <Text style={styles.mapUnavailableTitle}>Google Map unavailable</Text>
            <Text style={styles.mapUnavailableText}>
              Turn on the Android Google Maps build key to see the full live route preview here.
            </Text>
          </View>
        )}

        <View style={styles.topBar}>
          <TouchableOpacity style={styles.chromeButton} onPress={() => router.push('/menu')}>
            <MaterialCommunityIcons name="menu" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
          <View style={styles.titleChip}>
            <Text style={styles.titleChipText}>
              {order?.status === 'delivered' ? 'Completed trip' : order?.status === 'cancelled' ? 'Tracking closed' : 'Live tracking'}
            </Text>
          </View>
          <TouchableOpacity style={styles.chromeButton} onPress={() => router.push('/support-center')}>
            <MaterialCommunityIcons name="headset" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
        </View>

        {order ? (
          <View style={styles.mapLiveCard}>
            <View
              style={[
                styles.mapLiveIcon,
                order.status === 'delivered'
                  ? styles.mapLiveIconComplete
                  : order.status === 'cancelled'
                    ? styles.mapLiveIconClosed
                    : hasFreshDriverGpsPoint
                  ? styles.mapLiveIconFresh
                  : hasDriverGpsPoint
                    ? styles.mapLiveIconKnown
                    : styles.mapLiveIconPending,
              ]}>
              <MaterialCommunityIcons
                name={
                  order.status === 'delivered'
                    ? 'check-decagram-outline'
                    : order.status === 'cancelled'
                      ? 'close-circle-outline'
                      : hasFreshDriverGpsPoint
                        ? 'crosshairs-gps'
                        : hasDriverGpsPoint
                          ? 'map-marker-radius-outline'
                          : 'map-marker-outline'
                }
                size={18}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.mapLiveCopy}>
              <Text style={styles.mapLiveLabel}>{mapLiveStatusLabel}</Text>
              <Text style={styles.mapLiveText} numberOfLines={2}>
                {mapLiveStatusDetail}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {!order && !loading ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="map-marker-question-outline" size={30} color="#94A3B8" />
              <Text style={styles.emptyTitle}>Order not found</Text>
              <Text style={styles.emptyText}>Open a recent order from history or create a new booking first.</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.emptyState}>
              <View style={styles.liveLoadingVisual}>
                <Animated.View
                  style={[
                    styles.liveLoadingRing,
                    {
                      opacity: loadingPulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.62, 0.16],
                      }),
                      transform: [
                        {
                          scale: loadingPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.82, 1.25],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <MaterialCommunityIcons name="progress-clock" size={30} color={cargoTheme.colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Loading live order data</Text>
              <Text style={styles.emptyText}>We are pulling the latest dispatch status from Firestore.</Text>
            </View>
          ) : null}

          {order ? (
            <>
              <View style={styles.statusCard}>
                <View style={styles.statusBadge}>
                  <MaterialCommunityIcons
                    name={order.status === 'cancelled' && order.autoCancelledReason ? 'map-marker-off-outline' : order.status === 'pending_assignment' ? 'clock-outline' : 'map-marker-path'}
                    size={16}
                    color="#FFFFFF"
                  />
                  <Text style={styles.statusBadgeText}>{getTrackingBadgeLabel(order)}</Text>
                </View>
                <Text style={styles.statusTitle}>{getTrackingTitle(order)}</Text>
                <Text style={styles.statusText}>{getDriverSearchStatusText(order)}</Text>
                {isOrderAlive ? (
                  <View style={styles.liveActivityCard}>
                    <View style={styles.liveActivityHeader}>
                      <View style={styles.liveActivityPulseWrap}>
                        <Animated.View
                          style={[
                            styles.liveActivityPulse,
                            {
                              opacity: livePulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.72, 0.12],
                              }),
                              transform: [
                                {
                                  scale: livePulse.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, 1.9],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                        <View style={styles.liveActivityDot} />
                      </View>
                      <View style={styles.liveActivityCopy}>
                        <Text style={styles.liveActivityLabel}>{liveStatusLabel}</Text>
                        <Text style={styles.liveActivityText}>{liveStatusDetail}</Text>
                      </View>
                    </View>
                    <View style={styles.liveActivityTrack}>
                      <Animated.View
                        style={[
                          styles.liveActivitySweep,
                          {
                            transform: [
                              {
                                translateX: liveSweep.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [-96, 260],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}
                {isWaitingForDriver ? (
                  <View style={styles.statusWaitingRow}>
                    <View style={styles.statusWaitingIndicator}>
                      <Animated.View
                        style={[
                          styles.statusWaitingPulse,
                          {
                            opacity: waitingPulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.85, 0.18],
                            }),
                            transform: [
                              {
                                scale: waitingPulse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [1, 1.9],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                      <View style={styles.statusWaitingDot} />
                    </View>
                    <Text style={styles.statusWaitingText}>
                      {order.driverSearchStatus === 'waiting_for_driver'
                        ? 'No nearby driver is online yet. We will cancel automatically if no match appears in time.'
                        : 'Dispatch is actively searching for the nearest driver.'}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.driverCard}>
                <View style={styles.driverTop}>
                  <View style={styles.driverAvatar}>
                    <Text style={styles.driverAvatarText}>
                      {(order.driverName ?? 'DD')
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() ?? '')
                        .join('')}
                    </Text>
                  </View>
                  <View style={styles.driverCopy}>
                    <Text style={styles.driverName}>{order.driverName || 'Driver not assigned yet'}</Text>
                    <Text style={styles.driverMeta}>
                      {order.driverId
                        ? `${order.driverVehicleLabel || 'Vehicle pending'} • ${order.driverPlateNumber || 'Plate pending'}`
                        : order.driverSearchStatus === 'waiting_for_driver'
                          ? 'No nearby online driver yet.'
                          : 'Waiting for the nearest online driver.'}
                    </Text>
                  </View>
                  <View style={styles.ratingWrap}>
                    <MaterialCommunityIcons
                      name={orderHasRating ? 'star' : order?.status === 'delivered' ? 'star-outline' : 'map-marker-path'}
                      size={14}
                      color={orderHasRating || order?.status === 'delivered' ? '#F59E0B' : cargoTheme.colors.primaryDark}
                    />
                    <Text style={styles.ratingText}>{ratingBadgeLabel}</Text>
                  </View>
                </View>

                <View style={styles.driverGpsStatusRow}>
                  <View style={[styles.driverGpsDot, hasFreshDriverGpsPoint && styles.driverGpsDotFresh]} />
                  <View style={styles.driverGpsCopy}>
                    <Text style={styles.driverGpsLabel}>{mapLiveStatusLabel}</Text>
                    <Text style={styles.driverGpsText}>{mapLiveStatusDetail}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  activeOpacity={hasDriverPhone ? 0.88 : 1}
                  onPress={() => {
                    void handleCallDriver();
                  }}
                  style={[styles.phoneCard, !hasDriverPhone && styles.phoneCardMuted]}>
                  <View style={styles.phoneCardLeading}>
                    <MaterialCommunityIcons name="phone-outline" size={18} color={cargoTheme.colors.primaryDark} />
                    <Text style={styles.phoneCardLabel}>Driver phone</Text>
                  </View>
                  <View style={styles.phoneCardTrailing}>
                    <Text style={[styles.phoneCardValue, !hasDriverPhone && styles.phoneCardValueMuted]}>
                      {driverPhone || 'Phone pending'}
                    </Text>
                    {hasDriverPhone ? (
                      <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
                    ) : null}
                  </View>
                </TouchableOpacity>

                <View style={styles.driverActions}>
                  <PrimaryButton
                    label={hasDriverPhone ? 'Call driver' : 'Phone pending'}
                    variant="secondary"
                    icon="phone-outline"
                    style={[styles.actionButton, !hasDriverPhone && styles.actionButtonDisabled]}
                    onPress={() => {
                      void handleCallDriver();
                    }}
                  />
                  <PrimaryButton
                    label="Share trip"
                    variant="secondary"
                    icon="share-variant-outline"
                    style={styles.actionButton}
                    onPress={() => {
                      void handleShareTrip();
                    }}
                  />
                </View>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Trip details</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Order ID</Text>
                  <Text style={styles.summaryValue}>{order.orderNumber}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Route</Text>
                  <Text style={styles.summaryValue}>{order.routeLabel || `${order.pickupLabel} to ${order.dropoffLabel}`}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Fare</Text>
                  <Text style={styles.summaryValue}>{order.totalLabel}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Created</Text>
                  <Text style={styles.summaryValue}>{formatDeliveryDateTime(order.createdAt)}</Text>
                </View>
              </View>

              {order.status === 'delivered' ? (
                <View style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <View style={styles.reviewHeaderCopy}>
                      <Text style={styles.reviewTitle}>Your delivery rating</Text>
                      <Text style={styles.reviewSubtitle}>
                        {orderHasRating
                          ? 'Thanks for rating this completed DoorDrop order.'
                          : 'Tell DoorDrop how this completed delivery went.'}
                      </Text>
                    </View>
                    {canRateOrder ? (
                      <TouchableOpacity activeOpacity={0.88} onPress={handleOpenRatingPanel} style={styles.reviewEditChip}>
                        <MaterialCommunityIcons name={orderHasRating ? 'pencil-outline' : 'star-outline'} size={15} color={cargoTheme.colors.primaryDark} />
                        <Text style={styles.reviewEditChipText}>{orderHasRating ? 'Edit' : 'Rate'}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.reviewStarsRow}>
                    {ratingOptions.map((star) => (
                      <MaterialCommunityIcons
                        key={star}
                        name={star <= (order.customerRating ?? 0) ? 'star' : 'star-outline'}
                        size={20}
                        color="#F59E0B"
                      />
                    ))}
                    <Text style={styles.reviewStarsText}>
                      {orderHasRating ? `${order.customerRating}/5` : 'Not rated yet'}
                    </Text>
                  </View>

                  {order.customerReview?.trim() ? (
                    <Text style={styles.reviewBody}>&quot;{order.customerReview.trim()}&quot;</Text>
                  ) : (
                    <Text style={styles.reviewEmptyText}>
                      {orderHasRating ? 'No written comment was added for this trip.' : 'Add a star rating and an optional note for dispatch quality tracking.'}
                    </Text>
                  )}

                  {order.customerRatedAt ? (
                    <Text style={styles.reviewMeta}>Rated {formatDeliveryDateTime(order.customerRatedAt)}</Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.messageCard}>
                <Text style={styles.messageTitle}>Message driver</Text>
                <Text style={styles.messageSubtitle}>
                  {order.driverId
                    ? 'Use in-app chat for pickup notes, gate access and quick delivery updates.'
                    : 'Dispatch will unlock driver chat after a driver is assigned to this order.'}
                </Text>

                {messagesLoading ? (
                  <Text style={styles.messageHint}>Loading your latest conversation...</Text>
                ) : messages.length ? (
                  <View style={styles.messageThread}>
                    {messages.slice(-6).map((item) => {
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
                                styles.messageSender,
                                isCustomerMessage ? styles.messageSenderSelf : styles.messageSenderOther,
                              ]}>
                              {isCustomerMessage ? 'You' : item.senderName || 'Driver'}
                            </Text>
                            <Text
                              style={[
                                styles.messageText,
                                isCustomerMessage ? styles.messageTextSelf : styles.messageTextOther,
                              ]}>
                              {item.message}
                            </Text>
                            <Text
                              style={[
                                styles.messageTime,
                                isCustomerMessage ? styles.messageTimeSelf : styles.messageTimeOther,
                              ]}>
                              {formatDeliveryDateTime(item.createdAt)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.messageEmptyCard}>
                    <MaterialCommunityIcons name="message-text-outline" size={20} color="#94A3B8" />
                    <Text style={styles.messageHint}>
                      {order.driverId
                        ? 'No messages yet. Send the driver a quick note when you need help with pickup or delivery.'
                        : 'No driver conversation yet.'}
                    </Text>
                  </View>
                )}

                <View style={[styles.messageComposer, !canMessageDriver && styles.messageComposerDisabled]}>
                  <TextInput
                    value={messageDraft}
                    onChangeText={setMessageDraft}
                    editable={canMessageDriver && !messageSending}
                    multiline
                    maxLength={240}
                    placeholder={
                      canMessageDriver ? 'Write a message to your driver' : 'Driver chat becomes available after assignment'
                    }
                    placeholderTextColor="#94A3B8"
                    style={styles.messageInput}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    activeOpacity={0.88}
                    disabled={!canMessageDriver || !messageDraft.trim() || messageSending}
                    style={[
                      styles.messageSendButton,
                      (!canMessageDriver || !messageDraft.trim() || messageSending) && styles.messageSendButtonDisabled,
                    ]}
                    onPress={() => {
                      void handleSendMessage();
                    }}>
                    <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
                    <Text style={styles.messageSendButtonText}>{messageSending ? 'Sending...' : 'Send'}</Text>
                  </TouchableOpacity>
                </View>

                {!user?.uid ? (
                  <Text style={styles.messageHint}>Sign in first to message the driver from inside the app.</Text>
                ) : user.uid !== order.userId ? (
                  <Text style={styles.messageHint}>This chat is only available to the customer account that booked the trip.</Text>
                ) : !order.driverId ? (
                  <Text style={styles.messageHint}>Dispatch will connect your driver here as soon as one is assigned.</Text>
                ) : null}
              </View>

              {order.status === 'cancelled' ? (
                <View style={styles.cancelInfoCard}>
                  <Text style={styles.cancelInfoTitle}>Cancellation details</Text>
                  <Text style={styles.cancelInfoText}>
                    Cancelled by {getCancellationActorLabel(order.cancelledBy)}
                    {order.cancelledAt ? ` • ${formatDeliveryDateTime(order.cancelledAt)}` : ''}
                  </Text>
                  {cancellationReason ? <Text style={styles.cancelInfoReason}>{cancellationReason}</Text> : null}
                </View>
              ) : null}

              {canCancelOrder ? (
                <View style={styles.cancelToggleHitArea}>
                  <PrimaryButton
                    label="Cancel order"
                    variant="dark"
                    icon="close-circle-outline"
                    style={styles.cancelToggleButton}
                    onPress={() => setShowCancelPanel(true)}
                  />
                </View>
              ) : null}

              <View style={styles.progressCard}>
                <Text style={styles.progressTitle}>Order progress</Text>
                {progressSteps.map((step, index) => (
                  <View key={step.title} style={styles.progressRow}>
                    <View style={styles.progressRail}>
                      {isOrderAlive && index === activeProgressIndex ? (
                        <Animated.View
                          style={[
                            styles.progressDotPulse,
                            {
                              opacity: livePulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.5, 0.08],
                              }),
                              transform: [
                                {
                                  scale: livePulse.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.85, 1.8],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                      ) : null}
                      <View
                        style={[
                          styles.progressDot,
                          step.active && styles.progressDotActive,
                          isOrderAlive && index === activeProgressIndex && styles.progressDotCurrent,
                        ]}
                      />
                      {index !== progressSteps.length - 1 ? <View style={styles.progressLine} /> : null}
                    </View>
                    <View style={styles.progressCopy}>
                      <Text style={[styles.progressStepTitle, step.active && styles.progressStepTitleActive]}>{step.title}</Text>
                      <Text style={styles.progressStepNote}>{step.note}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <BottomNav activeTab="track" />
      </View>
      <Modal animationType="slide" transparent visible={showCancelPanel} onRequestClose={() => setShowCancelPanel(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!cancelSubmitting) {
                setShowCancelPanel(false);
              }
            }}
          />
          <View style={styles.cancelCard}>
            <View style={styles.cancelHeader}>
              <Text style={styles.cancelTitle}>Cancel this order</Text>
              <TouchableOpacity
                disabled={cancelSubmitting}
                onPress={() => {
                  setShowCancelPanel(false);
                  setCancelReason('');
                }}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.subtext} />
              </TouchableOpacity>
            </View>
            <Text style={styles.cancelText}>Choose the reason that best explains why you want to cancel.</Text>
            <View style={styles.reasonList}>
              {cancellationReasons.map((reason) => {
                const isSelected = cancelReason === reason;

                return (
                  <TouchableOpacity
                    key={reason}
                    activeOpacity={0.88}
                    style={[styles.reasonOption, isSelected && styles.reasonOptionSelected]}
                    onPress={() => setCancelReason(reason)}>
                    <View style={[styles.reasonRadio, isSelected && styles.reasonRadioSelected]}>
                      {isSelected ? <View style={styles.reasonRadioDot} /> : null}
                    </View>
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.cancelActionRow}>
              <PrimaryButton
                label="Keep order"
                variant="secondary"
                style={styles.cancelSecondaryAction}
                onPress={() => {
                  setShowCancelPanel(false);
                  setCancelReason('');
                }}
              />
              <PrimaryButton
                label={cancelSubmitting ? 'Cancelling...' : 'Confirm cancel'}
                variant="dark"
                icon="close-circle-outline"
                style={styles.cancelPrimaryAction}
                onPress={handleSubmitCancelOrder}
              />
            </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cargoTheme.colors.canvas,
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
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 24,
  },
  mapUnavailableTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  mapUnavailableText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
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
  chromeButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  mapLiveCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 36,
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
    fontSize: 13,
    fontWeight: '900',
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
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
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
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 18,
    marginBottom: 18,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#D7E1EA',
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
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
  },
  driverTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  driverAvatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
  },
  driverCopy: {
    flex: 1,
    marginRight: 8,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  driverMeta: {
    fontSize: 12,
    lineHeight: 18,
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
  cancelToggleButton: {
    minHeight: 64,
    marginBottom: 18,
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  cancelToggleHitArea: {
    paddingVertical: 6,
    marginHorizontal: -2,
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
    backgroundColor: '#FFF7ED',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#FED7AA',
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
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  ratingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  ratingTextBody: {
    fontSize: 13,
    lineHeight: 20,
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
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  cancelText: {
    fontSize: 13,
    lineHeight: 19,
    color: cargoTheme.colors.subtext,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FDBA74',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  reasonOptionSelected: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRadioSelected: {
    borderColor: '#DC2626',
  },
  reasonRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  reasonLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: cargoTheme.colors.text,
  },
  reasonLabelSelected: {
    color: '#991B1B',
    fontWeight: '700',
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
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 6,
  },
  cancelInfoText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#991B1B',
    marginBottom: 8,
  },
  cancelInfoReason: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.text,
  },
  summaryCard: {
    backgroundColor: cargoTheme.colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 18,
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
    color: cargoTheme.colors.subtext,
  },
  summaryValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
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
    fontWeight: '800',
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
    fontWeight: '800',
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
    color: cargoTheme.colors.text,
    fontStyle: 'italic',
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
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  messageSubtitle: {
    fontSize: 13,
    lineHeight: 20,
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
  },
  messageSendButton: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: cargoTheme.colors.primary,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
    fontSize: 12,
    lineHeight: 18,
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
