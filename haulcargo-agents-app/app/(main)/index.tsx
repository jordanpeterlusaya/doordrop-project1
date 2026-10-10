import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { Card, Muted, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, rejectOffer, setPickupMode } from '@/lib/carrier-actions';
import { STATUS_LABEL } from '@/lib/carrier-types';
import {
  darTodayLabel,
  dropOffLabel,
  isIncomingOffer,
  manifestNextAction,
  money,
  offerStillValid,
  primaryActiveJob,
  shipmentCode,
  todayCargoRows,
  trackIndex,
} from '@/lib/carrier-helpers';
import { TRACK } from '@/lib/carrier-types';
import { images } from '@/lib/images';
import { useCarrierSession } from '@/providers/carrier-session';

const PAGE_PAD = 20;
const TILE_GAP = 8;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_WIDTH = (SCREEN_WIDTH - PAGE_PAD * 2) * 0.485;

type QuickTile = {
  key: string;
  title: string;
  subtitle: string;
  image?: ImageSourcePropType;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

function ServiceTile({ tile }: { tile: QuickTile }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.title}
      onPress={tile.onPress}
      style={styles.tilePressable}>
      <View style={styles.tile}>
        {tile.image ? (
          <Image source={tile.image} resizeMode="contain" style={styles.tileArt} />
        ) : (
          <View style={styles.tileIconWrap}>
            <Ionicons name={tile.icon || 'ellipse'} size={22} color={theme.ink} />
          </View>
        )}
        <Text style={styles.tileTitle} numberOfLines={1}>
          {tile.title}
        </Text>
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          {tile.subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const job = carrierId ? primaryActiveJob(shipments, carrierId) : null;
  const todayCount = carrierId
    ? todayCargoRows(shipments, carrierId).filter((i) => i.shipmentStatus !== 'delivered').length
    : 0;

  const tiles: QuickTile[] = [
    {
      key: 'orders',
      title: 'Oda',
      subtitle: 'Pokea mizigo',
      image: images.homeAvatarMizigo,
      onPress: () => router.push('/(main)/orders'),
    },
    {
      key: 'manifest',
      title: 'Orodha',
      subtitle: 'Manifesti',
      image: images.homeTileTrack,
      onPress: () => router.push('/(main)/manifest'),
    },
    {
      key: 'fedha',
      title: 'Fedha',
      subtitle: 'Malipo',
      icon: 'cash-outline',
      onPress: () => router.push('/(main)/fedha'),
    },
    {
      key: 'schedule',
      title: 'Ratiba',
      subtitle: 'Safari leo',
      image: images.homeTileSchedule,
      onPress: () => router.push('/schedule'),
    },
  ];

  const renderJobActions = () => {
    if (!job || !carrierId || !user?.email) return null;
    if (isIncomingOffer(job, carrierId) && offerStillValid(job)) {
      return (
        <View style={styles.actions}>
          <PrimaryButton
            label="Kubali"
            onPress={() => void acceptOffer(job.id, carrierId, user.email!).then(() => router.push(`/order/${job.id}`))}
          />
          <PrimaryButton label="Kataa" variant="outline" onPress={() => void rejectOffer(job.id, carrierId, user.email!)} />
        </View>
      );
    }
    if (!job.pickupMode && ['accepted', 'contacted'].includes(job.shipmentStatus)) {
      return (
        <View style={styles.actions}>
          <PrimaryButton
            label="Nitafuata kwa mteja"
            onPress={() =>
              void setPickupMode(job.id, carrierId, 'agent_collects', user.email!).then(() =>
                router.push(`/directions/${job.id}`)
              )
            }
          />
          <PrimaryButton
            label="Leteni ofisini"
            variant="outline"
            onPress={() => void setPickupMode(job.id, carrierId, 'haul_delivers_to_office', user.email!)}
          />
        </View>
      );
    }
    if (job.pickupMode === 'agent_collects' && job.pickupLatitude && job.pickupLongitude) {
      return <PrimaryButton label="Elekea eneo la oda" onPress={() => router.push(`/directions/${job.id}`)} />;
    }
    const manifest = manifestNextAction(job);
    if (manifest) {
      return <PrimaryButton label={manifest.label} onPress={() => router.push(`/order/${job.id}`)} />;
    }
    const idx = trackIndex(job);
    const next = idx >= 0 ? TRACK[idx + 1] : null;
    if (next) {
      return <PrimaryButton label={next.label} onPress={() => router.push(`/order/${job.id}`)} />;
    }
    return <PrimaryButton label="Angalia oda" variant="outline" onPress={() => router.push(`/order/${job.id}`)} />;
  };

  return (
    <Screen scroll>
      <Text style={styles.greeting}>Karibu tena.</Text>
      <Text style={styles.company}>{carrier?.companyName || 'Haul Cargo Agents'}</Text>
      <Muted>{darTodayLabel()}</Muted>

      <View style={styles.grid}>
        {tiles.map((tile) => (
          <ServiceTile key={tile.key} tile={tile} />
        ))}
      </View>

      <View style={styles.utilityBar}>
        <View style={styles.utilityAction}>
          <View style={styles.utilityIcon}>
            <Ionicons name="cube-outline" size={16} color={theme.ink} />
          </View>
          <Text style={styles.utilityLabel}>{todayCount} mizigo leo</Text>
        </View>
        <View style={styles.utilityDivider} />
        <Pressable style={styles.utilityAction} onPress={() => router.push('/schedule')}>
          <View style={styles.utilityIcon}>
            <Ionicons name="time-outline" size={16} color={theme.ink} />
          </View>
          <Text style={styles.utilityLabel}>Ratiba</Text>
        </Pressable>
      </View>

      <SectionTitle>Kazi yako sasa</SectionTitle>
      {!job ? (
        <Card>
          <Muted>Hakuna oda hai kwa sasa. Oda mpya itaonekana hapa na countdown ya dakika 5.</Muted>
        </Card>
      ) : (
        <Card>
          <Text style={styles.code}>{shipmentCode(job)}</Text>
          <Text style={styles.dest}>{dropOffLabel(job)}</Text>
          <Text style={styles.meta}>
            {job.weightKg || 0} kg · {money(job.cashExpected)} · {STATUS_LABEL[job.shipmentStatus] || job.shipmentStatus}
          </Text>
          {isIncomingOffer(job, carrierId) ? <OfferCountdown shipment={job} /> : null}
          <View style={styles.spacer} />
          {renderJobActions()}
          <Pressable onPress={() => router.push(`/order/${job.id}`)} style={styles.detailLink}>
            <Text style={styles.detailText}>Maelezo kamili</Text>
          </Pressable>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  company: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: TILE_GAP,
    marginTop: 16,
    marginBottom: 10,
  },
  tilePressable: {
    width: TILE_WIDTH,
  },
  tile: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    overflow: 'hidden',
    height: 104,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tileArt: {
    width: Math.round(TILE_WIDTH * 0.88),
    height: 52,
    marginBottom: 2,
  },
  tileIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileTitle: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: theme.ink,
    textAlign: 'center',
  },
  tileSubtitle: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: typography.body,
    color: theme.muted,
    textAlign: 'center',
  },
  utilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: theme.tile,
    borderRadius: 14,
    marginBottom: 14,
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
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityLabel: {
    fontSize: 15,
    lineHeight: 19,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
  utilityDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: '#D1D5DB',
  },
  code: {
    fontSize: 20,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.3,
  },
  dest: {
    fontSize: 15,
    fontFamily: typography.body,
    color: theme.muted,
    marginTop: 4,
  },
  meta: {
    fontSize: 13,
    fontFamily: typography.body,
    color: theme.muted,
    marginTop: 8,
    marginBottom: 12,
  },
  actions: { gap: 10 },
  spacer: { height: 8 },
  detailLink: { marginTop: 14, alignItems: 'center' },
  detailText: {
    color: theme.ink,
    fontFamily: typography.semibold,
  },
});
