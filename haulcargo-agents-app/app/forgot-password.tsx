import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ForgotPasswordScreen() {
  const { resetPassword } = useCarrierSession();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <AuthShell
      title="Badili nenosiri"
      subtitle="Tutakutumia kiungo cha kubadili nenosiri kwenye barua pepe ya kampuni."
      footer={
        <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
          <Text style={styles.link}>Rudi kuingia</Text>
        </Pressable>
      }>
      <Field
        label="Barua pepe"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setError('');
          setMessage('');
        }}
      />
      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error}>
          {error}
        </Animated.Text>
      ) : null}
      {message ? (
        <Animated.Text entering={FadeIn} style={styles.ok}>
          {message}
        </Animated.Text>
      ) : null}
      <PrimaryButton
        label="Tuma barua"
        loading={loading}
        onPress={async () => {
          if (!email.trim()) {
            setError('Weka barua pepe kwanza.');
            return;
          }
          setLoading(true);
          setError('');
          try {
            await resetPassword(email);
            setMessage('Barua ya kubadili nenosiri imetumwa. Angalia inbox na spam.');
          } catch {
            setError('Imeshindwa. Hakikisha barua pepe na jaribu tena.');
          } finally {
            setLoading(false);
          }
        }}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { color: theme.danger, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13 },
  ok: { color: theme.success, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13 },
  linkWrap: { marginTop: 8 },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
});
