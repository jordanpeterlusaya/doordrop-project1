import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, type ImageSourcePropType } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

export type InstantConfirmPhase = 'assigned' | 'accepted' | 'declined' | 'cancelled' | 'no_driver';

export type InstantConfirmState = {
  phase: InstantConfirmPhase;
  nearbyCount: number;
  fareLabel: string;
  reassigned?: boolean;
};

type Copy = {
  driversNone: string;
  driversOne: string;
  driversMany: string;
  assignedTitle: string;
  assignedHint: string;
  nearbyLine: string;
  reassignedLine: string;
  noDriverTitle: string;
  noDriverLine: string;
  declinedTitle: string;
  declinedLine: string;
  acceptedTitle: string;
  acceptedLine: string;
  yourFare: string;
  cancel: string;
};

export function CargoInstantConfirm({
  state,
  vehicleTitle,
  vehicleImage,
  bottomInset,
  copy,
  error,
  cancelling,
  onCancel,
}: {
  state: InstantConfirmState;
  vehicleTitle: string;
  vehicleImage: ImageSourcePropType;
  bottomInset: number;
  copy: Copy;
  error?: string;
  cancelling?: boolean;
  onCancel: () => void;
}) {
  const count = Math.max(0, state.nearbyCount);
  const pill =
    count <= 0 ? copy.driversNone : count === 1 ? copy.driversOne : copy.driversMany.replace('{count}', String(count));
  const waiting = state.phase === 'assigned';
  const title =
    state.phase === 'no_driver'
      ? copy.noDriverTitle
      : state.phase === 'declined'
        ? copy.declinedTitle
        : state.phase === 'accepted'
          ? copy.acceptedTitle
          : copy.assignedTitle;
  const line =
    state.phase === 'no_driver'
      ? copy.noDriverLine.replace('{vehicle}', vehicleTitle)
      : state.phase === 'declined'
        ? copy.declinedLine
        : state.phase === 'accepted'
          ? copy.acceptedLine
          : state.reassigned
            ? copy.reassignedLine
            : copy.nearbyLine;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View pointerEvents="none" style={styles.pillWrap}>
        <View style={styles.pill}>
          <View style={[styles.dot, count <= 0 && styles.dotIdle]} />
          <Text style={styles.pillText}>{pill}</Text>
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 12) + 8 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        {waiting ? <Text style={styles.hint}>{copy.assignedHint}</Text> : null}

        <View style={styles.vehicleRow}>
          <View style={styles.avatarWrap}>
            <Image source={vehicleImage} style={styles.avatar} resizeMode="contain" />
          </View>
          <View style={styles.vehicleCopy}>
            <Text numberOfLines={1} style={styles.vehicleTitle}>
              {vehicleTitle}
            </Text>
          </View>
          <View style={styles.fareWrap}>
            <Text style={styles.fareKicker}>{copy.yourFare}</Text>
            <Text style={styles.fare}>{state.fareLabel}</Text>
          </View>
        </View>

        <Text style={styles.line}>{line}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          accessibilityRole="button"
          disabled={cancelling}
          style={[styles.cancel, cancelling && styles.cancelDisabled]}
          onPress={onCancel}>
          <Text style={styles.cancelText}>{copy.cancel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  pillWrap: {
    alignItems: 'center',
    paddingTop: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: cargoTheme.radius.pill,
    backgroundColor: '#FFFFFF',
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  dotIdle: {
    backgroundColor: '#9CA3AF',
  },
  pillText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.2,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  title: {
    fontFamily: typography.extrabold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: cargoTheme.colors.ink,
  },
  hint: {
    marginTop: 4,
    fontFamily: typography.medium,
    fontSize: 14,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  vehicleRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 52,
    height: 52,
  },
  vehicleCopy: {
    flex: 1,
    minWidth: 0,
  },
  vehicleTitle: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.3,
  },
  fareWrap: {
    alignItems: 'flex-end',
    maxWidth: 128,
  },
  fareKicker: {
    fontFamily: typography.medium,
    fontSize: 11,
    color: cargoTheme.colors.subtext,
  },
  fare: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.3,
    textAlign: 'right',
  },
  line: {
    marginTop: 14,
    fontFamily: typography.medium,
    fontSize: 15,
    lineHeight: 21,
    color: cargoTheme.colors.ink,
  },
  error: {
    marginTop: 8,
    fontFamily: typography.medium,
    fontSize: 13,
    lineHeight: 18,
    color: '#B91C1C',
  },
  cancel: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDisabled: {
    opacity: 0.6,
  },
  cancelText: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: cargoTheme.colors.ink,
  },
});
