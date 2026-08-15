import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage, type AppLanguage } from '@/providers/language-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

function AccountScreenContent() {
  const router = useRouter();
  const { profile, profileLoading, signOut, user } = useAuthSession();
  const { language, loading: languageLoading, setLanguage } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);
  const isSw = language === 'sw';

  const copy = {
    title: isSw ? 'Akaunti' : 'Account',
    editProfile: isSw ? 'Hariri wasifu' : 'Edit profile',
    language: isSw ? 'Lugha' : 'Language',
    savedPlaces: isSw ? 'Maeneo yaliyohifadhiwa' : 'Saved places',
    help: isSw ? 'Msaada' : 'Help',
    policies: isSw ? 'Sera' : 'Policies',
    signOut: isSw ? 'Toka' : 'Sign out',
    signingOut: isSw ? 'Inatoka...' : 'Signing out...',
    login: isSw ? 'Ingia' : 'Login',
    notSignedIn: isSw ? 'Haujaingia' : 'Not signed in',
    signOutFailedTitle: isSw ? 'Imeshindikana kutoka' : 'Sign out failed',
    signOutFailedMessage: isSw ? 'Tafadhali jaribu tena.' : 'Please try again.',
  };

  const profileName = profile?.fullName?.trim() || user?.displayName?.trim() || 'DoorDrop';
  const profileMeta = user?.email?.trim() || profile?.phoneNumber?.trim() || copy.notSignedIn;
  const initials = useMemo(() => {
    const source = profile?.fullName?.trim() || user?.displayName?.trim() || user?.email?.trim() || 'DD';
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [profile?.fullName, user?.displayName, user?.email]);

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } catch {
      Alert.alert(copy.signOutFailedTitle, copy.signOutFailedMessage);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content} footer={<BottomNav activeTab="account" />}>
      <CargoHeader title={copy.title} leftAction="menu" onLeftPress={() => router.push('/menu')} />

      <TouchableOpacity activeOpacity={0.88} style={styles.profileRow} onPress={() => router.push('/profile-edit')}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text numberOfLines={1} style={styles.profileName}>
            {profileLoading ? '...' : profileName}
          </Text>
          <Text numberOfLines={1} style={styles.profileMeta}>
            {profileMeta}
          </Text>
        </View>
        <Text style={styles.editLink}>{copy.editProfile}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>{copy.language}</Text>
      <View style={styles.languageRow}>
        {([
          { value: 'en' as const, label: 'English' },
          { value: 'sw' as const, label: 'Kiswahili' },
        ]).map((option) => {
          const selected = language === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              activeOpacity={0.88}
              disabled={languageLoading}
              style={[styles.languageChip, selected && styles.languageChipSelected]}
              onPress={() => {
                void setLanguage(option.value as AppLanguage);
              }}>
              <Text style={[styles.languageChipText, selected && styles.languageChipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.listCard}>
        <TouchableOpacity activeOpacity={0.88} style={styles.listRow} onPress={() => router.push('/saved-places')}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="bookmark-outline" size={20} color={cargoTheme.colors.text} />
          </View>
          <Text style={styles.listTitle}>{copy.savedPlaces}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.88}
          style={[styles.listRow, styles.listRowBorder]}
          onPress={() => router.push('/support-center')}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="lifebuoy" size={20} color={cargoTheme.colors.text} />
          </View>
          <Text style={styles.listTitle}>{copy.help}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.88}
          style={[styles.listRow, styles.listRowBorder]}
          onPress={() => router.push('/policies')}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={cargoTheme.colors.text} />
          </View>
          <Text style={styles.listTitle}>{copy.policies}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {user ? (
        <TouchableOpacity activeOpacity={0.88} style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>{signingOut ? copy.signingOut : copy.signOut}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity activeOpacity={0.88} style={styles.signOutButton} onPress={() => router.push('/login')}>
          <Text style={styles.loginText}>{copy.login}</Text>
        </TouchableOpacity>
      )}
    </CargoScreen>
  );
}

export default function AccountScreen() {
  return (
    <AuthSessionBoundary>
      <AccountScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
  editLink: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 22,
  },
  languageChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageChipSelected: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#F0FDF4',
  },
  languageChipText: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  languageChipTextSelected: {
    color: cargoTheme.colors.primaryDark,
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
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 12,
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
