import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, Image, StatusBar, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { logError } from '@/lib/debug-logger';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const splashDurationMs = 4000;
const splashGreen = cargoTheme.colors.primary;
const logo = require('@/assets/images/doordrop.png');

export default function SplashScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const navigationCommittedRef = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    Animated.timing(progress, {
      toValue: 1,
      duration: splashDurationMs,
      useNativeDriver: false,
    }).start();

    const navigateFromSplash = () => {
      if (navigationCommittedRef.current) {
        return;
      }

      navigationCommittedRef.current = true;
      try {
        router.replace('/home');
      } catch (error) {
        navigationCommittedRef.current = false;
        logError('SplashScreen', 'failed to navigate from splash', error);
        retryCount += 1;

        if (retryCount <= 6) {
          retryTimer = setTimeout(navigateFromSplash, 300);
        }
      }
    };

    const navigationTimer = setTimeout(navigateFromSplash, splashDurationMs);

    return () => {
      clearTimeout(navigationTimer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [progress, router]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['16%', '100%'],
  });
  const contentOpacity = progress.interpolate({
    inputRange: [0, 0.18, 1],
    outputRange: [0, 1, 1],
  });

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={splashGreen} />

      <Animated.View style={[styles.center, { opacity: contentOpacity }]}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tagline}>{copy.splash.tagline}</Text>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: splashGreen,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 128,
    height: 128,
    borderRadius: 32,
  },
  tagline: {
    marginTop: 20,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.medium,
    color: 'rgba(255, 255, 255, 0.92)',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 56,
    paddingBottom: 40,
  },
  progressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
});
