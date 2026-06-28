import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { BottomNav } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import {
  beginCargoDiagnosticAttempt,
  recordCargoDiagnostic,
} from '@/lib/cargo-diagnostics';
import { logError, logInfo } from '@/lib/debug-logger';
import { recordAppActivity } from '@/lib/app-analytics';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';
import { useNotifications } from '@/providers/notification-provider';

const screenScope = 'HomeScreen';

type AppRoute = '/send-parcel' | '/book-cargo' | '/track-order' | '/saved-places' | '/support-center';

type ServiceCard = {
  title: string;
  subtitle: string;
  image: number;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: AppRoute;
};

type ScheduleOption = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: AppRoute;
};

type ActivityItem = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: AppRoute;
};

type LiveLocationStatus = 'loading' | 'ready' | 'permission-denied' | 'unavailable';

const HOME_PRESS_GUARD_MS = 650;
const mapGridLines = Array.from({ length: 7 }, (_, index) => index);

function getSheetTop(height: number) {
  if (height < 700) return height * 0.35;
  if (height < 820) return height * 0.39;
  return height * 0.42;
}

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
    return formattedParts.slice(0, 4).join(', ');
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

  return addressParts.slice(0, 4).join(', ');
}

function MapBackground() {
  return (
    <View pointerEvents="none" style={styles.mapBackground}>
      <View style={styles.mapGridLayer}>
        {mapGridLines.map((line) => (
          <React.Fragment key={line}>
            <View style={[styles.mapGridLine, styles.mapGridHorizontal, { top: `${10 + line * 12}%` }]} />
            <View style={[styles.mapGridLine, styles.mapGridVertical, { left: `${8 + line * 14}%` }]} />
          </React.Fragment>
        ))}
      </View>
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.42)', 'rgba(255,255,255,0.88)']}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const { language } = useLanguage();
  const { unreadCount } = useNotifications();
  const { profile, user } = useAuthSession();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busyRoute, setBusyRoute] = useState<AppRoute | null>(null);
  const [liveLocationName, setLiveLocationName] = useState('');
  const [liveLocationStatus, setLiveLocationStatus] = useState<LiveLocationStatus>('loading');
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);
  const locationLookupIdRef = useRef(0);
  const routePressGuardRef = useRef(0);
  const utilityPressGuardRef = useRef(0);

  const sheetTop = useMemo(() => getSheetTop(height), [height]);
  const compact = height < 730 || width < 370;
  const copy = useMemo(
    () =>
      language === 'sw'
        ? {
            locationLabel: 'Eneo la sasa',
            locationLoading: 'Inatafuta eneo lako...',
            locationPermissionDenied: 'Ruhusu location kuona ulipo',
            locationUnavailable: 'Eneo halikupatikana',
            heroTitle: 'Tuma chochote, safirisha mizigo haraka.',
            heroSubtitle: 'Usafirishaji wa vifurushi na mizigo kwa hatua rahisi.',
            searchTitle: 'Unataka kutuma wapi?',
            searchSubtitle: 'Weka unakopeleka upate makadirio ya haraka',
            servicesTitle: 'Huduma',
            scheduleLink: 'Ratiba',
            serviceMeta: 'Makadirio ya haraka yapo',
            openingText: 'Inafunguka',
            scheduleCardTitle: 'Panga usafirishaji',
            scheduleCardSubtitle: 'Panga kuchukuliwa kwa kifurushi au mzigo baadaye.',
            quickActionsTitle: 'Vitendo vya haraka',
            scheduleModalTitle: 'Panga usafirishaji',
            scheduleModalSubtitle: 'Chagua huduma na uweke muda unaopendelea wa kuchukuliwa.',
            cancel: 'Ghairi',
            serviceCards: [
              {
                title: 'Tuma kifurushi',
                subtitle: 'Nyaraka, chakula na vifurushi vidogo',
                image: require('@/assets/images/home-send-parcel.png'),
                icon: 'package-variant-closed',
                route: '/send-parcel',
              },
              {
                title: 'Omba msafirishaji wa mizigo',
                subtitle: 'TOYO na Kirikuu kwa mizigo',
                image: require('@/assets/images/vehicle-light-truck.png'),
                icon: 'truck-fast-outline',
                route: '/book-cargo',
              },
            ] satisfies ServiceCard[],
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
            activityItems: [
              {
                title: 'Fuatilia oda',
                subtitle: 'Ona usafirishaji unaoendelea',
                icon: 'crosshairs-gps',
                route: '/track-order',
              },
              {
                title: 'Maeneo yaliyohifadhiwa',
                subtitle: 'Nyumbani, duka, ofisi',
                icon: 'map-marker-radius-outline',
                route: '/saved-places',
              },
              {
                title: 'Msaada',
                subtitle: 'Pata msaada wakati wowote',
                icon: 'headset',
                route: '/support-center',
              },
            ] satisfies ActivityItem[],
          }
        : {
            locationLabel: 'Current location',
            locationLoading: 'Finding your location...',
            locationPermissionDenied: 'Allow location to show where you are',
            locationUnavailable: 'Location name unavailable',
            heroTitle: 'Send anything, move cargo faster.',
            heroSubtitle: 'Parcel delivery and cargo transport in a simple guided flow.',
            searchTitle: 'Where do you want to send?',
            searchSubtitle: 'Enter destination and get instant estimate',
            servicesTitle: 'Services',
            scheduleLink: 'Schedule',
            serviceMeta: 'Instant estimate available',
            openingText: 'Opening',
            scheduleCardTitle: 'Schedule a delivery',
            scheduleCardSubtitle: 'Plan parcel or cargo pickup for later.',
            quickActionsTitle: 'Quick actions',
            scheduleModalTitle: 'Schedule delivery',
            scheduleModalSubtitle: 'Choose a service and set your preferred pickup time.',
            cancel: 'Cancel',
            serviceCards: [
              {
                title: 'Send parcel',
                subtitle: 'Documents, food and small packages',
                image: require('@/assets/images/home-send-parcel.png'),
                icon: 'package-variant-closed',
                route: '/send-parcel',
              },
              {
                title: 'Request cargo carrier',
                subtitle: 'TOYO and Kirikuu cargo carriers',
                image: require('@/assets/images/vehicle-light-truck.png'),
                icon: 'truck-fast-outline',
                route: '/book-cargo',
              },
            ] satisfies ServiceCard[],
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
            activityItems: [
              {
                title: 'Track order',
                subtitle: 'View active deliveries',
                icon: 'crosshairs-gps',
                route: '/track-order',
              },
              {
                title: 'Saved places',
                subtitle: 'Home, shop, office',
                icon: 'map-marker-radius-outline',
                route: '/saved-places',
              },
              {
                title: 'Support',
                subtitle: 'Get help anytime',
                icon: 'headset',
                route: '/support-center',
              },
            ] satisfies ActivityItem[],
          },
    [language]
  );

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <MapBackground />
      <View style={[styles.topChrome, compact && styles.topChromeCompact]}>
        <TouchableOpacity
          style={styles.iconButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          onPress={() => handleUtilityRoutePress('/menu')}>
          <MaterialCommunityIcons name="menu" size={23} color="#111827" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.locationButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={`${copy.locationLabel}: ${locationValue}`}
          onPress={() => {
            void refreshCurrentLocation('tap');
          }}>
          <View style={[styles.locationDot, liveLocationStatus !== 'ready' && styles.locationDotMuted]} />
          <View style={styles.locationCopy}>
            <Text style={styles.locationLabel}>{copy.locationLabel}</Text>
            <Text numberOfLines={1} style={styles.locationValue}>{locationValue}</Text>
          </View>
          {isRefreshingLocation || liveLocationStatus === 'loading' ? (
            <ActivityIndicator size="small" color={cargoTheme.colors.primaryDark} />
          ) : (
            <MaterialCommunityIcons name="crosshairs-gps" size={19} color="#6B7280" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.iconButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : 'Open notifications'}
          onPress={() => handleUtilityRoutePress('/notifications')}>
          <MaterialCommunityIcons
            name={unreadCount > 0 ? 'bell-ring-outline' : 'bell-outline'}
            size={22}
            color="#111827"
          />
          {unreadCount > 0 ? (
            <View style={styles.iconButtonBadge}>
              <Text style={styles.iconButtonBadgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <View style={[styles.heroPanel, compact && styles.heroPanelCompact]}>
        <Text style={styles.heroEyebrow}>DoorDrop</Text>
        <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>{copy.heroTitle}</Text>
        <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact]}>{copy.heroSubtitle}</Text>
      </View>

      <View style={[styles.sheet, { top: sheetTop }]}>
        <View style={styles.handleWrap}>
          <View style={styles.handle} />
        </View>

        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          bounces={false}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.destinationSearch}
            onPress={() => {
              void handleServiceSelect('/send-parcel', 'home-search-box');
            }}>
            <View style={styles.searchIconWrap}>
              <MaterialCommunityIcons name="magnify" size={22} color="#111827" />
            </View>
            <View style={styles.searchCopy}>
              <Text style={styles.searchTitle}>{copy.searchTitle}</Text>
              <Text style={styles.searchSubtitle}>{copy.searchSubtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
          </TouchableOpacity>

          <View style={styles.serviceHeaderRow}>
            <Text style={styles.sectionTitle}>{copy.servicesTitle}</Text>
            <TouchableOpacity activeOpacity={0.8} onPress={() => openScheduleSheet('home-schedule-link')}>
              <Text style={styles.linkText}>{copy.scheduleLink}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.serviceList}>
            {copy.serviceCards.map((service) => {
              const isBusy = busyRoute === service.route;

              return (
                <TouchableOpacity
                  key={service.title}
                  activeOpacity={0.9}
                  style={styles.serviceRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${service.title}`}
                  onPress={() => {
                    void handleServiceSelect(service.route, 'home-service-row');
                  }}>
                  <View style={styles.serviceImageWrap}>
                    <Image source={service.image} style={styles.serviceImage} resizeMode="cover" />
                  </View>

                  <View style={styles.serviceCopy}>
                    <View style={styles.serviceTitleRow}>
                      <Text style={styles.serviceTitle}>{service.title}</Text>
                      {isBusy ? <Text style={styles.openingText}>{copy.openingText}</Text> : null}
                    </View>
                    <Text numberOfLines={2} style={styles.serviceSubtitle}>{service.subtitle}</Text>
                    <View style={styles.serviceMetaRow}>
                      <MaterialCommunityIcons name={service.icon} size={15} color={cargoTheme.colors.primaryDark} />
                      <Text style={styles.serviceMeta}>{copy.serviceMeta}</Text>
                    </View>
                  </View>

                  <View style={styles.rowArrow}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.scheduleCard}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Schedule delivery"
            onPress={() => openScheduleSheet('home-schedule-card')}>
            <View style={styles.scheduleIconWrap}>
              <MaterialCommunityIcons name="calendar-clock-outline" size={22} color="#111827" />
            </View>
            <View style={styles.scheduleCopy}>
              <Text style={styles.scheduleTitle}>{copy.scheduleCardTitle}</Text>
              <Text style={styles.scheduleSubtitle}>{copy.scheduleCardSubtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>{copy.quickActionsTitle}</Text>
          <View style={styles.activityGrid}>
            {copy.activityItems.map((item) => (
              <TouchableOpacity
                key={item.title}
                activeOpacity={0.88}
                style={styles.activityCard}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title}`}
                onPress={() => {
                  void handleServiceSelect(item.route, 'home-quick-action');
                }}>
                <View style={styles.activityIconWrap}>
                  <MaterialCommunityIcons name={item.icon} size={19} color="#111827" />
                </View>
                <Text numberOfLines={1} style={styles.activityTitle}>{item.title}</Text>
                <Text numberOfLines={1} style={styles.activitySubtitle}>{item.subtitle}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <BottomNav activeTab="home" />
      </View>

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
  mapBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F8FAFC',
  },
  mapGridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  mapGridLine: {
    position: 'absolute',
    backgroundColor: '#E2E8F0',
    opacity: 0.72,
  },
  mapGridHorizontal: {
    left: 0,
    right: 0,
    height: 1,
  },
  mapGridVertical: {
    top: 0,
    bottom: 0,
    width: 1,
  },
  topChrome: {
    position: 'absolute',
    top: Platform.select({ ios: 58, android: 48, default: 52 }),
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topChromeCompact: {
    top: Platform.select({ ios: 48, android: 40, default: 44 }),
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  iconButtonBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  locationButton: {
    flex: 1,
    minHeight: 52,
    marginHorizontal: 10,
    borderRadius: 26,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  locationDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: cargoTheme.colors.primary,
    marginRight: 11,
  },
  locationDotMuted: {
    backgroundColor: '#CBD5E1',
  },
  locationCopy: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  locationValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  heroPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: Platform.select({ ios: 130, android: 122, default: 126 }),
  },
  heroPanelCompact: {
    top: Platform.select({ ios: 108, android: 102, default: 106 }),
  },
  heroEyebrow: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: 0,
    maxWidth: 340,
  },
  heroTitleCompact: {
    fontSize: 28,
    lineHeight: 33,
  },
  heroSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#374151',
    maxWidth: 320,
  },
  heroSubtitleCompact: {
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 280,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
    elevation: 14,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
  },
  sheetScroll: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 32,
  },
  destinationSearch: {
    minHeight: 72,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },
  searchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  searchCopy: {
    flex: 1,
  },
  searchTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 3,
  },
  searchSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  serviceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: 0,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '900',
    color: cargoTheme.colors.primaryDark,
  },
  serviceList: {
    marginBottom: 16,
  },
  serviceRow: {
    minHeight: 112,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  serviceImageWrap: {
    width: 90,
    height: 90,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginRight: 13,
  },
  serviceImage: {
    width: '100%',
    height: '100%',
  },
  serviceCopy: {
    flex: 1,
  },
  serviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  serviceTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: 0,
  },
  openingText: {
    fontSize: 10,
    fontWeight: '900',
    color: cargoTheme.colors.primaryDark,
    textTransform: 'uppercase',
  },
  serviceSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 9,
  },
  serviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceMeta: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
  },
  rowArrow: {
    width: 28,
    alignItems: 'flex-end',
  },
  scheduleCard: {
    minHeight: 74,
    borderRadius: 22,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },
  scheduleIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  scheduleCopy: {
    flex: 1,
  },
  scheduleTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  scheduleSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#D1D5DB',
  },
  activityGrid: {
    flexDirection: 'row',
    marginHorizontal: -4,
    marginTop: 12,
  },
  activityCard: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 20,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 11,
  },
  activityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  activityTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 3,
  },
  activitySubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 26,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 25,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: 0,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 14,
  },
  modalOption: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modalOptionCopy: {
    flex: 1,
    paddingRight: 12,
  },
  modalOptionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  modalOptionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#6B7280',
  },
  closeButton: {
    marginTop: 18,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
});
