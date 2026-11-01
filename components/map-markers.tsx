import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';

export type MapVehicleKey = 'bodaboda' | 'toyo' | 'kirikuu' | 'canter';

export function getMapVehicleKey(input: {
  flow?: string | null;
  cargoVehicleKey?: string | null;
  driverVehicleType?: string | null;
  serviceLabel?: string | null;
}): MapVehicleKey {
  const haystack = [input.cargoVehicleKey, input.driverVehicleType, input.serviceLabel, input.flow]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack.includes('canter') || haystack.includes('center') || haystack.includes('fuso')) {
    return 'canter';
  }

  if (haystack.includes('kirikuu')) {
    return 'kirikuu';
  }

  if (haystack.includes('toyo') || haystack.includes('bajaj') || haystack.includes('pickup') || haystack.includes('van')) {
    return 'toyo';
  }

  if (haystack.includes('boda') || haystack.includes('pikipiki') || haystack.includes('motor')) {
    return 'bodaboda';
  }

  if (input.flow === 'cargo') {
    return 'toyo';
  }

  return 'bodaboda';
}

export function getVehicleMarkerImage(vehicleKey: MapVehicleKey) {
  if (vehicleKey === 'toyo') {
    return images.cargoAvatarToyo;
  }

  if (vehicleKey === 'kirikuu') {
    return images.cargoAvatarKirikuu;
  }

  if (vehicleKey === 'canter') {
    return images.cargoAvatarCanter;
  }

  return images.bodaboda;
}

export function getVehicleMarkerIcon(vehicleKey: MapVehicleKey): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  if (vehicleKey === 'canter') {
    return 'truck';
  }

  if (vehicleKey === 'kirikuu') {
    return 'truck-outline';
  }

  if (vehicleKey === 'toyo') {
    return 'rickshaw';
  }

  return 'motorbike';
}

export function getVehicleMarkerLabel(vehicleKey: MapVehicleKey) {
  if (vehicleKey === 'canter') {
    return 'Canter';
  }

  if (vehicleKey === 'kirikuu') {
    return 'Kirikuu';
  }

  if (vehicleKey === 'toyo') {
    return 'Toyo';
  }

  return 'Bodaboda';
}

export function getVehicleAccent(vehicleKey: MapVehicleKey) {
  if (vehicleKey === 'canter') {
    return '#15803D';
  }

  if (vehicleKey === 'kirikuu') {
    return '#0F766E';
  }

  if (vehicleKey === 'toyo') {
    return '#2563EB';
  }

  return cargoTheme.colors.primary;
}

