import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';

export type MapVehicleKey = 'bodaboda' | 'toyo' | 'kirikuu';

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

  if (haystack.includes('kirikuu')) {
    return 'kirikuu';
  }

  if (haystack.includes('toyo') || haystack.includes('bajaj') || haystack.includes('pickup') || haystack.includes('van')) {
    return 'toyo';
  }

  if (input.flow === 'cargo') {
    return 'toyo';
  }

  return 'bodaboda';
}

export function getVehicleMarkerImage(vehicleKey: MapVehicleKey) {
  if (vehicleKey === 'toyo') {
    return images.toyoMedium;
  }

  if (vehicleKey === 'kirikuu') {
    return images.kirikuu;
  }

  return null;
}

export function getVehicleMarkerIcon(vehicleKey: MapVehicleKey): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  if (vehicleKey === 'kirikuu') {
    return 'truck-outline';
  }

  if (vehicleKey === 'toyo') {
    return 'moped';
  }

  return 'motorbike';
}

export function getVehicleMarkerLabel(vehicleKey: MapVehicleKey) {
  if (vehicleKey === 'kirikuu') {
    return 'Kirikuu';
  }

  if (vehicleKey === 'toyo') {
    return 'Toyo';
  }

  return 'Bodaboda';
}

export function MapStopPin({ kind, label }: { kind: 'pickup' | 'dropoff'; label?: string }) {
  const isPickup = kind === 'pickup';
  const caption = label || (isPickup ? 'Pickup' : 'Drop-off');

  return (
    <View style={styles.stopWrap} collapsable={false}>
      <View style={[styles.stopChip, isPickup ? styles.stopChipPickup : styles.stopChipDropoff]}>
        <Text style={[styles.stopChipText, isPickup ? styles.stopChipTextPickup : styles.stopChipTextDropoff]}>
          {caption}
        </Text>
      </View>
      <View style={[styles.stopHead, isPickup ? styles.stopHeadPickup : styles.stopHeadDropoff]}>
        <MaterialCommunityIcons
          name={isPickup ? 'package-variant-closed' : 'flag-checkered'}
          size={16}
          color="#FFFFFF"
        />
      </View>
      <View style={[styles.stopStem, isPickup ? styles.stopStemPickup : styles.stopStemDropoff]} />
      <View style={[styles.stopDot, isPickup ? styles.stopDotPickup : styles.stopDotDropoff]} />
    </View>
  );
}

export function VehicleDriverMarker({
  vehicleKey,
  assigned = false,
  label,
}: {
  vehicleKey: MapVehicleKey;
  assigned?: boolean;
  label?: string;
}) {
  const image = getVehicleMarkerImage(vehicleKey);
  const caption = label || getVehicleMarkerLabel(vehicleKey);

  return (
    <View style={styles.vehicleWrap} collapsable={false}>
      {assigned ? (
        <View style={styles.vehicleChip}>
          <Text style={styles.vehicleChipText}>{caption}</Text>
        </View>
      ) : null}
      <View style={[styles.vehicleCard, assigned && styles.vehicleCardAssigned]}>
        {image ? (
          <Image source={image} resizeMode="contain" fadeDuration={0} style={styles.vehicleImage} />
        ) : (
          <View style={styles.vehicleIconBadge}>
            <MaterialCommunityIcons name={getVehicleMarkerIcon(vehicleKey)} size={22} color="#FFFFFF" />
          </View>
        )}
      </View>
      <View style={[styles.vehicleStem, assigned && styles.vehicleStemAssigned]} />
      <View style={[styles.vehicleDot, assigned && styles.vehicleDotAssigned]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stopWrap: {
    alignItems: 'center',
  },
  stopChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
  },
  stopChipPickup: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  stopChipDropoff: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  stopChipText: {
    fontFamily: typography.bold,
    fontSize: 11,
    lineHeight: 14,
  },
  stopChipTextPickup: {
    color: '#166534',
  },
  stopChipTextDropoff: {
    color: '#1D4ED8',
  },
  stopHead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  stopHeadPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopHeadDropoff: {
    backgroundColor: '#2563EB',
  },
  stopStem: {
    width: 3,
    height: 10,
  },
  stopStemPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopStemDropoff: {
    backgroundColor: '#2563EB',
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: -2,
  },
  stopDotPickup: {
    backgroundColor: cargoTheme.colors.primary,
  },
  stopDotDropoff: {
    backgroundColor: '#2563EB',
  },
  vehicleWrap: {
    alignItems: 'center',
  },
  vehicleChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
  },
  vehicleChipText: {
    fontFamily: typography.bold,
    fontSize: 11,
    lineHeight: 14,
    color: cargoTheme.colors.text,
  },
  vehicleCard: {
    width: 58,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    overflow: 'hidden',
    paddingHorizontal: 4,
  },
  vehicleCardAssigned: {
    borderColor: cargoTheme.colors.primary,
    borderWidth: 2,
  },
  vehicleImage: {
    width: 52,
    height: 36,
  },
  vehicleIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleStem: {
    width: 3,
    height: 8,
    backgroundColor: cargoTheme.colors.text,
  },
  vehicleStemAssigned: {
    backgroundColor: cargoTheme.colors.primary,
  },
  vehicleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.text,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: -2,
  },
  vehicleDotAssigned: {
    backgroundColor: cargoTheme.colors.primary,
  },
});
