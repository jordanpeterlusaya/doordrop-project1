import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

const TAB_ICONS = {
  index: { idle: 'home-outline', active: 'home' },
  orders: { idle: 'cube-outline', active: 'cube' },
  manifest: { idle: 'list-outline', active: 'list' },
  fedha: { idle: 'wallet-outline', active: 'wallet' },
  settings: { idle: 'person-outline', active: 'person' },
} as const;

export default function MainTabsLayout() {
  const { user, initializing, needsCompanySetup, carrier, isAdmin } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 6);

  if (initializing) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={theme.ink} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/" />;
  if (needsCompanySetup) return <Redirect href="/register-company" />;
  if (!carrier && !isAdmin) return <Redirect href="/register-company" />;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.ink,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: [
          styles.tabBar,
          {
            height: 54 + bottomPad,
            paddingBottom: bottomPad,
          },
        ],
        tabBarIcon: ({ color, focused }) => {
          const icons = TAB_ICONS[route.name as keyof typeof TAB_ICONS];
          if (!icons) return null;
          return <Ionicons name={focused ? icons.active : icons.idle} size={24} color={color} />;
        },
      })}>
      <Tabs.Screen name="index" options={{ title: 'Nyumbani' }} />
      <Tabs.Screen name="orders" options={{ title: 'Oda' }} />
      <Tabs.Screen name="manifest" options={{ title: 'Orodha' }} />
      <Tabs.Screen name="fedha" options={{ title: 'Fedha' }} />
      <Tabs.Screen name="settings" options={{ title: 'Akaunti' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.primary,
  },
  tabBar: {
    borderTopColor: theme.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.white,
    paddingTop: 8,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabLabel: {
    fontFamily: typography.medium,
    fontSize: 11,
    lineHeight: 14,
  },
});