export function MapStopPin({
  kind,
  label,
  compact = false,
}: {
  kind: 'pickup' | 'dropoff';
  label?: string;
  compact?: boolean;
}) {
  const isPickup = kind === 'pickup';

  if (compact) {
    return (
      <View style={styles.compactStopWrap} collapsable={false}>
        <View style={[styles.compactStopCore, isPickup ? styles.compactStopPickup : styles.compactStopDropoff]} />
      </View>
    );
  }

  const caption = label || (isPickup ? 'Pickup' : 'Drop-off');
  const badge = isPickup ? 'A' : 'B';

  return (
    <View style={styles.stopWrap} collapsable={false}>
      <View style={[styles.stopChip, isPickup ? styles.stopChipPickup : styles.stopChipDropoff]}>
        <Text style={[styles.stopChipText, isPickup ? styles.stopChipTextPickup : styles.stopChipTextDropoff]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <View style={[styles.stopHead, isPickup ? styles.stopHeadPickup : styles.stopHeadDropoff]}>
        <Text style={styles.stopBadgeLetter}>{badge}</Text>
      </View>
      <View style={[styles.stopStem, isPickup ? styles.stopStemPickup : styles.stopStemDropoff]} />
      <View style={[styles.stopPulse, isPickup ? styles.stopPulsePickup : styles.stopPulseDropoff]} />
      <View style={[styles.stopDot, isPickup ? styles.stopDotPickup : styles.stopDotDropoff]} />
    </View>
  );
}

export const CARGO_CALLOUT_LAYOUT = {
  width: 116,
  height: 86,
  overlayHeight: 60,
  bullseye: 22,
};

export function CargoBullseyePin({ kind }: { kind: 'pickup' | 'dropoff' }) {
  const isPickup = kind === 'pickup';

  return (
    <View style={styles.bullseye} collapsable={false}>
      <View style={[styles.bullseyeRing, isPickup ? styles.bullseyeRingPickup : styles.bullseyeRingDropoff]} />
      <View style={styles.bullseyeHole} />
    </View>
  );
}

export function CargoRouteCallout({
  kind,
  title,
  detail,
  showPin = true,
  placement = 'above',
  stemOffset = 0,
}: {
  kind: 'pickup' | 'dropoff';
  title: string;
  detail?: string;
  showPin?: boolean;
  placement?: 'above' | 'below';
  stemOffset?: number;
}) {
  const isPickup = kind === 'pickup';
  const flipBelow = placement === 'below';
  const pill = (
    <View style={[styles.calloutPill, isPickup ? styles.calloutPillPickup : styles.calloutPillDropoff]}>
      <Text style={styles.calloutTitle} numberOfLines={1}>
        {title}
      </Text>
      {detail ? (
        <Text style={styles.calloutDetail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
  const stem = (
    <View
      style={[
        styles.calloutStemStack,
        flipBelow && styles.calloutStemStackBelow,
        stemOffset ? { transform: [{ translateX: stemOffset }] } : null,
      ]}>
      {flipBelow ? (
        <>
          <View style={[styles.calloutStem, isPickup ? styles.calloutStemPickup : styles.calloutStemDropoff]} />
          <View style={[styles.calloutNeck, isPickup ? styles.calloutStemPickup : styles.calloutStemDropoff]} />
        </>
      ) : (
        <>
          <View style={[styles.calloutNeck, isPickup ? styles.calloutStemPickup : styles.calloutStemDropoff]} />
          <View style={[styles.calloutStem, isPickup ? styles.calloutStemPickup : styles.calloutStemDropoff]} />
        </>
      )}
    </View>
  );
  const pin = showPin ? (
    <View style={styles.bullseye}>
      <View style={[styles.bullseyeRing, isPickup ? styles.bullseyeRingPickup : styles.bullseyeRingDropoff]} />
      <View style={styles.bullseyeHole} />
    </View>
  ) : null;

  return (
    <View
      style={[styles.calloutWrap, !showPin && styles.calloutWrapOverlay, flipBelow && styles.calloutWrapBelow]}
      collapsable={false}>
      {flipBelow ? (
        <>
          {stem}
          {pill}
          {pin}
        </>
      ) : (
        <>
          {pill}
          {stem}
          {pin}
        </>
      )}
    </View>
  );
}

export function CargoRoadVehiclePin({
  vehicleKey,
  emphasized = false,
}: {
  vehicleKey: MapVehicleKey;
  emphasized?: boolean;
}) {
  return (
    <View style={[styles.roadVehicleWrap, emphasized && styles.roadVehicleEmphasized]} collapsable={false}>
      <MaterialCommunityIcons
        name={getVehicleMarkerIcon(vehicleKey)}
        size={emphasized ? 17 : 15}
        color="#111827"
      />
    </View>
  );
}

export function VehicleDriverMarker({
  vehicleKey,
  assigned = false,
  label,
  muted = false,
}: {
  vehicleKey: MapVehicleKey;
  assigned?: boolean;
  label?: string;
  muted?: boolean;
}) {
  const image = getVehicleMarkerImage(vehicleKey);
  const caption = label || getVehicleMarkerLabel(vehicleKey);
  const showChip = Boolean(label);

  return (
    <View style={[styles.vehicleWrap, muted && styles.vehicleWrapMuted]} collapsable={false}>
      {showChip ? (
        <View style={[styles.vehicleChip, assigned && styles.vehicleChipAssigned]}>
          <Text style={styles.vehicleChipText} numberOfLines={1}>
            {caption}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.vehicleAvatar,
          assigned ? styles.vehicleAvatarAssigned : styles.vehicleAvatarIdle,
          muted && styles.vehicleAvatarMuted,
        ]}>
        {image ? (
          <Image source={image} resizeMode="contain" fadeDuration={0} style={styles.vehicleImage} />
        ) : (
          <View style={styles.vehicleIconBadge}>
            <MaterialCommunityIcons name={getVehicleMarkerIcon(vehicleKey)} size={18} color="#111827" />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stopWrap: {
    alignItems: 'center',
  },
  stopChip: {
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stopChipPickup: {
    backgroundColor: '#ECFDF3',
    borderColor: '#86EFAC',
  },
  stopChipDropoff: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  stopChipText: {
    fontFamily: typography.bold,
    fontSize: 12,
    lineHeight: 15,
  },
  stopChipTextPickup: {
    color: '#166534',
  },
  stopChipTextDropoff: {
    color: '#1D4ED8',
  },
  stopHead: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  stopHeadPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopHeadDropoff: {
    backgroundColor: '#2563EB',
  },
  stopBadgeLetter: {
    color: '#FFFFFF',
    fontFamily: typography.extrabold,
    fontSize: 18,
    lineHeight: 22,
  },
  stopStem: {
    width: 4,
    height: 12,
  },
  stopStemPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopStemDropoff: {
    backgroundColor: '#2563EB',
  },
  stopPulse: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginTop: -6,
    opacity: 0.28,
  },
  stopPulsePickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopPulseDropoff: {
    backgroundColor: '#2563EB',
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: -14,
  },
  stopDotPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopDotDropoff: {
    backgroundColor: '#2563EB',
  },
  compactStopWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
  },
  compactStopCore: {
    width: 16,
    height: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#111827',
    shadowOpacity: 0.22,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  compactStopPickup: {
    borderRadius: 8,
    backgroundColor: '#16A34A',
  },
  compactStopDropoff: {
    borderRadius: 4,
    backgroundColor: '#111827',
  },
  calloutWrap: {
    width: CARGO_CALLOUT_LAYOUT.width,
    height: CARGO_CALLOUT_LAYOUT.height,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  calloutWrapOverlay: {
    height: CARGO_CALLOUT_LAYOUT.overlayHeight,
  },
  calloutWrapBelow: {
    justifyContent: 'flex-start',
  },
  calloutPill: {
    minWidth: 78,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  calloutPillPickup: {
    backgroundColor: '#15803D',
  },
  calloutPillDropoff: {
    backgroundColor: '#111827',
  },
  calloutTitle: {
    fontFamily: typography.semibold,
    fontSize: 11,
    lineHeight: 13,
    color: '#FFFFFF',
  },
  calloutDetail: {
    fontFamily: typography.extrabold,
    fontSize: 16,
    lineHeight: 19,
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginTop: 1,
  },
  calloutStemStack: {
    alignItems: 'center',
    marginTop: -3,
    zIndex: -1,
  },
  calloutStemStackBelow: {
    marginTop: 0,
    marginBottom: -3,
  },
  calloutNeck: {
    width: 3,
    height: 7,
  },
  calloutStem: {
    width: 10,
    height: 10,
    marginTop: -5,
    transform: [{ rotate: '45deg' }],
  },
  calloutStemPickup: {
    backgroundColor: '#15803D',
  },
  calloutStemDropoff: {
    backgroundColor: '#111827',
  },
  bullseye: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  bullseyeRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
  },
  bullseyeRingPickup: {
    borderColor: '#15803D',
  },
  bullseyeRingDropoff: {
    borderColor: '#111827',
  },
  bullseyeHole: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  roadVehicleWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.08)',
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  roadVehicleEmphasized: {
    transform: [{ scale: 1.08 }],
    borderColor: '#111827',
  },
  vehicleWrap: {
    alignItems: 'center',
  },
  vehicleWrapMuted: {
    opacity: 0.72,
  },
  vehicleChip: {
    maxWidth: 110,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  vehicleChipAssigned: {
    borderColor: '#111827',
  },
  vehicleChipText: {
    fontFamily: typography.bold,
    fontSize: 10,
    lineHeight: 13,
    color: cargoTheme.colors.text,
  },
  vehicleAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#111827',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  vehicleAvatarIdle: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  vehicleAvatarAssigned: {
    borderWidth: 2.5,
    borderColor: '#111827',
  },
  vehicleAvatarMuted: {
    borderColor: '#F3F4F6',
  },
  vehicleImage: {
    width: 34,
    height: 34,
  },
  vehicleIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
});
