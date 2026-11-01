import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useCallback } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { SUPPORT_PHONE_LABEL } from '@/lib/support-contact';
import { useLanguage } from '@/providers/language-provider';

/** DoorDrop bus-ticket waitlist WhatsApp group invite — replace this one line if the invite changes. */
export const BUS_TICKET_WAITLIST_WHATSAPP_URL =
  'https://chat.whatsapp.com/B547SXkoRka1kfmMw2OTkv?s=cl&p=a&mlu=4&ilr=4&iam=0';

const SCREEN_WIDTH = Dimensions.get('window').width;
/** Full-bleed banner ~16:9, clamped so headline + benefits + CTA stay on a typical phone. */
const HERO_HEIGHT = Math.round(Math.min(248, Math.max(208, SCREEN_WIDTH * (9 / 16))));

type Benefit = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
};

export default function BusTicketsScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const isSw = language === 'sw';

  const copy = isSw
    ? {
        headerTitle: 'Tiketi za basi',
        headline: 'Tiketi.',
        supporting: 'Coming soon',
        benefits: [
          {
            icon: 'ticket-confirmation-outline',
            title: 'Uwekaji rahisi',
            description:
              'Chagua basi, siku, na kiti moja kwa moja kwenye app wakati huduma itakapoanza.',
          },
          {
            icon: 'map-marker-path',
            title: 'Fuatilia safari',
            description: 'Angalia hali ya safari yako kwa wakati halisi hadi ufikie.',
          },
          {
            icon: 'cellphone',
            title: 'Malipo ya simu',
            description: 'Lipa kwa M-Pesa, Mixx, au Airtel Money — haraka na salama.',
          },
        ] satisfies Benefit[],
        waitlistFailed: 'Imeshindikana kufungua WhatsApp',
        waitlistHint: `Tafadhali fungua WhatsApp na wasiliana ${SUPPORT_PHONE_LABEL}.`,
      }
    : {
        headerTitle: 'Bus tickets',
        headline: 'Tiketi.',
        supporting: 'Coming soon',
        benefits: [
          {
            icon: 'ticket-confirmation-outline',
            title: 'Easy booking',
            description: 'Pick a coach, date, and seat in the app when the service launches.',
          },
          {
            icon: 'map-marker-path',
            title: 'Track your trip',
            description: 'Follow your journey in real time until you arrive.',
          },
          {
            icon: 'cellphone',
            title: 'Mobile money',
            description: 'Pay with M-Pesa, Mixx, or Airtel Money — fast and secure.',
          },
        ] satisfies Benefit[],
        waitlistFailed: 'Unable to open WhatsApp',
        waitlistHint: `Please open WhatsApp and message ${SUPPORT_PHONE_LABEL}.`,
      };

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  }, [router]);

  const handleJoinWaitlist = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(BUS_TICKET_WAITLIST_WHATSAPP_URL);
      if (!supported) {
        throw new Error('WhatsApp not available');
      }
      await Linking.openURL(BUS_TICKET_WAITLIST_WHATSAPP_URL);
    } catch {
      Alert.alert(copy.waitlistFailed, copy.waitlistHint);
    }
  }, [copy.waitlistFailed, copy.waitlistHint]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={styles.topBar}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={isSw ? 'Rudi' : 'Back'}
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {copy.headerTitle}
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <View style={styles.heroFrame}>
          <Image
            source={require('@/assets/images/bus-ticket-waitlist-hero.png')}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>

        <View style={styles.body}>
          <Text style={styles.headline}>{copy.headline}</Text>
          <Text style={styles.supporting}>{copy.supporting}</Text>

          <View style={styles.benefits}>
            {copy.benefits.map((benefit) => (
              <View key={benefit.title} style={styles.benefitRow}>
                <View style={styles.benefitIcon}>
                  <MaterialCommunityIcons name={benefit.icon} size={26} color="#111827" />
                </View>
                <View style={styles.benefitCopy}>
                  <Text style={styles.benefitTitle}>{benefit.title}</Text>
                  <Text style={styles.benefitDescription}>{benefit.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Join the waitlist"
          activeOpacity={0.88}
          style={styles.cta}
          onPress={() => void handleJoinWaitlist()}>
          <Text style={styles.ctaLabel}>Join the waitlist</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.medium,
    color: '#111827',
    letterSpacing: -0.2,
  },
  topBarSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
    flexGrow: 1,
  },
  heroFrame: {
    width: '100%',
    height: HERO_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    borderRadius: 0,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.bold,
    color: '#111827',
    letterSpacing: -0.7,
  },
  supporting: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  benefits: {
    marginTop: 28,
    gap: 26,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  benefitIcon: {
    width: 32,
    marginTop: 2,
    alignItems: 'center',
  },
  benefitCopy: {
    flex: 1,
    minWidth: 0,
  },
  benefitTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.bold,
    color: '#111827',
    letterSpacing: -0.2,
  },
  benefitDescription: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  cta: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  ctaLabel: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
