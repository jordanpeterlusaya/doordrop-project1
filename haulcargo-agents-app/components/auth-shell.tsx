import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
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
};

export function AuthShell({ title, subtitle, children, back = true, footer, contentStyle }: Props) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // Mount marker for subtle enter animations via Reanimated entering props.
  }, []);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#FFF8C2', '#FFFFFF', '#F7F7F5']}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(420)} style={styles.topRow}>
            {back ? (
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                hitSlop={12}
                style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={theme.ink} />
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

          <Animated.View entering={FadeInUp.delay(80).duration(480)} style={[styles.hero, contentStyle]}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(140).duration(500)} style={styles.card}>
            {children}
          </Animated.View>

          {footer ? (
            <Animated.View entering={FadeInUp.delay(200).duration(480)} style={styles.footer}>
              {footer}
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.white },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 28, height: 28 },
  brandMark: {
    fontFamily: typography.ident,
    fontSize: 22,
    letterSpacing: -0.6,
    color: theme.ink,
  },
  hero: { marginBottom: 18 },
  title: {
    fontFamily: typography.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: theme.ink,
  },
  subtitle: {
    marginTop: 8,
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: theme.muted,
  },
  card: {
    backgroundColor: theme.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
  },
  footer: { marginTop: 18, alignItems: 'center' },
});
