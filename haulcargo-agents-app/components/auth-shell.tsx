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
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  back?: boolean;
  onBack?: () => void;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
  centered?: boolean;
  /** Compact step label under brand, e.g. "Step 1 of 3". */
  stepLabel?: string;
};

export function AuthShell({
  title,
  subtitle,
  children,
  back = true,
  onBack,
  footer,
  contentStyle,
  centered = false,
  stepLabel,
}: Props) {
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

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
            { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(320)} style={styles.topRow}>
            {back ? (
              <Pressable
                onPress={handleBack}
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
              <View style={styles.logoWrap}>
                <Image source={images.haulLogo} style={styles.logo} resizeMode="contain" />
                <View style={styles.brandDot} />
              </View>
              <Text style={styles.brandMark}>HAUL</Text>
            </View>
            <View style={styles.backBtn} />
          </Animated.View>

          {stepLabel ? (
            <Animated.Text entering={FadeIn.duration(280)} style={styles.stepLabel}>
              {stepLabel}
            </Animated.Text>
          ) : null}

          <Animated.View
            entering={FadeInUp.delay(40).duration(360)}
            style={[styles.hero, centered && styles.heroCentered, contentStyle]}>
            <Text style={[styles.title, centered && styles.titleCentered]}>{title}</Text>
            {subtitle ? (
              <Text style={[styles.subtitle, centered && styles.subtitleCentered]}>{subtitle}</Text>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(90).duration(380)} style={styles.form}>
            {children}
          </Animated.View>

          {footer ? (
            <Animated.View entering={FadeInUp.delay(130).duration(360)} style={styles.footer}>
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
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  scrollCentered: { justifyContent: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.white,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoWrap: { position: 'relative' },
  logo: { width: 22, height: 22 },
  brandDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.brandYellow,
  },
  brandMark: {
    fontFamily: typography.ident,
    fontSize: 17,
    letterSpacing: 0.4,
    color: theme.navy,
  },
  stepLabel: {
    fontFamily: typography.semibold,
    fontSize: 12,
    letterSpacing: 0.3,
    color: theme.muted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  hero: { marginBottom: 22 },
  heroCentered: { alignItems: 'center' },
  title: {
    fontFamily: typography.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: theme.ink,
  },
  titleCentered: { textAlign: 'center', fontSize: 22 },
  subtitle: {
    marginTop: 8,
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.muted,
  },
  subtitleCentered: { textAlign: 'center', maxWidth: 300 },
  form: {
    backgroundColor: 'transparent',
  },
  footer: { marginTop: 22, alignItems: 'center' },
});
