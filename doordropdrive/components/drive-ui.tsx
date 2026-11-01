import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { DrivePersonAvatar, DriveSceneAvatar, type DriveAvatarKind } from '../lib/drive-avatars';
import { DriveAvatarStage, DriveGraphicBackdrop } from '../lib/drive-graphics';
import { DriveFadeSlideIn, DrivePulseDot, DriveSheetEnter } from '../lib/drive-motion';
import { driveHapticLight, driveHapticMedium } from '../lib/drive-haptics';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const CTA = driveTheme.colors.cta;

export function DriveBrandMark({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <View style={[styles.brandRow, compact && styles.brandRowCompact]}>
      <Text
        style={[
          styles.brandWordmark,
          light && styles.brandWordmarkLight,
          compact && styles.brandNameCompact,
        ]}>
        HAUL Pilots
      </Text>
    </View>
  );
}

export function DriveStatusBadge({
  online,
  onlineLabel,
  offlineLabel,
}: {
  online: boolean;
  onlineLabel: string;
  offlineLabel: string;
}) {
  return (
    <View style={[styles.statusBadge, online ? styles.statusBadgeOnline : styles.statusBadgeOffline]}>
      <View style={[styles.statusDot, online ? styles.statusDotOnline : styles.statusDotOffline]} />
      <Text style={[styles.statusText, online ? styles.statusTextOnline : styles.statusTextOffline]}>
        {online ? onlineLabel : offlineLabel}
      </Text>
    </View>
  );
}

/** Premium floating header — single glass card over the map */
export function DriveHomeHeader({
  greeting,
  name,
  online,
  onlineLabel,
  offlineLabel,
  earningsLabel,
  earningsValue,
  earningsMeta,
  deliveredCount,
  deliveredLabel,
  ordersCount,
  ordersLabel,
  notificationCount,
  onPressEarnings,
  onPressNotifications,
}: {
  greeting: string;
  name: string;
  online: boolean;
  onlineLabel: string;
  offlineLabel: string;
  earningsLabel: string;
  earningsValue: string;
  earningsMeta?: string;
  deliveredCount?: number;
  deliveredLabel?: string;
  ordersCount?: number;
  ordersLabel?: string;
  notificationCount?: number;
  onPressEarnings?: () => void;
  onPressNotifications?: () => void;
}) {
  const statsMeta =
    deliveredCount != null && deliveredLabel && ordersCount != null && ordersLabel
      ? `${deliveredCount} ${deliveredLabel} · ${ordersCount} ${ordersLabel}`
      : earningsMeta ?? '';

  return (
    <DriveFadeSlideIn style={styles.homeHeaderCard}>
      <View style={styles.homeHeaderMainRow}>
        <DrivePersonAvatar name={name} kind="driver" size={44} online={online} />
        <View style={styles.homeHeaderIdentity}>
          <Text style={styles.homeBrandMark}>HAUL Pilots</Text>
          <Text style={styles.homeHeaderGreeting}>{greeting}</Text>
          <Text style={styles.homeHeaderName} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View
          style={[
            styles.homeHeaderStatus,
            online ? styles.homeHeaderStatusOn : styles.homeHeaderStatusOff,
          ]}>
          {online ? <DrivePulseDot color={driveTheme.colors.online} size={6} /> : null}
          <Text
            style={[
              styles.homeHeaderStatusText,
              online ? styles.homeHeaderStatusTextOn : styles.homeHeaderStatusTextOff,
            ]}>
            {online ? onlineLabel : offlineLabel}
          </Text>
        </View>
        <Pressable
          onPress={onPressNotifications}
          style={({ pressed }) => [styles.homeHeaderBell, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="bell-outline" size={20} color={driveTheme.colors.ink} />
          {notificationCount ? (
            <View style={styles.iconBadge}>
              <Text style={styles.iconBadgeText}>{Math.min(notificationCount, 9)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.homeHeaderDivider} />

      <Pressable
        onPress={onPressEarnings}
        style={({ pressed }) => [styles.homeHeaderEarnings, pressed && styles.pressed]}>
        <View style={styles.homeHeaderEarningsMain}>
          <Text style={styles.homeHeaderEarningsLabel}>{earningsLabel}</Text>
          <Text style={styles.homeHeaderEarningsValue}>{earningsValue}</Text>
        </View>
        {statsMeta ? <Text style={styles.homeHeaderEarningsMeta}>{statsMeta}</Text> : null}
        <MaterialCommunityIcons name="chevron-right" size={20} color={driveTheme.colors.muted} />
      </Pressable>
    </DriveFadeSlideIn>
  );
}

/** Soft overlays so floating UI reads clearly on the map */
export function DriveHomeMapGradients() {
  return (
    <>
      <View pointerEvents="none" style={styles.mapGradientTop} />
      <View pointerEvents="none" style={styles.mapGradientBottom} />
    </>
  );
}

export function DriveMapRecenterButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.mapRecenterBtn, pressed && styles.pressed]}>
      <MaterialCommunityIcons name="crosshairs-gps" size={22} color={driveTheme.colors.ink} />
    </Pressable>
  );
}

export function DriveBottomSheet({
  children,
  style,
  variant = 'default',
}: {
  children: React.ReactNode;
  style?: object;
  variant?: 'default' | 'home';
}) {
  return (
    <DriveSheetEnter>
      <View style={[styles.sheet, variant === 'home' && styles.sheetHome, style]}>
        <View style={[styles.sheetHandle, variant === 'home' && styles.sheetHandleHome]} />
        {children}
      </View>
    </DriveSheetEnter>
  );
}

