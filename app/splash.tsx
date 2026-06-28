import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';

import { typography } from '@/constants/typography';
import { logError } from '@/lib/debug-logger';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const splashDurationMs = 1500;

export default function SplashScreen() {
  const router = useRouter();
  const navigationCommittedRef = useRef(false);
  const [progressPercent, setProgressPercent] = useState(12);

  useEffect(() => {
    let currentProgress = 12;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const progressTimer = setInterval(() => {
      currentProgress = Math.min(currentProgress + 8, 96);
      setProgressPercent(currentProgress);
    }, 120);

    const navigateFromSplash = () => {
      if (navigationCommittedRef.current) {
        return;
      }

      navigationCommittedRef.current = true;
      setProgressPercent(100);
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
      clearInterval(progressTimer);
      clearTimeout(navigationTimer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#22C55E" />

      <View style={styles.copyWrap}>
        <Text style={styles.title}>DoorDrop</Text>
        <Text style={styles.subtitle}>
          Fast, reliable cargo and parcel delivery services at your fingertips. Track your shipments in real-time and enjoy seamless logistics solutions.
        </Text>
      </View>

      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.loaderText}>Loading DoorDrop...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#16A34A',
  },
  copyWrap: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 26,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 56,
    fontFamily: typography.extrabold,
    lineHeight: 60,
  },
  subtitle: {
    color: '#E8F5E9',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 340,
    fontWeight: '500',
  },
  progressWrap: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 280,
    gap: 12,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  loaderText: {
    color: '#ECFDF5',
    fontSize: 13,
    fontFamily: typography.bold,
    textAlign: 'center',
  },
});
