import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

const LENGTH = 6;

type Props = {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
};

export function OtpUnderlineInput({ value, onChange, autoFocus = true, editable = true }: Props) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.replace(/\D/g, '').slice(0, LENGTH).split('');

  const focus = () => {
    if (editable) inputRef.current?.focus();
  };

  return (
    <Pressable onPress={focus} style={styles.wrap} accessibilityRole="none">
      <View style={styles.slots} pointerEvents="none">
        {Array.from({ length: LENGTH }).map((_, index) => {
          const digit = digits[index] || '';
          const active = index === digits.length && digits.length < LENGTH;
          return (
            <View key={index} style={styles.slot}>
              <Text style={[styles.digit, digit ? styles.digitFilled : null]}>{digit}</Text>
              <View style={[styles.line, active && styles.lineActive, digit ? styles.lineFilled : null]} />
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={digits.join('')}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LENGTH}
        autoFocus={autoFocus}
        editable={editable}
        caretHidden
        style={styles.hidden}
        accessibilityLabel="Verification code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 18,
    marginTop: 8,
  },
  slots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'flex-end',
  },
  digit: {
    fontFamily: typography.bold,
    fontSize: 28,
    lineHeight: 34,
    color: theme.ink,
    marginBottom: 8,
    minHeight: 34,
  },
  digitFilled: {
    color: theme.ink,
  },
  line: {
    width: '100%',
    height: 2,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  lineActive: {
    backgroundColor: theme.ink,
    height: 2.5,
  },
  lineFilled: {
    backgroundColor: theme.ink,
  },
  hidden: {
    ...StyleSheet.absoluteFill,
    opacity: 0.02,
    color: 'transparent',
  },
});
