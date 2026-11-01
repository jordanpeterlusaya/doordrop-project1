import React from 'react';
import { StyleSheet, View } from 'react-native';

import { driveTheme } from '../constants/drive-theme';

type Tone = 'brand' | 'warm' | 'cool' | 'dark';

const toneStyles: Record<Tone, { glowA: string; glowB: string; ring: string }> = {
  brand: {
    glowA: 'rgba(5,150,105,0.18)',
    glowB: 'rgba(16,185,129,0.12)',
    ring: 'rgba(5,150,105,0.14)',
  },
  warm: {
    glowA: 'rgba(234,88,12,0.16)',
    glowB: 'rgba(251,191,36,0.12)',
    ring: 'rgba(234,88,12,0.14)',
  },
  cool: {
    glowA: 'rgba(37,99,235,0.14)',
    glowB: 'rgba(14,165,233,0.10)',
    ring: 'rgba(37,99,235,0.12)',
  },
  dark: {
    glowA: 'rgba(9,9,11,0.08)',
    glowB: 'rgba(24,24,27,0.06)',
    ring: 'rgba(9,9,11,0.08)',
  },
};

export function DriveGraphicBackdrop({
  children,
  tone = 'brand',
  style,
}: {
  children: React.ReactNode;
  tone?: Tone;
  style?: object;
}) {
  const palette = toneStyles[tone];

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.glowA, { backgroundColor: palette.glowA }]} />
      <View style={[styles.glowB, { backgroundColor: palette.glowB }]} />
      <View style={[styles.ring, { borderColor: palette.ring }]} />
      {children}
    </View>
  );
}

export function DriveAvatarStage({
  children,
  tone = 'brand',
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <DriveGraphicBackdrop tone={tone} style={styles.stage}>
      {children}
    </DriveGraphicBackdrop>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  glowA: {
    position: 'absolute',
    top: -18,
    right: -10,
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  glowB: {
    position: 'absolute',
    bottom: -12,
    left: -14,
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  ring: {
    position: 'absolute',
    inset: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
});
