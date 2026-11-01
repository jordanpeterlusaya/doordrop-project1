import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/cargo-ui';
import { HomeActiveOrderCard } from '@/components/home-active-order-card';
import { HomeOfflineState } from '@/components/home-offline-state';
import { HomePromoCarousel, type HomePromoSlide } from '@/components/home-promo-carousel';
import { CITY_PARCELS_ENABLED } from '@/constants/parcel-features';
import { typography } from '@/constants/typography';
import { isActiveCustomerOrder } from '@/lib/active-order-display';
import {
  beginCargoDiagnosticAttempt,
  recordCargoDiagnostic,
} from '@/lib/cargo-diagnostics';
import { logError, logInfo } from '@/lib/debug-logger';
import { recordAppActivity } from '@/lib/app-analytics';
import {
  ensureCustomerLocation,
  getCustomerLocationSnapshot,
  subscribeCustomerLocation,
} from '@/lib/customer-location';
import { subscribeToUserOrders, type DeliveryOrder } from '@/lib/delivery-data';
import { images, preloadHomeImages } from '@/lib/images';
import { useCustomerNetwork } from '@/lib/network-status';
import { isCargoServiceAvailableAt } from '@/lib/service-cities';
import type { RoutePoint } from '@/lib/route-utils';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

preloadHomeImages();

const screenScope = 'HomeScreen';
const HOME_PRESS_GUARD_MS = 650;
const PAGE_PAD = 20;
const TILE_GAP = 8;
const TILE_BG = '#F3F4F6';
const TILE_HEIGHT = 104;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_WIDTH = (SCREEN_WIDTH - PAGE_PAD * 2) * 0.485;
const TILE_ART_WIDTH = Math.round(TILE_WIDTH * 0.88);
const TILE_ART_HEIGHT = 52;
const TILE_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

type AppRoute =
  | '/send-parcel'
  | '/book-cargo'
  | '/ninunulie'
  | '/bus-tickets'
  | '/schedule'
  | '/track-order';

type ServiceCard = {
  key: string;
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
  route: AppRoute;
};

function getGreeting(language: 'sw' | 'en') {
  return language === 'sw' ? 'Karibu tena.' : 'Great to see you.';
}

