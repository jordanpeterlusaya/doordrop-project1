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

/** Page chrome aligned with HAUL customer CargoScreen / CargoHeader. */
export function Screen({
  children,
  scroll,
  style,
  contentStyle,
  padBottom = 28,
  /** Tab screens already sit above a safe tab bar — pad top only. */
  edges = 'all',
  backgroundColor = theme.white,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  padBottom?: number;
  edges?: 'all' | 'top';
  backgroundColor?: string;
}) {
  const insets = useSafeAreaInsets();
  const paddingTop = insets.top + 8;
  const paddingBottom = edges === 'top' ? padBottom : insets.bottom + padBottom;

  const inner = (
    <View
      style={[
        styles.screenInner,
        { paddingTop, paddingBottom, backgroundColor },
        contentStyle,
        style,
      ]}>
      {children}
    </View>
  );

  if (scroll) {
    return (
      <ScrollView
        style={[styles.screen, { backgroundColor }]}
        contentContainerStyle={styles.scrollGrow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
        {inner}
      </ScrollView>
    );
  }

  return <View style={[styles.screen, { backgroundColor }]}>{inner}</View>;
}

export function Header({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={theme.ink} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <View style={styles.headerSpacer} />
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
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
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={({ pressed }) => [
        styles.btn,
        resolved === 'primary' && styles.btnPrimary,
        resolved === 'outline' && styles.btnOutline,
        resolved === 'danger' && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={resolved === 'outline' || resolved === 'primary' ? theme.ink : theme.white}
        />
      ) : (
        <Text
          style={[
            styles.btnText,
            resolved === 'outline' && styles.btnTextOutline,
            resolved === 'primary' && styles.btnTextPrimary,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.muted}
        style={[styles.input, error ? styles.inputError : null]}
        {...props}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
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

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {children}
    </View>
  );
}

export function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function SettingsRow({
  icon,
  title,
  value,
  destructive,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  destructive?: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.settingsRow, pressed && styles.btnPressed]}>
        <Ionicons name={icon} size={22} color={destructive ? theme.danger : theme.ink} />
        <Text style={[styles.settingsTitle, destructive && styles.settingsTitleDanger]}>{title}</Text>
        {value ? <Text style={styles.settingsValue}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={18} color={destructive ? '#FCA5A5' : '#94A3B8'} />
      </Pressable>
      {!last ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.white },
  screenInner: { flexGrow: 1, paddingHorizontal: 20 },
  scrollGrow: { flexGrow: 1 },
  header: {
    paddingTop: 4,
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 40, height: 40 },
  headerTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.ident,
    color: theme.ink,
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: theme.muted,
  },
  btn: {
    borderRadius: theme.cta.borderRadius,
    paddingVertical: 14,
    paddingHorizontal: theme.cta.paddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.cta.minHeight,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnPrimary: {
    backgroundColor: theme.cta.backgroundColor,
    borderColor: theme.cta.backgroundColor,
  },
  btnOutline: {
    backgroundColor: theme.white,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  btnDanger: { backgroundColor: theme.danger, borderColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.88 },
  btnText: {
    color: theme.white,
    fontSize: theme.cta.labelSize,
    lineHeight: theme.cta.labelLineHeight,
    fontFamily: typography.bold,
    letterSpacing: theme.cta.letterSpacing,
  },
  btnTextPrimary: { color: theme.cta.labelColor },
  btnTextOutline: { color: theme.ink },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 6,
  },
  input: {
    borderWidth: 0,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: typography.body,
    backgroundColor: theme.tile,
    color: theme.ink,
  },
  inputError: { borderColor: theme.danger },
  fieldError: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: typography.semibold,
    color: theme.danger,
  },
  fieldHint: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: typography.body,
    color: theme.muted,
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
    fontSize: 12,
    fontFamily: typography.semibold,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 8,
  },
  empty: {
    paddingVertical: 36,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
    backgroundColor: theme.tile,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: typography.bold,
    fontSize: 17,
    lineHeight: 22,
    color: theme.ink,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptyBody: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.muted,
    textAlign: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: theme.tile,
  },
  chipOn: { backgroundColor: theme.ink },
  chipText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  chipTextOn: { color: theme.primary },
  settingsRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  settingsTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
  settingsTitleDanger: { color: theme.danger },
  settingsValue: {
    fontSize: 14,
    fontFamily: typography.body,
    color: theme.muted,
    marginRight: 2,
    maxWidth: '40%',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.line,
    marginLeft: 48,
  },
});
