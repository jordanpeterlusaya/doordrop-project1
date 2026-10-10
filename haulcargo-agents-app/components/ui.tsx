import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

export function Screen({
  children,
  scroll,
  style,
  padBottom = 24,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  padBottom?: number;
}) {
  const insets = useSafeAreaInsets();
  const content = (
    <View style={[styles.screenInner, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + padBottom }, style]}>
      {children}
    </View>
  );
  if (scroll) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.scrollGrow} keyboardShouldPersistTaps="handled">
        {content}
      </ScrollView>
    );
  }
  return <View style={styles.screen}>{content}</View>;
}

export function Header({ title, back }: { title: string; back?: boolean }) {
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.ink} />
        </Pressable>
      ) : (
        <View style={styles.backSpacer} />
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.backSpacer} />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'green' | 'outline' | 'danger';
}) {
  const resolved = variant === 'green' ? 'primary' : variant;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        resolved === 'primary' && styles.btnPrimary,
        resolved === 'outline' && styles.btnOutline,
        resolved === 'danger' && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={resolved === 'outline' ? theme.ink : theme.white} />
      ) : (
        <Text style={[styles.btnText, resolved === 'outline' && styles.btnTextOutline]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={theme.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.white },
  screenInner: { flex: 1, paddingHorizontal: 20 },
  scrollGrow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: { width: 36 },
  backSpacer: { width: 36 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  btn: {
    borderRadius: theme.cta.borderRadius,
    paddingVertical: 14,
    paddingHorizontal: theme.cta.paddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.cta.minHeight,
  },
  btnPrimary: { backgroundColor: theme.cta.backgroundColor },
  btnOutline: { backgroundColor: theme.white, borderWidth: 1.5, borderColor: theme.line },
  btnDanger: { backgroundColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.88 },
  btnText: {
    color: theme.cta.labelColor,
    fontSize: theme.cta.labelSize,
    lineHeight: theme.cta.labelLineHeight,
    fontFamily: typography.bold,
    letterSpacing: theme.cta.letterSpacing,
  },
  btnTextOutline: { color: theme.ink },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: typography.body,
    backgroundColor: theme.white,
    color: theme.ink,
  },
  card: {
    backgroundColor: theme.tile,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 12,
  },
  muted: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: typography.bold,
    color: theme.ink,
    marginBottom: 10,
    marginTop: 4,
    letterSpacing: -0.2,
  },
});
