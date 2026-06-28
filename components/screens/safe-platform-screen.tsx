import { useRouter } from 'expo-router';
import type { ComponentType } from 'react';
import React, { useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ScreenErrorBoundary } from '@/components/ErrorBoundary';
import { CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { recordCargoDiagnostic } from '@/lib/cargo-diagnostics';
import { logError, logInfo } from '@/lib/debug-logger';

type ScreenModule = {
  default: ComponentType;
};

type SafePlatformScreenProps = {
  loadNative: () => ScreenModule;
  loadWeb?: () => ScreenModule;
  screenName: string;
};

export function SafePlatformScreen({ loadNative, loadWeb, screenName }: SafePlatformScreenProps) {
  const router = useRouter();
  const fallbackRoute = screenName === 'Home' ? '/explore' : '/home';
  const fallbackLabel = screenName === 'Home' ? 'Open explore' : 'Go to home';
  const didLogLoadStart = useRef(false);
  const didLogLoadSuccess = useRef(false);

  const isCargoScreen = screenName === 'Book cargo';

  if (isCargoScreen && !didLogLoadStart.current) {
    didLogLoadStart.current = true;
    recordCargoDiagnostic('safe-platform:book-cargo:load-start', { platform: Platform.OS });
    logInfo('SafePlatformScreen', 'book-cargo load start', { platform: Platform.OS });
  }

  try {
    const module = Platform.OS === 'web' && loadWeb ? loadWeb() : loadNative();
    const Screen = module.default;

    if (isCargoScreen && !didLogLoadSuccess.current) {
      didLogLoadSuccess.current = true;
      recordCargoDiagnostic('safe-platform:book-cargo:load-success', {
        hasDefaultExport: Boolean(Screen),
        platform: Platform.OS,
      });
      logInfo('SafePlatformScreen', 'book-cargo load success', {
        hasDefaultExport: Boolean(Screen),
        platform: Platform.OS,
      });
    }

    return (
      <ScreenErrorBoundary screenName={screenName}>
        <Screen />
      </ScreenErrorBoundary>
    );
  } catch (error) {
    if (isCargoScreen) {
      recordCargoDiagnostic('safe-platform:book-cargo:load-failure', {
        error: error instanceof Error ? error.message : String(error),
        platform: Platform.OS,
        screenName,
      });
    }

    logError('SafePlatformScreen', `failed to load ${screenName} screen`, error, {
      platform: Platform.OS,
      screenName,
    });

    return (
      <CargoScreen contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>{screenName} is temporarily unavailable</Text>
          <Text style={styles.body}>
            This build skipped a screen module that did not load safely on the current device. The
            rest of the app can still open.
          </Text>
          <PrimaryButton label={fallbackLabel} onPress={() => router.replace(fallbackRoute)} />
        </View>
      </CargoScreen>
    );
  }
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 32,
  },
  card: {
    borderRadius: 28,
    padding: 20,
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  title: {
    color: cargoTheme.colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.extrabold,
  },
  body: {
    color: cargoTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 21,
  },
});
