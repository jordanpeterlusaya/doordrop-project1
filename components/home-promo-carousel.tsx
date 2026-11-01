import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { typography } from '@/constants/typography';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PAGE_PAD = 20;
const CARD_WIDTH = SCREEN_WIDTH - PAGE_PAD * 2;
const CARD_GAP = 12;
const SNAP = CARD_WIDTH + CARD_GAP;
const AUTO_ADVANCE_MS = 4200;

export type HomePromoSlide = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
  gradient: [string, string, ...string[]];
  onPress: () => void;
};

type HomePromoCarouselProps = {
  slides: HomePromoSlide[];
};

function PromoCard({
  slide,
  reduceMotion,
}: {
  slide: HomePromoSlide;
  reduceMotion: boolean;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={slide.title}
      android_disableSound
      onPressIn={() => {
        if (!reduceMotion) {
          scale.value = withSpring(0.975, { damping: 18, stiffness: 220 });
        }
        slide.onPress();
      }}
      onPressOut={() => {
        if (!reduceMotion) {
          scale.value = withSpring(1, { damping: 16, stiffness: 200 });
        }
      }}>
      <Animated.View style={[styles.cardShell, animatedStyle]}>
        <LinearGradient
          colors={slide.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}>
          <View style={styles.orbPrimary} />
          <View style={styles.orbSecondary} />

          <View style={styles.copyCol}>
            <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {slide.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {slide.subtitle}
            </Text>
          </View>

          <Image
            source={slide.image}
            defaultSource={slide.image}
            fadeDuration={0}
            resizeMode="contain"
            style={styles.art}
          />

          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={14} color="#0B7A3B" />
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export function HomePromoCarousel({ slides }: HomePromoCarouselProps) {
  const listRef = useRef<Animated.ScrollView>(null);
  const indexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(Boolean(enabled));
      }
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(Boolean(enabled));
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const scrollToIndex = useCallback((index: number, animated = true) => {
    listRef.current?.scrollTo({ x: index * SNAP, animated });
  }, []);

  useEffect(() => {
    if (reduceMotion || slides.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      const next = (indexRef.current + 1) % slides.length;
      indexRef.current = next;
      setActiveIndex(next);
      scrollToIndex(next, true);
    }, AUTO_ADVANCE_MS);

    return () => clearInterval(timer);
  }, [reduceMotion, scrollToIndex, slides.length]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / SNAP);
    const bounded = Math.max(0, Math.min(next, slides.length - 1));
    if (bounded !== indexRef.current) {
      indexRef.current = bounded;
      setActiveIndex(bounded);
    }
  };

  return (
    <View>
      <Animated.ScrollView
        ref={listRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={SNAP}
        snapToAlignment="start"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}>
        {slides.map((slide) => (
          <View key={slide.id} style={styles.slideWrap}>
            <PromoCard slide={slide} reduceMotion={reduceMotion} />
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.dots}>
        {slides.map((slide, index) => (
          <View key={slide.id} style={[styles.dot, index === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingRight: PAGE_PAD,
  },
  slideWrap: {
    width: CARD_WIDTH,
    marginRight: CARD_GAP,
  },
  cardShell: {
    borderRadius: 24,
  },
  card: {
    minHeight: 132,
    borderRadius: 22,
    overflow: 'hidden',
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  orbPrimary: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(0,0,0,0.12)',
    right: -40,
    top: -50,
  },
  orbSecondary: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
    left: -30,
    bottom: -40,
  },
  copyCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
    zIndex: 2,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: typography.bold,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: 'rgba(255,255,255,0.82)',
  },
  art: {
    width: 96,
    height: 104,
    marginRight: -4,
    marginBottom: -6,
    zIndex: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    width: 16,
    backgroundColor: '#111827',
  },
});