export function DriveGoOnline({
  label,
  caption,
  hint,
  loading,
  embedded,
  onPress,
}: {
  label: string;
  caption: string;
  hint: string;
  loading?: boolean;
  embedded?: boolean;
  onPress?: () => void;
}) {
  if (embedded) {
    return (
      <DriveSurfaceCard style={styles.homeActionCard}>
        <Text style={styles.homeActionEyebrow}>{caption}</Text>
        <Pressable
          disabled={loading}
          onPress={() => {
            void driveHapticMedium();
            onPress?.();
          }}
          style={({ pressed }) => [styles.ctaButton, loading && styles.disabled, pressed && styles.ctaPressed]}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.ctaButtonText}>{label}</Text>}
        </Pressable>
        <Text style={styles.homeActionHint}>{hint}</Text>
      </DriveSurfaceCard>
    );
  }

  return (
    <DriveBottomSheet variant="home">
      <Text style={styles.homeSheetTitle}>{caption}</Text>
      <Text style={styles.homeSheetSubtitle}>{hint}</Text>
      <Pressable
        disabled={loading}
        onPress={() => {
          void driveHapticMedium();
          onPress?.();
        }}
        style={({ pressed }) => [
          styles.homeCtaGradient,
          styles.homeCtaBrand,
          loading && styles.disabled,
          pressed && styles.brandPressed,
        ]}>
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <MaterialCommunityIcons name="power" size={22} color="#FFFFFF" />
            <Text style={styles.homeCtaText}>{label}</Text>
          </>
        )}
      </Pressable>
    </DriveBottomSheet>
  );
}

