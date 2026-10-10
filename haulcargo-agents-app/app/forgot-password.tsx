import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ForgotPasswordScreen() {
  const { resetPassword } = useCarrierSession();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <Screen scroll>
      <Header title="Badili nenosiri" back />
      <Text style={styles.sub}>Tutakutumia kiungo cha kubadili nenosiri kwenye barua pepe.</Text>
      <Field label="Barua pepe" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.ok}>{message}</Text> : null}
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
            setMessage('Barua ya kubadili nenosiri imetumwa.');
          } catch {
            setError('Imeshindwa. Jaribu tena.');
          } finally {
            setLoading(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: theme.muted, marginBottom: 20 },
  error: { color: theme.danger, marginBottom: 12 },
  ok: { color: theme.success, marginBottom: 12 },
});
