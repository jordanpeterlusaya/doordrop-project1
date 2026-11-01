import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import type { DeliveryOrder } from '@/lib/delivery-data';
import {
  buildOrderReceiptModel,
  buildReceiptBarcodeWidths,
  callReceiptPhone,
  downloadOrderReceiptPdf,
} from '@/lib/outside-parcel-receipt';
import { useLanguage } from '@/providers/language-provider';

type OutsideParcelReceiptModalProps = {
  visible: boolean;
  order: DeliveryOrder | null;
  originCity?: string;
  onContinue: () => void;
  onDismiss?: () => void;
  showContinue?: boolean;
};

function ReceiptBarcode({ value }: { value: string }) {
  const widths = useMemo(() => buildReceiptBarcodeWidths(value), [value]);

  return (
    <View style={styles.barcodeBlock}>
      <View style={styles.barcodeRow}>
        {widths.map((width, index) => (
          <View
            key={`${index}-${width}`}
            style={[
              styles.barcodeBar,
              {
                width,
                backgroundColor: index % 2 === 0 ? '#FFFFFF' : 'transparent',
              },
            ]}
          />
        ))}
      </View>
      <Text style={styles.barcodeCaption}>{value}</Text>
    </View>
  );
}

export function OutsideParcelReceiptModal({
  visible,
  order,
  originCity,
  onContinue,
  onDismiss,
  showContinue = false,
}: OutsideParcelReceiptModalProps) {
  const copy = useAppCopy();
  const { language } = useLanguage();
  const { height: screenHeight } = useWindowDimensions();
  const [downloading, setDownloading] = useState(false);
  const close = onDismiss ?? onContinue;

  const model = useMemo(
    () => (order ? buildOrderReceiptModel(order, language, originCity) : null),
    [language, order, originCity]
  );

  const handleDownload = async () => {
    if (!order || downloading) {
      return;
    }
    setDownloading(true);
    try {
      await downloadOrderReceiptPdf({
        order,
        language,
        originCity,
      });
    } catch {
      // Alert is shown by downloadOrderReceiptPdf.
    } finally {
      setDownloading(false);
    }
  };

  const handleCall = () => {
    if (!model?.recipientPhoneDialable) {
      return;
    }
    void callReceiptPhone(model.recipientPhoneDialable);
  };

  if (!order || !visible || !model) {
    return null;
  }

  const initials = model.recipientName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" />
        <View style={[styles.card, { maxHeight: screenHeight * 0.92 }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.cardScroll}
            bounces={false}>
            <View style={styles.header}>
              <Pressable
                onPress={close}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <MaterialCommunityIcons name="close" size={18} color="#111827" />
              </Pressable>
              <Text style={styles.title}>{copy.parcel.receiptTitle}</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.personRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials || 'H'}</Text>
              </View>
              <View style={styles.personCopy}>
                <Text style={styles.personName} numberOfLines={1}>
                  {model.recipientName}
                </Text>
                <Text style={styles.personPhone} numberOfLines={1}>
                  {model.recipientPhone}
                </Text>
              </View>
              {model.recipientPhoneDialable ? (
                <Pressable
                  onPress={handleCall}
                  style={styles.callButton}
                  accessibilityRole="button"
                  accessibilityLabel={copy.parcel.receiptCall}>
                  <MaterialCommunityIcons name="phone" size={18} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.ticket}>
              <Text style={styles.brandMark}>{copy.parcel.receiptBrand}</Text>
              {model.rows.map((row, index) => (
                <View
                  key={`${row.label}-${row.value}`}
                  style={[styles.ticketRow, index === model.rows.length - 1 && styles.ticketRowLast]}>
                  <Text style={styles.ticketLabel}>{row.label}</Text>
                  <Text style={styles.ticketValue}>{row.value}</Text>
                </View>
              ))}
              <View style={styles.perforation} />
              <ReceiptBarcode value={model.trackingCode} />
            </View>

            {model.paymentLabel ? (
              <View style={styles.paymentRow}>
                <View>
                  <Text style={styles.paymentLabel}>{copy.parcel.receiptPayment}</Text>
                  <Text style={styles.paymentValue}>{model.paymentLabel}</Text>
                </View>
              </View>
            ) : null}

            <PrimaryButton
              label={downloading ? copy.parcel.receiptDownloadingPdf : copy.parcel.receiptDownloadPdf}
              onPress={() => void handleDownload()}
              icon="download-outline"
              disabled={downloading}
              style={downloading ? styles.buttonBusy : undefined}
            />

            {showContinue ? (
              <Pressable onPress={onContinue} style={styles.skipLink} accessibilityRole="button">
                <Text style={styles.skipLinkText}>{copy.parcel.receiptContinue}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(244, 246, 248, 0.96)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  cardScroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 36,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: typography.bold,
    color: '#111827',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: '#111827',
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: '#111827',
  },
  personPhone: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  callButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticket: {
    backgroundColor: '#111111',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  brandMark: {
    textAlign: 'center',
    fontSize: 11,
    letterSpacing: 2.4,
    fontFamily: typography.bold,
    color: '#94A3B8',
    marginBottom: 10,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  ticketRowLast: {
    paddingBottom: 4,
  },
  ticketLabel: {
    fontSize: 13,
    fontFamily: typography.body,
    color: '#94A3B8',
  },
  ticketValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 13,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
  perforation: {
    height: 1,
    marginTop: 10,
    marginBottom: 14,
    backgroundColor: '#334155',
    opacity: 0.9,
  },
  barcodeBlock: {
    alignItems: 'center',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 44,
    overflow: 'hidden',
  },
  barcodeBar: {
    height: 44,
  },
  barcodeCaption: {
    marginTop: 8,
    fontSize: 11,
    letterSpacing: 1.4,
    fontFamily: typography.semibold,
    color: '#E2E8F0',
  },
  paymentRow: {
    paddingHorizontal: 4,
  },
  paymentLabel: {
    fontSize: 12,
    fontFamily: typography.body,
    color: '#94A3B8',
  },
  paymentValue: {
    marginTop: 2,
    fontSize: 20,
    fontFamily: typography.bold,
    color: '#111827',
  },
  buttonBusy: {
    opacity: 0.55,
  },
  skipLink: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  skipLinkText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
});
