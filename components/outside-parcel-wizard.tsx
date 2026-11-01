import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { parsePhoneValue, PhoneInput, toE164Phone } from '@/components/phone-input';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  isZanzibarSeaDestination,
  type OutsideDestinationCity,
  type OutsideHub,
  type OutsideShippingMode,
} from '@/lib/outside-parcel';
import { BUS_CORRIDOR_COPY, groupDestinationsByBusCorridor } from '@/lib/tanzania-bus-regions';

export type WizardStep = 1 | 2 | 3;
export type OutsideParcelSizePreset = 'ndogo' | 'wastani' | 'kubwa' | 'kubwa_sana';

export type OutsideParcelSizeOption = {
  key: OutsideParcelSizePreset;
  title: string;
  subtitle: string;
  disabled?: boolean;
};

type Props = {
  language: 'sw' | 'en';
  step: WizardStep;
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
  continueEnabled: boolean;
  pickupLabel: string;
  originLabel: string;
  destinations: OutsideDestinationCity[];
  selectedCityKey: string | null;
  selectedCityLabel: string | null;
  onSelectCity: (cityKey: OutsideDestinationCity['key']) => void;
  onClearCity: () => void;
  shippingMode: OutsideShippingMode | null;
  onSelectMode: (mode: OutsideShippingMode) => void;
  expressAvailable: boolean;
  expressPrice: string;
  expressEta: string;
  busAvailable: boolean;
  busPrice: string;
  busEta: string;
  sizeOptions: OutsideParcelSizeOption[];
  sizePreset: OutsideParcelSizePreset | null;
  onSelectSize: (key: OutsideParcelSizePreset) => void;
  weightKg: string;
  onChangeWeight: (value: string) => void;
  weightHint: string;
  weightError: string | null;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  onChangeLength: (value: string) => void;
  onChangeWidth: (value: string) => void;
  onChangeHeight: (value: string) => void;
  volumetricHint: string | null;
  onApplyVolumetric: (() => void) | null;
  photoUri: string | null;
  photoError: string | null;
  photoUploaded?: boolean;
  photoUploading?: boolean;
  cameraAvailable: boolean;
  onCapturePhoto: () => void;
  onPickLibrary: () => void;
  onClearPhoto: () => void;
  recipientName: string;
  onChangeName: (value: string) => void;
  recipientPhone: string;
  onChangePhone: (value: string) => void;
  notifyRecipient: boolean;
  onToggleNotify: () => void;
  notifyLabel: string;
  declaredValue: string;
  onChangeDeclaredValue: (value: string) => void;
  homeAddressRequired: boolean;
  homeAddressReady: boolean;
  homeAddressLabel: string;
  onOpenHomeAddress: () => void;
  flightLabel: string | null;
  flightPicker: React.ReactNode;
  stands: OutsideHub[];
  airports: OutsideHub[];
  selectedStandId: string | null;
  onSelectStand: (standId: string) => void;
  summaryLine: string;
  legalAccepted: boolean;
  onToggleLegal: () => void;
  onOpenLegal: () => void;
  legalBody: string;
  legalCheckbox: string;
};

