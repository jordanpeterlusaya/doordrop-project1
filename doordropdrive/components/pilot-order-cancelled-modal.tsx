import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { driveType } from '../constants/drive-theme';
import { driveHapticMedium } from '../lib/drive-haptics';

export function PilotOrderCancelledModal({
  visible,
  title,
  message,
  closeLabel,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="alert" size={36} color="#0B0F14" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable
            onPress={() => {
              void driveHapticMedium();
              onClose();
            }}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
            <Text style={styles.closeText}>{closeLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#2A2F3A',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 18,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: driveType.bold,
    fontSize: 22,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: driveType.regular,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(248,250,252,0.78)',
    textAlign: 'center',
    marginBottom: 22,
  },
  closeBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#3A4150',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeText: {
    fontFamily: driveType.semibold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  pressed: { opacity: 0.88 },
});
