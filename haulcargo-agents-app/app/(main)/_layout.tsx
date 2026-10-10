import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function MainTabsLayout() {
  const { user, initializing, needsCompanySetup, carrier, isAdmin } = useCarrierSession();

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.primary }}>
        <ActivityIndicator color={theme.ink} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/" />;
  if (needsCompanySetup) return <Redirect href="/register-company" />;
  if (!carrier && !isAdmin) return <Redirect href="/register-company" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.ink,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: {
          fontFamily: typography.semibold,
          fontSize: 11,
        },
        tabBarStyle: {
          borderTopColor: theme.line,
          backgroundColor: theme.white,
          height: 62,
          paddingTop: 4,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Muhtasari',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Oda',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="manifest"
        options={{
          title: 'Orodha',
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="fedha"
        options={{
          title: 'Fedha',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Mipangilio',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
