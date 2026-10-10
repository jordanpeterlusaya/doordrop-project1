import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { createCarrierFromRegistration } from '@/lib/carrier-registration';
import { auth } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function RegisterCompanyScreen() {
  const { user, needsCompanySetup, refreshCarrier } = useCarrierSession();
  const [companyName, setCompanyName] = useState('');
  const [routeOrigin, setRouteOrigin] = useState('Dar es Salaam');
  const [routeDestination, setRouteDestination] = useState('');
  const [routeDepart, setRouteDepart] = useState('08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState('500');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return <Redirect href="/login" />;
  if (!needsCompanySetup) return <Redirect href="/(main)" />;

  return (
    <Screen scroll>
      <Header title="Kamilisha kampuni" back />
      <Text style={styles.sub}>Akaunti yako haijaunganishwa na kampuni. Weka taarifa za usafirishaji.</Text>
      <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
      <Field label="Kutoka" value={routeOrigin} onChangeText={setRouteOrigin} />
      <Field label="Kwenda" value={routeDestination} onChangeText={setRouteDestination} />
      <Field label="Muda wa kuondoka" value={routeDepart} onChangeText={setRouteDepart} />
      <Field label="Uwezo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi"
        loading={loading}
        onPress={async () => {
          if (!companyName.trim() || !routeDestination.trim()) {
            setError('Jaza jina na marudio.');
            return;
          }
          setLoading(true);
          try {
            const email = user.email?.trim().toLowerCase() || '';
            await createCarrierFromRegistration(user, {
              companyName,
              routeOrigin,
              routeDestination,
              routeDepart,
              cargoCapacityKg: Number(cargoCapacityKg) || 0,
            }, email);
            await refreshCarrier();
            router.replace('/(main)');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Imeshindwa.');
          } finally {
            setLoading(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: theme.muted, marginBottom: 16, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 12 },
});