function ServiceTile({
  card,
  busy,
  onPress,
}: {
  card: ServiceCard;
  busy: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.title}
      android_disableSound
      hitSlop={TILE_HIT_SLOP}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 18, stiffness: 240 });
        onPress();
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 16, stiffness: 210 });
      }}
      style={styles.tilePressable}>
      <Animated.View style={[styles.tile, animatedStyle]}>
        <Image
          source={card.image}
          defaultSource={card.image}
          fadeDuration={0}
          resizeMode="contain"
          style={styles.tileArt}
        />
        {busy ? <ActivityIndicator style={styles.busy} color="#111827" /> : null}
        <Text style={styles.tileTitle} numberOfLines={1}>
          {card.title}
        </Text>
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          {card.subtitle}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { language } = useLanguage();
  const { profile, user } = useAuthSession();
  const { online, checking, retry } = useCustomerNetwork({ failThreshold: 1 });
  const [busyRoute, setBusyRoute] = useState<AppRoute | null>(null);
  const [activeOrder, setActiveOrder] = useState<DeliveryOrder | null>(null);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const initialLocation = getCustomerLocationSnapshot();
  const [liveLocationPoint, setLiveLocationPoint] = useState<RoutePoint | null>(initialLocation.point);
  const routePressGuardRef = useRef(0);

  useEffect(() => {
    const unsub = subscribeCustomerLocation((next) => {
      if (next.point) {
        setLiveLocationPoint(next.point);
      }
    });
    void ensureCustomerLocation({ force: false, source: 'initial' }).then((next) => {
      if (next.point) {
        setLiveLocationPoint(next.point);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    logInfo(screenScope, 'screen-mounted');
    return () => logInfo(screenScope, 'screen-unmounted');
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setActiveOrder(null);
      setActiveOrderCount(0);
      return;
    }

    return subscribeToUserOrders(
      user.uid,
      (orders) => {
        const active = orders.filter(isActiveCustomerOrder);
        setActiveOrder(active[0] ?? null);
        setActiveOrderCount(active.length);
      },
      () => {
        setActiveOrder(null);
        setActiveOrderCount(0);
      }
    );
  }, [user?.uid]);

  const copy = useMemo(
    () =>
      language === 'sw'
        ? {
            greeting: getGreeting('sw'),
            trackLabel: 'Fuatilia',
            scheduleLabel: 'Ratiba',
            serviceCards: [
              {
                key: 'cargo',
                title: 'Mizigo',
                subtitle: 'Gari linakuja',
                image: images.homeAvatarMizigo,
                route: '/book-cargo',
              },
              {
                key: 'parcel',
                title: 'Kifurushi',
                subtitle: 'Tuma haraka',
                image: images.homeTileParcelSoft,
                route: '/send-parcel',
              },
              {
                key: 'tickets',
                title: 'Tiketi',
                subtitle: 'Coming soon',
                image: images.homeTileTiketiSoft,
                route: '/bus-tickets',
              },
              {
                key: 'ninunulie',
                title: 'Ninunulie',
                subtitle: 'Tunakununulia',
                image: images.homeTileNinunulieSoft,
                route: '/ninunulie',
              },
            ] satisfies ServiceCard[],
          }
        : {
            greeting: getGreeting('en'),
            trackLabel: 'Track',
            scheduleLabel: 'Schedule',
            serviceCards: [
              {
                key: 'cargo',
                title: 'Cargo',
                subtitle: 'Book a vehicle',
                image: images.homeAvatarMizigo,
                route: '/book-cargo',
              },
              {
                key: 'parcel',
                title: 'Parcels',
                subtitle: 'Send fast',
                image: images.homeTileParcelSoft,
                route: '/send-parcel',
              },
              {
                key: 'tickets',
                title: 'Tickets',
                subtitle: 'Coming soon',
                image: images.homeTileTiketiSoft,
                route: '/bus-tickets',
              },
              {
                key: 'ninunulie',
                title: 'Buy for me',
                subtitle: 'We shop for you',
                image: images.homeTileNinunulieSoft,
                route: '/ninunulie',
              },
            ] satisfies ServiceCard[],
          },
    [language]
  );

  const handleServiceSelect = useCallback(
    (route: AppRoute, source: string) => {
      const now = Date.now();
      if (now - routePressGuardRef.current < HOME_PRESS_GUARD_MS) {
        return;
      }
      routePressGuardRef.current = now;
      setBusyRoute(route);

      try {
        const cargoOutOfReach =
          route === '/book-cargo' &&
          liveLocationPoint != null &&
          !isCargoServiceAvailableAt(liveLocationPoint);

        if (cargoOutOfReach) {
          router.push({ pathname: '/book-cargo', params: { outOfReach: '1' } });
        } else if (route === '/send-parcel' && !CITY_PARCELS_ENABLED) {
          router.push({ pathname: '/send-parcel', params: { scope: 'outside' } });
        } else {
          router.push(route);
        }
      } catch (error) {
        logError(screenScope, 'service navigation failed', error, { route, source });
        setBusyRoute(null);
        return;
      }

      setTimeout(() => {
        void recordAppActivity({
          userId: user?.uid,
          userName: profile?.fullName || user?.displayName || user?.email || 'HAUL User',
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
              logError(screenScope, 'cargo diagnostics failed after navigation', error, {
                route,
                source,
              });
            }
          })();
        }
      }, 250);

      setTimeout(() => {
        setBusyRoute((current) => (current === route ? null : current));
      }, 700);
    },
    [liveLocationPoint, profile?.fullName, router, user?.displayName, user?.email, user?.uid]
  );

  const promoSlides = useMemo<HomePromoSlide[]>(
    () =>
      language === 'sw'
        ? [
            {
              id: 'ninunulie',
              eyebrow: 'NINUNULIE',
              title: 'Tunakununulia',
              subtitle: 'Kariakoo — wewe unalipa tu.',
              image: images.homePromoNinunulie,
              gradient: ['#E6CF00', '#FFE500', '#FFF3A0'],
              onPress: () => handleServiceSelect('/ninunulie', 'home-promo-carousel'),
            },
            {
              id: 'tickets',
              eyebrow: 'COMING SOON',
              title: 'Tiketi za basi',
              subtitle: 'Jiunge waitlist mapema.',
              image: images.homePromoTiketi,
              gradient: ['#111827', '#1F2937', '#374151'],
              onPress: () => handleServiceSelect('/bus-tickets', 'home-promo-carousel'),
            },
            {
              id: 'parcel',
              eyebrow: 'KIFURUSHI',
              title: 'Tuma kifurushi',
              subtitle: 'Tuma mkoa kwa mkoa.',
              image: images.homePromoParcel,
              gradient: ['#C4B000', '#FFE500', '#FFF9CC'],
              onPress: () => handleServiceSelect('/send-parcel', 'home-promo-carousel'),
            },
          ]
        : [
            {
              id: 'ninunulie',
              eyebrow: 'NINUNULIE',
              title: 'We shop for you',
              subtitle: 'Kariakoo — you just pay.',
              image: images.homePromoNinunulie,
              gradient: ['#E6CF00', '#FFE500', '#FFF3A0'],
              onPress: () => handleServiceSelect('/ninunulie', 'home-promo-carousel'),
            },
            {
              id: 'tickets',
              eyebrow: 'COMING SOON',
              title: 'Bus tickets',
              subtitle: 'Join the waitlist early.',
              image: images.homePromoTiketi,
              gradient: ['#111827', '#1F2937', '#374151'],
              onPress: () => handleServiceSelect('/bus-tickets', 'home-promo-carousel'),
            },
            {
              id: 'parcel',
              eyebrow: 'PARCEL',
              title: 'Send a parcel',
              subtitle: 'Send across regions.',
              image: images.homePromoParcel,
              gradient: ['#C4B000', '#FFE500', '#FFF9CC'],
              onPress: () => handleServiceSelect('/send-parcel', 'home-promo-carousel'),
            },
          ],
    [handleServiceSelect, language]
  );

  if (!online) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#E8F0E3" />
        <HomeOfflineState language={language} checking={checking} onRetry={() => void retry()} />
        <BottomNav activeTab="home" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.greeting}>{copy.greeting}</Text>

        <View style={styles.grid}>
          {copy.serviceCards.map((card) => (
            <ServiceTile
              key={card.key}
              card={card}
              busy={busyRoute === card.route}
              onPress={() => handleServiceSelect(card.route, 'home-service-card')}
            />
          ))}
        </View>

        {activeOrder ? (
          <HomeActiveOrderCard
            order={activeOrder}
            language={language}
            extraCount={activeOrderCount}
            scheduleLabel={copy.scheduleLabel}
            onPress={() =>
              router.push({ pathname: '/track-order', params: { orderId: activeOrder.id } })
            }
            onSchedulePress={() => handleServiceSelect('/schedule', 'home-live-strip')}
          />
        ) : (
          <View style={styles.utilityBar}>
            <Pressable
              style={styles.utilityAction}
              accessibilityRole="button"
              accessibilityLabel={copy.trackLabel}
              android_disableSound
              onPressIn={() => handleServiceSelect('/track-order', 'home-utility-bar')}>
              <View style={styles.utilityIcon}>
                <Ionicons name="locate-outline" size={16} color="#111827" />
              </View>
              <Text style={styles.utilityLabel}>{copy.trackLabel}</Text>
            </Pressable>
            <View style={styles.utilityDivider} />
            <Pressable
              style={styles.utilityAction}
              accessibilityRole="button"
              accessibilityLabel={copy.scheduleLabel}
              android_disableSound
              onPressIn={() => handleServiceSelect('/schedule', 'home-utility-bar')}>
              <View style={styles.utilityIcon}>
                <Ionicons name="time-outline" size={16} color="#111827" />
              </View>
              <Text style={styles.utilityLabel}>{copy.scheduleLabel}</Text>
            </Pressable>
          </View>
        )}

        <HomePromoCarousel slides={promoSlides} />
      </ScrollView>

      <BottomNav activeTab="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeTop: {
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: PAGE_PAD,
    paddingTop: 12,
    paddingBottom: 32,
  },
  greeting: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.bold,
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: TILE_GAP,
    marginBottom: 10,
  },
  tilePressable: {
    width: '48.5%',
  },
  tile: {
    backgroundColor: TILE_BG,
    borderRadius: 16,
    overflow: 'hidden',
    height: TILE_HEIGHT,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tileArt: {
    width: TILE_ART_WIDTH,
    height: TILE_ART_HEIGHT,
    marginBottom: 2,
  },
  busy: {
    position: 'absolute',
    top: 22,
  },
  tileTitle: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#111827',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  tileSubtitle: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: typography.body,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  utilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: TILE_BG,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  utilityAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 10,
  },
  utilityIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityLabel: {
    fontSize: 15,
    lineHeight: 19,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  utilityDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: '#D1D5DB',
  },
});
