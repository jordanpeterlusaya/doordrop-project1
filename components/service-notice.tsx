import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import React from 'react';
import { Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { useNetworkStatus, type CustomerNoticeKind } from '@/lib/network-status';

const offlineAvatar = require('@/assets/images/offline-sad-avatar.png');

export function ServiceNotice({
  kind,
  message,
}: {
  kind: CustomerNoticeKind;
  message?: string;
}) {
  const copy = useAppCopy();
  const presentation =
    kind === 'offline'
      ? {
          icon: 'wifi-off' as const,
          title: copy.notice.offlineTitle,
          text: message || copy.notice.offlineText,
          avatar: offlineAvatar,
        }
      : kind === 'service'
        ? {
            icon: 'map-marker-radius-outline' as const,
            title: copy.notice.serviceTitle,
            text: message || copy.notice.serviceText,
            avatar: null,
          }
        : {
            icon: 'map-search-outline' as const,
            title: copy.notice.locationTitle,
            text: message || copy.notice.locationText,
            avatar: null,
          };

  return (
    <View style={[styles.card, presentation.avatar ? styles.cardOffline : null]}>
      {presentation.avatar ? (
        <Image source={presentation.avatar} style={styles.avatar} resizeMode="contain" />
      ) : (
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name={presentation.icon} size={20} color={cargoTheme.colors.primaryDark} />
        </View>
      )}
      <View style={styles.copy}>
        <Text style={styles.title}>{presentation.title}</Text>
        <Text style={styles.text}>{presentation.text}</Text>
      </View>
    </View>
  );
}

export function OfflineBanner() {
  return <ServiceNotice kind="offline" />;
}

export function AppOfflineBanner() {
  const pathname = usePathname();
  const online = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const hideOnHome = pathname === '/home' || pathname === '/';

  if (online || hideOnHome) {
    return null;
  }

  const topInset = Math.max(insets.top, StatusBar.currentHeight ?? 0, 8) + 6;

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={[styles.wrap, { paddingTop: topInset }]}>
        <ServiceNotice kind="offline" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 36,
    elevation: 36,
  },
  wrap: {
    paddingHorizontal: 14,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  cardOffline: {
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: typography.bold,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: cargoTheme.colors.text,
  },
  text: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: cargoTheme.colors.subtext,
  },
});
