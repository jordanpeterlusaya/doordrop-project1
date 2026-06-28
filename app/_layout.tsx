import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, Text, View } from 'react-native';

import { RouteErrorBoundary, ScreenErrorBoundary } from '@/components/ErrorBoundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

function keepNativeSplashVisible() {
  try {
    void ExpoSplashScreen.preventAutoHideAsync().catch((error) => {
      logAsyncFailure('RootLayout', 'preventAutoHideAsync', error);
    });
  } catch (error) {
    logAsyncFailure('RootLayout', 'preventAutoHideAsync', error);
  }
}

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

keepNativeSplashVisible();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const appAssetsReady = fontsLoaded || Boolean(fontError) || startupTimedOut;

  useEffect(() => {
    installGlobalErrorLogging();
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setStartupTimedOut(true);
    }, 700);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      logAsyncSuccess('RootLayout', 'loadFonts');
    }

    if (fontError) {
      logAsyncFailure('RootLayout', 'loadFonts', fontError);
    }
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (!appAssetsReady) {
      return;
    }

    hideNativeSplash();
  }, [appAssetsReady]);

  if (!appAssetsReady) {
    return <StartupFallback />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ScreenErrorBoundary screenName="Root navigator">
        <AuthProvider>
          <UsageTracker />
          <LanguageProvider>
            <NotificationProvider>
              <RootNavigator />
            </NotificationProvider>
          </LanguageProvider>
        </AuthProvider>
      </ScreenErrorBoundary>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function StartupFallback() {
  return (
    <View style={styles.startupRoot}>
      <Text style={styles.startupTitle}>DoorDrop</Text>
      <View style={styles.startupTrack}>
        <View style={styles.startupFill} />
      </View>
    </View>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

function UsageTracker() {
  const pathname = usePathname();
  const { profile, user } = useAuthSession();
  const lastTrackedRef = useRef('');

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
          userName: profile?.fullName || user.displayName || user.email || 'DoorDrop User',
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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="splash" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="terms" options={{ headerShown: false }} />
      <Stack.Screen name="privacy-policy" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="explore" options={{ headerShown: false }} />
      <Stack.Screen name="menu" />
      <Stack.Screen name="send-parcel" />
      <Stack.Screen name="book-cargo" />
      <Stack.Screen name="order-review" />
      <Stack.Screen name="track-order" />
      <Stack.Screen name="history" />
      <Stack.Screen name="account" />
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
  startupRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#16A34A',
  },
  startupTitle: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '800',
    lineHeight: 48,
    marginBottom: 22,
  },
  startupTrack: {
    width: '72%',
    maxWidth: 280,
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  startupFill: {
    width: '58%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
});
