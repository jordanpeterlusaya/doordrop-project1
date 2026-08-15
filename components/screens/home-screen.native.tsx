import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  beginCargoDiagnosticAttempt,
  recordCargoDiagnostic,
} from '@/lib/cargo-diagnostics';
import { logError, logInfo } from '@/lib/debug-logger';
import { recordAppActivity } from '@/lib/app-analytics';
import {
  getDeliveryOrderStatusLabel,
  subscribeToUserOrders,
  type DeliveryOrder,
} from '@/lib/delivery-data';
import { getSavedPlaces, type SavedPlace } from '@/lib/saved-places';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';
import { useNotifications } from '@/providers/notification-provider';

const screenScope = 'HomeScreen';

type AppRoute = '/send-parcel' | '/book-cargo' | '/track-order' | '/saved-places' | '/support-center';

type ScheduleOption = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: AppRoute;
};

type ServiceTile = {
  key: string;
  title: string;
  subtitle: string;
  image?: number;
  imageScale?: number;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconTone?: 'green' | 'slate';
  action: 'route' | 'schedule';
  route?: AppRoute;
};

type LiveLocationStatus = 'loading' | 'ready' | 'permission-denied' | 'unavailable';

const HOME_PRESS_GUARD_MS = 650;
const ACTIVE_ORDER_STATUSES = new Set(['pending_assignment', 'driver_assigned', 'driver_at_pickup', 'in_transit']);

