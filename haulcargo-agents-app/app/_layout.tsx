import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import { CarrierSessionProvider } from '@/providers/carrier-session';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <CarrierSessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="register-company" />
          <Stack.Screen name="(main)" />
          <Stack.Screen name="schedule" options={{ presentation: 'modal' }} />
          <Stack.Screen name="history" />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="directions/[id]" />
          <Stack.Screen name="receipt/[id]" />
          <Stack.Screen name="admin/verify" />
        </Stack>
      </CarrierSessionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
