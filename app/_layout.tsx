import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';

import { CustomerPresenceTracker } from '@/components/customer-presence-tracker';
import { NinunulieShareListener } from '@/components/ninunulie-share-listener';
import { RouteErrorBoundary, ScreenErrorBoundary } from '@/components/ErrorBoundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { warmCustomerLocation } from '@/lib/customer-location';
import { preloadHomeImages } from '@/lib/images';
import {
  installGlobalErrorLogging,
  logAsyncFailure,
  logAsyncStart,
  logAsyncSuccess,
} from '@/lib/debug-logger';
import { recordAppActivity } from '@/lib/app-analytics';
import { AuthProvider, useAuthSession } from '@/providers/auth-provider';
import { LanguageProvider } from '@/providers/language-provider';
import { NotificationProvider } from '@/providers/notification-provider';

function hideNativeSplash() {
  try {
    logAsyncStart('RootLayout', 'hideSplash');
    ExpoSplashScreen.hideAsync()
      .then(() => {
        logAsyncSuccess('RootLayout', 'hideSplash');
      })
      .catch((error) => {
        logAsyncFailure('RootLayout', 'hideSplash', error);
      });
  } catch (error) {
    logAsyncFailure('RootLayout', 'hideSplash', error);
  }
}

// Never call preventAutoHideAsync — that holds the baked logo splash as its own page.
// Hide immediately at module load so yellow letter intro is the first real screen.
hideNativeSplash();
void ExpoSplashScreen.hideAsync().catch(() => undefined);
preloadHomeImages();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    InstrumentSerif_400Regular_Italic,
  });

  useEffect(() => {
    installGlobalErrorLogging();
  }, []);

  // Hide again on first paint — do not wait for fonts.
  useEffect(() => {
    hideNativeSplash();
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      logAsyncSuccess('RootLayout', 'loadFonts');
    }
    if (fontError) {
      logAsyncFailure('RootLayout', 'loadFonts', fontError);
    }
  }, [fontError, fontsLoaded]);

  // Never gate the tree on fonts — that leaves the logo splash up.
  const haulNavTheme = {
    ...(colorScheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(colorScheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      // Avoid a white/FAFAFA flash before the yellow letter intro mounts.
      background: '#FFE500',
      card: '#FFE500',
    },
  };

  return (
    <ThemeProvider value={haulNavTheme}>
      <ScreenErrorBoundary screenName="Root navigator">
        <AuthProvider>
          <UsageTracker />
          <CustomerPresenceTracker />
          <NinunulieShareListener />
          <LanguageProvider>
            <NotificationProvider>
              <View style={styles.rootCanvas}>
                <RootNavigator />
              </View>
            </NotificationProvider>
          </LanguageProvider>
        </AuthProvider>
      </ScreenErrorBoundary>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

function UsageTracker() {
  const pathname = usePathname();
  const { profile, user } = useAuthSession();
  const lastTrackedRef = useRef('');

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    warmCustomerLocation();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !pathname) {
      return;
    }

    const trackKey = `${user.uid}:${pathname}`;
    if (lastTrackedRef.current === trackKey) {
      return;
    }

    lastTrackedRef.current = trackKey;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        void recordAppActivity({
          userId: user.uid,
          userName: profile?.fullName || user.displayName || user.email || 'HAUL User',
          userRole: 'customer',
          eventName: 'screen_view',
          featureKey: pathname,
          featureLabel: pathname === '/' ? 'app start' : pathname.replace('/', ''),
          screen: pathname,
          route: pathname,
        });
      }, 900);
    });

    return () => {
      interactionTask.cancel();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [pathname, profile?.fullName, user?.displayName, user?.email, user?.uid]);

  return null;
}

function RootNavigator() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FFE500' },
        // No fade hop — cold start must not look like a second page before HAUL.
        animation: 'none',
      }}>
      <Stack.Screen name="index" options={{ animation: 'none' }} />
      <Stack.Screen name="splash" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="otp" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="terms" options={{ headerShown: false }} />
      <Stack.Screen name="privacy-policy" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' }, animation: 'fade' }} />
      <Stack.Screen name="explore" options={{ headerShown: false }} />
      <Stack.Screen name="menu" />
      <Stack.Screen name="send-parcel" />
      <Stack.Screen name="book-cargo" />
      <Stack.Screen name="ninunulie" options={{ headerShown: false }} />
      <Stack.Screen name="bus-tickets" options={{ headerShown: false }} />
      <Stack.Screen name="schedule" options={{ headerShown: false, contentStyle: { backgroundColor: '#F4F4F5' } }} />
      <Stack.Screen name="order-review" />
      <Stack.Screen name="track-order" />
      <Stack.Screen name="history" />
      <Stack.Screen name="finance" options={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }} />
      <Stack.Screen name="account" />
      <Stack.Screen name="emergency" options={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }} />
      <Stack.Screen name="language" options={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }} />
      <Stack.Screen name="saved-places" />
      <Stack.Screen name="policies" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="support-center" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  rootCanvas: {
    flex: 1,
    backgroundColor: '#FFE500',
  },
});
