import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { useLanguage } from '@/providers/language-provider';

export default function HomeWebScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const copy =
    language === 'sw'
      ? {
          kicker: 'DoorDrop Web',
          title: 'Kituo cha kazi kwa app ya mteja',
          subtitle:
            'App ya simu hushughulikia kuweka oda, kufuatilia na historia huku DoorDrop ikiendesha usambazaji na upangaji wa madereva nyuma ya pazia.',
          splashAction: 'Fungua ukurasa wa mwanzo',
          serviceCards: [
            {
              title: 'Tuma kifurushi',
              subtitle: 'Anzisha usafirishaji wa vifurushi kwenye app ya simu huku DoorDrop ikisimamia ugawaji wa moja kwa moja.',
              route: '/send-parcel' as const,
              image: require('@/assets/images/home-send-parcel.png'),
              icon: 'package-variant-closed' as const,
            },
            {
              title: 'Omba msafirishaji wa mizigo',
              subtitle: 'Panga usafiri wa mizigo kwa mtiririko rahisi zaidi kueleweka.',
              route: '/book-cargo' as const,
              image: require('@/assets/images/vehicle-light-truck.png'),
              icon: 'truck-fast-outline' as const,
            },
          ],
          notice:
            'Kila oda iliyothibitishwa huhifadhiwa mara moja na kushirikiwa kwenye skrini za kuweka oda, historia na ufuatiliaji za app ya mteja.',
        }
      : {
          kicker: 'DoorDrop Web',
          title: 'Operations hub for the customer app',
          subtitle:
            'The native app handles booking, tracking, and history while DoorDrop keeps dispatch and driver assignment running behind the scenes.',
          splashAction: 'Open splash page',
          serviceCards: [
            {
              title: 'Send parcel',
              subtitle: 'Create parcel deliveries in the mobile app and let the DoorDrop team handle live dispatch in the background.',
              route: '/send-parcel' as const,
              image: require('@/assets/images/home-send-parcel.png'),
              icon: 'package-variant-closed' as const,
            },
            {
              title: 'Request cargo carrier',
              subtitle: 'Set up transport for goods in a simpler, easier-to-understand flow.',
              route: '/book-cargo' as const,
              image: require('@/assets/images/vehicle-light-truck.png'),
              icon: 'truck-fast-outline' as const,
            },
          ],
          notice:
            'Every confirmed order is stored once and shared across booking, history, and tracking screens for the customer app.',
        };

  return (
    <CargoScreen contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{copy.kicker}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <View style={styles.heroActions}>
          <PrimaryButton label={copy.splashAction} variant="secondary" onPress={() => router.push('/splash')} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.serviceRow}>
        {copy.serviceCards.map((card) => (
          <TouchableOpacity key={card.title} style={styles.card} activeOpacity={0.9} onPress={() => router.push(card.route)}>
            <View style={styles.imageWrap}>
              <Image source={card.image} style={styles.image} resizeMode="cover" />
            </View>
            <View style={styles.cardBody}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name={card.icon} size={18} color={cargoTheme.colors.primaryDark} />
              </View>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.notice}>
        <MaterialCommunityIcons name="sync" size={20} color={cargoTheme.colors.primaryDark} />
        <Text style={styles.noticeText}>{copy.notice}</Text>
      </View>
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 14,
    paddingBottom: 32,
    gap: 22,
  },
  hero: {
    borderRadius: 32,
    padding: 24,
    backgroundColor: cargoTheme.colors.darkSurface,
    gap: 12,
  },
  kicker: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
  },
  subtitle: {
    color: '#D7E1EA',
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 700,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  serviceRow: {
    gap: 16,
  },
  card: {
    width: 320,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  imageWrap: {
    height: 170,
    backgroundColor: '#ECFDF3',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    padding: 18,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 22,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    padding: 16,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.primaryDark,
  },
});
