import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';

type Props = {
  language: 'sw' | 'en';
  checking?: boolean;
  onRetry: () => void;
};

export function HomeOfflineState({ language, checking = false, onRetry }: Props) {
  const copy =
    language === 'sw'
      ? {
          title: 'Hakuna intaneti',
          text: 'Angalia muunganisho wako kisha jaribu tena.',
          retry: 'Jaribu tena',
        }
      : {
          title: 'No internet',
          text: 'Check your connection and try again.',
          retry: 'Try again',
        };

  return (
    <View style={styles.root}>
      <View style={styles.map}>
        <View style={[styles.road, styles.roadA]} />
        <View style={[styles.road, styles.roadB]} />
        <View style={[styles.road, styles.roadC]} />
        <View style={[styles.block, styles.blockA]} />
        <View style={[styles.block, styles.blockB]} />
        <View style={[styles.block, styles.blockC]} />
      </View>

      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.body}>
          <View style={styles.artWell}>
            <Image source={images.offlineSatelliteAvatar} style={styles.avatar} resizeMode="contain" />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.text}>{copy.text}</Text>
        </View>
      </SafeAreaView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.retry}
          disabled={checking}
          onPress={onRetry}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, checking && styles.buttonBusy]}>
          {checking ? (
            <ActivityIndicator color={cargoTheme.colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{copy.retry}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E8F0E3',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  road: {
    position: 'absolute',
    backgroundColor: '#F7F4EC',
  },
  roadA: {
    top: '18%',
    left: -40,
    right: -40,
    height: 28,
    transform: [{ rotate: '-8deg' }],
  },
  roadB: {
    top: '46%',
    left: '28%',
    width: 22,
    height: '70%',
    transform: [{ rotate: '14deg' }],
  },
  roadC: {
    top: '62%',
    left: -30,
    right: -20,
    height: 18,
    transform: [{ rotate: '4deg' }],
  },
  block: {
    position: 'absolute',
    backgroundColor: '#DCE6D6',
    borderRadius: 10,
  },
  blockA: {
    top: '12%',
    left: '8%',
    width: 88,
    height: 54,
  },
  blockB: {
    top: '28%',
    right: '10%',
    width: 72,
    height: 46,
  },
  blockC: {
    top: '52%',
    left: '14%',
    width: 64,
    height: 40,
  },
  safe: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  artWell: {
    width: 188,
    height: 188,
    borderRadius: 94,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 168,
    height: 168,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: typography.extrabold,
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  text: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: typography.body,
    color: '#4B5563',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  button: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonBusy: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
