import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { typography } from '@/constants/typography';

export type HomeShowcaseAction = 'route' | 'schedule';

export type HomeShowcaseCard = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  image?: ImageSourcePropType;
  imageScale?: number;
  iconName?: keyof typeof MaterialCommunityIcons.glyphMap;
  gradient: [string, string, string];
  action: HomeShowcaseAction;
  route?: '/send-parcel' | '/book-cargo' | '/ninunulie' | '/bus-tickets' | '/track-order' | '/support-center';
  params?: Record<string, string>;
  featured?: boolean;
  badge?: string;
  routes?: string[];
  highlights?: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }[];
  secondaryImage?: ImageSourcePropType;
  secondaryImageScale?: number;
};

type HomeServiceShowcaseProps = {
  cards: HomeShowcaseCard[];
  onCardPress: (card: HomeShowcaseCard) => void;
  sectionTitle?: string;
};

/** Compact side-by-side plan cards (screenshot-style home). */
export function HomeServiceShowcase({
  cards,
  onCardPress,
  sectionTitle,
}: HomeServiceShowcaseProps) {
  const planCards = cards.slice(0, 2);

  return (
    <View style={styles.wrap}>
      {sectionTitle ? <Text style={styles.sectionTitle}>{sectionTitle}</Text> : null}
      <View style={styles.row}>
        {planCards.map((card) => (
          <Pressable
            key={card.id}
            accessibilityRole="button"
            accessibilityLabel={card.title}
            onPress={() => onCardPress(card)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
            <View style={styles.artWell}>
              {card.image ? (
                <Image
                  source={card.image}
                  style={[styles.artImage, card.imageScale ? { transform: [{ scale: card.imageScale }] } : null]}
                  resizeMode="contain"
                />
              ) : card.iconName ? (
                <MaterialCommunityIcons name={card.iconName} size={42} color="#111827" />
              ) : null}
            </View>
            <View style={styles.captionRow}>
              <Text style={styles.caption} numberOfLines={2}>
                {card.title}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color="#111827" />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: typography.bold,
    color: '#000000',
    letterSpacing: -0.4,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  cardPressed: {
    opacity: 0.92,
  },
  artWell: {
    height: 110,
    backgroundColor: '#F3F3F3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: 88,
    height: 88,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 48,
  },
  caption: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#111827',
  },
});
