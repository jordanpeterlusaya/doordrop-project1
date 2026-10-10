import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AuthShell } from '@/components/auth-shell';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

/** Phone OTP is the primary sign-in — point users there instead of email reset. */
export default function ForgotPasswordScreen() {
  return (
    <AuthShell
      title="Sign in with phone"
      subtitle="HAUL Agents uses SMS verification. Enter your company phone to receive a code."
      footer={
        <Pressable onPress={() => router.replace('/register')} style={styles.linkWrap}>
          <Text style={styles.muted}>
            New company? <Text style={styles.link}>Register</Text>
          </Text>
        </Pressable>
      }>
      <Text style={styles.body}>
        No password needed. We send a one-time code to the phone on your carrier account.
      </Text>
      <PrimaryButton label="Continue" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: theme.muted,
    marginBottom: 18,
  },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
});
