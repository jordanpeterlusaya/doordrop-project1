import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

type RegionOutOfReachScreenProps = {
  avatar: ImageSourcePropType;
  title: string;
  text: string;
  hint: string;
  backLabel: string;
  checkingLabel: string;
  status: 'checking' | 'out-of-reach';
  glowColor?: string;
};

export function RegionOutOfReachScreen({
  avatar,
  title,
  text,
  hint,
  backLabel,
  checkingLabel,
  status,
  glowColor = '#DDF5E5',
}: RegionOutOfReachScreenProps) {
  const router = useRouter();
  const isOutOfReach = status === 'out-of-reach';

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4FAF6" />
      <View style={[styles.glow, { backgroundColor: glowColor }]} />
      <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={handleBack}>
        <MaterialCommunityIcons name="arrow-left" size={22} color="#0F172A" />
      </TouchableOpacity>
      <View style={styles.body}>
        {isOutOfReach ? (
          <>
            <View style={styles.artWell}>
              <Image source={avatar} style={styles.avatar} resizeMode="contain" />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.text}>{text}</Text>
            <Text style={styles.hint}>{hint}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => router.replace('/home')}>
              <Text style={styles.buttonText}>{backLabel}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={cargoTheme.colors.primary} />
            <Text style={styles.checking}>{checkingLabel}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4FAF6',
  },
  glow: {
    position: 'absolute',
    top: -80,
    alignSelf: 'center',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.7,
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: 18,
    marginTop: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3EEE7',
    zIndex: 2,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 56,
  },
  artWell: {
    width: 280,
    height: 280,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: '#14532D',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  avatar: {
    width: 230,
    height: 230,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  text: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#475569',
    textAlign: 'center',
  },
  hint: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
    textAlign: 'center',
  },
  checking: {
    marginTop: 16,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#64748B',
    textAlign: 'center',
  },
  button: {
    marginTop: 28,
    minHeight: cargoTheme.cta.minHeight,
    minWidth: 220,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
