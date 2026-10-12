import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { LocationSuggestionsList } from '@/components/location-suggestions-list';
import { NinunulieSuccessPopup } from '@/components/ninunulie-success-popup';
import { PhoneInput } from '@/components/phone-input';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  ensureCustomerLocation,
  getCustomerLocationSnapshot,
  subscribeCustomerLocation,
} from '@/lib/customer-location';
import { createNinunulieOrder } from '@/lib/delivery-data';
import {
  createSearchSessionToken,
  fetchLocationSuggestions,
  getInstantLocationSuggestions,
  retrieveLocationSuggestion,
  type LocationSuggestion,
} from '@/lib/location-search';
import {
  asLocalImageUri,
  extractUrlFromText,
  parseNinunulieShareParams,
  type NinunulieSourceMode,
} from '@/lib/ninunulie-share';
import { formatScheduleSummary } from '@/lib/schedule-delivery';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

const MAX_PHOTOS = 4;
const HAUL_SOURCE_PHONE = 'HAUL-SOURCE';

type Step = 'start' | 'item' | 'source' | 'delivery' | 'confirm';
type Photo = { id: string; localUri: string; remoteUrl?: string; uploading?: boolean };
type MarketKey = 'kariakoo' | 'mchikichini' | 'mwenge' | 'nyingine';

type MediaApi = {
  pickOrderImageFromLibrary: (o?: { selectionLimit?: number }) => Promise<Array<{ uri: string }>>;
  pickOrderImageFromCamera: () => Promise<{ uri: string } | null>;
  uploadNinunuliePhoto: (p: {
    userId: string;
    localUri: string;
  }) => Promise<{ downloadURL: string }>;
  openAppSettings?: () => Promise<boolean>;
};

const WORK_STEPS: Step[] = ['item', 'source', 'delivery', 'confirm'];

const PROCESS_STEPS = [
  'HAUL inapokea ombi na kutafuta duka',
  'Unalipa mfanyabiashara kwa namba ya simu',
  'Agent anasimamia makabidhiano, kisha tunasafirisha',
];

const MARKETS: { key: MarketKey; label: string }[] = [
  { key: 'kariakoo', label: 'Kariakoo' },
  { key: 'mchikichini', label: 'Mchikichini' },
  { key: 'mwenge', label: 'Mwenge' },
  { key: 'nyingine', label: 'Lingine' },
];

function mediaApi(): MediaApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/lib/order-media') as MediaApi;
}

function photoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, '');
}