export function DriveOnlinePanel({
  title,
  subtitle,
  actionLabel,
  loading,
  embedded,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  loading?: boolean;
  embedded?: boolean;
  onAction?: () => void;
}) {
  if (embedded) {
    return (
      <DriveSurfaceCard style={styles.homeActionCard}>
        <View style={styles.homeOnlineRow}>
          <View style={styles.searchingPulse}>
            <DrivePulseDot color={driveTheme.colors.online} size={8} />
          </View>
          <View style={styles.searchingCopy}>
            <Text style={styles.searchingTitle}>{title}</Text>
            <Text style={styles.searchingSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </View>
        <Pressable
          disabled={loading}
          onPress={() => {
            void driveHapticLight();
            onAction?.();
          }}
          style={({ pressed }) => [styles.homeOfflineBtn, pressed && styles.pressed]}>
          <Text style={styles.secondaryTextBtnLabel}>{loading ? '...' : actionLabel}</Text>
        </Pressable>
      </DriveSurfaceCard>
    );
  }

  return (
    <DriveBottomSheet variant="home">
      <View style={styles.homeOnlineHero}>
        <View style={styles.homeOnlinePulseRing}>
          <DrivePulseDot color={driveTheme.colors.online} size={10} />
        </View>
        <View style={styles.searchingCopy}>
          <Text style={styles.homeSheetTitle}>{title}</Text>
          <Text style={styles.homeSheetSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
      </View>
      <Pressable
        disabled={loading}
        onPress={() => {
          void driveHapticLight();
          onAction?.();
        }}
        style={({ pressed }) => [styles.homeOfflineLink, pressed && styles.pressed]}>
        <Text style={styles.homeOfflineLinkText}>{loading ? '...' : actionLabel}</Text>
      </Pressable>
    </DriveBottomSheet>
  );
}

const CARGO_LOADS = [
  { key: 'small', title: 'Kidogo', detail: 'Nafasi ndogo kwenye gari.' },
  { key: 'half', title: 'Nusu', detail: 'Karibu nusu ya gari.' },
  { key: 'full', title: 'Inajaa', detail: 'Gari linajaa.' },
  { key: 'overload', title: 'Inazidi', detail: 'Mzigo unazidi gari.' },
] as const;

function cargoLoadState(label?: string) {
  const value = String(label || '').trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value.includes('zidi') || value === 'overload') {
    return CARGO_LOADS[3];
  }
  if (value.includes('jaa') || value === 'full') {
    return CARGO_LOADS[2];
  }
  if (value.includes('nusu') || value === 'half') {
    return CARGO_LOADS[1];
  }
  if (value.includes('kidogo') || value === 'small') {
    return CARGO_LOADS[0];
  }
  return { key: 'custom' as const, title: label!.trim(), detail: '' };
}

export function DriveOrderCard({
  meta,
  place,
  customer,
  customerPhone,
  phoneLabel,
  fare,
  fareLabel = 'Bei',
  actionLabel,
  actionDisabled,
  loading,
  embedded,
  onAction,
  onCall,
  callLabel,
  fareStepper,
  loadLabel,
  chancesUsed,
  chancesTotal = 3,
  chanceHint,
  spendingChance,
  customerNote,
  offerNote,
  onChangeOfferNote,
  onDecline,
  declineLabel = 'Kataa',
}: {
  meta: string;
  place: string;
  customer?: string;
  customerPhone?: string;
  phoneLabel?: string;
  fare: string;
  fareLabel?: string;
  actionLabel: string;
  actionDisabled?: boolean;
  loading?: boolean;
  embedded?: boolean;
  onAction?: () => void;
  onCall?: () => void;
  callLabel?: string;
  fareStepper?: {
    onMinus: () => void;
    onPlus: () => void;
    minusDisabled?: boolean;
    plusDisabled?: boolean;
  };
  loadLabel?: string;
  chancesUsed?: number;
  chancesTotal?: number;
  chanceHint?: string;
  spendingChance?: boolean;
  customerNote?: string;
  offerNote?: string;
  onChangeOfferNote?: (value: string) => void;
  onDecline?: () => void;
  declineLabel?: string;
}) {
  const load = cargoLoadState(loadLabel);
  const showChances = typeof chancesUsed === 'number';
  const used = Math.max(0, Math.min(chancesTotal, chancesUsed ?? 0));
  const phone = customerPhone && !/not provided/i.test(customerPhone) ? customerPhone : '';
  const body = (
    <View style={styles.openOffer}>
      <View style={styles.openTop}>
        {load ? <Text style={styles.openLoad}>{load.title}</Text> : <View />}
        {showChances ? (
          <View style={styles.chanceRow}>
            {Array.from({ length: chancesTotal }, (_, index) => (
              <View key={index} style={[styles.chanceDot, index < used ? styles.chanceDotUsed : styles.chanceDotLeft]} />
            ))}
          </View>
        ) : null}
      </View>
      <Text style={styles.openPlace} numberOfLines={2}>
        {place}
      </Text>
      {customer ? (
        <Text style={styles.openName} numberOfLines={1}>
          {customer}
        </Text>
      ) : null}
      <View style={styles.openFare}>
        {fareStepper ? (
          <Pressable
            disabled={fareStepper.minusDisabled}
            onPress={() => {
              void driveHapticLight();
              fareStepper.onMinus();
            }}
            style={[styles.openStep, fareStepper.minusDisabled && styles.disabled]}>
            <Text style={styles.openStepText}>−</Text>
          </Pressable>
        ) : null}
        <Text style={styles.openAmount}>{fare}</Text>
        {fareStepper ? (
          <Pressable
            disabled={fareStepper.plusDisabled}
            onPress={() => {
              void driveHapticLight();
              fareStepper.onPlus();
            }}
            style={[styles.openStep, fareStepper.plusDisabled && styles.disabled]}>
            <Text style={styles.openStepText}>+</Text>
          </Pressable>
        ) : null}
      </View>
      {phone ? (
        <Pressable onPress={() => void onCall?.()} style={styles.openPhone}>
          <Text style={styles.openPhoneText}>{phone}</Text>
          {callLabel ? <Text style={styles.openPhoneAction}>{callLabel}</Text> : null}
        </Pressable>
      ) : null}
      {onChangeOfferNote ? (
        <View style={styles.openNotes}>
          {['Bei yangu.', 'Niko tayari.', 'Tuongee.'].map((line) => {
            const active = offerNote === line;
            return (
              <Pressable key={line} onPress={() => onChangeOfferNote(line)}>
                <Text style={[styles.openNote, active && styles.openNoteOn]}>{line.replace('.', '')}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Pressable
        disabled={loading || actionDisabled}
        onPress={() => {
          void driveHapticMedium();
          onAction?.();
        }}
        style={({ pressed }) => [
          styles.homeCtaGradient,
          styles.homeCtaDark,
          (loading || actionDisabled) && styles.disabled,
          pressed && styles.ctaPressed,
        ]}>
        {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.homeCtaText}>{actionLabel}</Text>}
      </Pressable>
      {onDecline ? (
        <Pressable onPress={onDecline} style={styles.openDecline}>
          <Text style={styles.openDeclineText}>{declineLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (embedded) {
    return <DriveSurfaceCard style={styles.orderSheetEmbedded}>{body}</DriveSurfaceCard>;
  }

  return <DriveBottomSheet variant="home" style={styles.orderSheet}>{body}</DriveBottomSheet>;
}

export function DriveDemandChip({
  title,
  hint,
  probabilityLabel,
  hotspotLabel,
  onNavigateHotspot,
  navigateLabel,
}: {
  title: string;
  hint: string;
  probabilityLabel?: string;
  hotspotLabel?: string;
  onNavigateHotspot?: () => void;
  navigateLabel?: string;
}) {
  return (
    <View style={styles.demandChip}>
      <View style={styles.demandChipInner}>
        <View style={styles.demandIcon}>
          <MaterialCommunityIcons name="chart-timeline-variant" size={18} color={driveTheme.colors.warning} />
        </View>
        <View style={styles.demandCopy}>
          <Text style={styles.demandTitle}>{title}</Text>
          {probabilityLabel ? <Text style={styles.demandProbability}>{probabilityLabel}</Text> : null}
          {hotspotLabel ? <Text style={styles.demandHotspot}>{hotspotLabel}</Text> : null}
        </View>
        {onNavigateHotspot && navigateLabel ? (
          <Pressable
            onPress={() => {
              void driveHapticMedium();
              onNavigateHotspot();
            }}
            style={({ pressed }) => [styles.demandNavigateBtn, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="navigation-variant" size={15} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DriveProEmptyState({
  icon,
  title,
  text,
  actionLabel,
  onAction,
  avatarKind,
}: {
  icon: IconName;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  avatarKind?: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
}) {
  return (
    <DriveFadeSlideIn style={styles.emptyState}>
      <DriveGraphicBackdrop tone="brand" style={styles.emptyArtWrap}>
        {avatarKind ? (
          <DriveSceneAvatar kind={avatarKind} size={140} />
        ) : (
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name={icon} size={26} color={driveTheme.colors.ink} />
          </View>
        )}
      </DriveGraphicBackdrop>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            void driveHapticLight();
            onAction();
          }}
          style={({ pressed }) => [styles.ctaButton, styles.emptyCta, pressed && styles.ctaPressed]}>
          <Text style={styles.ctaButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </DriveFadeSlideIn>
  );
}

export function DriveScreenHeader({
  title,
  subtitle,
  avatarKind,
}: {
  title: string;
  subtitle?: string;
  avatarKind?: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
}) {
  return (
    <View style={styles.screenHeader}>
      {avatarKind ? (
        <DriveAvatarStage tone="cool">
          <DriveSceneAvatar kind={avatarKind} size={72} />
        </DriveAvatarStage>
      ) : null}
      <Text style={styles.screenTitle}>{title}</Text>
      {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function DriveAccountHero({
  name,
  meta,
  initials,
  online,
  onlineLabel,
  offlineLabel,
}: {
  name: string;
  meta: string;
  initials: string;
  online: boolean;
  onlineLabel: string;
  offlineLabel: string;
}) {
  return (
    <DriveGraphicBackdrop tone={online ? 'brand' : 'dark'} style={styles.accountHero}>
      <DrivePersonAvatar name={name} kind="driver" size={64} online={online} />
      <View style={styles.accountCopy}>
        <Text style={styles.accountName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.accountMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <DriveStatusBadge online={online} onlineLabel={onlineLabel} offlineLabel={offlineLabel} />
    </DriveGraphicBackdrop>
  );
}

export function DriveAuthPanel({
  title,
  subtitle,
  avatarKind = 'authWelcome',
}: {
  title: string;
  subtitle: string;
  avatarKind?: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
}) {
  return (
    <View style={styles.authPanel}>
      <DriveAvatarStage tone="brand">
        <DriveSceneAvatar kind={avatarKind} size={108} />
      </DriveAvatarStage>
      <DriveBrandMark />
      <Text style={styles.authTitle}>{title}</Text>
      <Text style={styles.authSubtitle}>{subtitle}</Text>
    </View>
  );
}

export function DriveIllustrationHero({
  avatarKind,
  title,
  subtitle,
  tone = 'brand',
}: {
  avatarKind: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
  title: string;
  subtitle?: string;
  tone?: 'brand' | 'warm' | 'cool' | 'dark';
}) {
  return (
    <DriveGraphicBackdrop tone={tone} style={styles.illustrationHero}>
      <DriveSceneAvatar kind={avatarKind} size={120} />
      <Text style={styles.illustrationHeroTitle}>{title}</Text>
      {subtitle ? <Text style={styles.illustrationHeroSubtitle}>{subtitle}</Text> : null}
    </DriveGraphicBackdrop>
  );
}

export function DriveNearbyPin({ name }: { name?: string }) {
  return (
    <View style={styles.nearbyPin}>
      <View style={styles.nearbyBubble}>
        {name ? (
          <DrivePersonAvatar name={name} kind="customer" size={28} />
        ) : (
          <MaterialCommunityIcons name="account" size={14} color={driveTheme.colors.primaryDark} />
        )}
      </View>
      <View style={styles.nearbyStem} />
    </View>
  );
}

export function DriveBottomNavItem({
  icon,
  label,
  active,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  badge?: number;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      onPressIn={() => {
        Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 5 }).start();
      }}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}>
      <Animated.View style={[styles.navItemInner, { transform: [{ scale }] }]}>
        <View style={styles.navIconWrap}>
          <MaterialCommunityIcons
            name={icon}
            size={24}
            color={active ? driveTheme.colors.ink : driveTheme.colors.muted}
          />
          {badge ? (
            <View style={styles.navBadge}>
              <Text style={styles.navBadgeText}>{Math.min(badge, 9)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
          {label}
        </Text>
        {active ? <View style={styles.navActiveBar} /> : null}
      </Animated.View>
    </Pressable>
  );
}

export function DriveIconWell({ icon, size = 56 }: { icon: IconName; size?: number }) {
  return (
    <View style={[styles.iconWell, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <MaterialCommunityIcons name={icon} size={size * 0.42} color={driveTheme.colors.ink} />
    </View>
  );
}

export function DriveStatRow({ items }: { items: Array<{ value: string; label: string }> }) {
  return (
    <View style={styles.statRow}>
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <View style={styles.statDivider} /> : null}
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1}>
              {item.value}
            </Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function DriveSectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export function DriveSurfaceCard({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: object;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          void driveHapticLight();
          onPress();
        }}
        style={({ pressed }) => [styles.surfaceCard, style, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.surfaceCard, style]}>{children}</View>;
}

export function DriveStatusPill({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'done' | 'live' | 'muted' | 'warning';
}) {
  return (
    <View
      style={[
        styles.statusPill,
        tone === 'done' && styles.statusPillDone,
        tone === 'live' && styles.statusPillLive,
        tone === 'warning' && styles.statusPillWarning,
      ]}>
      <Text
        style={[
          styles.statusPillText,
          tone === 'done' && styles.statusPillTextDone,
          tone === 'live' && styles.statusPillTextLive,
          tone === 'warning' && styles.statusPillTextWarning,
        ]}>
        {label}
      </Text>
    </View>
  );
}

export function DriveRouteStops({
  pickupLabel,
  pickupTitle,
  dropoffLabel,
  dropoffTitle,
}: {
  pickupLabel: string;
  pickupTitle: string;
  dropoffLabel: string;
  dropoffTitle: string;
}) {
  return (
    <View style={styles.routeStops}>
      <View style={styles.routeStopRow}>
        <View style={styles.routeRail}>
          <View style={[styles.routeSquare, styles.routeSquarePickup]} />
          <View style={styles.routeLine} />
        </View>
        <View style={styles.routeCopy}>
          <Text style={styles.routeStopTitle}>{pickupTitle}</Text>
          <Text style={styles.routeStopValue} numberOfLines={2}>
            {pickupLabel}
          </Text>
        </View>
      </View>
      <View style={styles.routeStopRow}>
        <View style={styles.routeRail}>
          <View style={[styles.routeSquare, styles.routeSquareDropoff]} />
        </View>
        <View style={styles.routeCopy}>
          <Text style={styles.routeStopTitle}>{dropoffTitle}</Text>
          <Text style={styles.routeStopValue} numberOfLines={2}>
            {dropoffLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function DriveMenuRow({
  icon,
  iconColor,
  iconBg,
  title,
  hint,
  trailing,
  onPress,
}: {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  hint?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={[styles.menuIcon, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        {hint ? (
          <Text style={styles.menuHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={22} color={driveTheme.colors.muted} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          void driveHapticLight();
          onPress();
        }}
        style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.menuRow}>{content}</View>;
}

export function DriveNotificationRow({
  icon,
  iconColor,
  iconBg,
  title,
  body,
  time,
  unread,
  onPress,
  personName,
}: {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  body: string;
  time?: string;
  unread?: boolean;
  onPress?: () => void;
  personName?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.notifRow, unread && styles.notifRowUnread, pressed && styles.pressed]}>
      {personName ? (
        <DrivePersonAvatar name={personName} kind="customer" size={44} />
      ) : (
        <View style={[styles.notifIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        </View>
      )}
      <View style={styles.notifCopy}>
        <View style={styles.notifTitleRow}>
          <Text style={styles.notifTitle} numberOfLines={1}>
            {title}
          </Text>
          {unread ? <View style={styles.notifUnreadDot} /> : null}
        </View>
        <Text style={styles.notifBody} numberOfLines={2}>
          {body}
        </Text>
        {time ? <Text style={styles.notifTime}>{time}</Text> : null}
      </View>
    </Pressable>
  );
}

export function DrivePrimaryButton({
  label,
  loading,
  disabled,
  onPress,
  icon,
  variant = 'cta',
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'cta' | 'brand';
}) {
  const btnStyle = variant === 'brand' ? styles.brandButton : styles.ctaButton;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        void driveHapticMedium();
        onPress?.();
      }}
      style={({ pressed }) => [
        btnStyle,
        (disabled || loading) && styles.disabled,
        pressed && (variant === 'brand' ? styles.brandPressed : styles.ctaPressed),
      ]}>
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View style={styles.primaryButtonInner}>
          {icon ? <MaterialCommunityIcons name={icon} size={20} color="#FFFFFF" /> : null}
          <Text style={styles.ctaButtonText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function DriveGhostButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.ghostButton, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.ghostButtonText}>{loading ? '...' : label}</Text>
    </Pressable>
  );
}

export function DriveSegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              void driveHapticLight();
              onChange(option.value);
            }}
            style={({ pressed }) => [styles.segmentedItem, active && styles.segmentedItemActive, pressed && styles.pressed]}>
            <Text style={[styles.segmentedLabel, active && styles.segmentedLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DriveTripQuickActions({
  items,
}: {
  items: Array<{
    icon: IconName;
    label: string;
    badge?: number;
    onPress?: () => void;
  }>;
}) {
  return (
    <View style={styles.quickRow}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => {
            void driveHapticLight();
            item.onPress?.();
          }}
          style={({ pressed }) => [styles.quickBtn, pressed && styles.pressed]}>
          <View>
            <MaterialCommunityIcons name={item.icon} size={22} color={driveTheme.colors.ink} />
            {item.badge ? (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{Math.min(item.badge, 9)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.quickBtnLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.55 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: driveTheme.spacing.md },
  brandRowCompact: { gap: driveTheme.spacing.sm },
  brandIconShell: {
    width: 44,
    height: 44,
    borderRadius: driveTheme.radius.md,
    backgroundColor: driveTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandIconShellLight: { backgroundColor: 'rgba(255,255,255,0.15)' },
  brandIcon: { width: 30, height: 30, borderRadius: 8 },
  brandWordmark: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 22,
    letterSpacing: 0.3,
    backgroundColor: driveTheme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  brandWordmarkLight: {
    backgroundColor: 'transparent',
    color: driveTheme.colors.ink,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  brandName: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 18, letterSpacing: -0.5 },
  brandNameLight: { color: '#FFFFFF' },
  brandNameCompact: { fontSize: 16 },
  brandCaption: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    marginTop: 1,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  brandCaptionLight: { color: 'rgba(255,255,255,0.75)' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeOnline: { backgroundColor: driveTheme.colors.onlineSoft },
  statusBadgeOffline: { backgroundColor: driveTheme.colors.surfaceMuted },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOnline: { backgroundColor: driveTheme.colors.online },
  statusDotOffline: { backgroundColor: driveTheme.colors.muted },
  statusText: { fontFamily: driveType.semibold, fontSize: 11 },
  statusTextOnline: { color: driveTheme.colors.primaryDark },
  statusTextOffline: { color: driveTheme.colors.subtext },
  homeHeaderWrap: { gap: driveTheme.spacing.sm },
  homeHeaderCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    ...driveTheme.shadows.float,
  },
  homeHeaderMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeHeaderIdentity: { flex: 1, minWidth: 0 },
  homeBrandMark: {
    alignSelf: 'flex-start',
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 11,
    letterSpacing: 0.2,
    backgroundColor: driveTheme.colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 4,
  },
  homeHeaderGreeting: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  homeHeaderName: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 17,
    letterSpacing: -0.4,
    marginTop: 1,
  },
  homeHeaderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  homeHeaderStatusOn: { backgroundColor: driveTheme.colors.onlineSoft },
  homeHeaderStatusOff: { backgroundColor: driveTheme.colors.surfaceMuted },
  homeHeaderStatusText: { fontFamily: driveType.semibold, fontSize: 10, letterSpacing: 0.3 },
  homeHeaderStatusTextOn: { color: driveTheme.colors.primaryDark },
  homeHeaderStatusTextOff: { color: driveTheme.colors.subtext },
  homeHeaderBell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: driveTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeHeaderDivider: {
    height: 1,
    backgroundColor: driveTheme.colors.line,
    marginVertical: 12,
  },
  homeHeaderEarnings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeHeaderEarningsMain: { flex: 1, minWidth: 0 },
  homeHeaderEarningsLabel: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  homeHeaderEarningsValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 24,
    letterSpacing: -0.8,
    marginTop: 2,
  },
  homeHeaderEarningsMeta: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.muted,
    fontSize: 11,
    maxWidth: 88,
    textAlign: 'right',
    lineHeight: 15,
  },
  mapGradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
    zIndex: 1,
    backgroundColor: 'rgba(11,15,20,0.18)',
  },
  mapGradientBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 1,
    backgroundColor: 'rgba(11,15,20,0.12)',
  },
  mapRecenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: 210,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(21,26,33,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    ...driveTheme.shadows.float,
  },
  sheetHome: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  sheetHandleHome: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: driveTheme.colors.line,
    marginBottom: 18,
  },
  homeSheetTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 22,
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  homeSheetSubtitle: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  homeCtaGradient: {
    minHeight: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  homeCtaBrand: {
    backgroundColor: driveTheme.colors.cta,
  },
  homeCtaDark: {
    backgroundColor: driveTheme.colors.cta,
  },
  homeCtaText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 17,
    letterSpacing: 0.15,
  },
  homeOnlineHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 8,
  },
  homeOnlinePulseRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: driveTheme.colors.onlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  homeOfflineLink: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  homeOfflineLinkText: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 14,
  },
  homeHeaderLegacy: { gap: driveTheme.spacing.md },
  homeTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: driveTheme.spacing.md,
  },
  homeTopBarMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.md,
    minWidth: 0,
  },
  homeTopBarCopy: { flex: 1, minWidth: 0, gap: 6 },
  homeTopBarGreeting: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.ink,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  homeMetricsCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    overflow: 'hidden',
    ...driveTheme.shadows.card,
  },
  homeMetricsPrimary: {
    flex: 1.2,
    paddingHorizontal: driveTheme.spacing.lg,
    paddingVertical: driveTheme.spacing.lg,
    justifyContent: 'center',
    backgroundColor: driveTheme.colors.dark,
  },
  homeMetricsLabel: {
    fontFamily: driveType.regular,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  homeMetricsValue: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 22,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  homeMetricsDivider: {
    width: 1,
    backgroundColor: driveTheme.colors.line,
  },
  homeMetricsSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: driveTheme.spacing.md,
    gap: driveTheme.spacing.md,
  },
  homeMetricItem: { flex: 1, alignItems: 'center' },
  homeMetricValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  homeMetricLabel: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  homeActionCard: { gap: driveTheme.spacing.md },
  homeActionEyebrow: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  homeActionHint: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  homeOnlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: driveTheme.spacing.md },
  homeOfflineBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  orderSheetEmbedded: { gap: driveTheme.spacing.md },
  homeHeaderTopRow: { flexDirection: 'row', alignItems: 'center', gap: driveTheme.spacing.md },
  homeHeaderTopCopy: { flex: 1, minWidth: 0 },
  homeHeaderHint: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 12, marginTop: 2 },
  earningsPill: {
    alignSelf: 'flex-start',
    backgroundColor: CTA,
    borderRadius: driveTheme.radius.lg,
    paddingHorizontal: driveTheme.spacing.lg,
    paddingVertical: driveTheme.spacing.md,
    maxWidth: '72%',
    ...driveTheme.shadows.pill,
  },
  earningsPillLabel: {
    fontFamily: driveType.regular,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  earningsPillValue: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 22,
    letterSpacing: -0.8,
    marginTop: 2,
  },
  earningsPillMeta: {
    fontFamily: driveType.regular,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 2,
  },
  homeHeaderRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.sm,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...driveTheme.shadows.card,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: driveTheme.colors.online },
  liveChipText: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 11 },
  offlineChip: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...driveTheme.shadows.card,
  },
  offlineChipText: { fontFamily: driveType.semibold, color: driveTheme.colors.subtext, fontSize: 11 },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: driveTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...driveTheme.shadows.card,
  },
  iconBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: driveTheme.colors.surface,
  },
  iconBadgeText: { fontFamily: driveType.bold, color: '#FFFFFF', fontSize: 9 },
  homeGreetingLine: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    marginTop: 2,
    paddingLeft: 2,
  },
  sheet: {
    backgroundColor: driveTheme.colors.surface,
    borderTopLeftRadius: driveTheme.radius.xxl,
    borderTopRightRadius: driveTheme.radius.xxl,
    paddingHorizontal: driveTheme.spacing.xl,
    paddingTop: driveTheme.spacing.sm,
    paddingBottom: driveTheme.spacing.xl,
    ...driveTheme.shadows.sheet,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: driveTheme.colors.lineStrong,
    marginBottom: driveTheme.spacing.lg,
  },
  goOnlineArtWrap: {
    alignItems: 'center',
    marginBottom: driveTheme.spacing.md,
  },
  sheetEyebrow: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 20,
    letterSpacing: -0.5,
    marginBottom: driveTheme.spacing.lg,
  },
  sheetHint: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: driveTheme.spacing.md,
  },
  ctaButton: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: CTA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: driveTheme.colors.ctaPressed },
  brandButton: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: driveTheme.colors.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandPressed: { backgroundColor: driveTheme.colors.primaryDark },
  ctaButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  searchingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: driveTheme.spacing.md },
  searchingPulse: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.onlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: driveTheme.colors.online },
  searchingCopy: { flex: 1 },
  searchingTitle: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 18, letterSpacing: -0.4 },
  searchingSubtitle: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  secondaryTextBtn: { marginTop: driveTheme.spacing.lg, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryTextBtnLabel: { fontFamily: driveType.semibold, color: driveTheme.colors.subtext, fontSize: 15 },
  orderSheet: { minHeight: 460, gap: 0, paddingBottom: 8 },
  openOffer: { gap: 18, paddingTop: 4 },
  openTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openLoad: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 15 },
  openPlace: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  openName: { marginTop: -10, fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 16 },
  openFare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openAmount: { flex: 1, textAlign: 'center', fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 32, letterSpacing: -0.8 },
  openStep: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openStepText: { color: '#FFFFFF', fontSize: 22, lineHeight: 24, fontFamily: driveType.bold, marginTop: -1 },
  openPhone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openPhoneText: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 16 },
  openPhoneAction: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 15 },
  openNotes: { flexDirection: 'row', gap: 16 },
  openNote: { fontFamily: driveType.semibold, color: '#9CA3AF', fontSize: 14 },
  openNoteOn: { color: driveTheme.colors.ink },
  openDecline: { alignItems: 'center', paddingVertical: 2 },
  openDeclineText: { fontFamily: driveType.semibold, color: '#6B7280', fontSize: 15 },
  chanceDot: { width: 8, height: 8, borderRadius: 4 },
  chanceDotLeft: { backgroundColor: driveTheme.colors.primary },
  chanceDotUsed: { backgroundColor: '#E5E7EB' },
  orderBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: driveTheme.colors.primary,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  orderBadgeText: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 12, letterSpacing: 0.2 },
  loadWord: {
    alignSelf: 'flex-start',
    backgroundColor: driveTheme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 13,
  },
  noteChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noteChip: {
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noteChipActive: { backgroundColor: driveTheme.colors.primary },
  noteChipText: { fontFamily: driveType.semibold, color: '#6B7280', fontSize: 13 },
  noteChipTextActive: { color: driveTheme.colors.ink },
  loadBlock: { gap: 8 },
  loadKicker: { fontFamily: driveType.semibold, color: driveTheme.colors.subtext, fontSize: 12 },
  loadChips: { flexDirection: 'row', gap: 6 },
  loadChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  loadChipActive: { backgroundColor: driveTheme.colors.primary },
  loadChipText: { fontFamily: driveType.semibold, color: '#9CA3AF', fontSize: 12 },
  loadChipTextActive: { fontFamily: driveType.bold, color: driveTheme.colors.ink },
  loadDetail: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 14, lineHeight: 18 },
  noteBlock: { gap: 4 },
  customerNote: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 15, lineHeight: 21 },
  chanceBlock: { gap: 6 },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chancePip: { width: 28, height: 10, borderRadius: 5 },
  chancePipLeft: { backgroundColor: driveTheme.colors.primary },
  chancePipUsed: { backgroundColor: '#E5E7EB' },
  chancePipNext: { borderWidth: 2, borderColor: '#111827' },
  chanceCount: { marginLeft: 4, fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 13 },
  offerNoteInput: {
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    fontFamily: driveType.semibold,
    color: driveTheme.colors.ink,
    fontSize: 14,
    paddingVertical: 8,
  },
  chanceHint: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 13, lineHeight: 18 },
  orderPlace: { flex: 1, fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  orderHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: driveTheme.spacing.md },
  orderCustomer: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 14 },
  orderFareRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: driveTheme.spacing.sm,
    marginBottom: driveTheme.spacing.sm,
  },
  orderFareLabel: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 13 },
  orderFare: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 28, letterSpacing: -0.8 },
  orderFareStepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderFareStepButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderFareStepText: { color: '#FFFFFF', fontSize: 20, lineHeight: 22, fontFamily: driveType.bold, marginTop: -1 },
  demandChip: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(234, 88, 12, 0.12)',
    ...driveTheme.shadows.card,
  },
  demandChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  demandChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#FFF7ED',
  },
  demandIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(234, 88, 12, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  demandCopy: { flex: 1 },
  demandTitle: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 13 },
  demandProbability: { fontFamily: driveType.bold, color: driveTheme.colors.primaryDark, fontSize: 12, marginTop: 2 },
  demandHint: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 11, marginTop: 1 },
  demandHotspot: { fontFamily: driveType.semibold, color: driveTheme.colors.warning, fontSize: 11, marginTop: 2 },
  demandNavigateBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demandNavigateText: { fontFamily: driveType.semibold, color: '#FFFFFF', fontSize: 11 },
  orderPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.sm,
    backgroundColor: driveTheme.colors.primarySoft,
    borderRadius: driveTheme.radius.md,
    paddingHorizontal: driveTheme.spacing.md,
    paddingVertical: 10,
    marginTop: driveTheme.spacing.sm,
  },
  orderPhoneCopy: { flex: 1 },
  orderPhoneLabel: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 11 },
  orderPhoneValue: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 14, marginTop: 1 },
  orderPhoneAction: { fontFamily: driveType.semibold, color: driveTheme.colors.primaryDark, fontSize: 12 },
  emptyState: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    paddingHorizontal: driveTheme.spacing.xxl,
    paddingVertical: 40,
    alignItems: 'center',
    ...driveTheme.shadows.card,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: driveTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: driveTheme.spacing.md,
  },
  emptyTitle: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 18, textAlign: 'center', letterSpacing: -0.3 },
  emptyText: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 6,
  },
  emptyCta: { marginTop: driveTheme.spacing.xl, alignSelf: 'stretch' },
  emptyArtWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: driveTheme.spacing.lg,
    marginBottom: driveTheme.spacing.md,
    borderRadius: driveTheme.radius.xl,
  },
  illustrationHero: {
    alignItems: 'center',
    paddingVertical: driveTheme.spacing.xl,
    paddingHorizontal: driveTheme.spacing.lg,
    marginBottom: driveTheme.spacing.lg,
    borderRadius: driveTheme.radius.xl,
    backgroundColor: driveTheme.colors.surface,
    ...driveTheme.shadows.card,
  },
  illustrationHeroTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 24,
    letterSpacing: -0.6,
    textAlign: 'center',
    marginTop: driveTheme.spacing.md,
  },
  illustrationHeroSubtitle: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
  },
  screenHeader: { paddingTop: 8, paddingBottom: 12, gap: 4 },
  screenTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 32,
    letterSpacing: -1,
    lineHeight: 38,
  },
  screenSubtitle: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 15, lineHeight: 22 },
  accountHero: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.md,
    ...driveTheme.shadows.card,
  },
  accountAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: driveTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 17 },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontFamily: driveType.bold, color: driveTheme.colors.ink, fontSize: 17, letterSpacing: -0.3 },
  accountMeta: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 13, marginTop: 2 },
  authPanel: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.xl,
    gap: driveTheme.spacing.sm,
    marginBottom: driveTheme.spacing.md,
    ...driveTheme.shadows.card,
  },
  authTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 26,
    letterSpacing: -0.6,
    marginTop: driveTheme.spacing.md,
  },
  authSubtitle: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 15, lineHeight: 22 },
  nearbyPin: { alignItems: 'center' },
  nearbyBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.surface,
    borderWidth: 2,
    borderColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyStem: { width: 2, height: 6, backgroundColor: driveTheme.colors.primary },
  navItem: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  navItemInner: { alignItems: 'center', width: '100%' },
  navActiveBar: {
    marginTop: 6,
    width: 18,
    height: 3,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.ink,
  },
  navIconWrap: { position: 'relative', height: 26, justifyContent: 'center' },
  navBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: driveTheme.colors.surface,
  },
  navBadgeText: { fontFamily: driveType.bold, color: '#FFFFFF', fontSize: 9 },
  navLabel: { fontFamily: driveType.semibold, color: driveTheme.colors.muted, fontSize: 10, marginTop: 4 },
  navLabelActive: { color: driveTheme.colors.ink },
  iconWell: {
    backgroundColor: driveTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    paddingVertical: driveTheme.spacing.lg,
    ...driveTheme.shadows.card,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: driveTheme.colors.line, marginVertical: 4 },
  statValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  statLabel: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 11, textAlign: 'center' },
  sectionTitle: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  surfaceCard: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    gap: driveTheme.spacing.sm,
    ...driveTheme.shadows.card,
  },
  statusPill: {
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: driveTheme.colors.surfaceMuted,
  },
  statusPillDone: { backgroundColor: driveTheme.colors.primarySoft },
  statusPillLive: { backgroundColor: driveTheme.colors.infoSoft },
  statusPillWarning: { backgroundColor: driveTheme.colors.warningSoft },
  statusPillText: { fontFamily: driveType.semibold, color: driveTheme.colors.subtext, fontSize: 11 },
  statusPillTextDone: { color: driveTheme.colors.primaryDark },
  statusPillTextLive: { color: driveTheme.colors.info },
  statusPillTextWarning: { color: driveTheme.colors.warning },
  routeStops: { gap: 4, marginVertical: driveTheme.spacing.sm },
  routeStopRow: { flexDirection: 'row', gap: driveTheme.spacing.md },
  routeRail: { width: 16, alignItems: 'center', paddingTop: 3 },
  routeSquare: { width: 10, height: 10, borderRadius: 2 },
  routeSquarePickup: { backgroundColor: driveTheme.colors.ink },
  routeSquareDropoff: { backgroundColor: driveTheme.colors.info },
  routeLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: driveTheme.colors.lineStrong, marginVertical: 4 },
  routeCopy: { flex: 1, paddingBottom: 8 },
  routeStopTitle: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  routeStopValue: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 2,
    letterSpacing: -0.2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.md,
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    ...driveTheme.shadows.card,
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: driveTheme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuTitle: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 16, letterSpacing: -0.2 },
  menuHint: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 13, lineHeight: 18 },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: driveTheme.spacing.md,
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    ...driveTheme.shadows.card,
  },
  notifRowUnread: { backgroundColor: '#FAFAFA' },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: driveTheme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifCopy: { flex: 1, minWidth: 0, gap: 3 },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 15, flex: 1, letterSpacing: -0.2 },
  notifUnreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: driveTheme.colors.primary },
  notifBody: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 14, lineHeight: 20 },
  notifTime: { fontFamily: driveType.regular, color: driveTheme.colors.muted, fontSize: 12, marginTop: 2 },
  primaryButtonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghostButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  ghostButtonText: { fontFamily: driveType.semibold, color: driveTheme.colors.subtext, fontSize: 15 },
  quickRow: { flexDirection: 'row', gap: driveTheme.spacing.sm, marginTop: driveTheme.spacing.md },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: driveTheme.radius.lg,
    paddingVertical: driveTheme.spacing.md,
    minHeight: 72,
  },
  quickBtnLabel: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 11 },
  quickBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  quickBadgeText: { fontFamily: driveType.bold, color: '#FFFFFF', fontSize: 9 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: driveTheme.radius.lg,
    padding: 4,
    gap: 4,
  },
  segmentedItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: driveTheme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedItemActive: {
    backgroundColor: driveTheme.colors.surface,
    ...driveTheme.shadows.card,
  },
  segmentedLabel: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 14,
  },
  segmentedLabelActive: {
    color: driveTheme.colors.ink,
  },
});
