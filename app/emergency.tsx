import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme, type CargoIcon } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import {
  clearEmergencyContact,
  getEmergencyContact,
  saveEmergencyContact,
  toTelHref,
  type EmergencyContact,
} from '@/lib/emergency-contact';
import { useAuthSession } from '@/providers/auth-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

const EMERGENCY_NUMBER = '112';

type ProtectionPoint = {
  icon: CargoIcon;
  titleKey:
    | 'supportPointTitle'
    | 'ridersTitle'
    | 'privacyTitle'
    | 'staySafeTitle'
    | 'accidentTitle';
  textKey: 'supportPointText' | 'ridersText' | 'privacyText' | 'staySafeText' | 'accidentText';
};

const PROTECTION_POINTS: ProtectionPoint[] = [
  { icon: 'headset', titleKey: 'supportPointTitle', textKey: 'supportPointText' },
  { icon: 'account-check-outline', titleKey: 'ridersTitle', textKey: 'ridersText' },
  { icon: 'lock-outline', titleKey: 'privacyTitle', textKey: 'privacyText' },
  { icon: 'map-marker-path', titleKey: 'staySafeTitle', textKey: 'staySafeText' },
  { icon: 'alert-outline', titleKey: 'accidentTitle', textKey: 'accidentText' },
];

function firstPhone(contact: Contacts.Contact) {
  const phone = contact.phoneNumbers?.find((entry) => entry.number?.trim())?.number?.trim();
  return phone || '';
}