function cleanAddressPart(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeAddressParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatNamedCurrentLocation(address: Location.LocationGeocodedAddress | null | undefined) {
  if (!address) {
    return '';
  }

  const formattedAddress = cleanAddressPart(address.formattedAddress);
  if (formattedAddress) {
    const formattedParts = dedupeAddressParts(
      formattedAddress
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    );
    return formattedParts.slice(0, 2).join(', ');
  }

  const addressParts = dedupeAddressParts(
    [
      address.name,
      address.street,
      address.district,
      address.subregion,
      address.city,
      address.region,
      address.country,
    ]
      .map(cleanAddressPart)
      .filter(Boolean)
  );

  return addressParts.slice(0, 2).join(', ');
}

export default function HomePage() {
  const router = useRouter();
  const { language } = useLanguage();
  const { unreadCount } = useNotifications();
  const { profile, user } = useAuthSession();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busyRoute, setBusyRoute] = useState<AppRoute | null>(null);
  const [liveLocationName, setLiveLocationName] = useState('');
  const [liveLocationStatus, setLiveLocationStatus] = useState<LiveLocationStatus>('loading');
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeOrder, setActiveOrder] = useState<DeliveryOrder | null>(null);
  const locationLookupIdRef = useRef(0);
  const routePressGuardRef = useRef(0);
  const utilityPressGuardRef = useRef(0);

  const copy = useMemo(
    () =>
      language === 'sw'
        ? {
            locationLoading: 'Inatafuta eneo...',
            locationPermissionDenied: 'Ruhusu location',
            locationUnavailable: 'Eneo halikupatikana',
            greeting: 'Hujambo',
            heroTitle: 'Tuma chochote leo.',
            searchTitle: 'Unataka kutuma wapi?',
            laterLabel: 'Ratiba',
            openingText: 'Inafunguka',
            scheduleModalTitle: 'Panga usafirishaji',
            scheduleModalSubtitle: 'Chagua huduma na uweke muda unaopendelea wa kuchukuliwa.',
            cancel: 'Ghairi',
            savedPlacesTitle: 'Maeneo yako',
            savedPlacesEmpty: 'Hifadhi nyumbani, duka au ofisi',
            activeOrderTitle: 'Usafirishaji unaoendelea',
            tiles: [
              {
                key: 'parcel',
                title: 'Kifurushi',
                subtitle: 'Nyaraka na vifurushi',
                image: require('@/assets/images/home-send-parcel.png'),
                imageScale: 1.22,
                icon: 'package-variant-closed',
                action: 'route',
                route: '/send-parcel',
              },
              {
                key: 'cargo',
                title: 'Mizigo',
                subtitle: 'TOYO na Kirikuu',
                image: require('@/assets/images/10.png'),
                imageScale: 1.04,
                icon: 'truck-fast-outline',
                action: 'route',
                route: '/book-cargo',
              },
              {
                key: 'schedule',
                title: 'Ratiba',
                subtitle: 'Panga kuchukuliwa',
                icon: 'calendar-month-outline',
                iconTone: 'green',
                action: 'schedule',
              },
              {
                key: 'track',
                title: 'Fuatilia',
                subtitle: 'Oda zinazoendelea',
                icon: 'map-marker-path',
                iconTone: 'slate',
                action: 'route',
                route: '/track-order',
              },
            ] satisfies ServiceTile[],
            scheduleOptions: [
              {
                title: 'Tuma kifurushi',
                subtitle: 'Panga kuchukuliwa au kupelekwa kwa kifurushi baadaye.',
                icon: 'package-variant-closed',
                route: '/send-parcel',
              },
              {
                title: 'Omba msafirishaji wa mizigo',
                subtitle: 'Panga usafiri wa mizigo yako kwa muda unaokufaa.',
                icon: 'truck-fast-outline',
                route: '/book-cargo',
              },
            ] satisfies ScheduleOption[],
          }
        : {
            locationLoading: 'Finding location...',
            locationPermissionDenied: 'Allow location',
            locationUnavailable: 'Location unavailable',
            greeting: 'Hello',
            heroTitle: 'Send anything today.',
            searchTitle: 'Where do you want to send?',
            laterLabel: 'Later',
            openingText: 'Opening',
            scheduleModalTitle: 'Schedule delivery',
            scheduleModalSubtitle: 'Choose a service and set your preferred pickup time.',
            cancel: 'Cancel',
            savedPlacesTitle: 'Your places',
            savedPlacesEmpty: 'Save home, shop or office',
            activeOrderTitle: 'Delivery in progress',
            tiles: [
              {
                key: 'parcel',
                title: 'Parcel',
                subtitle: 'Documents and packages',
                image: require('@/assets/images/home-send-parcel.png'),
                imageScale: 1.22,
                icon: 'package-variant-closed',
                action: 'route',
                route: '/send-parcel',
              },
              {
                key: 'cargo',
                title: 'Cargo',
                subtitle: 'TOYO and Kirikuu',
                image: require('@/assets/images/10.png'),
                imageScale: 1.04,
                icon: 'truck-fast-outline',
                action: 'route',
                route: '/book-cargo',
              },
              {
                key: 'schedule',
                title: 'Schedule',
                subtitle: 'Plan a pickup',
                icon: 'calendar-month-outline',
                iconTone: 'green',
                action: 'schedule',
              },
              {
                key: 'track',
                title: 'Track',
                subtitle: 'Active deliveries',
                icon: 'map-marker-path',
                iconTone: 'slate',
                action: 'route',
                route: '/track-order',
              },
            ] satisfies ServiceTile[],
            scheduleOptions: [
              {
                title: 'Send parcel',
                subtitle: 'Schedule a parcel pickup or drop-off for later.',
                icon: 'package-variant-closed',
                route: '/send-parcel',
              },
              {
                title: 'Request cargo carrier',
                subtitle: 'Plan transport for your goods at your preferred time.',
                icon: 'truck-fast-outline',
                route: '/book-cargo',
              },
            ] satisfies ScheduleOption[],
          },
    [language]
  );

  const firstName = useMemo(() => {
    const fullName = profile?.fullName?.trim() || user?.displayName?.trim() || '';
    return fullName.split(/\s+/)[0] || '';
  }, [profile?.fullName, user?.displayName]);

  const locationValue = useMemo(() => {
    if (liveLocationStatus === 'ready' && liveLocationName.trim()) {
      return liveLocationName;
    }

    if (liveLocationStatus === 'permission-denied') {
      return copy.locationPermissionDenied;
    }

    if (liveLocationStatus === 'unavailable') {
      return copy.locationUnavailable;
    }

    return copy.locationLoading;
  }, [copy.locationLoading, copy.locationPermissionDenied, copy.locationUnavailable, liveLocationName, liveLocationStatus]);

  const applyCurrentPosition = useCallback(async (position: Location.LocationObject) => {
    const lookupId = ++locationLookupIdRef.current;
    const point = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    try {
      const reverse = await Location.reverseGeocodeAsync(point);
      if (lookupId !== locationLookupIdRef.current) {
        return;
      }

      const nextLocationName = formatNamedCurrentLocation(reverse[0]);
      if (nextLocationName) {
        setLiveLocationName(nextLocationName);
        setLiveLocationStatus('ready');
        logInfo(screenScope, 'live-location-ready', {
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
        return;
      }

      setLiveLocationName('');
      setLiveLocationStatus('unavailable');
      logInfo(screenScope, 'live-location-missing-name', {
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      });
    } catch (error) {
      if (lookupId !== locationLookupIdRef.current) {
        return;
      }

      setLiveLocationName('');
      setLiveLocationStatus('unavailable');
      logError(screenScope, 'reverse geocode failed', error);
    }
  }, []);

  const refreshCurrentLocation = useCallback(
    async (source: 'initial' | 'tap' | 'watch' = 'tap'): Promise<boolean> => {
      if (source === 'tap') {
        setIsRefreshingLocation(true);
      }

      setLiveLocationStatus((currentStatus) => (currentStatus === 'ready' ? currentStatus : 'loading'));

      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          setLiveLocationName('');
          setLiveLocationStatus('permission-denied');
          return false;
        }

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await applyCurrentPosition(currentPosition);
        return true;
      } catch (error) {
        setLiveLocationName('');
        setLiveLocationStatus('unavailable');
        logError(screenScope, 'current location lookup failed', error, { source });
        return false;
      } finally {
        if (source === 'tap') {
          setIsRefreshingLocation(false);
        }
      }
    },
    [applyCurrentPosition]
  );

  useEffect(() => {
    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        if (isMounted) {
          void refreshCurrentLocation('initial');
        }
      }, 700);
    });

    return () => {
      isMounted = false;
      interactionTask.cancel();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [refreshCurrentLocation]);

  useEffect(() => {
    let isMounted = true;

    void getSavedPlaces().then((places) => {
      if (isMounted) {
        setSavedPlaces(places.slice(0, 4));
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setActiveOrder(null);
      return;
    }

    return subscribeToUserOrders(
      user.uid,
      (orders) => {
        setActiveOrder(orders.find((order) => ACTIVE_ORDER_STATUSES.has(order.status)) ?? null);
      },
      (error) => {
        logError(screenScope, 'active order lookup failed', error);
      }
    );
  }, [user?.uid]);

  useEffect(() => {
    logInfo(screenScope, 'screen-mounted');

    return () => {
      logInfo(screenScope, 'screen-unmounted');
    };
  }, []);

  const handleUtilityRoutePress = useCallback(
    (route: '/menu' | '/notifications') => {
      const now = Date.now();
      if (now - utilityPressGuardRef.current < HOME_PRESS_GUARD_MS) {
        return;
      }

      utilityPressGuardRef.current = now;
      router.push(route);
    },
    [router]
  );

  const handleServiceSelect = useCallback((route: AppRoute, source: string) => {
    const now = Date.now();
    if (now - routePressGuardRef.current < HOME_PRESS_GUARD_MS) {
      return;
    }

    routePressGuardRef.current = now;
    setBusyRoute(route);

    try {
      router.push(route);
    } catch (error) {
      logError(screenScope, 'service navigation failed', error, { route, source });
      setBusyRoute(null);
      return;
    }

    setTimeout(() => {
      void recordAppActivity({
        userId: user?.uid,
        userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
        userRole: 'customer',
        eventName: 'feature_tap',
        featureKey: route,
        featureLabel: route.replace('/', ''),
        screen: 'home',
        route,
        metadata: { source },
      });

      if (route === '/book-cargo') {
        void (async () => {
          try {
            await beginCargoDiagnosticAttempt(source, { route });
            await recordCargoDiagnostic('home:book-cargo:after-router-push', { route, source });
          } catch (error) {
            logError(screenScope, 'cargo diagnostics failed after navigation', error, { route, source });
          }
        })();
      }
    }, 250);

    setTimeout(() => {
      setBusyRoute((currentRoute) => (currentRoute === route ? null : currentRoute));
    }, 700);
  }, [profile?.fullName, router, user?.displayName, user?.email, user?.uid]);

  const handleScheduleSelect = useCallback((route: AppRoute) => {
    setScheduleOpen(false);
    handleServiceSelect(route, 'home-schedule-sheet');
  }, [handleServiceSelect]);

  const openScheduleSheet = useCallback((source: string) => {
    setScheduleOpen(true);
    setTimeout(() => {
      void recordAppActivity({
        userId: user?.uid,
        userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
        userRole: 'customer',
        eventName: 'schedule_open',
        featureKey: 'schedule_delivery',
        featureLabel: 'Schedule delivery',
        screen: 'home',
        route: '/home',
        metadata: { source },
      });
    }, 250);
  }, [profile?.fullName, user?.displayName, user?.email, user?.uid]);

  const handleTilePress = useCallback(
    (tile: ServiceTile) => {
      if (tile.action === 'schedule') {
        openScheduleSheet('home-service-tile');
        return;
      }

      if (tile.route) {
        handleServiceSelect(tile.route, 'home-service-tile');
      }
    },
    [handleServiceSelect, openScheduleSheet]
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          onPress={() => handleUtilityRoutePress('/menu')}>
          <MaterialCommunityIcons name="menu" size={22} color="#111827" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.locationChip}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={locationValue}
          onPress={() => {
            void refreshCurrentLocation('tap');
          }}>
          <MaterialCommunityIcons name="map-marker" size={15} color={cargoTheme.colors.primary} />
          <Text numberOfLines={1} style={styles.locationText}>
            {locationValue}
          </Text>
          {isRefreshingLocation || liveLocationStatus === 'loading' ? (
            <ActivityIndicator size="small" color="#94A3B8" />
          ) : (
            <MaterialCommunityIcons name="chevron-down" size={16} color="#94A3B8" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : 'Open notifications'}
          onPress={() => handleUtilityRoutePress('/notifications')}>
          <MaterialCommunityIcons
            name={unreadCount > 0 ? 'bell-ring-outline' : 'bell-outline'}
            size={21}
            color="#111827"
          />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {firstName ? (
          <Text style={styles.heroEyebrow}>
            {copy.greeting}, {firstName}
          </Text>
        ) : null}
        <Text style={styles.heroTitle}>{copy.heroTitle}</Text>

        <View style={styles.tileGrid}>
          {copy.tiles.map((tile) => {
            const isBusy = Boolean(tile.route && busyRoute === tile.route);

            return (
              <TouchableOpacity
                key={tile.key}
                activeOpacity={0.88}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={tile.title}
                onPress={() => handleTilePress(tile)}>
                <View style={styles.tileArt}>
                  {tile.image ? (
                    <Image
                      source={tile.image}
                      style={[styles.tileImage, tile.imageScale ? { transform: [{ scale: tile.imageScale }] } : null]}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={[styles.tileIconWrap, tile.iconTone === 'green' && styles.tileIconWrapGreen]}>
                      <MaterialCommunityIcons
                        name={tile.icon}
                        size={22}
                        color={tile.iconTone === 'green' ? cargoTheme.colors.primaryDark : '#111827'}
                      />
                    </View>
                  )}
                </View>
                <Text style={styles.tileTitle}>{tile.title}</Text>
                <Text numberOfLines={1} style={styles.tileSubtitle}>
                  {isBusy ? copy.openingText : tile.subtitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.searchBar}>
          <TouchableOpacity
            style={styles.searchMain}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={copy.searchTitle}
            onPress={() => {
              void handleServiceSelect('/send-parcel', 'home-search-box');
            }}>
            <MaterialCommunityIcons name="magnify" size={22} color="#111827" />
            <Text numberOfLines={1} style={styles.searchTitle}>
              {copy.searchTitle}
            </Text>
          </TouchableOpacity>
          <View style={styles.searchDivider} />
          <TouchableOpacity
            style={styles.laterButton}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel={copy.laterLabel}
            onPress={() => openScheduleSheet('home-search-later')}>
            <MaterialCommunityIcons name="calendar-month-outline" size={16} color="#111827" />
            <Text style={styles.laterLabel}>{copy.laterLabel}</Text>
          </TouchableOpacity>
        </View>

        {activeOrder ? (
          <TouchableOpacity
            style={styles.placeRow}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={copy.activeOrderTitle}
            onPress={() => handleServiceSelect('/track-order', 'home-active-order')}>
            <View style={styles.placeIconActive}>
              <View style={styles.liveDot} />
              <MaterialCommunityIcons name="package-variant-closed" size={18} color={cargoTheme.colors.primaryDark} />
            </View>
            <View style={styles.placeCopy}>
              <Text numberOfLines={1} style={styles.placeTitle}>
                {activeOrder.dropoffLabel || copy.activeOrderTitle}
              </Text>
              <Text numberOfLines={1} style={styles.placeSubtitleActive}>
                {getDeliveryOrderStatusLabel(activeOrder.status)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        ) : null}

        {savedPlaces.length > 0 ? (
          savedPlaces.map((place) => (
            <TouchableOpacity
              key={place.id}
              style={styles.placeRow}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel={place.label}
              onPress={() => handleServiceSelect('/send-parcel', 'home-saved-place')}>
              <View style={styles.placeIcon}>
                <MaterialCommunityIcons name={place.icon} size={20} color="#111827" />
              </View>
              <View style={styles.placeCopy}>
                <Text numberOfLines={1} style={styles.placeTitle}>
                  {place.label}
                </Text>
                <Text numberOfLines={1} style={styles.placeSubtitle}>
                  {place.address}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <TouchableOpacity
            style={styles.placeRow}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={copy.savedPlacesEmpty}
            onPress={() => handleServiceSelect('/saved-places', 'home-saved-places-empty')}>
            <View style={styles.placeIcon}>
              <MaterialCommunityIcons name="map-marker-plus-outline" size={20} color="#111827" />
            </View>
            <View style={styles.placeCopy}>
              <Text style={styles.placeTitle}>{copy.savedPlacesTitle}</Text>
              <Text style={styles.placeSubtitle}>{copy.savedPlacesEmpty}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomNav activeTab="home" />

      <Modal animationType="slide" transparent visible={scheduleOpen} onRequestClose={() => setScheduleOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setScheduleOpen(false)} />

          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{copy.scheduleModalTitle}</Text>
            <Text style={styles.modalSubtitle}>{copy.scheduleModalSubtitle}</Text>

            {copy.scheduleOptions.map((option) => (
              <TouchableOpacity
                key={option.title}
                style={styles.modalOption}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={`Schedule ${option.title}`}
                onPress={() => handleScheduleSelect(option.route)}>
                <View style={styles.modalOptionIcon}>
                  <MaterialCommunityIcons name={option.icon} size={22} color="#111827" />
                </View>
                <View style={styles.modalOptionCopy}>
                  <Text style={styles.modalOptionTitle}>{option.title}</Text>
                  <Text style={styles.modalOptionSubtitle}>{option.subtitle}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.closeButton} activeOpacity={0.88} onPress={() => setScheduleOpen(false)}>
              <Text style={styles.closeButtonText}>{copy.cancel}</Text>
            </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationChip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  locationText: {
    flex: 1,
    marginHorizontal: 6,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.1,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: typography.bold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  heroEyebrow: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#64748B',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.7,
    marginBottom: 14,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  tile: {
    width: '48%',
    backgroundColor: '#F4F5F7',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  tileArt: {
    height: 52,
    marginBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconWrapGreen: {
    backgroundColor: '#ECFDF3',
  },
  tileTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  tileSubtitle: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.body,
    color: '#64748B',
  },
  searchBar: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: '#F4F5F7',
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  searchMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchTitle: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  searchDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 8,
  },
  laterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  laterLabel: {
    marginLeft: 6,
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  placeRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEF2F6',
  },
  placeIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  placeIconActive: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  liveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  placeCopy: {
    flex: 1,
    minWidth: 0,
  },
  placeTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#0F172A',
    letterSpacing: -0.15,
  },
  placeSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
  },
  placeSubtitleActive: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  modalSubtitle: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#64748B',
  },
  modalOption: {
    minHeight: 74,
    borderRadius: 18,
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modalOptionCopy: {
    flex: 1,
  },
  modalOptionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  modalOptionSubtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.body,
    color: '#64748B',
  },
  closeButton: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
});
