import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

/** Legacy route. Company setup is part of registration, never a post-login gate. */
export default function RegisterCompanyScreen() {
  const { user, initializing, carrier } = useCarrierSession();

  if (initializing) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;
  if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
  return <Redirect href="/(main)" />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
  },
});
