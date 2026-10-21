import React from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

type Props = {
  visible: boolean;
  title?: string;
  message: string;
  onDismiss: () => void;
  /** Timed notices close when the dim area is tapped. The Kataa confirm does not. */
  dismissOnBackdrop?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryBusy?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

/**
 * Light page that slides up from the bottom.
 * Desk warnings only — not an OS notification, banner, or pinned notice.
 */
export function WarningSheet({
  visible,
  title,
  message,
  onDismiss,
  dismissOnBackdrop = false,
  primaryLabel,
  onPrimary,
  primaryBusy = false,
  secondaryLabel,
  onSecondary,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const leave = () => {
    if (onSecondary) onSecondary();
    else onDismiss();
  };
  const maxHeight = Math.max(220, height - insets.top - 96);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismissOnBackdrop ? onDismiss : leave}>
      <View style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdrop ? onDismiss : undefined}
          accessibilityRole={dismissOnBackdrop ? 'button' : undefined}
          accessibilityLabel={dismissOnBackdrop ? 'Funga' : undefined}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), maxHeight }]}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <Text style={title ? styles.body : styles.lead}>{message}</Text>
          {primaryLabel && onPrimary ? (
            <Pressable
              onPress={onPrimary}
              disabled={primaryBusy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, primaryBusy && styles.primaryBusy]}>
              <Text style={styles.primaryText}>{primaryBusy ? 'Inaendelea…' : primaryLabel}</Text>
            </Pressable>
          ) : null}
          {secondaryLabel ? (
            <Pressable
              onPress={leave}
              disabled={primaryBusy}
              accessibilityRole="button"
              style={styles.secondary}>
              <Text style={styles.secondaryText}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    marginBottom: 16,
  },
  title: {
    fontFamily: typography.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: theme.ink,
  },
  lead: {
    fontFamily: typography.semibold,
    fontSize: 17,
    lineHeight: 24,
    color: theme.ink,
  },
  body: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 16,
    lineHeight: 23,
    color: theme.ink,
  },
  primary: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryPressed: { backgroundColor: '#1A1A1A' },
  primaryBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  primaryText: {
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  secondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryText: {
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: theme.muted,
  },
});
