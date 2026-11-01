import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

export function NinunulieSuccessPopup({
  visible,
  orderNumber,
  onDismiss,
}: {
  visible: boolean;
  orderNumber: string;
  onDismiss: () => void;
}) {
  const backdrop = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      backdrop.setValue(0);
      card.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(card, {
        toValue: 1,
        friction: 8,
        tension: 68,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, backdrop, card]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.root} pointerEvents="box-none">
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Funga" />
        </Animated.View>

        <Animated.View
          style={[
            styles.paperWrap,
            {
              opacity: card,
              transform: [
                {
                  translateY: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
                {
                  rotate: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['1.2deg', '-0.5deg'],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.paper}>
            <View style={styles.grainA} />
            <View style={styles.grainB} />
            <View style={styles.fold} />

            <TouchableOpacity
              style={styles.close}
              onPress={onDismiss}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Funga">
              <MaterialCommunityIcons name="close" size={20} color="#111827" />
            </TouchableOpacity>

            <Text style={styles.brand}>HAUL</Text>
            <Text style={styles.title}>Ombi limepokelewa</Text>
            <View style={styles.next}>
              <Text style={styles.nextLine}>HAUL itashughulikia ombi.</Text>
              <Text style={styles.nextLine}>Tutakupigia kwa maelekezo zaidi.</Text>
            </View>
            {orderNumber ? <Text style={styles.order}>{orderNumber}</Text> : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const PAPER = '#F3DE6A';
const PAPER_WARM = '#E8C94A';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.48)',
  },
  paperWrap: {
    width: '80%',
    maxWidth: 340,
  },
  paper: {
    backgroundColor: PAPER,
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 32,
    overflow: 'hidden',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
  },
  grainA: {
    position: 'absolute',
    top: -40,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: cargoTheme.colors.primary,
    opacity: 0.38,
  },
  grainB: {
    position: 'absolute',
    bottom: -50,
    left: -40,
    width: 180,
    height: 140,
    borderRadius: 70,
    backgroundColor: PAPER_WARM,
    opacity: 0.55,
  },
  fold: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  brand: {
    fontFamily: typography.ident,
    fontSize: 18,
    letterSpacing: 1.6,
    color: '#111827',
    marginBottom: 16,
  },
  title: {
    fontFamily: typography.identSlogan,
    fontSize: 26,
    lineHeight: 32,
    color: '#111827',
  },
  next: {
    marginTop: 18,
    gap: 8,
  },
  nextLine: {
    fontFamily: typography.body,
    fontSize: 16,
    lineHeight: 22,
    color: '#111827',
  },
  order: {
    marginTop: 20,
    fontFamily: typography.medium,
    fontSize: 13,
    letterSpacing: 0.3,
    color: 'rgba(17,24,39,0.5)',
  },
});
