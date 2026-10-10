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
          <Ionicons name="chevron-back" size={24} color={theme.charcoal} />
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
  variant = 'green',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'green' | 'outline' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant === 'green' && styles.btnGreen,
        variant === 'outline' && styles.btnOutline,
        variant === 'danger' && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}>
      {loading ? <ActivityIndicator color={variant === 'outline' ? theme.green : theme.white} /> : <Text style={[styles.btnText, variant === 'outline' && styles.btnTextOutline]}>{label}</Text>}
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
  screen: { flex: 1, backgroundColor: theme.bg },
  screenInner: { flex: 1, paddingHorizontal: 20 },
  scrollGrow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: { width: 36 },
  backSpacer: { width: 36 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: theme.charcoal },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnGreen: { backgroundColor: theme.green },
  btnOutline: { backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border },
  btnDanger: { backgroundColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.88 },
  btnText: { color: theme.white, fontSize: 16, fontWeight: '700' },
  btnTextOutline: { color: theme.green },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: theme.charcoal, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: theme.white,
    color: theme.charcoal,
  },
  card: {
    backgroundColor: theme.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 12,
  },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: theme.charcoal, marginBottom: 10, marginTop: 4 },
});
