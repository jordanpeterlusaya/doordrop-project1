import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Header, PrimaryButton, Screen, Card } from '@/components/ui';
import { theme } from '@/constants/theme';
import { dropOffLabel, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

function stickerHtml(item: ReturnType<typeof useCarrierSession>['shipments'][0]) {
  const code = shipmentCode(item);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{font-family:sans-serif;padding:24px}
    .code{font-size:32px;font-weight:800;letter-spacing:2px}
    .row{margin-top:12px;font-size:14px}
    .brand{color:#14532d;font-weight:700}
  </style></head><body>
    <div class="brand">HAUL · Haul Cargo Agents</div>
    <div class="code">${code}</div>
    <div class="row">Kwenda: ${dropOffLabel(item)}</div>
    <div class="row">Uzito: ${item.weightKg || 0} kg</div>
    <div class="row">Mtumaji: ${item.customerName || '—'}</div>
    <div class="row">Mpokeaji: ${item.recipientName || '—'}</div>
    <div class="row">Nauli: ${money(item.cashExpected)}</div>
  </body></html>`;
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments } = useCarrierSession();
  const item = shipments.find((s) => s.id === id);

  if (!item) {
    return (
      <Screen>
        <Header title="Risiti" back />
        <Text>Mzigo haupatikani.</Text>
      </Screen>
    );
  }

  const sharePrint = async () => {
    const html = stickerHtml(item);
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Shiriki risiti' });
    }
  };

  return (
    <Screen scroll>
      <Header title="Risiti / Stika" back />
      <Card>
        <Text style={styles.brand}>HAUL Cargo</Text>
        <Text style={styles.code}>{shipmentCode(item)}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Kwenda</Text>
          <Text style={styles.value}>{dropOffLabel(item)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Uzito</Text>
          <Text style={styles.value}>{item.weightKg || 0} kg</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Mtumaji</Text>
          <Text style={styles.value}>{item.customerName || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Mpokeaji</Text>
          <Text style={styles.value}>{item.recipientName || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Nauli</Text>
          <Text style={styles.value}>{money(item.cashExpected)}</Text>
        </View>
      </Card>
      <PrimaryButton label="Shiriki / Chapisha PDF" onPress={() => void sharePrint()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { color: theme.green, fontWeight: '800', marginBottom: 8 },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 2, color: theme.charcoal, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: theme.muted },
  value: { fontWeight: '600', color: theme.charcoal, maxWidth: '60%', textAlign: 'right' },
});
