import { useSegments } from 'expo-router';
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

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

/** Icon row in app/(main)/_layout.tsx. The rest of the bar is the system inset. */
const TAB_BAR_BODY = 54;

/**
 * Light page that slides up from the bottom.
 * Desk warnings only — not an OS notification, banner, or pinned notice.
 * On the main tabs the copy sits above the tab bar, which is drawn over the system nav.
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
  const { height, width } = useWindowDimensions();
  const segments = useSegments() as string[];
  const onTabs = segments.includes('(main)');
  const topInset = Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0);
  const bottomInset = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  const tabBarHeight = TAB_BAR_BODY + Math.max(bottomInset, Platform.OS === 'android' ? 10 : 6);
  // Short copy used to land inside the tab bar and under the 3-button nav.
  const bottomGap = onTabs ? tabBarHeight : Math.max(bottomInset, 16) + (Platform.OS === 'android' ? 12 : 0);
  const leave = () => {
    if (onSecondary) onSecondary();
    else onDismiss();
  };
  const maxHeight = Math.max(280, Math.min(height * 0.72, height - topInset - 120));
  const bodyMax = Math.max(96, maxHeight - bottomGap - 120);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismissOnBackdrop ? onDismiss : leave}>
      <View style={[styles.flex, { width }]}>
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdrop ? onDismiss : undefined}
          accessibilityRole={dismissOnBackdrop ? 'button' : undefined}
          accessibilityLabel={dismissOnBackdrop ? 'Funga' : undefined}
        />
        <View style={[styles.sheet, { width, maxHeight, paddingBottom: bottomGap }]}>
          <View style={styles.handle} />
          <ScrollView
            style={{ maxHeight: bodyMax, flexGrow: 0 }}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text accessibilityRole="alert" style={title ? styles.body : styles.lead}>
              {message}
            </Text>
          </ScrollView>
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
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 10,
    zIndex: 2,
    elevation: 16,
  },
  scrollContent: { flexGrow: 0 },
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
