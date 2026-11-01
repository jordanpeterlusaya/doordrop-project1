import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme, type CargoIcon } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

type TileKey = 'safety' | 'inbox';

const TILES: { key: TileKey; icon: CargoIcon; route: '/emergency' | '/notifications' }[] = [
  { key: 'safety', icon: 'shield-check-outline', route: '/emergency' },
  { key: 'inbox', icon: 'email-outline', route: '/notifications' },
];

function SettingsRow({
  icon,
  title,
  value,
  destructive,
  onPress,
}: {
  icon: CargoIcon;
  title: string;
  value?: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.88} style={styles.settingsRow} onPress={onPress}>
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={destructive ? '#DC2626' : cargoTheme.colors.text}
      />
      <Text style={[styles.settingsTitle, destructive && styles.settingsTitleDestructive]}>{title}</Text>
      {value ? <Text style={styles.settingsValue}>{value}</Text> : null}
      <MaterialCommunityIcons name="chevron-right" size={20} color={destructive ? '#FCA5A5' : '#94A3B8'} />
    </TouchableOpacity>
  );
}

function AccountScreenContent() {
  const router = useRouter();
  const copy = useAppCopy();
  const { profile, profileLoading, signOut, user } = useAuthSession();
  const { language } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);

  const signedIn = Boolean(user);
  const profileName = signedIn
    ? profile?.fullName?.trim() || user?.displayName?.trim() || copy.account.guestName
    : copy.account.guestName;
  const profileMeta = signedIn
    ? user?.email?.trim() || profile?.phoneNumber?.trim() || ''
    : copy.account.guestMeta;
  const initials = useMemo(() => {
    if (!signedIn) {
      return '';
    }

    const source = profile?.fullName?.trim() || user?.displayName?.trim() || user?.email?.trim() || '';
    const letters = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
    return letters || 'H';
  }, [profile?.fullName, signedIn, user?.displayName, user?.email]);

  const languageValue =
    language === 'sw' ? copy.account.languageKiswahili : copy.account.languageEnglish;

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } catch {
      Alert.alert(copy.account.signOutFailedTitle, copy.account.signOutFailedMessage);
    } finally {
      setSigningOut(false);
    }
  };

  const openProfile = () => {
    router.push(signedIn ? '/profile-edit' : '/login');
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content} footer={<BottomNav activeTab="account" embedInSafeFooter />}>
      <TouchableOpacity activeOpacity={0.88} style={styles.identityRow} onPress={openProfile}>
        <View style={styles.identityCopy}>
          <Text numberOfLines={2} style={styles.displayName}>
            {profileLoading && signedIn ? '...' : profileName}
          </Text>
          {profileMeta ? (
            <Text numberOfLines={2} style={styles.displayMeta}>
              {profileMeta}
            </Text>
          ) : null}
        </View>
        <View style={styles.avatar}>
          {signedIn && initials ? (
            <Text style={styles.avatarText}>{initials}</Text>
          ) : (
            <MaterialCommunityIcons name="account-outline" size={28} color={cargoTheme.colors.text} />
          )}
        </View>
      </TouchableOpacity>

      <View style={styles.tileGrid}>
        <View style={styles.tileRow}>
          {TILES.map((tile) => (
            <TouchableOpacity
              key={tile.key}
              activeOpacity={0.88}
              style={styles.tile}
              onPress={() => router.push(tile.route)}>
              <MaterialCommunityIcons name={tile.icon} size={22} color={cargoTheme.colors.text} />
              <Text style={styles.tileLabel}>{copy.account[tile.key]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{copy.account.settings}</Text>
      <View style={styles.group}>
        <SettingsRow
          icon="translate"
          title={copy.account.language}
          value={languageValue}
          onPress={() => router.push('/language')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="bell-outline"
          title={copy.account.notifications}
          onPress={() => router.push('/notifications')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="map-marker-outline"
          title={copy.account.savedPlaces}
          onPress={() => router.push('/saved-places')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow icon="account-edit-outline" title={copy.account.editProfile} onPress={openProfile} />
        {signedIn ? (
          <>
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="lock-outline"
              title={copy.account.changePassword}
              onPress={() => router.push('/change-password')}
            />
          </>
        ) : null}
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="file-document-outline"
          title={copy.account.policies}
          onPress={() => router.push('/policies')}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon="lifebuoy"
          title={copy.account.help}
          onPress={() => router.push('/support-center')}
        />
      </View>

      <View style={[styles.group, styles.groupSpaced]}>
        {signedIn ? (
          <SettingsRow
            icon="logout"
            title={signingOut ? copy.account.signingOut : copy.account.signOut}
            destructive
            onPress={() => void handleSignOut()}
          />
        ) : (
          <SettingsRow icon="login" title={copy.account.login} onPress={() => router.push('/login')} />
        )}
      </View>
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
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 22,
    gap: 14,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: typography.ident,
    color: cargoTheme.colors.text,
    letterSpacing: -0.8,
  },
  displayMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3F4F6',
    borderWidth: 2,
    borderColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontFamily: typography.ident,
    color: cargoTheme.colors.text,
  },
  tileGrid: {
    gap: 10,
    marginBottom: 22,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    minHeight: 88,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: 'space-between',
    gap: 12,
  },
  tileLabel: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
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
  group: {
    backgroundColor: '#F3F4F6',
    borderRadius: 18,
    overflow: 'hidden',
  },
  groupSpaced: {
    marginTop: 12,
  },
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
    color: cargoTheme.colors.text,
  },
  settingsTitleDestructive: {
    color: '#DC2626',
  },
  settingsValue: {
    fontSize: 14,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginRight: 2,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginLeft: 48,
  },
});