const copy = {
  sw: {
    title1: 'Mkoa',
    title2: 'Mpokeaji',
    title3: 'Ukubwa',
    from: 'Kutoka',
    to: 'Mkoa',
    where: 'Chagua mkoa',
    how: 'Usafiri',
    air: 'Ndege',
    bus: 'Basi',
    company: 'Kampuni',
    quotePrice: 'Bei baada ya kampuni',
    photo: 'Picha ya mzigo',
    photoHint: 'Piga picha ya mzigo. Kampuni itaona picha hii kabla ya kutuma bei.',
    takePhoto: 'Piga picha',
    library: 'Chagua picha',
    clearPhoto: 'Ondoa',
    photoUploading: 'Inapakia picha…',
    photoUploaded: 'Picha imepakia. Unaweza kuendelea.',
    photoNeeded: 'Lazima upakie picha kabla ya kuendelea.',
    ferry: 'Ferry',
    unavailable: 'Haipatikani',
    size: 'Ukubwa',
    name: 'Jina',
    phone: 'Simu',
    value: 'Thamani (TZS)',
    addAddress: 'Anwani',
    flight: 'Ndege',
    stand: 'Stendi',
    airport: 'Uwanja',
    search: 'Tafuta mkoa',
    contacts: 'Contacts',
    pickContact: 'Contact',
    searchContacts: 'Tafuta',
    noContacts: 'Hakuna',
    closeContacts: 'Funga',
    noMatch: 'Hakuna mkoa',
    notify: 'SMS',
  },
  en: {
    title1: 'Region',
    title2: 'Recipient',
    title3: 'Size',
    from: 'From',
    to: 'Region',
    where: 'Choose region',
    how: 'Travel',
    air: 'Plane',
    bus: 'Bus',
    company: 'Company',
    quotePrice: 'Price after the company',
    photo: 'Cargo photo',
    photoHint: 'Take a photo of the cargo. The company sees it before sending a price.',
    takePhoto: 'Take photo',
    library: 'Choose photo',
    clearPhoto: 'Remove',
    photoUploading: 'Uploading photo…',
    photoUploaded: 'Photo uploaded. You can continue.',
    photoNeeded: 'You must upload a photo before continuing.',
    ferry: 'Ferry',
    unavailable: 'Unavailable',
    size: 'Size',
    name: 'Name',
    phone: 'Phone',
    value: 'Value (TZS)',
    addAddress: 'Address',
    flight: 'Flight',
    stand: 'Stand',
    airport: 'Airport',
    search: 'Search region',
    contacts: 'Contacts',
    pickContact: 'Contact',
    searchContacts: 'Search',
    noContacts: 'None',
    closeContacts: 'Close',
    noMatch: 'No match',
    notify: 'SMS',
  },
};

function applyContactPhone(rawPhone: string, onChangePhone: (value: string) => void) {
  const parsed = parsePhoneValue(rawPhone);
  onChangePhone(toE164Phone(parsed.country, parsed.national) || rawPhone);
}