function firstParam(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function marketRegion(key: MarketKey, custom: string) {
  if (key === 'nyingine') {
    return custom.trim() || 'Dar es Salaam';
  }
  const found = MARKETS.find((item) => item.key === key);
  return `${found?.label || 'Kariakoo'}, Dar es Salaam`;
}

function stepTitle(step: Step, sourceMode: NinunulieSourceMode | null) {
  if (step === 'start') return 'Ninunulie';
  if (step === 'item') return 'Bidhaa';
  if (step === 'source') return sourceMode === 'seller_contact' ? 'Duka' : 'Soko';
  if (step === 'delivery') return 'Mahali';
  return 'Thibitisha';
}

export default function NinunulieFlowScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { profile, user } = useAuthSession();
  const shareDraft = useMemo(() => parseNinunulieShareParams(params), [params]);
  const incomingSource = firstParam(params.sourceMode) === 'seller_contact' ? 'seller_contact' : '';
  const [step, setStep] = useState<Step>(shareDraft ? 'item' : 'start');
  const [sourceMode, setSourceMode] = useState<NinunulieSourceMode | null>(
    shareDraft ? 'haul_source' : incomingSource || null
  );
  const [busy, setBusy] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successOrderNumber, setSuccessOrderNumber] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const appliedShareKey = useRef('');
  const locationTokenRef = useRef(createSearchSessionToken());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTiming = firstParam(params.timing) === 'later' ? 'later' : 'now';
  const scheduleDate = firstParam(params.scheduleDate);
  const scheduleTime = firstParam(params.scheduleTime);
  const scheduleSummary =
    scheduleTiming === 'later' && scheduleDate
      ? formatScheduleSummary(scheduleDate, scheduleTime || '00:00', language)
      : '';

  const [itemTitle, setItemTitle] = useState(firstParam(params.itemTitle));
  const [itemNotes, setItemNotes] = useState('');
  const [productUrl, setProductUrl] = useState(firstParam(params.productUrl));
  const [expectedPrice, setExpectedPrice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [sellerShop, setSellerShop] = useState('');
  const [market, setMarket] = useState<MarketKey>('kariakoo');
  const [customMarket, setCustomMarket] = useState('');

  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryLabel, setDeliveryLabel] = useState('');
  const [deliveryLatitude, setDeliveryLatitude] = useState<number | undefined>();
  const [deliveryLongitude, setDeliveryLongitude] = useState<number | undefined>();
  const [deliveryQuery, setDeliveryQuery] = useState('');
  const [deliverySuggestions, setDeliverySuggestions] = useState<LocationSuggestion[]>([]);
  const [deliverySearching, setDeliverySearching] = useState(false);
  const [timingMode, setTimingMode] = useState<'now' | 'later'>(scheduleTiming);

  const photoUrls = useMemo(
    () => photos.map((p) => p.remoteUrl).filter((u): u is string => Boolean(u)),
    [photos]
  );
  const uploading = photos.some((p) => p.uploading);
  const slots = MAX_PHOTOS - photos.length;
  const sellerPhoneReady = phoneDigits(sellerPhone).length >= 9;
  const sellerRegion = marketRegion(market, customMarket);
  const workIndex = Math.max(0, WORK_STEPS.indexOf(step));

  useEffect(() => {
    const name = profile?.fullName?.trim() || user?.displayName?.trim() || '';
    const phone = profile?.phoneNumber?.trim() || user?.phoneNumber?.trim() || '';
    if (name) setRecipientName(name);
    if (phone) setRecipientPhone(phone);
  }, [profile?.fullName, profile?.phoneNumber, user?.displayName, user?.phoneNumber]);

  useEffect(() => {
    const apply = (label: string, lat?: number, lng?: number) => {
      setDeliveryLabel(label);
      setDeliveryQuery(label);
      setDeliveryLatitude(lat);
      setDeliveryLongitude(lng);
    };

    const unsub = subscribeCustomerLocation((snap) => {
      if (snap.status === 'ready' && snap.label.trim()) {
        apply(snap.label.trim(), snap.point?.latitude, snap.point?.longitude);
      }
    });

    const cur = getCustomerLocationSnapshot();
    if (cur.status === 'ready' && cur.label.trim()) {
      apply(cur.label.trim(), cur.point?.latitude, cur.point?.longitude);
    } else {
      void ensureCustomerLocation({ force: true, source: 'initial' })
        .then((next) => {
          if (next.status === 'ready' && next.label.trim()) {
            apply(next.label.trim(), next.point?.latitude, next.point?.longitude);
          }
        })
        .catch(() => undefined);
    }
    return unsub;
  }, []);

  const runPhotoUpload = useCallback(
    async (draft: Photo) => {
      if (!user?.uid) return;
      try {
        const up = await mediaApi().uploadNinunuliePhoto({
          userId: user.uid,
          localUri: draft.localUri,
        });
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === draft.id ? { ...p, remoteUrl: up.downloadURL, uploading: false } : p
          )
        );
      } catch {
        setPhotos((prev) =>
          prev.map((p) => (p.id === draft.id ? { ...p, uploading: false, remoteUrl: undefined } : p))
        );
        Alert.alert('Picha', 'Imeshindikana kupakia. Gusa picha ili jaribu tena, au ondoa.');
      }
    },
    [user?.uid]
  );

  const uploadUris = useCallback(
    async (uris: string[]) => {
      if (!user?.uid || !uris.length) return;
      const drafts: Photo[] = uris.map((uri) => ({
        id: photoId(),
        localUri: asLocalImageUri(uri) || uri,
        uploading: true,
      }));
      setPhotos((prev) => [...prev, ...drafts].slice(0, MAX_PHOTOS));
      await Promise.all(drafts.map((draft) => runPhotoUpload(draft)));
    },
    [runPhotoUpload, user?.uid]
  );

  const retryFailedPhoto = useCallback(
    (photo: Photo) => {
      if (photo.uploading || photo.remoteUrl) return;
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, uploading: true, remoteUrl: undefined } : p))
      );
      void runPhotoUpload(photo);
    },
    [runPhotoUpload]
  );

  useEffect(() => {
    if (!shareDraft) return;
    const key = `${shareDraft.url}|${shareDraft.text}|${shareDraft.imageUris.join(',')}`;
    if (appliedShareKey.current === key) return;
    appliedShareKey.current = key;
    setSourceMode('haul_source');
    setStep('item');
    if (shareDraft.itemHint) {
      setItemTitle((prev) => prev.trim() || shareDraft.itemHint);
    }
    if (shareDraft.url) {
      setProductUrl((prev) => prev.trim() || shareDraft.url);
    } else if (shareDraft.text) {
      setItemNotes((prev) => prev.trim() || shareDraft.text);
    }
    if (shareDraft.imageUris.length) {
      void uploadUris(shareDraft.imageUris);
    }
  }, [shareDraft, uploadUris]);

  const openGallery = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert('Ingia', 'Ingia akaunti kwanza.');
      return;
    }
    if (slots <= 0) {
      Alert.alert('Picha', `Upeo ni picha ${MAX_PHOTOS}.`);
      return;
    }
    try {
      const picked = await mediaApi().pickOrderImageFromLibrary({
        selectionLimit: Math.min(MAX_PHOTOS, slots),
      });
      if (picked.length) await uploadUris(picked.map((p) => p.uri));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Gallery haipatikani kwenye build hii.';
      const needsSettings = /Settings|Ruhusa ya picha imezimwa|Ruhusa ya kamera imezimwa/i.test(
        message
      );
      if (needsSettings && typeof mediaApi().openAppSettings === 'function') {
        Alert.alert('Gallery', message, [
          { text: 'Bado', style: 'cancel' },
          {
            text: 'Fungua Settings',
            onPress: () => {
              void mediaApi().openAppSettings?.();
            },
          },
        ]);
        return;
      }
      Alert.alert('Gallery', message);
    }
  }, [slots, uploadUris, user?.uid]);

  const pasteProductLink = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard') as {
        getStringAsync: () => Promise<string>;
      };
      const raw = (await Clipboard.getStringAsync()) || '';
      const url = extractUrlFromText(raw) || raw.trim();
      if (!url) {
        Alert.alert('Link', 'Nakili link kwanza, kisha jaribu tena.');
        return;
      }
      setProductUrl(url);
      if (!itemTitle.trim()) {
        setItemTitle(raw.replace(url, '').replace(/\s+/g, ' ').trim().slice(0, 80));
      }
    } catch {
      Alert.alert('Link', 'Imeshindikana kusoma clipboard.');
    }
  }, [itemTitle]);

  const searchDelivery = useCallback((query: string) => {
    setDeliveryQuery(query);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDeliverySuggestions([]);
      setDeliverySearching(false);
      return;
    }
    setDeliverySearching(true);
    const instant = getInstantLocationSuggestions(trimmed, undefined, 6);
    setDeliverySuggestions(instant);
    searchTimerRef.current = setTimeout(() => {
      void fetchLocationSuggestions(trimmed, locationTokenRef.current, undefined, 6)
        .then((rows) => {
          setDeliverySuggestions(rows);
        })
        .catch(() => undefined)
        .finally(() => setDeliverySearching(false));
    }, 280);
  }, []);

  const pickDeliverySuggestion = useCallback(async (suggestion: LocationSuggestion) => {
    try {
      const resolved = await retrieveLocationSuggestion(suggestion, locationTokenRef.current);
      setDeliveryLabel(resolved.label);
      setDeliveryQuery(resolved.label);
      setDeliveryLatitude(resolved.point?.latitude);
      setDeliveryLongitude(resolved.point?.longitude);
      setDeliverySuggestions([]);
    } catch {
      setDeliveryLabel(suggestion.name || suggestion.fullText);
      setDeliveryQuery(suggestion.name || suggestion.fullText);
      setDeliveryLatitude(suggestion.coordinates?.latitude);
      setDeliveryLongitude(suggestion.coordinates?.longitude);
      setDeliverySuggestions([]);
    }
  }, []);

  const useCurrentLocation = useCallback(() => {
    void ensureCustomerLocation({ force: true, source: 'tap' })
      .then((next) => {
        if (next.status === 'ready' && next.label.trim()) {
          setDeliveryLabel(next.label.trim());
          setDeliveryQuery(next.label.trim());
          setDeliveryLatitude(next.point?.latitude);
          setDeliveryLongitude(next.point?.longitude);
          setDeliverySuggestions([]);
        } else {
          Alert.alert('Mahali', 'Ruhusu location ili kutumia eneo lako.');
        }
      })
      .catch(() => {
        Alert.alert('Mahali', 'Imeshindikana kusoma eneo lako.');
      });
  }, []);

  const resolvedTitle = useMemo(() => {
    const typed = itemTitle.trim();
    if (typed.length >= 2) return typed;
    if (photos.length) return 'Bidhaa kutoka picha';
    if (productUrl.trim()) return 'Bidhaa kutoka link';
    return '';
  }, [itemTitle, photos.length, productUrl]);

  const photosReady =
    photos.length === 0 || photos.every((p) => Boolean(p.remoteUrl) && !p.uploading);
  const canItem =
    !uploading &&
    photosReady &&
    (resolvedTitle.length >= 2 ||
      itemNotes.trim().length >= 8 ||
      Boolean(productUrl.trim()) ||
      photoUrls.length > 0);
  const canSource =
    sourceMode === 'seller_contact'
      ? sellerName.trim().length >= 2 && sellerPhoneReady
      : Boolean(sellerRegion.trim()) && (market !== 'nyingine' || customMarket.trim().length >= 3);
  const canDelivery = deliveryLabel.trim().length >= 3;
  const canConfirm = canItem && canSource && canDelivery && !busy && photosReady;

  const choosePath = useCallback((mode: NinunulieSourceMode) => {
    setSourceMode(mode);
    setStep('item');
  }, []);

  const goBack = useCallback(() => {
    if (step === 'start') {
      router.back();
      return;
    }
    if (step === 'item') {
      setStep('start');
      return;
    }
    if (step === 'source') {
      setStep('item');
      return;
    }
    if (step === 'delivery') {
      setStep('source');
      return;
    }
    setStep('delivery');
  }, [router, step]);

  const goNext = useCallback(() => {
    if (step === 'start') {
      Alert.alert('Anza', 'Chagua njia moja.');
      return;
    }
    if (step === 'item') {
      if (photos.length > 0 && (uploading || photos.some((p) => !p.remoteUrl))) {
        const failed = photos.some((p) => !p.uploading && !p.remoteUrl);
        Alert.alert(
          'Picha',
          uploading
            ? 'Subiri picha zipakie kwanza.'
            : failed
              ? 'Ondoa picha zilizoshindwa au gusa ili jaribu tena.'
              : 'Subiri picha zipakie kwanza.'
        );
        return;
      }
      if (!canItem) {
        Alert.alert('Bidhaa', 'Weka jina au picha.');
        return;
      }
      setStep('source');
      return;
    }
    if (step === 'source') {
      if (!canSource) {
        Alert.alert(
          'Chanzo',
          sourceMode === 'seller_contact' ? 'Jaza jina na namba.' : 'Chagua soko.'
        );
        return;
      }
      setStep('delivery');
      return;
    }
    if (step === 'delivery') {
      if (!canDelivery) {
        Alert.alert('Mahali', 'Chagua mahali pa kukabidhiwa.');
        return;
      }
      setStep('confirm');
    }
  }, [canDelivery, canItem, canSource, photos, sourceMode, step, uploading]);

  const submit = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert('Ingia', 'Ingia akaunti kwanza.');
      return;
    }
    if (!canConfirm) {
      Alert.alert('Ombi', 'Hakiki bidhaa, chanzo, na mahali.');
      return;
    }
    if (photos.length > 0 && photoUrls.length === 0) {
      Alert.alert('Picha', 'Picha hazijapakia. Gusa ili jaribu tena au ondoa.');
      return;
    }
    if (photos.length > 0 && photoUrls.length < photos.length) {
      Alert.alert('Picha', 'Baadhi ya picha hazijapakia. Gusa ili jaribu tena au ondoa.');
      return;
    }
    if (phoneDigits(recipientPhone).length < 9) {
      Alert.alert('Simu', 'Weka namba yako ya simu.');
      return;
    }
    if (busy) return;

    const haulSource = sourceMode !== 'seller_contact';
    const qtyLabel = quantity > 1 ? `Idadi: ${quantity}` : '';
    const description = [itemNotes.trim(), qtyLabel].filter(Boolean).join('\n');
    const sellerNotes = [
      haulSource ? 'Mteja hana namba ya duka. HAUL itatafuta bidhaa.' : '',
      sellerShop.trim() ? `Mahali/stendi: ${sellerShop.trim()}` : '',
      productUrl.trim() ? `Link: ${productUrl.trim()}` : '',
      'Mteja analipa mfanyabiashara kwa namba ya simu. Agent anasimamia malipo dukani na makabidhiano ya mzigo.',
      'Kisha HAUL inasafirisha mzigo kwa mteja.',
    ]
      .filter(Boolean)
      .join('\n');

    setBusy(true);
    try {
      const order = await createNinunulieOrder({
        userId: user.uid,
        customerName: recipientName.trim() || 'HAUL customer',
        customerEmail: user.email?.trim() || '',
        customerPhone: recipientPhone.trim(),
        deliveryLabel: deliveryLabel.trim(),
        deliveryLatitude,
        deliveryLongitude,
        itemTitle: resolvedTitle,
        itemDescription: description || undefined,
        expectedPriceTzs: expectedPrice.trim() || undefined,
        productUrl: productUrl.trim() || undefined,
        photoUrls: photoUrls.length ? photoUrls : undefined,
        sellerName: haulSource ? `HAUL itatafuta · ${sellerRegion}` : sellerName.trim(),
        sellerPhone: haulSource ? HAUL_SOURCE_PHONE : sellerPhone.trim(),
        sellerRegion,
        sellerNotes,
        customerNotes: haulSource
          ? 'Sina namba ya mfanyabiashara — tafuteni duka.'
          : undefined,
        timingMode: timingMode === 'later' ? 'later' : 'now',
        scheduleDate: timingMode === 'later' ? scheduleDate : undefined,
        scheduleTime: timingMode === 'later' ? scheduleTime : undefined,
        scheduleLabel: timingMode === 'later' ? scheduleSummary || undefined : undefined,
        fulfillmentChannel: haulSource ? 'ops_desk' : 'whatsapp',
      });

      setSuccessOrderNumber(order.orderNumber);
      setSuccessOpen(true);
    } catch (e) {
      Alert.alert('Imeshindikana', e instanceof Error ? e.message : 'Jaribu tena.');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canConfirm,
    deliveryLabel,
    deliveryLatitude,
    deliveryLongitude,
    expectedPrice,
    itemNotes,
    photos.length,
    photoUrls,
    productUrl,
    quantity,
    recipientName,
    recipientPhone,
    resolvedTitle,
    scheduleDate,
    scheduleSummary,
    scheduleTime,
    sellerName,
    sellerPhone,
    sellerRegion,
    sellerShop,
    sourceMode,
    timingMode,
    user?.email,
    user?.uid,
  ]);

  const dismissSuccess = useCallback(() => {
    setSuccessOpen(false);
    router.replace('/home');
  }, [router]);

  const footerLabel =
    step === 'start' ? '' : step === 'confirm' ? (busy ? 'Inasubiri…' : 'Tuma ombi') : 'Endelea';
  const footerDisabled =
    step === 'item' ? !canItem : step === 'source' ? !canSource : step === 'delivery' ? !canDelivery : !canConfirm;

  return (
    <CargoScreen
      backgroundColor="#FFFFFF"
      keyboardAvoiding
      contentContainerStyle={styles.content}
      footer={
        step === 'start' ? undefined : (
          <PrimaryButton
            label={footerLabel}
            size="parcel"
            variant={step === 'confirm' ? 'dark' : 'primary'}
            onPress={step === 'confirm' ? () => void submit() : goNext}
            disabled={footerDisabled}
          />
        )
      }>
      <CargoHeader title={stepTitle(step, sourceMode)} onLeftPress={goBack} />

      {step !== 'start' && step !== 'confirm' ? (
        <View style={styles.dots}>
          {WORK_STEPS.map((key, index) => (
            <View key={key} style={[styles.dot, index <= workIndex && styles.dotOn]} />
          ))}
        </View>
      ) : null}

      {step === 'start' ? (
        <View style={styles.form}>
          <TouchableOpacity
            style={styles.pathCard}
            activeOpacity={0.88}
            onPress={() => choosePath('seller_contact')}>
            <Text style={styles.pathTitle}>Nina namba ya duka</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pathCard}
            activeOpacity={0.88}
            onPress={() => choosePath('haul_source')}>
            <Text style={styles.pathTitle}>Sina namba</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step === 'item' ? (
        <View style={styles.form}>
          <TouchableOpacity
            style={styles.photoShell}
            onPress={() => {
              const first = photos[0];
              if (first && !first.remoteUrl && !first.uploading) {
                retryFailedPhoto(first);
                return;
              }
              void openGallery();
            }}
            activeOpacity={0.88}>
            {photos[0] ? (
              <View>
                <Image source={{ uri: photos[0].localUri }} style={styles.photoHero} />
                {photos[0].uploading ? (
                  <View style={styles.photoMask}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : !photos[0].remoteUrl ? (
                  <View style={styles.photoMask}>
                    <Text style={styles.photoRetry}>Gusa tena</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={styles.photoX}
                  onPress={() => setPhotos((prev) => prev.filter((p) => p.id !== photos[0].id))}>
                  <MaterialCommunityIcons name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photoEmpty}>
                <Text style={styles.photoTitle}>Ongeza picha</Text>
              </View>
            )}
          </TouchableOpacity>

          <PlainField
            value={itemTitle}
            onChangeText={setItemTitle}
            placeholder="Jina la bidhaa"
          />

          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Idadi</Text>
            <View style={styles.qtyShell}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity((n) => Math.max(1, n - 1))}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity((n) => Math.min(20, n + 1))}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={() => setMoreOpen((v) => !v)} hitSlop={10}>
            <Text style={styles.moreLink}>{moreOpen ? 'Ficha' : 'Maelezo zaidi'}</Text>
          </TouchableOpacity>

          {moreOpen ? (
            <View style={styles.moreBlock}>
              <TouchableOpacity onPress={() => void pasteProductLink()}>
                <Text style={styles.moreLink}>Weka link</Text>
              </TouchableOpacity>
              {productUrl.trim() ? (
                <Text numberOfLines={1} style={styles.linkText}>
                  {productUrl.trim()}
                </Text>
              ) : null}
              <PlainField
                value={expectedPrice}
                onChangeText={(value) => setExpectedPrice(value.replace(/[^\d]/g, ''))}
                placeholder="Bei (TZS)"
                keyboardType="number-pad"
              />
              <PlainField
                value={itemNotes}
                onChangeText={setItemNotes}
                placeholder="Maelezo"
                multiline
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {step === 'source' ? (
        <View style={styles.form}>
          {sourceMode === 'seller_contact' ? (
            <>
              <PlainField
                value={sellerName}
                onChangeText={setSellerName}
                placeholder="Jina la duka"
                autoFocus
              />
              <PhoneInput value={sellerPhone} onChangeText={setSellerPhone} placeholder="Namba" />
            </>
          ) : (
            <>
              <Text style={styles.quiet}>HAUL itatafuta duka</Text>
              <View style={styles.marketRow}>
                {MARKETS.map((item) => {
                  const on = market === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[styles.marketChip, on && styles.marketChipOn]}
                      onPress={() => setMarket(item.key)}>
                      <Text style={[styles.marketText, on && styles.marketTextOn]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {market === 'nyingine' ? (
                <PlainField
                  value={customMarket}
                  onChangeText={setCustomMarket}
                  placeholder="Eneo"
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {step === 'delivery' ? (
        <View style={styles.form}>
          <View style={styles.placeShell}>
            <TextInput
              value={deliveryQuery}
              onChangeText={searchDelivery}
              placeholder="Kabidhi wapi"
              placeholderTextColor="#9CA3AF"
              style={styles.placeInput}
            />
            <TouchableOpacity onPress={useCurrentLocation} hitSlop={10} style={styles.gpsBtn}>
              <MaterialCommunityIcons name="crosshairs-gps" size={22} color="#111827" />
            </TouchableOpacity>
          </View>
          <LocationSuggestionsList
            suggestions={deliverySuggestions}
            loading={deliverySearching}
            loadingLabel="…"
            emptyLabel=""
            showEmpty={false}
            headerLabel=""
            embedded
            onSelect={(suggestion) => {
              void pickDeliverySuggestion(suggestion);
            }}
          />
          <View style={styles.whenRow}>
            <TouchableOpacity
              style={[styles.whenChip, timingMode === 'now' && styles.whenChipOn]}
              onPress={() => setTimingMode('now')}>
              <Text style={[styles.whenText, timingMode === 'now' && styles.whenTextOn]}>Sasa</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.whenChip, timingMode === 'later' && styles.whenChipOn]}
              onPress={() => {
                if (scheduleDate) {
                  setTimingMode('later');
                  return;
                }
                router.push('/schedule');
              }}>
              <Text style={[styles.whenText, timingMode === 'later' && styles.whenTextOn]}>
                {scheduleSummary || 'Baadaye'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {step === 'confirm' ? (
        <View style={styles.confirm}>
          <TouchableOpacity onPress={() => setStep('item')} activeOpacity={0.8}>
            <Text style={styles.confirmItem}>
              {resolvedTitle}
              {quantity > 1 ? `  × ${quantity}` : ''}
            </Text>
          </TouchableOpacity>
          <View style={styles.confirmAccent} />

          <SummaryRow
            label="Kutoka"
            value={
              sourceMode === 'seller_contact'
                ? `${sellerName.trim()} · ${sellerPhone.trim()}`
                : sellerRegion
            }
            onPress={() => setStep('source')}
          />
          <SummaryRow
            label="Kwenda"
            value={deliveryLabel.trim() || '—'}
            onPress={() => setStep('delivery')}
          />
          <SummaryRow
            label="Malipo"
            value={
              sourceMode === 'seller_contact' && sellerPhone.trim()
                ? expectedPrice.trim()
                  ? `${sellerPhone.trim()} · TZS ${expectedPrice.trim()}`
                  : sellerPhone.trim()
                : expectedPrice.trim()
                  ? `HAUL itapeleka namba · TZS ${expectedPrice.trim()}`
                  : 'HAUL itapeleka namba ya malipo'
            }
          />
          {phoneDigits(recipientPhone).length < 9 ? (
            <PhoneInput
              value={recipientPhone}
              onChangeText={setRecipientPhone}
              placeholder="Simu yako"
            />
          ) : null}

          <View style={styles.process}>
            {PROCESS_STEPS.map((line) => (
              <Text key={line} style={styles.processLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <NinunulieSuccessPopup
        visible={successOpen}
        orderNumber={successOrderNumber}
        onDismiss={dismissSuccess}
      />
    </CargoScreen>
  );
}

function PlainField({
  value,
  onChangeText,
  placeholder,
  multiline,
  autoFocus,
  keyboardType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  autoFocus?: boolean;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      multiline={multiline}
      autoFocus={autoFocus}
      keyboardType={keyboardType}
      style={[styles.input, multiline && styles.inputTall]}
    />
  );
}

function SummaryRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.summaryRow} onPress={onPress} activeOpacity={0.8}>
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={styles.summaryRow}>{inner}</View>;
}

const styles = StyleSheet.create({
  content: {
    gap: 20,
    paddingBottom: 20,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E7EB',
  },
  dotOn: {
    backgroundColor: cargoTheme.colors.primary,
  },
  form: {
    gap: 20,
    paddingTop: 16,
  },
  pathCard: {
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: cargoTheme.colors.primary,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  pathTitle: {
    fontFamily: typography.extrabold,
    fontSize: 20,
    letterSpacing: -0.3,
    color: '#111827',
  },
  photoShell: {
    minHeight: 200,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  photoEmpty: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTitle: {
    fontFamily: typography.extrabold,
    fontSize: 20,
    color: '#111827',
  },
  photoHero: {
    width: '100%',
    height: 200,
  },
  photoRetry: {
    color: '#FFFFFF',
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  photoMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoX: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    fontFamily: typography.body,
    fontSize: 17,
    color: '#111827',
  },
  inputTall: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 16,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
  },
  qtyLabel: {
    fontFamily: typography.semibold,
    fontSize: 17,
    color: '#111827',
  },
  qtyShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: {
    fontFamily: typography.extrabold,
    fontSize: 22,
    color: '#111827',
  },
  qtyValue: {
    minWidth: 24,
    textAlign: 'center',
    fontFamily: typography.extrabold,
    fontSize: 18,
    color: '#111827',
  },
  moreLink: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: '#6B7280',
  },
  moreBlock: {
    gap: 12,
  },
  linkText: {
    fontFamily: typography.body,
    fontSize: 13,
    color: '#6B7280',
  },
  quiet: {
    fontFamily: typography.body,
    fontSize: 15,
    color: '#6B7280',
  },
  marketRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  marketChip: {
    minWidth: '47%',
    minHeight: 64,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
  },
  marketChipOn: {
    backgroundColor: cargoTheme.colors.primary,
  },
  marketText: {
    fontFamily: typography.extrabold,
    fontSize: 17,
    color: '#4B5563',
  },
  marketTextOn: {
    color: '#111827',
  },
  placeShell: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeInput: {
    flex: 1,
    minHeight: 58,
    fontFamily: typography.body,
    fontSize: 17,
    color: '#111827',
  },
  gpsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whenRow: {
    flexDirection: 'row',
    gap: 10,
  },
  whenChip: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whenChipOn: {
    backgroundColor: cargoTheme.colors.primary,
  },
  whenText: {
    fontFamily: typography.semibold,
    fontSize: 17,
    color: '#4B5563',
  },
  whenTextOn: {
    color: '#111827',
  },
  confirm: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 8,
  },
  confirmItem: {
    fontFamily: typography.ident,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: '#111827',
    paddingBottom: 16,
  },
  confirmAccent: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: cargoTheme.colors.primary,
    marginBottom: 20,
  },
  summaryRow: {
    paddingVertical: 18,
    gap: 6,
  },
  summaryLabel: {
    fontFamily: typography.medium,
    fontSize: 13,
    color: '#9CA3AF',
  },
  summaryValue: {
    fontFamily: typography.semibold,
    fontSize: 18,
    lineHeight: 26,
    color: '#111827',
  },
  process: {
    gap: 12,
    paddingTop: 28,
  },
  processLine: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: '#9CA3AF',
  },
});
