import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { driveHapticLight } from '../lib/drive-haptics';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

type MenuItem = {
  key: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
};

export function PilotMenuDrawer({
  visible,
  onClose,
  driverName,
  vehicleLine,
  online,
  onlineLabel,
  offlineLabel,
  language,
  onLanguageEn,
  onLanguageSw,
  languageTitle,
  languageEn,
  languageSw,
  autoConfirm,
  onAutoConfirmChange,
  autoConfirmTitle,
  autoConfirmHint,
  items,
  signOutLabel,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  driverName: string;
  vehicleLine: string;
  online: boolean;
  onlineLabel: string;
  offlineLabel: string;
  language: 'en' | 'sw';
  onLanguageEn: () => void;
  onLanguageSw: () => void;
  languageTitle: string;
  languageEn: string;
  languageSw: string;
  autoConfirm: boolean;
  onAutoConfirmChange: (value: boolean) => void;
  autoConfirmTitle: string;
  autoConfirmHint: string;
  items: MenuItem[];
  signOutLabel: string;
  onSignOut: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          <View style={styles.handle} />
          <View style={styles.hero}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {driverName
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'HP'}
              </Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroName} numberOfLines={1}>
                {driverName}
              </Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {vehicleLine}
              </Text>
              <View style={[styles.statusPill, online ? styles.statusOn : styles.statusOff]}>
                <View style={[styles.statusDot, online ? styles.dotOn : styles.dotOff]} />
                <Text style={styles.statusText}>{online ? onlineLabel : offlineLabel}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={22} color="#F8FAFC" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{languageTitle}</Text>
              <View style={styles.langRow}>
                <Pressable
                  onPress={onLanguageEn}
                  style={[styles.langChip, language === 'en' && styles.langChipActive]}>
                  <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>{languageEn}</Text>
                </Pressable>
                <Pressable
                  onPress={onLanguageSw}
                  style={[styles.langChip, language === 'sw' && styles.langChipActive]}>
                  <Text style={[styles.langText, language === 'sw' && styles.langTextActive]}>{languageSw}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{autoConfirmTitle}</Text>
                <Text style={styles.rowSub}>{autoConfirmHint}</Text>
              </View>
              <Switch
                value={autoConfirm}
                onValueChange={onAutoConfirmChange}
                trackColor={{ false: '#334155', true: '#86EFAC' }}
                thumbColor={autoConfirm ? '#16A34A' : '#F8FAFC'}
              />
            </View>

            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => {
                  void driveHapticLight();
                  item.onPress?.();
                }}
                style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}>
                <View style={styles.itemIcon}>
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={20}
                    color={item.danger ? '#EF4444' : '#F8FAFC'}
                  />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.rowTitle, item.danger && styles.dangerText]}>{item.title}</Text>
                  {item.subtitle ? <Text style={styles.rowSub}>{item.subtitle}</Text> : null}
                </View>
                {item.trailing ?? (
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
                )}
              </Pressable>
            ))}

            <Pressable
              onPress={() => {
                void driveHapticLight();
                onSignOut();
              }}
              style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
              <Text style={styles.signOutText}>{signOutLabel}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    maxHeight: '88%',
    backgroundColor: '#12181F',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A313B',
    paddingBottom: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A4350',
    marginTop: 10,
    marginBottom: 8,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A313B',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: driveType.bold, color: '#0B0F14', fontSize: 16 },
  heroCopy: { flex: 1, minWidth: 0 },
  heroName: { fontFamily: driveType.bold, fontSize: 18, color: '#F8FAFC' },
  heroMeta: { marginTop: 2, fontFamily: driveType.regular, fontSize: 13, color: '#94A3B8' },
  statusPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusOn: { backgroundColor: '#14301F' },
  statusOff: { backgroundColor: '#1C222B' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { backgroundColor: '#34C759' },
  dotOff: { backgroundColor: '#64748B' },
  statusText: { fontFamily: driveType.semibold, fontSize: 11, color: '#F8FAFC' },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#1C222B',
    borderRadius: 14,
    padding: 12,
  },
  cardLabel: {
    fontFamily: driveType.semibold,
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 8,
  },
  langRow: { flexDirection: 'row', gap: 8 },
  langChip: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#151A21',
  },
  langChipActive: { backgroundColor: '#34C759' },
  langText: { fontFamily: driveType.semibold, fontSize: 13, color: '#94A3B8' },
  langTextActive: { color: '#0B0F14' },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C222B',
    borderRadius: 14,
    padding: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C222B',
    borderRadius: 14,
    padding: 12,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#151A21',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: driveType.semibold, fontSize: 15, color: '#F8FAFC' },
  rowSub: { marginTop: 2, fontFamily: driveType.regular, fontSize: 12, color: '#94A3B8' },
  dangerText: { color: '#EF4444' },
  pressed: { opacity: 0.88 },
  signOut: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#2A1515',
  },
  signOutText: { fontFamily: driveType.bold, fontSize: 15, color: '#EF4444' },
});
