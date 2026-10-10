import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LandingScreen() {
  const { user, initializing, needsCompanySetup, carrier } = useCarrierSession();

  if (initializing) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator size="large" color={theme.green} />
      </Screen>
    );
  }

  if (user) {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  return (
    <Screen scroll padBottom={32}>
      <LinearGradient colors={['#14532d', '#166534']} style={styles.hero}>
        <Text style={styles.brand}>Haul Cargo Agents</Text>
        <Text style={styles.tagline}>Makampuni ya usafirishaji yapokee mizigo ya HAUL — simamia oda, safari, na fedha mahali pamoja.</Text>
      </LinearGradient>
      <View style={styles.body}>
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>H</Text>
          </View>
          <Text style={styles.lead}>
            Unganisha na wateja wa DoorDrop/HAUL, kubali oda ndani ya dakika 5, fuata eneo la kuchukua mzigo, na simamia manifesti yako.
          </Text>
        </View>
        <PrimaryButton label="Ingia" onPress={() => router.push('/login')} />
        <View style={styles.gap} />
        <PrimaryButton label="Jisajili kampuni" variant="outline" onPress={() => router.push('/register')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  hero: { marginHorizontal: -20, paddingHorizontal: 24, paddingVertical: 36, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  brand: { fontSize: 26, fontWeight: '800', color: theme.white, marginBottom: 10 },
  tagline: { fontSize: 15, lineHeight: 22, color: '#dcfce7' },
  body: { marginTop: 28, flex: 1 },
  logoRow: { flexDirection: 'row', gap: 14, marginBottom: 28, alignItems: 'flex-start' },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: { color: theme.white, fontSize: 22, fontWeight: '800' },
  lead: { flex: 1, fontSize: 14, lineHeight: 21, color: theme.muted },
  gap: { height: 12 },
});