export function OutsideParcelWizard({
  language,
  step,
  onBack,
  onContinue,
  continueLabel,
  continueEnabled,
  pickupLabel,
  originLabel,
  destinations,
  selectedCityKey,
  selectedCityLabel,
  onSelectCity,
  shippingMode,
  onSelectMode,
  expressAvailable,
  expressPrice,
  busAvailable,
  sizeOptions,
  sizePreset,
  onSelectSize,
  recipientName,
  onChangeName,
  recipientPhone,
  onChangePhone,
  photoUri,
  photoError,
  photoUploaded = false,
  photoUploading = false,
  onCapturePhoto,
  onPickLibrary,
  onClearPhoto,
  declaredValue,
  onChangeDeclaredValue,
  homeAddressRequired,
  homeAddressReady,
  homeAddressLabel,
  onOpenHomeAddress,
  flightPicker,
  stands,
  airports,
  selectedStandId,
  onSelectStand,
}: Props) {
  const t = copy[language];
  const corridorCopy = BUS_CORRIDOR_COPY[language];
  const insets = useSafeAreaInsets();
  const [destinationOpen, setDestinationOpen] = useState(!selectedCityKey);
  const [regionQuery, setRegionQuery] = useState('');
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!selectedCityKey) {
      setDestinationOpen(true);
    }
  }, [selectedCityKey]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const visibleDestinations = useMemo(() => {
    const query = regionQuery.trim().toLowerCase();
    if (!query) {
      return destinations;
    }
    return destinations.filter((city) => {
      const standHit = city.stands.some((stand) => stand.label.toLowerCase().includes(query));
      return city.label.toLowerCase().includes(query) || city.key.includes(query) || standHit;
    });
  }, [destinations, regionQuery]);

  const destinationGroups = useMemo(
    () => groupDestinationsByBusCorridor(visibleDestinations),
    [visibleDestinations]
  );

  const title = step === 1 ? t.title1 : step === 2 ? t.title2 : t.title3;
  const seaDestination = isZanzibarSeaDestination({ key: selectedCityKey, label: selectedCityLabel });
  const standardTitle = seaDestination ? t.ferry : t.company;
  const standardIcon = seaDestination ? 'ferry' : 'truck';
  const handoffHubs = shippingMode === 'express' ? airports : stands;
  const handoffTitle = shippingMode === 'express' ? t.airport : seaDestination ? t.ferry : t.stand;
  const handoffIcon = shippingMode === 'express' ? 'airplane' : seaDestination ? 'ferry' : 'bus-stop';

  const visibleContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    return contacts
      .filter((contact) => (contact.phoneNumbers?.length ?? 0) > 0)
      .filter((contact) => {
        if (!query) {
          return true;
        }
        const name = (contact.name ?? '').toLowerCase();
        const phone = contact.phoneNumbers?.[0]?.number?.toLowerCase() ?? '';
        return name.includes(query) || phone.includes(query);
      })
      .slice(0, 40);
  }, [contactQuery, contacts]);

  const openContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    const result = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
      pageSize: 2000,
      sort: Contacts.SortTypes.FirstName,
    });
    setContacts(result.data.filter((contact) => (contact.phoneNumbers?.length ?? 0) > 0));
    setContactQuery('');
    setContactsOpen(true);
  };

  const footerPad = Math.max(insets.bottom, 16) + (Platform.OS === 'ios' ? 0 : Math.min(keyboardHeight, 24));

  const handlePickCity = (city: OutsideDestinationCity) => {
    Keyboard.dismiss();
    setRegionQuery('');
    setDestinationOpen(false);
    onSelectCity(city.key);
  };

  const handleOpenDestination = () => {
    setRegionQuery('');
    setDestinationOpen(true);
  };

  const handleBack = () => {
    if (step === 1 && destinationOpen && selectedCityKey) {
      setDestinationOpen(false);
      setRegionQuery('');
      return;
    }
    onBack();
  };

  const renderHubList = (hubs: OutsideHub[]) => {
    if (hubs.length === 0) {
      return null;
    }

    return (
      <View style={styles.standList}>
        {hubs.map((hub) => {
          const active = hub.id === selectedStandId;
          return (
            <Pressable
              key={hub.id}
              accessibilityRole="button"
              onPress={() => onSelectStand(hub.id)}
              style={styles.listRow}>
              <View style={[styles.iconBubble, active && styles.iconBubbleActive]}>
                <MaterialCommunityIcons name={handoffIcon} size={18} color="#111827" />
              </View>
              <Text style={styles.listTitle}>{hub.label}</Text>
              {active ? <MaterialCommunityIcons name="check" size={20} color="#111827" /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderSizeRows = (compact = false) => (
    <View style={styles.sizeList}>
      {sizeOptions.map((option) => {
        const active = sizePreset === option.key;
        return (
          <Pressable
            key={option.key}
            disabled={option.disabled}
            accessibilityRole="button"
            onPress={() => onSelectSize(option.key)}
            style={[
              styles.sizeRow,
              option.disabled && styles.sizeRowDisabled,
              compact && styles.sizeRowCompact,
            ]}>
            <View style={[styles.sizeIcon, active && styles.sizeIconActive]}>
              <MaterialCommunityIcons
                name={
                  option.key === 'ndogo'
                    ? 'package-variant'
                    : option.key === 'wastani'
                      ? 'package'
                      : option.key === 'kubwa_sana'
                        ? 'cube-outline'
                        : 'package-variant-closed'
                }
                size={20}
                color="#111827"
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.sizeTitle}>{option.title}</Text>
              <Text style={styles.sizeMeta}>{option.subtitle}</Text>
            </View>
            {active ? <View style={styles.radioOn} /> : <View style={styles.radioOff} />}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={handleBack} style={styles.iconBtn} hitSlop={12}>
            <MaterialCommunityIcons name={step === 1 && !selectedCityKey ? 'close' : 'chevron-left'} size={26} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.progressRow}>
          {[1, 2, 3].map((item) => (
            <View key={item} style={[styles.progressSeg, item <= step && styles.progressSegOn]} />
          ))}
        </View>

        {step === 1 && destinationOpen ? (
          <View style={styles.searchWrap}>
            <View style={styles.searchShell}>
              <MaterialCommunityIcons name="magnify" size={20} color="#9CA3AF" />
              <TextInput
                value={regionQuery}
                onChangeText={setRegionQuery}
                placeholder={t.search}
                placeholderTextColor="#9CA3AF"
                style={styles.searchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {regionQuery ? (
                <Pressable onPress={() => setRegionQuery('')} hitSlop={8}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#9CA3AF" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <ScrollView
          key={`${step}-${destinationOpen ? 'regions' : selectedCityKey ?? 'blank'}`}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {step === 1 ? (
            <>
              <View style={styles.selectRow}>
                <View style={styles.selectStack}>
                  <Text style={styles.selectEyebrow}>{t.from}</Text>
                  <Text numberOfLines={1} style={styles.selectValue}>
                    {pickupLabel || originLabel}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={handleOpenDestination}
                style={styles.selectRow}>
                <View style={styles.selectStack}>
                  <Text style={styles.selectEyebrow}>{t.to}</Text>
                  <Text numberOfLines={1} style={styles.selectValue}>
                    {selectedCityLabel || t.where}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#111827" />
              </Pressable>

              {destinationOpen ? (
                <>
                  {destinationGroups.length === 0 ? <Text style={styles.help}>{t.noMatch}</Text> : null}
                  {destinationGroups.map((group) => (
                    <View key={group.id} style={styles.corridorBlock}>
                      <Text style={styles.corridorLabel}>{corridorCopy[group.id]}</Text>
                      {group.cities.map((city) => {
                        const active = city.key === selectedCityKey;
                        return (
                          <Pressable
                            key={city.key}
                            accessibilityRole="button"
                            onPress={() => handlePickCity(city)}
                            style={styles.cityRow}>
                            <Text style={[styles.cityName, active && styles.cityNameActive]}>{city.label}</Text>
                            {active ? <MaterialCommunityIcons name="check" size={20} color="#111827" /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>{t.how}</Text>
                  <View style={styles.modeGrid}>
                    <Pressable
                      disabled={!busAvailable}
                      onPress={() => onSelectMode('standard')}
                      style={[
                        styles.modeCard,
                        shippingMode === 'standard' && styles.modeCardActive,
                        !busAvailable && styles.modeCardDisabled,
                      ]}>
                      {shippingMode === 'standard' ? (
                        <MaterialCommunityIcons name="check" size={18} color="#111827" style={styles.modeCheck} />
                      ) : null}
                      <MaterialCommunityIcons
                        name={standardIcon}
                        size={30}
                        color={busAvailable ? '#111827' : '#9CA3AF'}
                      />
                      <Text style={styles.modeTitle}>{standardTitle}</Text>
                      <Text style={styles.modeMeta}>{busAvailable ? t.quotePrice : t.unavailable}</Text>
                    </Pressable>
                    <Pressable
                      disabled={!expressAvailable}
                      onPress={() => onSelectMode('express')}
                      style={[
                        styles.modeCard,
                        shippingMode === 'express' && styles.modeCardActive,
                        !expressAvailable && styles.modeCardDisabled,
                      ]}>
                      {shippingMode === 'express' ? (
                        <MaterialCommunityIcons name="check" size={18} color="#111827" style={styles.modeCheck} />
                      ) : null}
                      <MaterialCommunityIcons
                        name="airplane"
                        size={30}
                        color={expressAvailable ? '#111827' : '#9CA3AF'}
                      />
                      <Text style={styles.modeTitle}>{t.air}</Text>
                      <Text style={styles.modeMeta}>{expressAvailable ? expressPrice : t.unavailable}</Text>
                    </Pressable>
                  </View>

                  {shippingMode === 'express' && flightPicker ? <View style={styles.flightWrap}>{flightPicker}</View> : null}

                  {shippingMode === 'standard' && handoffHubs.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>{handoffTitle}</Text>
                      {renderHubList(handoffHubs)}
                    </>
                  ) : null}

                  {shippingMode === 'express' && handoffHubs.length > 1 ? (
                    <>
                      <Text style={styles.sectionTitle}>{handoffTitle}</Text>
                      {renderHubList(handoffHubs)}
                    </>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={styles.fieldLabel}>{t.name}</Text>
              <View style={styles.nameRow}>
                <View style={[styles.inputShell, styles.nameInput]}>
                  <TextInput
                    value={recipientName}
                    onChangeText={onChangeName}
                    placeholder={t.name}
                    placeholderTextColor="#9CA3AF"
                    style={styles.input}
                    autoCapitalize="words"
                  />
                </View>
                <Pressable onPress={() => void openContacts()} style={styles.contactBtn} accessibilityRole="button">
                  <MaterialCommunityIcons name="account-plus" size={20} color="#111827" />
                  <Text style={styles.contactBtnText}>{t.contacts}</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t.phone}</Text>
              <PhoneInput value={recipientPhone} onChangeText={onChangePhone} />

              {homeAddressRequired ? (
                <Pressable onPress={onOpenHomeAddress} style={styles.addressRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={20} color="#111827" />
                  <Text numberOfLines={2} style={styles.addressText}>
                    {homeAddressReady ? homeAddressLabel : t.addAddress}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
                </Pressable>
              ) : null}

            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.fieldLabel}>{t.photo}</Text>
              <Text style={styles.help}>{t.photoHint}</Text>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              ) : (
                <View style={styles.photoEmpty}>
                  <MaterialCommunityIcons name="camera-outline" size={28} color="#111827" />
                </View>
              )}
              {photoUploading ? <Text style={styles.photoStatus}>{t.photoUploading}</Text> : null}
              {photoUploaded && !photoUploading ? (
                <Text style={styles.photoStatusOk}>{t.photoUploaded}</Text>
              ) : null}
              {photoError ? <Text style={styles.photoStatusErr}>{photoError}</Text> : null}
              {!photoUri && !photoUploading ? <Text style={styles.help}>{t.photoNeeded}</Text> : null}
              <View style={styles.photoActions}>
                <Pressable
                  onPress={onCapturePhoto}
                  disabled={photoUploading}
                  style={[styles.photoBtn, photoUploading && styles.photoBtnOff]}
                  accessibilityRole="button">
                  <Text style={styles.photoBtnText}>{t.takePhoto}</Text>
                </Pressable>
                <Pressable
                  onPress={onPickLibrary}
                  disabled={photoUploading}
                  style={[styles.photoBtn, photoUploading && styles.photoBtnOff]}
                  accessibilityRole="button">
                  <Text style={styles.photoBtnText}>{t.library}</Text>
                </Pressable>
                {photoUri ? (
                  <Pressable
                    onPress={onClearPhoto}
                    disabled={photoUploading}
                    style={[styles.photoBtn, photoUploading && styles.photoBtnOff]}
                    accessibilityRole="button">
                    <Text style={styles.photoBtnText}>{t.clearPhoto}</Text>
                  </Pressable>
                ) : null}
              </View>
              {renderSizeRows()}

              <Text style={styles.fieldLabel}>{t.value}</Text>
              <View style={styles.inputShell}>
                <Text style={styles.suffix}>TZS</Text>
                <TextInput
                  value={declaredValue}
                  onChangeText={onChangeDeclaredValue}
                  keyboardType="number-pad"
                  placeholder="50,000"
                  placeholderTextColor="#9CA3AF"
                  style={styles.input}
                />
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerPad }]}>
          <Pressable
            accessibilityRole="button"
            disabled={!continueEnabled}
            onPress={() => {
              Keyboard.dismiss();
              onContinue();
            }}
            style={[styles.cta, !continueEnabled && styles.ctaOff]}>
            <Text style={[styles.ctaText, !continueEnabled && styles.ctaTextOff]}>{continueLabel}</Text>
            {continueEnabled ? <MaterialCommunityIcons name="arrow-right" size={20} color="#111827" /> : null}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={contactsOpen} animationType="slide" transparent onRequestClose={() => setContactsOpen(false)}>
        <View style={styles.contactOverlay}>
          <Pressable style={styles.contactBackdrop} onPress={() => setContactsOpen(false)} />
          <View style={[styles.contactSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.contactHandle} />
            <View style={styles.contactHead}>
              <Text style={styles.contactTitle}>{t.pickContact}</Text>
              <Pressable onPress={() => setContactsOpen(false)} hitSlop={10}>
                <Text style={styles.contactClose}>{t.closeContacts}</Text>
              </Pressable>
            </View>
            <View style={styles.searchShell}>
              <MaterialCommunityIcons name="magnify" size={20} color="#6B7280" />
              <TextInput
                value={contactQuery}
                onChangeText={setContactQuery}
                placeholder={t.searchContacts}
                placeholderTextColor="#9CA3AF"
                style={styles.searchInput}
                autoFocus
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.contactScroll}>
              {visibleContacts.map((contact, index) => {
                const phone = contact.phoneNumbers?.[0]?.number?.trim();
                if (!phone) {
                  return null;
                }
                return (
                  <Pressable
                    key={`${contact.name ?? 'contact'}-${phone}-${index}`}
                    onPress={() => {
                      onChangeName(contact.name ?? '');
                      applyContactPhone(phone, onChangePhone);
                      setContactsOpen(false);
                    }}
                    style={styles.contactRow}>
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactInitial}>{(contact.name ?? '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactPhone}>{phone}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {visibleContacts.length === 0 ? <Text style={styles.help}>{t.noContacts}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 4,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 26,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.4,
  },
  headerSpacer: {
    width: 44,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
  },
  progressSegOn: {
    backgroundColor: cargoTheme.colors.primary,
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  searchShell: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.medium,
    color: '#111827',
    paddingVertical: 12,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 4,
  },
  selectRow: {
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectStack: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  selectEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: '#9CA3AF',
  },
  selectValue: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.ident,
    color: '#111827',
  },
  corridorBlock: {
    marginTop: 20,
  },
  corridorLabel: {
    marginBottom: 4,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
    fontFamily: typography.semibold,
    color: '#9CA3AF',
  },
  cityRow: {
    minHeight: 56,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  cityName: {
    fontSize: 16,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  cityNameActive: {
    color: '#111827',
  },
  modeGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  modeCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  modeCardActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
  },
  modeCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  modeCardDisabled: {
    opacity: 0.4,
  },
  modeTitle: {
    fontSize: 16,
    fontFamily: typography.ident,
    color: '#111827',
  },
  modeMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: '#6B7280',
    textAlign: 'center',
  },
  flightWrap: {
    marginTop: 16,
  },
  quietRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quietText: {
    flex: 1,
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  sizeList: {
    gap: 12,
  },
  sizeRow: {
    minHeight: 72,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sizeRowCompact: {
    minHeight: 64,
  },
  sizeRowDisabled: {
    opacity: 0.38,
  },
  sizeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeIconActive: {
    backgroundColor: 'transparent',
  },
  sizeTitle: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: '#111827',
  },
  sizeMeta: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  radioOff: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
  },
  radioOn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: cargoTheme.colors.primary,
    borderWidth: 5,
    borderColor: '#111827',
  },
  summaryCard: {
    backgroundColor: '#F7F7F5',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontFamily: typography.medium,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  routeLine: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
    marginBottom: 8,
  },
  fieldLabel: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  inputShell: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  inputShellError: {
    borderColor: '#DC2626',
  },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
    paddingVertical: 12,
  },
  suffix: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#6B7280',
    marginHorizontal: 4,
  },
  help: {
    marginTop: 6,
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  helpError: {
    color: '#DC2626',
    marginTop: 8,
  },
  addressRow: {
    marginTop: 22,
    minHeight: 56,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  addressText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  legalBody: {
    marginTop: 22,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#374151',
  },
  termsRow: {
    marginTop: 14,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#F7F7F5',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  termsText: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  checkRow: {
    marginTop: 22,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  checkRowOn: {
    backgroundColor: '#FFFFFF',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: '#111827',
  },
  checkLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.medium,
    color: '#111827',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  cta: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  ctaOff: {
    backgroundColor: '#F3F4F6',
  },
  ctaText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
  ctaTextOff: {
    color: '#9CA3AF',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameInput: {
    flex: 1,
  },
  contactBtn: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cargoTheme.colors.primary,
    gap: 2,
    minWidth: 84,
  },
  contactBtnText: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  standList: {
    gap: 0,
    marginBottom: 8,
  },
  listRow: {
    minHeight: 64,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  listTitle: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  listMeta: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  iconBubble: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconBubbleActive: {
    backgroundColor: 'transparent',
  },
  scanTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.4,
  },
  scanHint: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  scanFrame: {
    height: 240,
    borderRadius: 20,
    backgroundColor: '#F7F7F5',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  scanEmpty: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  scanEmptyText: {
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  scanCorner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: cargoTheme.colors.primary,
    zIndex: 2,
  },
  scanTL: {
    top: 14,
    left: 14,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  scanTR: {
    top: 14,
    right: 14,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  scanBL: {
    bottom: 14,
    left: 14,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  scanBR: {
    bottom: 14,
    right: 14,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },
  scanActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  ghostBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ghostBtnText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  dimRow: {
    marginTop: 22,
    flexDirection: 'row',
    gap: 8,
  },
  dimCell: {
    flex: 1,
  },
  dimLabel: {
    marginBottom: 6,
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dimShell: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  dimInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.bold,
    color: '#111827',
    paddingVertical: 10,
    textAlign: 'center',
  },
  estimateRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  estimateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  estimateAction: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#111827',
    textDecorationLine: 'underline',
  },
  contactOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17,24,39,0.4)',
  },
  contactBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  contactSheet: {
    maxHeight: '78%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  contactHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    marginBottom: 12,
  },
  contactHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  contactTitle: {
    fontSize: 18,
    fontFamily: typography.bold,
    color: '#111827',
  },
  contactClose: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  contactScroll: {
    maxHeight: 420,
  },
  contactRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: cargoTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInitial: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: '#111827',
  },
  contactName: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  contactPhone: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: 16,
    marginTop: 8,
    backgroundColor: '#F3F4F6',
  },
  photoEmpty: {
    height: 120,
    borderRadius: 16,
    marginTop: 8,
    backgroundColor: '#F5E000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 16,
  },
  photoBtn: {
    backgroundColor: '#111827',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  photoBtnText: {
    color: '#FFFFFF',
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  photoBtnOff: {
    opacity: 0.5,
  },
  photoStatus: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#374151',
  },
  photoStatusOk: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#15803D',
  },
  photoStatusErr: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#DC2626',
  },
});
