import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { typography } from '@/constants/typography';

export default function BookCargoWebScreen() {
  const router = useRouter();

  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <Pressable style={styles.back} onPress={() => router.replace('/home')}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title}>Mizigo</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Chagua gari kwenye simu</Text>
        <Text style={styles.cardText}>
          Booking ya Mizigo inatumia ramani, Toyo Electric / TOYO / Kirikuu, na bei ya kujadili. Fungua HAUL kwenye simu
          kuchagua pickup, drop-off, kisha Toa bei yako.
        </Text>
      </View>

      <Pressable style={styles.cta} onPress={() => router.replace('/home')}>
        <Text style={styles.ctaText}>Rudi nyumbani</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 20,
    paddingTop: 28,
    gap: 16,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 18,
    color: '#111827',
  },
  title: {
    fontSize: 20,
    fontFamily: typography.extrabold,
    color: '#111827',
  },
  card: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: '#111827',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 17,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
});
