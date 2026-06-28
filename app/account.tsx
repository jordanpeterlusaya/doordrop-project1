import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoHeader, MenuRow, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage, type AppLanguage } from '@/providers/language-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

function AccountScreenContent() {
  const router = useRouter();
  const { authMethod, profile, profileLoading, signOut, user } = useAuthSession();
  const { language, loading: languageLoading, setLanguage } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);
  const copy = useMemo(
    () =>
      language === 'sw'
        ? {
            title: 'Akaunti',
            subtitle: 'Dhibiti maelezo ya wasifu, mapendeleo ya malipo, maeneo yaliyohifadhiwa na msaada.',
            profileRefreshing: 'Inasasisha wasifu...',
            phoneOnFile: 'Namba iliyohifadhiwa',
            googleConnected: 'Akaunti ya Google imeunganishwa',
            emailConnected: 'Akaunti ya barua pepe imeunganishwa',
            guestMode: 'Hali ya matumizi ya mgeni',
            editProfile: 'Hariri wasifu',
            ratingLabel: 'Ukadiriaji wa programu',
            deliveriesLabel: 'Jumla ya usafirishaji',
            sections: [
              {
                title: 'Wasifu',
                items: [
                  { label: 'Wasifu wa biashara', value: 'DoorDrop Studio' },
                  { label: 'Namba kuu ya simu', value: '+255 742 000 111' },
                  { label: 'Malipo ya msingi', value: 'Lipa wakati wa kupokea' },
                ],
              },
              {
                title: 'Mapendeleo',
                items: [
                  { label: 'Anwani zilizohifadhiwa', value: 'Maeneo 3' },
                  { label: 'Arifa', value: 'Oda, ETA ya dereva, promosheni' },
                  { label: 'Msaada', value: 'Msaada wa ndani ya app saa 24/7' },
                ],
              },
            ],
            languageTitle: 'Lugha',
            languageSubtitle: 'Chagua lugha ya kuonyesha kwenye ukurasa wa nyumbani na sehemu kuu za akaunti.',
            languageOptions: [
              { value: 'en' as const, label: 'English' },
              { value: 'sw' as const, label: 'Kiswahili' },
            ],
            selectedLabel: 'Imechaguliwa',
            savedPlacesTitle: 'Maeneo yaliyohifadhiwa',
            savedPlacesSubtitle: 'Nyumbani, ofisi, ghala na sehemu unazopendelea za kushusha mizigo',
            savedPlacesTrailing: 'Maeneo 3',
            profileEditingTitle: 'Uhariri wa wasifu',
            profileEditingSubtitle: 'Sasisha jina la biashara, mawasiliano na mipangilio ya arifa',
            supportTitle: 'Kituo cha msaada',
            supportSubtitle: 'Piga gumzo na msaada, piga dispatch au pitia mwongozo wa usalama',
            policiesTitle: 'Sera',
            policiesSubtitle: 'Pitia masharti, faragha na sera za ulinzi wa usafirishaji',
            signOut: 'Toka',
            signingOut: 'Inatoka...',
            signOutFailedTitle: 'Imeshindikana kutoka',
            signOutFailedMessage: 'Tafadhali jaribu tena.',
          }
        : {
            title: 'Account',
            subtitle: 'Manage profile details, payment preferences, saved places and support.',
            profileRefreshing: 'Refreshing profile...',
            phoneOnFile: 'Phone on file',
            googleConnected: 'Google account connected',
            emailConnected: 'Email account connected',
            guestMode: 'Guest browsing mode',
            editProfile: 'Edit profile',
            ratingLabel: 'App rating',
            deliveriesLabel: 'Total deliveries',
            sections: [
              {
                title: 'Profile',
                items: [
                  { label: 'Business profile', value: 'DoorDrop Studio' },
                  { label: 'Primary phone', value: '+255 742 000 111' },
                  { label: 'Default payment', value: 'Cash on delivery' },
                ],
              },
              {
                title: 'Preferences',
                items: [
                  { label: 'Saved addresses', value: '3 places' },
                  { label: 'Notifications', value: 'Orders, driver ETA, promos' },
                  { label: 'Support', value: '24/7 in-app help' },
                ],
              },
            ],
            languageTitle: 'Language',
            languageSubtitle: 'Choose the language used on the homepage and key account screens.',
            languageOptions: [
              { value: 'en' as const, label: 'English' },
              { value: 'sw' as const, label: 'Swahili' },
            ],
            selectedLabel: 'Selected',
            savedPlacesTitle: 'Saved places',
            savedPlacesSubtitle: 'Home, office, warehouse and favorite customer drop-offs',
            savedPlacesTrailing: '3 saved',
            profileEditingTitle: 'Profile editing',
            profileEditingSubtitle: 'Update business name, contact details and notification settings',
            supportTitle: 'Support center',
            supportSubtitle: 'Chat with support, call dispatch or review safety guidance',
            policiesTitle: 'Policies',
            policiesSubtitle: 'Review terms, privacy and delivery protection policies',
            signOut: 'Sign out',
            signingOut: 'Signing out...',
            signOutFailedTitle: 'Sign out failed',
            signOutFailedMessage: 'Please try again.',
          },
    [language]
  );

  const initials = useMemo(() => {
    const source = profile?.fullName?.trim() || user?.displayName?.trim() || user?.email?.trim() || 'DoorDrop User';
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [profile?.fullName, user?.displayName, user?.email]);

  const profileName = profile?.fullName?.trim() || user?.displayName?.trim() || 'DoorDrop User';
  const profileMeta = user?.email || 'Signed in with Google';

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
    <CargoScreen contentContainerStyle={styles.content} footer={<BottomNav activeTab="account" />}>
      <CargoHeader
        title={copy.title}
        subtitle={copy.subtitle}
        leftAction="menu"
        onLeftPress={() => router.push('/menu')}
        rightIcon="history"
        onRightPress={() => router.push('/history')}
      />

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.profileName}>{profileName}</Text>
        <Text style={styles.profileMeta}>{profileMeta}</Text>
        <Text style={styles.verificationBadge}>
          {profileLoading
            ? copy.profileRefreshing
            : profile?.phoneNumber
              ? `${copy.phoneOnFile}: ${profile.phoneNumber}`
              : authMethod === 'google'
                ? copy.googleConnected
                : authMethod === 'email'
                  ? copy.emailConnected
                  : copy.guestMode}
        </Text>
        <TouchableOpacity style={styles.editProfileButton} onPress={() => router.push('/profile-edit')}>
          <Text style={styles.editProfileText}>{copy.editProfile}</Text>
        </TouchableOpacity>
        <View style={styles.profileStats}>
          <View style={styles.profileStat}>
            <Text style={styles.profileStatValue}>4.9</Text>
            <Text style={styles.profileStatLabel}>{copy.ratingLabel}</Text>
          </View>
          <View style={styles.profileDivider} />
          <View style={styles.profileStat}>
            <Text style={styles.profileStatValue}>63</Text>
            <Text style={styles.profileStatLabel}>{copy.deliveriesLabel}</Text>
          </View>
        </View>
      </View>

      {copy.sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.sectionCard}>
            {section.items.map((item, index) => (
              <View key={item.label} style={[styles.detailRow, index !== section.items.length - 1 && styles.detailRowBorder]}>
                <Text style={styles.detailLabel}>{item.label}</Text>
                <Text style={styles.detailValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.languageTitle}</Text>
        <View style={styles.languageCard}>
          <Text style={styles.languageSubtitle}>{copy.languageSubtitle}</Text>
          <View style={styles.languageOptions}>
            {copy.languageOptions.map((option) => {
              const selected = language === option.value;

              return (
                <TouchableOpacity
                  key={option.value}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: languageLoading, selected }}
                  disabled={languageLoading}
                  style={[styles.languageOption, selected && styles.languageOptionSelected]}
                  onPress={() => {
                    void setLanguage(option.value as AppLanguage);
                  }}>
                  <Text style={[styles.languageOptionLabel, selected && styles.languageOptionLabelSelected]}>
                    {option.label}
                  </Text>
                  {selected ? <Text style={styles.languageOptionMeta}>{copy.selectedLabel}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      <MenuRow
        icon="map-marker-multiple-outline"
        title={copy.savedPlacesTitle}
        subtitle={copy.savedPlacesSubtitle}
        trailingLabel={copy.savedPlacesTrailing}
        onPress={() => router.push('/saved-places')}
      />
      <MenuRow
        icon="account-edit-outline"
        title={copy.profileEditingTitle}
        subtitle={copy.profileEditingSubtitle}
        onPress={() => router.push('/profile-edit')}
      />
      <MenuRow
        icon="headset"
        title={copy.supportTitle}
        subtitle={copy.supportSubtitle}
        onPress={() => router.push('/support-center')}
      />
      <MenuRow
        icon="shield-check-outline"
        title={copy.policiesTitle}
        subtitle={copy.policiesSubtitle}
        onPress={() => router.push('/policies')}
      />

      <PrimaryButton
        label={signingOut ? copy.signingOut : copy.signOut}
        variant="dark"
        icon="logout"
        onPress={handleSignOut}
        style={styles.logoutButton}
      />
      {signingOut ? <ActivityIndicator style={styles.logoutLoader} color={cargoTheme.colors.primary} /> : null}
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
    paddingBottom: 20,
  },
  profileCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 22,
    alignItems: 'center',
    marginBottom: 22,
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 24,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
  },
  profileName: {
    fontSize: 24,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  profileMeta: {
    fontSize: 13,
    color: '#D7E1EA',
    marginBottom: 12,
  },
  editProfileButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 16,
  },
  editProfileText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: typography.bold,
  },
  verificationBadge: {
    color: '#BBF7D0',
    fontSize: 12,
    fontFamily: typography.bold,
    marginBottom: 12,
  },
  profileStats: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    paddingVertical: 14,
  },
  profileStat: {
    flex: 1,
    alignItems: 'center',
  },
  profileStatValue: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  profileStatLabel: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#D7E1EA',
  },
  profileDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    paddingHorizontal: 16,
  },
  detailRow: {
    paddingVertical: 14,
  },
  detailRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: cargoTheme.colors.subtext,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  languageCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    padding: 16,
  },
  languageSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
    marginBottom: 14,
  },
  languageOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  languageOption: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  languageOptionSelected: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: cargoTheme.colors.primarySoft,
  },
  languageOptionLabel: {
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  languageOptionLabelSelected: {
    color: cargoTheme.colors.primaryDark,
  },
  languageOptionMeta: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  logoutButton: {
    marginTop: 8,
  },
  logoutLoader: {
    marginTop: 12,
  },
});
