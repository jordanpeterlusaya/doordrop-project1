import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { getNotificationPresentation } from '@/lib/notification-presentation';
import type { UserNotification } from '@/lib/user-notifications';

const AUTO_DISMISS_MS = 4500;

export function InAppBanner({
  notification,
  onPress,
  onDismiss,
}: {
  notification: UserNotification | null;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!notification) {
      return;
    }

    translateY.setValue(-120);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 84 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    const timeoutId = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timeoutId);
  }, [notification, onDismiss, opacity, translateY]);

  if (!notification) {
    return null;
  }

  const presentation = getNotificationPresentation({
    type: notification.type,
    orderStatus: notification.orderStatus,
  });
  const topInset = Math.max(insets.top, StatusBar.currentHeight ?? 0, 8) + 6;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.wrap, { paddingTop: topInset, opacity, transform: [{ translateY }] }]}>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" onPress={onPress} style={styles.cardPress}>
            <View style={[styles.iconWrap, { backgroundColor: presentation.tint }]}>
              <MaterialCommunityIcons name={presentation.icon} size={20} color={presentation.iconColor} />
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} style={styles.title}>
                {notification.title}
              </Text>
              <Text numberOfLines={2} style={styles.message}>
                {notification.message}
              </Text>
            </View>
          </Pressable>
          <TouchableOpacity
            accessibilityLabel="Dismiss"
            hitSlop={10}
            onPress={onDismiss}
            style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={18} color={cargoTheme.colors.subtext} />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
  },
  wrap: {
    paddingHorizontal: 14,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 6,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  cardPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingVertical: 2,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: typography.bold,
    fontSize: 14,
    color: cargoTheme.colors.text,
  },
  message: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: cargoTheme.colors.subtext,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
