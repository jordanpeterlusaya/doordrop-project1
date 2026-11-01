import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { driveAvatarArt } from './drive-assets';

export type DriveAvatarKind =
  | 'goOnline'
  | 'emptyTrips'
  | 'payment'
  | 'notifications'
  | 'offline'
  | 'authWelcome'
  | 'verification'
  | 'searchingOrders'
  | 'customer'
  | 'driver';

const avatarPalettes = [
  { bg: '#ECFDF5', ring: '#059669', text: '#047857' },
  { bg: '#EFF6FF', ring: '#2563EB', text: '#1D4ED8' },
  { bg: '#FFF7ED', ring: '#EA580C', text: '#C2410C' },
  { bg: '#F4F4F5', ring: '#18181B', text: '#27272A' },
  { bg: '#FEF2F2', ring: '#DC2626', text: '#B91C1C' },
] as const;

function hashSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getInitials(name?: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return 'DD';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function DriveSceneAvatar({
  kind,
  size = 120,
}: {
  kind: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
  size?: number;
}) {
  const source =
    kind === 'goOnline'
      ? driveAvatarArt.goOnline
      : kind === 'emptyTrips'
        ? driveAvatarArt.emptyTrips
        : kind === 'payment'
          ? driveAvatarArt.payment
          : kind === 'notifications'
            ? driveAvatarArt.notifications
            : kind === 'authWelcome'
              ? driveAvatarArt.authWelcome
              : kind === 'verification'
                ? driveAvatarArt.verification
                : kind === 'searchingOrders'
                  ? driveAvatarArt.searchingOrders
                  : driveAvatarArt.offline;

  return (
    <View style={[styles.sceneShell, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Image source={source} style={styles.sceneImage} resizeMode="cover" />
    </View>
  );
}

export function DrivePersonAvatar({
  name,
  kind = 'driver',
  size = 52,
  online,
}: {
  name?: string | null;
  kind?: 'customer' | 'driver';
  size?: number;
  online?: boolean;
}) {
  const palette = avatarPalettes[hashSeed(name || kind) % avatarPalettes.length];
  const initials = getInitials(name);

  return (
    <View style={[styles.personWrap, { width: size, height: size }]}>
      <View
        style={[
          styles.personRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: online ? driveTheme.colors.online : palette.ring,
          },
        ]}>
        <View
          style={[
            styles.personCore,
            {
              width: size - 6,
              height: size - 6,
              borderRadius: (size - 6) / 2,
              backgroundColor: palette.bg,
            },
          ]}>
          <Text style={[styles.personInitials, { color: palette.text, fontSize: size * 0.32 }]}>{initials}</Text>
        </View>
      </View>
      {online ? <View style={[styles.onlineBadge, { right: size * 0.02, bottom: size * 0.02 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sceneShell: {
    overflow: 'hidden',
    backgroundColor: driveTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: 'rgba(5,150,105,0.12)',
  },
  sceneImage: {
    width: '100%',
    height: '100%',
  },
  personWrap: {
    position: 'relative',
  },
  personRing: {
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personCore: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  personInitials: {
    fontFamily: driveType.bold,
    letterSpacing: 0.5,
  },
  onlineBadge: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: driveTheme.colors.online,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
