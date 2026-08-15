import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const SUPPORT_PHONE = '0796904849';
const SUPPORT_WHATSAPP = '255796904849';
const SUPPORT_PHONE_LABEL = '0796 904 849';

export default function SupportCenterScreen() {
  const router = useRouter();
  const copy = useAppCopy();

  const openPhoneCall = async () => {
    try {
      await Linking.openURL(`tel:${SUPPORT_PHONE}`);
    } catch {
      Alert.alert(copy.help.callFailed, copy.help.callHint.replace('{phone}', SUPPORT_PHONE_LABEL));
    }
  };

  const openWhatsApp = async () => {
    const whatsappUrl = `https://wa.me/${SUPPORT_WHATSAPP}`;

    try {
      const supported = await Linking.canOpenURL(whatsappUrl);
      if (!supported) {
        throw new Error('WhatsApp not available');
      }
      await Linking.openURL(whatsappUrl);
    } catch {
      Alert.alert(copy.help.whatsappFailed, copy.help.whatsappHint.replace('{phone}', SUPPORT_PHONE_LABEL));
    }
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title={copy.help.title} onLeftPress={() => router.back()} />

      <Text style={styles.intro}>{copy.help.intro}</Text>

      <View style={styles.listCard}>
        <TouchableOpacity activeOpacity={0.88} style={styles.listRow} onPress={() => void openPhoneCall()}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="phone-outline" size={20} color={cargoTheme.colors.text} />
          </View>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{copy.help.call}</Text>
            <Text style={styles.listMeta}>{SUPPORT_PHONE_LABEL}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.88}
          style={[styles.listRow, styles.listRowBorder]}
          onPress={() => void openWhatsApp()}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="whatsapp" size={20} color={cargoTheme.colors.text} />
          </View>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{copy.help.whatsapp}</Text>
            <Text style={styles.listMeta}>{SUPPORT_PHONE_LABEL}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.88}
          style={[styles.listRow, styles.listRowBorder]}
          onPress={() => router.push('/policies')}>
          <View style={styles.listIcon}>
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={cargoTheme.colors.text} />
          </View>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{copy.help.policies}</Text>
            <Text style={styles.listMeta}>Terms and privacy</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 20,
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    overflow: 'hidden',
  },
  listRow: {
    minHeight: 64,
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
  listCopy: {
    flex: 1,
    minWidth: 0,
  },
  listTitle: {
    fontSize: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  listMeta: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
});
