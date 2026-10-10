import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  back?: boolean;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Centered OTP-style layout (more vertical space, tighter card). */
  centered?: boolean;
};

export function AuthShell({
  title,
  subtitle,
  children,
  back = true,
  footer,
  contentStyle,
  centered = false,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            centered && styles.scrollCentered,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(380)} style={styles.topRow}>
            {back ? (
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={theme.ink} />
              </Pressable>
            ) : (
              <View style={styles.backBtn} />
            )}
            <View style={styles.brand}>
              <Image source={images.haulLogo} style={styles.logo} resizeMode="contain" />
              <Text style={styles.brandMark}>HAUL</Text>
            </View>
            <View style={styles.backBtn} />
          </Animated.View>

          <Animated.View
            entering={FadeInUp.delay(60).duration(420)}
            style={[styles.hero, centered && styles.heroCentered, contentStyle]}>
            <Text style={[styles.title, centered && styles.titleCentered]}>{title}</Text>
            {subtitle ? (
              <Text style={[styles.subtitle, centered && styles.subtitleCentered]}>{subtitle}</Text>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(120).duration(440)} style={styles.card}>
            {children}
          </Animated.View>

          {footer ? (
            <Animated.View entering={FadeInUp.delay(160).duration(420)} style={styles.footer}>
              {footer}
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1 },
  scrollCentered: { justifyContent: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 28, height: 28 },
  brandMark: {
    fontFamily: typography.ident,
    fontSize: 22,
    letterSpacing: -0.6,
    color: theme.ink,
  },
  hero: { marginBottom: 20 },
  heroCentered: { alignItems: 'center' },
  title: {
    fontFamily: typography.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: theme.ink,
  },
  titleCentered: { textAlign: 'center', fontSize: 24 },
  subtitle: {
    marginTop: 8,
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: theme.muted,
  },
  subtitleCentered: { textAlign: 'center', maxWidth: 280 },
  card: {
    backgroundColor: theme.white,
    borderRadius: 24,
    padding: 22,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  footer: { marginTop: 20, alignItems: 'center' },
});
