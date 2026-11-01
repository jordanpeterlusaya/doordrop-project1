import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import {
  Image,
  ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

type VerifyPhase = 'connecting' | 'waiting' | 'no_driver' | 'error';

type Props = {
  statusTitle: string;
  statusHint: string;
  vehicleTitle: string;
  vehicleImage?: ImageSourcePropType;
  fareLabel: string;
  nearbyLine: string;
  nearbyPhotos?: Array<string | undefined>;
  cancelLabel: string;
  onCancel: () => void;
  cancelDisabled?: boolean;
  bottomInset?: number;
  errorText?: string;
  /** connecting/waiting → animate; no_driver/error → stop */
  phase?: VerifyPhase;
};

function VerifySearchProgress({ active, emphatic }: { active: boolean; emphatic?: boolean }) {
  const pulse = useSharedValue(0);
  const pulse2 = useSharedValue(0);
  const bar = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(pulse);
      cancelAnimation(pulse2);
      cancelAnimation(bar);
      pulse.value = 0;
      pulse2.value = 0;
      bar.value = 0;
      return;
    }
    const pulseMs = emphatic ? 1100 : 1400;
    const barMs = emphatic ? 1400 : 1800;
    pulse.value = withRepeat(withTiming(1, { duration: pulseMs, easing: Easing.out(Easing.quad) }), -1, false);
    pulse2.value = withRepeat(
      withTiming(1, { duration: pulseMs + 350, easing: Easing.out(Easing.quad) }),
      -1,
      false
    );
    bar.value = withRepeat(withTiming(1, { duration: barMs, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(pulse2);
      cancelAnimation(bar);
    };
  }, [active, emphatic, bar, pulse, pulse2]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: active ? (emphatic ? 0.95 : 0.85) - pulse.value * (emphatic ? 0.85 : 0.75) : 0,
    transform: [{ scale: 0.65 + pulse.value * (emphatic ? 0.7 : 0.55) }],
  }));

  const ring2Style = useAnimatedStyle(() => ({
    opacity: active && emphatic ? 0.7 - pulse2.value * 0.65 : 0,
    transform: [{ scale: 0.55 + pulse2.value * 0.85 }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: `${12 + bar.value * 76}%`,
    opacity: active ? 1 : 0.35,
  }));

  return (
    <View style={styles.progressBlock} accessibilityElementsHidden={!active}>
      <View style={styles.progressStage}>
        <Animated.View style={[styles.progressRing, styles.progressRingOuter, ring2Style]} />
        <Animated.View style={[styles.progressRing, ringStyle]} />
        <View style={[styles.progressCore, emphatic && styles.progressCoreEmphatic]}>
          <MaterialCommunityIcons name="radar" size={18} color={cargoTheme.colors.ink} />
        </View>
      </View>
      <View style={[styles.progressTrack, emphatic && styles.progressTrackEmphatic]}>
        <Animated.View style={[styles.progressFill, emphatic && styles.progressFillEmphatic, fillStyle]} />
      </View>
    </View>
  );
}

export function CargoDriverVerifySheet({
  statusTitle,
  statusHint,
  vehicleTitle,
  vehicleImage,
  fareLabel,
  nearbyLine,
  nearbyPhotos = [],
  cancelLabel,
  onCancel,
  cancelDisabled = false,
  bottomInset = 12,
  errorText,
  phase = 'connecting',
}: Props) {
  const photos = nearbyPhotos.filter(Boolean).slice(0, 3);
  const progressActive = phase === 'connecting' || phase === 'waiting';

  return (
    <View style={styles.sheet}>
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={[
          styles.sheetScrollContent,
          { paddingBottom: Math.max(bottomInset, 12) + 12 },
        ]}
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.handle} />
        <Text style={styles.title}>{statusTitle}</Text>
        <Text style={styles.hint}>{statusHint}</Text>

        <VerifySearchProgress active={progressActive} emphatic={phase === 'waiting'} />

        <View style={styles.vehicleRow}>
          <View style={styles.vehicleAvatarWrap}>
            {vehicleImage ? (
              <Image source={vehicleImage} style={styles.vehicleAvatar} resizeMode="contain" />
            ) : (
              <MaterialCommunityIcons name="truck" size={28} color={cargoTheme.colors.ink} />
            )}
          </View>
          <Text style={styles.vehicleName} numberOfLines={1}>
            {vehicleTitle}
          </Text>
          <MaterialCommunityIcons name="cash" size={18} color="#6B7280" />
          <Text style={styles.fare}>{fareLabel}</Text>
        </View>

        <View style={styles.nearbyRow}>
          {photos.length ? (
            <View style={styles.photoStack}>
              {photos.map((uri, index) => (
                <Image
                  key={`${uri}-${index}`}
                  source={{ uri: String(uri) }}
                  style={[styles.photo, { marginLeft: index === 0 ? 0 : -10, zIndex: photos.length - index }]}
                />
              ))}
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <MaterialCommunityIcons name="account" size={16} color={cargoTheme.colors.ink} />
            </View>
          )}
          <Text style={styles.nearbyText}>{nearbyLine}</Text>
        </View>

        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

        <TouchableOpacity
          accessibilityRole="button"
          disabled={cancelDisabled}
          onPress={onCancel}
          style={[styles.cancelButton, cancelDisabled && styles.cancelDisabled]}>
          <Text style={styles.cancelLabel}>{cancelLabel}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export function CargoDriversFoundPill({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  return (
    <View style={styles.pill} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.pillDot} />
      <Text style={styles.pillText}>{label.replace('{count}', String(Math.max(0, count)))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
    overflow: 'hidden',
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    flexGrow: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  title: {
    fontFamily: typography.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.5,
  },
  hint: {
    marginTop: 4,
    fontFamily: typography.medium,
    fontSize: 14,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  progressBlock: {
    marginTop: 14,
    alignItems: 'center',
    gap: 10,
  },
  progressStage: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: cargoTheme.colors.primary,
    backgroundColor: 'rgba(255,229,0,0.16)',
  },
  progressRingOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,229,0,0.08)',
  },
  progressCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressCoreEmphatic: {
    backgroundColor: cargoTheme.colors.primary,
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: cargoTheme.colors.primary,
  },
  progressFillEmphatic: {
    height: 5,
  },
  progressTrackEmphatic: {
    height: 5,
  },
  vehicleRow: {
    marginTop: 16,
    minHeight: 64,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  vehicleAvatarWrap: {
    width: 52,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleAvatar: {
    width: 52,
    height: 40,
  },
  vehicleName: {
    flex: 1,
    fontFamily: typography.bold,
    fontSize: 16,
    color: cargoTheme.colors.ink,
  },
  fare: {
    fontFamily: typography.extrabold,
    fontSize: 16,
    color: cargoTheme.colors.ink,
  },
  nearbyRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  photo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#E5E7EB',
  },
  photoPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyText: {
    flex: 1,
    fontFamily: typography.medium,
    fontSize: 13,
    lineHeight: 18,
    color: '#4B5563',
  },
  error: {
    marginTop: 10,
    fontFamily: typography.medium,
    fontSize: 13,
    color: '#B91C1C',
  },
  cancelButton: {
    marginTop: 16,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: '#DC2626',
    borderWidth: 1,
    borderColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDisabled: {
    opacity: 0.55,
  },
  cancelLabel: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  pillText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: cargoTheme.colors.ink,
  },
});
