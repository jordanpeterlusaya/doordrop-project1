import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen, SectionTitle, SettingsRow } from '@/components/ui';
import { coverageSummary } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { carrierStatusLabel } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function SettingsScreen() {
  const { carrier, user, signOut } = useCarrierSession();

  if (!carrier) {
    return (
      <Screen edges="top">
        <View style={styles.identityRow}>
          <View style={styles.identityCopy}>
            <Text style={styles.displayName}>Akaunti</Text>
            <Text style={styles.displayMeta}>{user?.email || 'HAUL Cargo Agents'}</Text>
          </View>
        </View>
        <View style={styles.group}>
          <SettingsRow
            icon="log-out-outline"
            title="Toka"
            destructive
            last
            onPress={() => void signOut().then(() => router.replace('/'))}
          />
        </View>
      </Screen>
    );
  }

  const verified = carrier.status === 'verified';
  const coverage = coverageSummary({
    coverageRegions: carrier.coverageRegions || [],
    coverageAllTanzania: Boolean(carrier.coverageAllTanzania),
    coverageInternational: Boolean(carrier.coverageInternational),
    coverageInternationalCountries: String(carrier.coverageInternationalCountries || ''),
  });
  const displayName = carrier.companyName?.trim() || carrier.name?.trim() || 'Kampuni';
  const phone = carrier.phone || '';
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'H';

  return (
    <Screen scroll edges="top">
      <View style={styles.identityRow}>
        <View style={styles.identityCopy}>
          <Text numberOfLines={2} style={styles.displayName}>
            {displayName}
          </Text>
          <Text numberOfLines={1} style={styles.displayMeta}>
            {user?.email || phone || 'HAUL Cargo Agents'}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Hali</Text>
          <View style={[styles.statusPill, verified ? styles.statusPillOk : styles.statusPillWait]}>
            <Text style={[styles.statusPillText, verified ? styles.statusPillTextOk : undefined]}>
              {carrierStatusLabel(carrier.status)}
            </Text>
          </View>
        </View>
        <Text style={styles.statusBody}>
          {verified ? 'Unaweza kupokea oda kutoka HAUL.' : 'HAUL inapitia taarifa za kampuni.'}
        </Text>
        <Text style={styles.coverage}>Coverage · {coverage}</Text>
        {carrier.rejectionReason ? (
          <Text style={styles.reject}>Sababu: {carrier.rejectionReason}</Text>
        ) : null}
      </View>

      <SectionTitle>Zana</SectionTitle>
      <View style={styles.group}>
        <SettingsRow
          icon="business-outline"
          title="Hariri taarifa za kampuni"
          onPress={() => router.push('/edit-company')}
        />
        <SettingsRow
          icon="map-outline"
          title="Coverage / maeneo"
          value={coverage}
          onPress={() => router.push('/edit-coverage')}
        />
        <SettingsRow
          icon="document-text-outline"
          title="Hati za kampuni"
          onPress={() => router.push('/edit-documents')}
        />
        <SettingsRow
          icon="bus-outline"
          title="Ratiba ya safari"
          onPress={() => router.push('/schedule')}
        />
        <SettingsRow
          icon="time-outline"
          title="Historia"
          last
          onPress={() => router.push('/history')}
        />
      </View>

      <View style={[styles.group, styles.groupSpaced]}>
        <SettingsRow
          icon="log-out-outline"
          title="Toka"
          destructive
          last
          onPress={() => void signOut().then(() => router.replace('/'))}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 18,
    gap: 14,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  displayName: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.ident,
    color: theme.ink,
    letterSpacing: -0.7,
  },
  displayMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: theme.muted,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.tile,
    borderWidth: 2,
    borderColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontFamily: typography.ident,
    color: theme.ink,
  },
  statusCard: {
    backgroundColor: theme.tile,
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusLabel: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.muted,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillOk: { backgroundColor: '#ECFDF5' },
  statusPillWait: { backgroundColor: theme.primarySoft },
  statusPillText: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.ink,
  },
  statusPillTextOk: { color: '#047857' },
  statusBody: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.ink,
  },
  coverage: {
    marginTop: 10,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  reject: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.danger,
  },
  group: {
    backgroundColor: theme.tile,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 12,
  },
  groupSpaced: { marginTop: 8, marginBottom: 24 },
});
