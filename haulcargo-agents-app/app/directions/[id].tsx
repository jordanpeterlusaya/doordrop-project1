import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { Header, Muted, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { dropOffLabel, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function DirectionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments } = useCarrierSession();
  const item = shipments.find((s) => s.id === id);
  const [agent, setAgent] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Ruhusa ya eneo hairuhusiwi.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setAgent({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    })();
  }, []);

  if (!item) {
    return (
      <Screen>
        <Header title="Maelekezo" back />
        <Muted>Oda haipatikani.</Muted>
      </Screen>
    );
  }

  const pickupLat = Number(item.pickupLatitude);
  const pickupLng = Number(item.pickupLongitude);
  const hasCoords = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);

  const openExternalNav = () => {
    if (!hasCoords) return;
    const url = Platform.select({
      ios: `maps://?daddr=${pickupLat},${pickupLng}`,
      android: `google.navigation:q=${pickupLat},${pickupLng}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${pickupLat},${pickupLng}`,
    });
    if (url) void Linking.openURL(url);
  };

  const region =
    hasCoords && agent
      ? {
          latitude: (agent.latitude + pickupLat) / 2,
          longitude: (agent.longitude + pickupLng) / 2,
          latitudeDelta: Math.max(0.05, Math.abs(agent.latitude - pickupLat) * 2.5),
          longitudeDelta: Math.max(0.05, Math.abs(agent.longitude - pickupLng) * 2.5),
        }
      : hasCoords
        ? { latitude: pickupLat, longitude: pickupLng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
        : null;

  return (
    <Screen style={styles.flex} padBottom={16}>
      <Header title="Eneo la oda" back />
      <Text style={styles.code}>{shipmentCode(item)}</Text>
      <Muted>{dropOffLabel(item)}</Muted>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {!hasCoords ? (
        <Muted style={styles.pad}>GPS ya mteja haipatikani bado. Wasiliana na mtumaji kwa simu.</Muted>
      ) : (
        <>
          <View style={styles.mapWrap}>
            {region ? (
              <MapView style={styles.map} provider={PROVIDER_GOOGLE} initialRegion={region}>
                <Marker coordinate={{ latitude: pickupLat, longitude: pickupLng }} title="Oda ilipo" pinColor={theme.green} />
                {agent ? <Marker coordinate={agent} title="Wewe" pinColor={theme.charcoal} /> : null}
                {agent ? (
                  <Polyline
                    coordinates={[
                      { latitude: agent.latitude, longitude: agent.longitude },
                      { latitude: pickupLat, longitude: pickupLng },
                    ]}
                    strokeColor={theme.green}
                    strokeWidth={4}
                  />
                ) : null}
              </MapView>
            ) : null}
          </View>
          <PrimaryButton label="Fungua navigation" onPress={openExternalNav} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  code: { fontSize: 18, fontWeight: '800', color: theme.charcoal, marginTop: 8 },
  pad: { marginTop: 16 },
  err: { color: theme.danger, marginTop: 8 },
  mapWrap: { flex: 1, marginVertical: 16, borderRadius: 14, overflow: 'hidden', minHeight: 320 },
  map: { flex: 1 },
});
