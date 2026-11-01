import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';
import { useLanguage } from '@/providers/language-provider';

type ParcelPackingInstructionsProps = {
  weightLimitKg: number;
  strict?: boolean;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
};

const copy = {
  sw: {
    title: 'Maelekezo ya kufunga',
    close: 'Funga',
    rows: (kg: number) => [
      'Funga vitu kwenye sanduku, mfuko, au bahasha',
      'Usiweke vitu vilivyokatazwa wala bidhaa zinazozidi kikomo cha thamani ya eneo',
      'Mkabidhi mzigo moja kwa moja kwa dereva',
      `Hakikisha uzito wake usizidi ${kg} kg na unaingia bila kuharibu gari`,
      'Mshirikishe mpokeaji maelezo ya uwasilishaji',
    ],
    strictRows: (kg: number) => [
      'Mzigo lazima uwe kwenye sanduku gumu au bahasha iliyofungwa vizuri. Mfuko laini haukubaliki.',
      'Funga kila kitu ndani. Hakuna kitu kinachoruhusiwa kutoka nje ya kifurushi.',
      'Andika jina na simu ya mpokeaji nje ya kifurushi.',
      'Usifunge vinywaji, glasi wazi, betri zilizo wazi, au vitu vilivyokatazwa.',
      `Uzito usizidi ${kg} kg. Kifurushi kikubwa kuliko hiki hakiendi kama mzigo mdogo au wa wastani.`,
      'Kampuni inaweza kukataa mzigo usiofungwa vizuri kabla ya safari.',
    ],
  },
  en: {
    title: 'Packing instructions',
    close: 'Close',
    rows: (kg: number) => [
      'Pack items into a box, bag, or envelope',
      'No prohibited items or goods exceeding local value limits',
      'Hand the package directly to the driver',
      `Ensure it weighs no more than ${kg} kg and fits without damaging the vehicle`,
      'Share delivery details with the recipient',
    ],
    strictRows: (kg: number) => [
      'The parcel must be in a rigid box or a sealed envelope. A soft bag is not accepted.',
      'Seal everything inside. Nothing may stick out of the package.',
      'Write the recipient name and phone on the outside.',
      'Do not pack liquids, loose glass, exposed batteries, or prohibited goods.',
      `Weight must stay within ${kg} kg. Anything larger is not a small or medium parcel.`,
      'The company can refuse a poorly packed parcel before the trip.',
    ],
  },
};

export function ParcelPackingInstructions({
  weightLimitKg,
  strict = false,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}: ParcelPackingInstructionsProps) {
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const t = copy[language];
  const rows = strict ? t.strictRows(weightLimitKg) : t.rows(weightLimitKg);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.close}
          hitSlop={10}
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}>
          <MaterialCommunityIcons name="close" size={20} color="#111827" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}>
        <Image source={images.parcelPackingBox} style={styles.box} resizeMode="contain" />
        <Text style={styles.title}>{t.title}</Text>
        <View style={styles.list}>
          {rows.map((row, index) => (
            <View key={row} style={[styles.row, index < rows.length - 1 && styles.rowDivider]}>
              <MaterialCommunityIcons name="check" size={20} color="#16A34A" style={styles.check} />
              <Text style={styles.rowText}>{row}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="OK"
          disabled={busy}
          onPress={onConfirm}
          style={({ pressed }) => [styles.ok, (pressed || busy) && styles.okPressed]}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.okText}>OK</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  headerSpacer: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  closePressed: {
    opacity: 0.7,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  box: {
    width: 220,
    height: 200,
    alignSelf: 'center',
    marginTop: 12,
  },
  title: {
    marginTop: 28,
    marginBottom: 8,
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.5,
  },
  list: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 18,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  check: {
    marginTop: 2,
  },
  rowText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#111827',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
  },
  error: {
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#DC2626',
    textAlign: 'center',
  },
  ok: {
    minHeight: cargoTheme.ctaParcel.minHeight,
    borderRadius: 999,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  okPressed: {
    opacity: 0.88,
  },
  okText: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.bold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
