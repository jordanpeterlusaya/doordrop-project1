import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme, type CargoIcon } from '@/constants/cargo-theme';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess } from '@/lib/debug-logger';
import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';
import { type SavedPlace } from '@/lib/saved-places';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const SAVED_PLACES_KEY = 'doordrop.savedPlaces';
const screenScope = 'SavedPlacesScreen';

const placeTypeOptions: { label: string; icon: CargoIcon }[] = [
  { label: 'Home', icon: 'home-map-marker' },
  { label: 'Office', icon: 'office-building-marker-outline' },
  { label: 'Shop', icon: 'storefront-outline' },
  { label: 'Other', icon: 'map-marker-outline' },
];

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SavedPlacesScreen() {
  const router = useRouter();
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
      Alert.alert('Incomplete details', 'Enter a place name and a clear address before saving.');
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
      Alert.alert('Unable to save place', 'Please try saving this place again.');
    }
  };

  const handleDeletePlace = (placeId: string) => {
    Alert.alert('Remove saved place?', 'This place will no longer appear in your account shortcuts.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void persistPlaces(savedPlaces.filter((place) => place.id !== placeId));
        },
      },
    ]);
  };

  return (
    <CargoScreen contentContainerStyle={styles.content}>
      <CargoHeader
        title="Saved places"
        subtitle="Add your own common pickup and drop-off locations."
        onLeftPress={() => router.back()}
      />

      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Save your own places</Text>
        <Text style={styles.heroText}>
          Add places you use often so booking becomes faster each time you open DoorDrop.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Add a place</Text>
        <View style={styles.typeGrid}>
          {placeTypeOptions.map((option) => {
            const isSelected = selectedType.label === option.label;

            return (
              <Pressable
                key={option.label}
                onPress={() => setSelectedType(option)}
                style={[styles.typeChip, isSelected && styles.typeChipSelected]}>
                <MaterialCommunityIcons
                  name={option.icon}
                  size={18}
                  color={isSelected ? cargoTheme.colors.primaryDark : cargoTheme.colors.subtext}
                />
                <Text style={[styles.typeChipText, isSelected && styles.typeChipTextSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {selectedType.label === 'Other' ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Place name</Text>
            <TextInput
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="Warehouse, Auntie's home, Store..."
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Enter the full address or landmark"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
        </View>

        <PrimaryButton label="Save place" icon="content-save-outline" onPress={() => void handleAddPlace()} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your places</Text>

        {loading ? <Text style={styles.emptyText}>Loading your saved places...</Text> : null}

        {!loading && savedPlaces.length === 0 ? (
          <Text style={styles.emptyText}>No saved places yet. Add your first place above.</Text>
        ) : null}

        {!loading
          ? savedPlaces.map((place, index) => (
              <View key={place.id} style={[styles.placeRow, index !== savedPlaces.length - 1 && styles.rowBorder]}>
                <View style={styles.placeLeading}>
                  <View style={styles.placeIconWrap}>
                    <MaterialCommunityIcons name={place.icon} size={20} color={cargoTheme.colors.primaryDark} />
                  </View>
                  <View style={styles.placeCopy}>
                    <Text style={styles.placeTitle}>{place.label}</Text>
                    <Text style={styles.placeSubtitle}>{place.address}</Text>
                  </View>
                </View>

                <Pressable style={styles.deleteButton} onPress={() => handleDeletePlace(place.id)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#DC2626" />
                </Pressable>
              </View>
            ))
          : null}
      </View>
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
  },
  heroCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 20,
    marginBottom: 18,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroText: {
    color: '#D6E0EA',
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    padding: 18,
    marginBottom: 18,
    gap: 14,
  },
  sectionTitle: {
    color: cargoTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  typeChipSelected: {
    borderColor: '#86EFAC',
    backgroundColor: cargoTheme.colors.primarySoft,
  },
  typeChipText: {
    color: cargoTheme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  typeChipTextSelected: {
    color: cargoTheme.colors.primaryDark,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: cargoTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 16,
    fontSize: 15,
    color: cargoTheme.colors.text,
  },
  emptyText: {
    color: cargoTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  placeLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  placeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: cargoTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeCopy: {
    flex: 1,
    gap: 3,
  },
  placeTitle: {
    color: cargoTheme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  placeSubtitle: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },
});
