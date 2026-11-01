import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { SUPPORT_PHONE_LABEL, supportTelUrl, supportWhatsAppUrl } from '../lib/support-contact';
import { driveHapticLight } from '../lib/drive-haptics';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

type HelpRow = {
  key: string;
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
};

export function PilotHelpScreen({
  title,
  subtitle,
  rows,
  tipsTitle,
  tips,
}: {
  title: string;
  subtitle: string;
  rows: HelpRow[];
  tipsTitle: string;
  tips: string[];
}) {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.card}>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            onPress={() => {
              void driveHapticLight();
              row.onPress?.();
            }}
            style={({ pressed }) => [
              styles.row,
              index === rows.length - 1 && styles.rowLast,
              pressed && styles.pressed,
            ]}>
            <View style={[styles.iconWrap, { backgroundColor: row.iconBg }]}>
              <MaterialCommunityIcons name={row.icon} size={20} color={row.iconColor} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {row.subtitle}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>{tipsTitle}</Text>
      <View style={styles.tipsCard}>
        {tips.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footerNote}>{SUPPORT_PHONE_LABEL}</Text>
    </ScrollView>
  );
}

export function openSupportCall() {
  return Linking.openURL(supportTelUrl());
}

export function openSupportWhatsApp(message?: string) {
  return Linking.openURL(supportWhatsAppUrl(message));
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
  },
  title: {
    fontFamily: driveType.bold,
    fontSize: 32,
    letterSpacing: -0.6,
    color: driveTheme.colors.ink,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 18,
    fontFamily: driveType.regular,
    fontSize: 14,
    lineHeight: 20,
    color: driveTheme.colors.subtext,
  },
  card: {
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 18,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: driveTheme.colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  pressed: { opacity: 0.88 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: driveType.semibold,
    fontSize: 15,
    color: driveTheme.colors.ink,
  },
  rowSub: {
    marginTop: 2,
    fontFamily: driveType.regular,
    fontSize: 13,
    color: driveTheme.colors.subtext,
  },
  section: {
    marginTop: 22,
    marginBottom: 10,
    fontFamily: driveType.bold,
    fontSize: 16,
    color: driveTheme.colors.ink,
  },
  tipsCard: {
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: '#34C759',
  },
  tipText: {
    flex: 1,
    fontFamily: driveType.regular,
    fontSize: 14,
    lineHeight: 20,
    color: driveTheme.colors.subtext,
  },
  footerNote: {
    marginTop: 20,
    textAlign: 'center',
    fontFamily: driveType.semibold,
    fontSize: 13,
    color: driveTheme.colors.muted,
  },
});
