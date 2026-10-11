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

/** Six discrete OTP boxes — not underlines, not 8 digits. */
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
            <View
              key={index}
              style={[styles.box, active && styles.boxActive, digit ? styles.boxFilled : null]}>
              <Text style={styles.digit}>{digit}</Text>
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
    marginBottom: 16,
    marginTop: 4,
  },
  slots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  box: {
    flex: 1,
    aspectRatio: 0.9,
    maxHeight: 56,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  boxFilled: {
    borderColor: theme.navyMid,
  },
  digit: {
    fontFamily: typography.bold,
    fontSize: 22,
    lineHeight: 28,
    color: theme.ink,
  },
  hidden: {
    ...StyleSheet.absoluteFill,
    opacity: 0.02,
    color: 'transparent',
  },
});

