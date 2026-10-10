import 'react-native-gesture-handler';
import 'react-native-reanimated';

import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View } from 'react-native';

import { CarrierSessionProvider } from '@/providers/carrier-session';

function hideNativeSplash() {
  void ExpoSplashScreen.hideAsync().catch(() => undefined);
}

// Prefer yellow letter intro over the baked logo splash page.
hideNativeSplash();

export default function RootLayout() {
  useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    InstrumentSerif_400Regular_Italic,
  });

  useEffect(() => {
    hideNativeSplash();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <CarrierSessionProvider>
        <View style={styles.canvas}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: styles.stack }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="register-company" />
            <Stack.Screen name="verification-pending" />
            <Stack.Screen name="(main)" />
            <Stack.Screen name="schedule" options={{ presentation: 'modal' }} />
            <Stack.Screen name="history" />
            <Stack.Screen name="order/[id]" />
            <Stack.Screen name="directions/[id]" />
            <Stack.Screen name="receipt/[id]" />
            <Stack.Screen name="admin/verify" />
          </Stack>
        </View>
      </CarrierSessionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1, backgroundColor: '#FFE500' },
  stack: { backgroundColor: '#FFE500' },
});
