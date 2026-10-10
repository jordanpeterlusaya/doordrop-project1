import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

export default function MainTabsLayout() {
  const { user, initializing, needsCompanySetup, carrier, isAdmin } = useCarrierSession();

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.green} size="large" />
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
        tabBarActiveTintColor: theme.green,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { borderTopColor: theme.border, backgroundColor: theme.white },
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