export default function EmergencyScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const { user } = useAuthSession();
  const [contact, setContact] = useState<EmergencyContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsDenied, setContactsDenied] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<Contacts.Contact[]>([]);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const uid = user?.uid;

  useEffect(() => {
    let active = true;
    void getEmergencyContact(uid).then((stored) => {
      if (active) {
        setContact(stored);
      }
    });
    return () => {
      active = false;
    };
  }, [uid]);

  const openPhone = useCallback(
    async (phone: string) => {
      try {
        await Linking.openURL(toTelHref(phone));
      } catch {
        Alert.alert(copy.emergency.callFailed, copy.emergency.callHint.replace('{phone}', phone));
      }
    },
    [copy.emergency.callFailed, copy.emergency.callHint]
  );

  const persistContact = useCallback(
    async (next: EmergencyContact) => {
      setSaving(true);
      try {
        await saveEmergencyContact(uid, next);
        setContact(next);
        setPickerOpen(false);
        setManualName('');
        setManualPhone('');
      } finally {
        setSaving(false);
      }
    },
    [uid]
  );

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setContactsLoading(true);
    setContactsDenied(false);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setContactsDenied(true);
        setDeviceContacts([]);
        return;
      }

      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 1000,
      });
      setDeviceContacts(result.data.filter((item) => firstPhone(item)));
    } catch {
      setContactsDenied(true);
      setDeviceContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const handleSaveManual = () => {
    const name = manualName.trim();
    const phone = manualPhone.trim();
    if (name.length < 2 || phone.replace(/\D/g, '').length < 3) {
      return;
    }
    void persistContact({ name, phone });
  };

  const handleRemove = () => {
    void clearEmergencyContact(uid).then(() => setContact(null));
  };

  const listedContacts = useMemo(
    () =>
      deviceContacts
        .map((item) => ({
          id: item.id || `${item.name}-${firstPhone(item)}`,
          name: item.name?.trim() || firstPhone(item),
          phone: firstPhone(item),
        }))
        .filter((item) => item.phone),
    [deviceContacts]
  );

  return (
    <>
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title={copy.emergency.title} onLeftPress={() => router.back()} />

      <View style={styles.actionGrid}>
        <TouchableOpacity activeOpacity={0.88} style={styles.actionTile} onPress={() => router.push('/support-center')}>
          <MaterialCommunityIcons name="message-text-outline" size={22} color={cargoTheme.colors.text} />
          <Text style={styles.actionTitle}>{copy.emergency.support}</Text>
          <Text style={styles.actionHint}>{copy.emergency.supportHint}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.88} style={styles.actionTile} onPress={() => void openPicker()}>
          <MaterialCommunityIcons name="account-plus-outline" size={22} color={cargoTheme.colors.text} />
          <Text style={styles.actionTitle}>{copy.emergency.emergencyContact}</Text>
          <Text numberOfLines={2} style={styles.actionHint}>
            {contact ? contact.name : copy.emergency.emergencyContactEmpty}
          </Text>
        </TouchableOpacity>
      </View>

      {contact ? (
        <View style={styles.contactCard}>
          <View style={styles.contactCopy}>
            <Text style={styles.contactName}>{contact.name}</Text>
            <Text style={styles.contactPhone}>{contact.phone}</Text>
          </View>
          <TouchableOpacity activeOpacity={0.88} style={styles.contactCall} onPress={() => void openPhone(contact.phone)}>
            <Text style={styles.contactCallText}>{copy.emergency.callContact}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={copy.emergency.call112}
        activeOpacity={0.9}
        style={styles.emergencyButton}
        onPress={() => void openPhone(EMERGENCY_NUMBER)}>
        <MaterialCommunityIcons name="phone" size={22} color={cargoTheme.colors.primary} />
        <View>
          <Text style={styles.emergencyButtonTitle}>{copy.emergency.call112}</Text>
          <Text style={styles.emergencyButtonHint}>{copy.emergency.call112Hint}</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>{copy.emergency.howProtected}</Text>
      <View style={styles.protectGrid}>
        {PROTECTION_POINTS.map((point) => (
          <View key={point.titleKey} style={styles.protectCard}>
            <View style={styles.protectIcon}>
              <MaterialCommunityIcons name={point.icon} size={22} color={cargoTheme.colors.text} />
            </View>
            <Text style={styles.protectTitle}>{copy.emergency[point.titleKey]}</Text>
            <Text style={styles.protectText}>{copy.emergency[point.textKey]}</Text>
          </View>
        ))}
      </View>
    </CargoScreen>

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{copy.emergency.pickContact}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.text} />
              </TouchableOpacity>
            </View>

            {contactsLoading ? (
              <ActivityIndicator color={cargoTheme.colors.text} style={styles.modalSpinner} />
            ) : contactsDenied ? (
              <Text style={styles.modalHint}>{copy.emergency.contactsDenied}</Text>
            ) : listedContacts.length ? (
              <FlatList
                data={listedContacts}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.contactList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={styles.pickerRow}
                    onPress={() => void persistContact({ name: item.name, phone: item.phone })}>
                    <View style={styles.pickerCopy}>
                      <Text style={styles.pickerName}>{item.name}</Text>
                      <Text style={styles.pickerPhone}>{item.phone}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.modalHint}>{copy.emergency.noContacts}</Text>
            )}

            <TextInput
              value={manualName}
              onChangeText={setManualName}
              placeholder={copy.emergency.manualName}
              placeholderTextColor={cargoTheme.colors.subtext}
              style={styles.input}
            />
            <TextInput
              value={manualPhone}
              onChangeText={setManualPhone}
              placeholder={copy.emergency.manualPhone}
              placeholderTextColor={cargoTheme.colors.subtext}
              keyboardType="phone-pad"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              {contact ? (
                <TouchableOpacity onPress={handleRemove}>
                  <Text style={styles.removeText}>{copy.emergency.removeContact}</Text>
                </TouchableOpacity>
              ) : (
                <View />
              )}
              <TouchableOpacity
                activeOpacity={0.88}
                disabled={saving}
                style={styles.saveButton}
                onPress={handleSaveManual}>
                <Text style={styles.saveButtonText}>{copy.emergency.saveContact}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 36,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionTile: {
    flex: 1,
    minHeight: 108,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    padding: 14,
    justifyContent: 'space-between',
    gap: 8,
  },
  actionTitle: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  actionHint: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: cargoTheme.colors.primarySoft,
  },
  contactCopy: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  contactPhone: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  contactCall: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCallText: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primary,
  },
  emergencyButton: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: cargoTheme.colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    marginBottom: 26,
  },
  emergencyButtonTitle: {
    fontSize: 18,
    fontFamily: typography.ident,
    color: '#FFFFFF',
  },
  emergencyButtonHint: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: typography.body,
    color: cargoTheme.colors.primary,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: typography.ident,
    color: cargoTheme.colors.text,
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  protectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  protectCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 148,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    padding: 14,
  },
  protectIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  protectTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    marginBottom: 6,
  },
  protectText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '86%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: typography.ident,
    color: cargoTheme.colors.text,
  },
  modalSpinner: {
    marginVertical: 24,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 12,
  },
  contactList: {
    maxHeight: 240,
    marginBottom: 12,
  },
  pickerRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  pickerCopy: {
    gap: 2,
  },
  pickerName: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  pickerPhone: {
    fontSize: 13,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    marginBottom: 10,
    fontSize: 15,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
    backgroundColor: '#F8FAFC',
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  removeText: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: '#DC2626',
  },
  saveButton: {
    minHeight: cargoTheme.cta.minHeight,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
