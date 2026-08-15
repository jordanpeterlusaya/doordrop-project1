import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme, menuSections } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

function getInitials(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return 'DD';
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function MenuScreenContent() {
  const router = useRouter();
  const { profile, signOut, user } = useAuthSession();
  const copy = useAppCopy();
  const displayName = profile?.fullName?.trim() || user?.displayName?.trim() || 'DoorDrop';
  const displayMeta = user?.email?.trim() || profile?.phoneNumber?.trim() || copy.menu.notSignedIn;
  const initials = useMemo(() => getInitials(displayName), [displayName]);

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/login');
    } catch {
      Alert.alert(copy.menu.signOutFailed, copy.menu.tryAgain);
    }
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title={copy.menu.title} leftAction="close" onLeftPress={() => router.back()} />

      <View style={styles.profileRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text numberOfLines={1} style={styles.profileName}>
            {displayName}
          </Text>
          <Text numberOfLines={1} style={styles.profileMeta}>
            {displayMeta}
          </Text>
        </View>
      </View>

      {menuSections.map((section, sectionIndex) => (
        <View key={section.title ?? `section-${sectionIndex}`} style={styles.section}>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
          <View style={styles.listCard}>
            {section.items.map((item, index) => (
              <TouchableOpacity
                key={item.title}
                activeOpacity={0.88}
                style={[styles.listRow, index > 0 && styles.listRowBorder]}
                onPress={() => router.push(item.route)}>
                <View style={styles.listIcon}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={cargoTheme.colors.text} />
                </View>
                <Text style={styles.listTitle}>
                  {item.route === '/account'
                    ? copy.menu.account
                    : item.route === '/saved-places'
                      ? copy.menu.savedPlaces
                      : item.route === '/notifications'
                        ? copy.menu.notifications
                        : item.route === '/support-center'
                          ? copy.menu.help
                          : copy.menu.policies}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {user ? (
        <TouchableOpacity activeOpacity={0.88} style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>{copy.menu.signOut}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          activeOpacity={0.88}
          style={styles.signOutButton}
          onPress={() => router.push('/login')}>
          <Text style={styles.loginText}>{copy.common.login}</Text>
        </TouchableOpacity>
      )}
    </CargoScreen>
  );
}

export default function MenuScreen() {
  return (
    <AuthSessionBoundary>
      <MenuScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.primaryDark,
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.3,
  },
  profileMeta: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    overflow: 'hidden',
  },
  listRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EEF4',
  },
  listIcon: {
    width: 32,
    alignItems: 'center',
    marginRight: 12,
  },
  listTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  signOutButton: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  signOutText: {
    fontSize: 15,
    fontFamily: typography.bold,
    color: '#DC2626',
  },
  loginText: {
    fontSize: 15,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
});
