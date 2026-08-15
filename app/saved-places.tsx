import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme, type CargoIcon } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess } from '@/lib/debug-logger';
import { useAppCopy } from '@/lib/app-copy';
import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';
import { type SavedPlace } from '@/lib/saved-places';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const SAVED_PLACES_KEY = 'doordrop.savedPlaces';
const screenScope = 'SavedPlacesScreen';

const placeTypeOptions: { label: string; icon: CargoIcon }[] = [
  { label: 'Home', icon: 'home-outline' },
  { label: 'Office', icon: 'briefcase-outline' },
  { label: 'Shop', icon: 'storefront-outline' },
  { label: 'Other', icon: 'map-marker-outline' },
];

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SavedPlacesScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const [selectedType, setSelectedType] = useState(placeTypeOptions[0]);
  const [customLabel, setCustomLabel] = useState('');
  const [address, setAddress] = useState('');
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadSavedPlaces = async () => {
      try {
        logAsyncStart(screenScope, 'loadSavedPlaces');
        const storedValue = await getPersistedItem(SAVED_PLACES_KEY);
        const parsedValue = storedValue ? (JSON.parse(storedValue) as SavedPlace[]) : [];

        if (active) {
          setSavedPlaces(Array.isArray(parsedValue) ? parsedValue : []);
        }
        logAsyncSuccess(screenScope, 'loadSavedPlaces', {
          count: Array.isArray(parsedValue) ? parsedValue.length : 0,
        });
      } catch (error) {
        logAsyncFailure(screenScope, 'loadSavedPlaces', error);
        if (active) {
          setSavedPlaces([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadSavedPlaces();

    return () => {
      active = false;
    };
  }, []);

  const resolvedLabel = useMemo(() => {
    if (selectedType.label === 'Other') {
      return customLabel.trim();
    }

    return selectedType.label;
  }, [customLabel, selectedType.label]);

  const formIsValid = resolvedLabel.length >= 2 && address.trim().length >= 6;

  const persistPlaces = async (nextPlaces: SavedPlace[]) => {
    logAsyncStart(screenScope, 'persistPlaces', { count: nextPlaces.length });
    setSavedPlaces(nextPlaces);
    await setPersistedItem(SAVED_PLACES_KEY, JSON.stringify(nextPlaces));
    logAsyncSuccess(screenScope, 'persistPlaces', { count: nextPlaces.length });
  };

  const handleAddPlace = async () => {
    if (!formIsValid) {
      Alert.alert(copy.savedPlaces.incompleteTitle, copy.savedPlaces.incompleteText);
      return;
    }

    const nextPlace: SavedPlace = {
      id: buildId(),
      label: resolvedLabel,
      address: address.trim(),
      icon: selectedType.icon,
    };

    try {
      await persistPlaces([nextPlace, ...savedPlaces]);
      setAddress('');
      setCustomLabel('');
      setSelectedType(placeTypeOptions[0]);
    } catch (error) {
      logAsyncFailure(screenScope, 'handleAddPlace', error, { label: nextPlace.label });
      Alert.alert(copy.savedPlaces.saveFailed, copy.savedPlaces.saveFailedText);
    }
  };

  const handleDeletePlace = (placeId: string) => {
    Alert.alert(copy.savedPlaces.removeTitle, copy.savedPlaces.removeText, [
      { text: copy.savedPlaces.keep, style: 'cancel' },
      {
        text: copy.savedPlaces.remove,
        style: 'destructive',
        onPress: () => {
          void persistPlaces(savedPlaces.filter((place) => place.id !== placeId));
        },
      },
    ]);
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title={copy.savedPlaces.title} onLeftPress={() => router.back()} />

      <View style={styles.typeRow}>
        {placeTypeOptions.map((option) => {
          const isSelected = selectedType.label === option.label;
          return (
            <Pressable
              key={option.label}
              onPress={() => setSelectedType(option)}
              style={[styles.typeChip, isSelected && styles.typeChipSelected]}>
              <Text style={[styles.typeChipText, isSelected && styles.typeChipTextSelected]}>
                {option.label === 'Home'
                  ? copy.savedPlaces.home
                  : option.label === 'Office'
                    ? copy.savedPlaces.office
                    : option.label === 'Shop'
                      ? copy.savedPlaces.shop
                      : copy.savedPlaces.other}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selectedType.label === 'Other' ? (
        <TextInput
          value={customLabel}
          onChangeText={setCustomLabel}
          placeholder={copy.savedPlaces.placeName}
          placeholderTextColor="#94A3B8"
          style={styles.input}
        />
      ) : null}

      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder={copy.savedPlaces.address}
        placeholderTextColor="#94A3B8"
        style={styles.input}
      />

      <PrimaryButton
        label={copy.common.save}
        onPress={() => void handleAddPlace()}
        style={!formIsValid ? styles.saveDisabled : undefined}
      />

      <Text style={styles.sectionTitle}>{copy.savedPlaces.yourPlaces}</Text>

      {loading ? <Text style={styles.emptyText}>{copy.common.loading}</Text> : null}

      {!loading && savedPlaces.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="map-marker-outline" size={28} color="#94A3B8" />
          <Text style={styles.emptyText}>{copy.savedPlaces.empty}</Text>
        </View>
      ) : null}

      {!loading && savedPlaces.length > 0 ? (
        <View style={styles.listCard}>
          {savedPlaces.map((place, index) => (
            <View key={place.id} style={[styles.placeRow, index > 0 && styles.placeBorder]}>
              <View style={styles.placeIcon}>
                <MaterialCommunityIcons name={place.icon} size={20} color={cargoTheme.colors.text} />
              </View>
              <View style={styles.placeCopy}>
                <Text numberOfLines={1} style={styles.placeTitle}>
                  {place.label}
                </Text>
                <Text numberOfLines={2} style={styles.placeSubtitle}>
                  {place.address}
                </Text>
              </View>
              <TouchableOpacity hitSlop={10} onPress={() => handleDeletePlace(place.id)}>
                <MaterialCommunityIcons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  typeChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeChipSelected: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#F0FDF4',
  },
  typeChipText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  typeChipTextSelected: {
    color: cargoTheme.colors.primaryDark,
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
    marginBottom: 12,
  },
  saveDisabled: {
    opacity: 0.55,
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 10,
    marginLeft: 4,
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    overflow: 'hidden',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  placeBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EEF4',
  },
  placeIcon: {
    width: 32,
    alignItems: 'center',
  },
  placeCopy: {
    flex: 1,
    minWidth: 0,
  },
  placeTitle: {
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  placeSubtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
});
