import ErrorBoundary from './components/ErrorBoundary';
import { tryRequire } from './lib/safety';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { FirebaseError } from 'firebase/app';
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    updateProfile,
    type User,
} from 'firebase/auth';
import {
    doc,
    increment,
    serverTimestamp,
    updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    AppState,
    type AppStateStatus,
    Image,
    KeyboardAvoidingView,
    Linking,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    Vibration,
    View,
} from 'react-native';

import { getFirebaseAuthErrorMessage, getFirebaseDataErrorMessage } from './lib/auth-errors';
import { recordDriverActivity } from './lib/driver-analytics';
import {
    formatDeliveryDateTime,
    getDeliveryOrderStatusLabel,
    acceptDriverOrder,
    declineDriverOrder,
    recordDriverAppOpen,
    registerDriver,
    rateDeliveryCustomer,
    setDriverAvailability,
    subscribeToDeliveryOrder,
    subscribeToDriver,
    subscribeToDriverOrders,
    updateDriverLocation,
    updateDriverOrderStatus,
    type DeliveryOrder,
    type DeliveryOrderStatus,
    type DriverRecord,
    type DriverVehicleType,
} from './lib/driver-data';
import {
    fetchDriverPaymentStatus,
    initiateDriverAccessPayment,
    verifyDriverAccessPayment,
    type DriverPaymentNetwork,
    type DriverPaymentNetworkKey,
    type DriverPaymentRecord,
    type DriverPaymentStatusResponse,
} from './lib/driver-payments';
import { auth, db, storage } from './lib/firebase';
import { getDriverCopy } from './lib/driver-copy';
import { loadDriverSettings, saveDriverSettings, type DriverLang } from './lib/driver-settings';
import { sendOrderMessage, subscribeToOrderMessages, type OrderMessage } from './lib/order-messages';
import { normalizePhoneNumber } from './lib/phone-auth';

type AuthMode = 'signin' | 'register';
type DriverTab = 'home' | 'trip' | 'history' | 'notifications' | 'account';
type AccountView = 'overview' | 'payments';
type PaymentCheckoutStep = 'debt' | 'proof' | 'submitted';
type FeedbackTone = 'error' | 'info' | 'success';
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type SetupStep = 'profile' | 'vehicle' | 'documents';
type DocumentKey = 'vehiclePhoto' | 'driverPhoto';
type DriverDocumentUpload = {
  uri?: string;
  fileName?: string | null;
  mimeType?: string | null;
  downloadURL?: string;
  storagePath?: string;
  uploadedAt?: string;
  uploadStatus?: 'uploaded' | 'pending_upload' | 'not_submitted';
  uploadNote?: string;
};
type DriverDocumentUploads = Record<DocumentKey, DriverDocumentUpload | null>;
type DriverNotification = {
  id: string;
  title: string;
  message: string;
  icon: IconName;
  tone: 'success' | 'info' | 'warning';
  time: string;
};
type TripAction = {
  label: string;
  nextStatus: 'driver_at_pickup' | 'in_transit' | 'delivered';
  icon: IconName;
};
type PaymentStepTone = 'done' | 'active' | 'muted';
type RegisterFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  vehicleType: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor: string;
  plateNumber: string;
};
type ProfileSetupState = {
  fullName: string;
  phoneNumber: string;
  vehicleType: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor: string;
  plateNumber: string;
};

const ACTIVE_ORDER_STATUSES: DeliveryOrderStatus[] = ['driver_assigned', 'driver_at_pickup', 'in_transit'];
const vehicleTypeOptions: { key: DriverVehicleType; label: string; icon: IconName }[] = [
  { key: 'bodaboda', label: 'Bike', icon: 'motorbike' },
  { key: 'toyo', label: 'TOYO', icon: 'car-pickup' },
  { key: 'kirikuu', label: 'Kirikuu', icon: 'truck-fast-outline' },
];
const tabs: { key: DriverTab; icon: IconName }[] = [
  { key: 'home', icon: 'home-outline' },
  { key: 'trip', icon: 'navigation-variant-outline' },
  { key: 'history', icon: 'clock-outline' },
  { key: 'notifications', icon: 'bell-outline' },
  { key: 'account', icon: 'account-outline' },
];
const setupSteps: { key: SetupStep; label: string; icon: IconName }[] = [
  { key: 'profile', label: 'Profile', icon: 'account' },
  { key: 'vehicle', label: 'Vehicle', icon: 'truck-fast-outline' },
];
const documentRequirements: { key: DocumentKey; label: string; helper: string; icon: IconName }[] = [
  {
    key: 'vehiclePhoto',
    label: 'Picha ya gari',
    helper: 'Upload a clear exterior photo showing the vehicle condition.',
    icon: 'car-estate',
  },
  {
    key: 'driverPhoto',
    label: 'Picha ya dereva',
    helper: 'Upload a clear driver profile photo for admin verification.',
    icon: 'account-box-outline',
  },
];
const vehicleColorOptions: { label: string; swatch: string }[] = [
  { label: 'White', swatch: '#FFFFFF' },
  { label: 'Green', swatch: '#0F9D58' },
  { label: 'Black', swatch: '#111827' },
  { label: 'Silver', swatch: '#CBD5E1' },
  { label: 'Blue', swatch: '#2563EB' },
  { label: 'Red', swatch: '#DC2626' },
];
const defaultMongikePaymentNetworks: DriverPaymentNetwork[] = [
  {
    key: 'mpesa',
    label: 'M-Pesa',
    provider: 'Vodacom',
    color: '#16A34A',
    logoUrl: 'https://images.seeklogo.com/logo-png/62/2/m-pesa-logo-png_seeklogo-622552.png',
    enabled: true,
    comingSoon: false,
    recipientPhone: '0750355402',
  },
  {
    key: 'mixx',
    label: 'Mixx by Yas',
    provider: 'Yas / Tigo Pesa',
    color: '#155EEF',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Yas_Tanzania.svg/512px-Yas_Tanzania.svg.png',
    enabled: false,
    comingSoon: true,
  },
  {
    key: 'airtel',
    label: 'Airtel Money',
    provider: 'Airtel',
    color: '#DC2626',
    logoUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTweT0_EszZrApI-MHVpPBZueAISnt5GXJNnw&s',
    enabled: false,
    comingSoon: true,
  },
  {
    key: 'halopesa',
    label: 'HaloPesa',
    provider: 'Halotel',
    color: '#7C3AED',
    logoUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSbuLQMvrrg2lEeCHcKj_5qd7fTXGC3akQx0Q&s',
    enabled: false,
    comingSoon: true,
  },
];
const driverAccessFallbackDailyFeeTzs = 3000;
const dayMs = 24 * 60 * 60 * 1000;
const tanzaniaUtcOffsetMs = 3 * 60 * 60 * 1000;
const assignedOrderVibrationPattern = [0, 900, 450, 900, 450, 1400, 700];
const foregroundAssignedOrderVibrationPattern = [0, 700, 250, 700, 250, 1000];
const setupStepOrder: SetupStep[] = ['profile', 'vehicle'];
const appLogoImage = require('./assets/images/icon2.png');

// Public hosted Terms & Privacy pages on DoorDrop Firebase Hosting.
const TERMS_URL = 'https://efootball-app-9d175.web.app/terms/';
const PRIVACY_URL = 'https://efootball-app-9d175.web.app/privacy';
const DOORDRIVE_TERMS_VERSION = 'doordrive-driver-terms-2026-06-04';
const driveTheme = {
  colors: {
    primary: '#16A34A',
    primaryDark: '#14532D',
    primarySoft: '#DCFCE7',
    accent: '#F97316',
    canvas: '#F5F7F6',
    surface: '#FFFFFF',
    dark: '#0F172A',
    ink: '#111827',
    subtext: '#64748B',
    line: '#E2E8F0',
    info: '#2563EB',
    warning: '#EA580C',
    danger: '#DC2626',
  },
  radius: {
    lg: 22,
    xl: 28,
    pill: 999,
  },
};
const driveType = {
  regular: 'Manrope_400Regular',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
} as const;

function getInitialRegisterForm(): RegisterFormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
    vehicleType: 'bodaboda',
    vehicleLabel: '',
    vehicleColor: 'White',
    plateNumber: '',
  };
}

function getInitialDocumentUploads(): DriverDocumentUploads {
  return {
    vehiclePhoto: null,
    driverPhoto: null,
  };
}

function getInitialProfileSetup(user?: User | null): ProfileSetupState {
  return {
    fullName: user?.displayName?.trim() || '',
    phoneNumber: '',
    vehicleType: 'bodaboda',
    vehicleLabel: '',
    vehicleColor: '',
    plateNumber: '',
  };
}

function getRegisterFullName(form: RegisterFormState) {
  return [form.firstName, form.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function getRegisterVehicleLabel(form: RegisterFormState) {
  return form.vehicleLabel.trim() || getVehicleTypeLabel(form.vehicleType);
}

function getVehicleTypeLabel(vehicleType?: string) {
  const labels: Record<string, string> = {
    bodaboda: 'Bodaboda / Motorcycle',
    pikipiki: 'Bodaboda / Motorcycle',
    boda: 'Bodaboda / Motorcycle',
    motorcycle: 'Bodaboda / Motorcycle',
    motorbike: 'Bodaboda / Motorcycle',
    kirikuu: 'Kirikuu',
    toyo: 'TOYO',
    toyo_xl: 'TOYO',
    pickup: 'TOYO',
    van: 'TOYO',
    truck: 'TOYO',
  };

  return labels[vehicleType || ''] || 'Vehicle pending';
}

function getDriverDocumentFallback(upload: DriverDocumentUpload | null | undefined): DriverDocumentUpload | null {
  if (!upload?.uri) {
    return {
      uploadStatus: 'not_submitted',
      uploadNote: 'Driver skipped this photo during quick signup.',
    };
  }

  return {
    fileName: upload.fileName || 'Driver document photo',
    mimeType: upload.mimeType || 'image/jpeg',
    uploadStatus: 'pending_upload',
    uploadNote: 'Photo was selected in the driver app, but cloud upload was not completed.',
  };
}

function getImageExtension(upload: DriverDocumentUpload) {
  const fromName = upload.fileName?.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }

  if (upload.mimeType?.includes('png')) {
    return 'png';
  }

  if (upload.mimeType?.includes('webp')) {
    return 'webp';
  }

  return 'jpg';
}

async function uploadDriverDocumentImage(driverId: string, key: DocumentKey, upload: DriverDocumentUpload) {
  if (!upload.uri) {
    return getDriverDocumentFallback(upload);
  }

  const response = await fetch(upload.uri);
  const blob = await response.blob();
  const extension = getImageExtension(upload);
  const storagePath = `driver-verifications/${driverId}/${key}-${Date.now()}.${extension}`;
  const imageRef = ref(storage, storagePath);
  const mimeType = upload.mimeType || (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');

  await uploadBytes(imageRef, blob, { contentType: mimeType });
  const downloadURL = await getDownloadURL(imageRef);

  return {
    ...upload,
    downloadURL,
    storagePath,
    uploadedAt: new Date().toISOString(),
    uploadStatus: 'uploaded' as const,
  };
}

async function uploadDriverVerificationImages(driverId: string, uploads: DriverDocumentUploads) {
  const entries = await Promise.all(
    documentRequirements.map(async (item) => {
      const upload = uploads[item.key];
      if (!upload) {
        return [item.key, getDriverDocumentFallback(upload)] as const;
      }

      try {
        return [item.key, await uploadDriverDocumentImage(driverId, item.key, upload)] as const;
      } catch {
        return [item.key, getDriverDocumentFallback(upload)] as const;
      }
    })
  );

  return Object.fromEntries(entries) as DriverDocumentUploads;
}

function getDriverVerificationDocumentPlaceholders(uploads: DriverDocumentUploads) {
  return Object.fromEntries(
    documentRequirements.map((item) => [item.key, getDriverDocumentFallback(uploads[item.key])])
  ) as DriverDocumentUploads;
}

async function syncDriverVerificationImages(driverId: string, uploads: DriverDocumentUploads) {
  const verificationDocuments = await uploadDriverVerificationImages(driverId, uploads);

  await updateDoc(doc(db, 'drivers', driverId), {
    verificationDocuments,
    vehiclePhotoURL: verificationDocuments.vehiclePhoto?.downloadURL || '',
    driverPhotoURL: verificationDocuments.driverPhoto?.downloadURL || '',
    updatedAt: serverTimestamp(),
  });
}

function getNextSetupStep(step: SetupStep) {
  const currentIndex = setupStepOrder.indexOf(step);
  return setupStepOrder[Math.min(setupStepOrder.length - 1, currentIndex + 1)];
}

function getPreviousSetupStep(step: SetupStep) {
  const currentIndex = setupStepOrder.indexOf(step);
  return setupStepOrder[Math.max(0, currentIndex - 1)];
}

function isActiveOrderStatus(status?: DeliveryOrderStatus) {
  return !!status && ACTIVE_ORDER_STATUSES.includes(status);
}

function getNextTripAction(status?: DeliveryOrderStatus): TripAction | null {
  switch (status) {
    case 'driver_assigned':
      return { label: 'Arrived at pickup', nextStatus: 'driver_at_pickup' as const, icon: 'map-marker-check-outline' };
    case 'driver_at_pickup':
      return { label: 'Start trip', nextStatus: 'in_transit' as const, icon: 'road-variant' };
    case 'in_transit':
      return { label: 'Mark delivered', nextStatus: 'delivered' as const, icon: 'check-circle-outline' };
    default:
      return null;
  }
}

function haversineDistanceKm(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number }
) {
  const earthRadiusKm = 6371;
  const dLat = ((end.latitude - start.latitude) * Math.PI) / 180;
  const dLng = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLat = (start.latitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceKm(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.max(0.1, Math.round(distanceKm * 10) / 10).toFixed(1)} km away`;
  }

  return `${distanceKm.toFixed(1)} km away`;
}

type MapPoint = { latitude: number; longitude: number };
type NavigationTarget = {
  kind: 'pickup' | 'dropoff';
  label: string;
  point: MapPoint | null;
};

const serviceCoordinateBounds = {
  minLatitude: -12.8,
  maxLatitude: 0.2,
  minLongitude: 28.5,
  maxLongitude: 41.5,
};

function parseMapCoordinate(value: unknown) {
  const coordinate = typeof value === 'number' ? value : Number(String(value ?? '').trim());

  return Number.isFinite(coordinate) ? coordinate : undefined;
}

function isValidLatitude(value: number) {
  return value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return value >= -180 && value <= 180;
}

function isLikelyServicePoint(point: MapPoint) {
  return (
    point.latitude >= serviceCoordinateBounds.minLatitude &&
    point.latitude <= serviceCoordinateBounds.maxLatitude &&
    point.longitude >= serviceCoordinateBounds.minLongitude &&
    point.longitude <= serviceCoordinateBounds.maxLongitude
  );
}

function getOrderPickupPoint(order: DeliveryOrder): MapPoint | null {
  return getPointFromCoordinates(order.pickupLatitude, order.pickupLongitude);
}

function getPointFromCoordinates(latitudeValue: unknown, longitudeValue: unknown): MapPoint | null {
  const latitude = parseMapCoordinate(latitudeValue);
  const longitude = parseMapCoordinate(longitudeValue);

  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const directPoint = { latitude, longitude };
  if (isValidLatitude(latitude) && isValidLongitude(longitude) && isLikelyServicePoint(directPoint)) {
    return directPoint;
  }

  const swappedPoint = { latitude: longitude, longitude: latitude };
  if (isValidLatitude(swappedPoint.latitude) && isValidLongitude(swappedPoint.longitude) && isLikelyServicePoint(swappedPoint)) {
    return swappedPoint;
  }

  return null;
}

function getDriverVisibleDropoffLabel(order: DeliveryOrder) {
  return order.dropoffLabel?.trim() || order.outsideDestinationLabel?.trim() || order.driverDropoffLabel?.trim() || 'Drop-off';
}

function getDriverVisibleDropoffPoint(order: DeliveryOrder) {
  return (
    getPointFromCoordinates(order.dropoffLatitude, order.dropoffLongitude) ??
    getPointFromCoordinates(order.outsideDestinationLatitude, order.outsideDestinationLongitude) ??
    getPointFromCoordinates(order.driverDropoffLatitude, order.driverDropoffLongitude)
  );
}

function getDriverNavigationTarget(order: DeliveryOrder): NavigationTarget {
  if (order.status === 'driver_assigned') {
    return {
      kind: 'pickup',
      label: order.pickupLabel?.trim() || 'Pickup',
      point: getOrderPickupPoint(order),
    };
  }

  return {
    kind: 'dropoff',
    label: getDriverVisibleDropoffLabel(order),
    point: getDriverVisibleDropoffPoint(order),
  };
}

function FeedbackBanner({ tone, message }: { tone: FeedbackTone; message: string }) {
  const toneStyle =
    tone === 'success'
      ? styles.feedbackSuccess
      : tone === 'error'
        ? styles.feedbackError
        : styles.feedbackInfo;

  return (
    <View style={[styles.feedbackBanner, toneStyle]}>
      <Text style={styles.feedbackText}>{message}</Text>
    </View>
  );
}

function AppButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
  icon,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'dark';
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}) {
  const buttonStyle =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'dark'
        ? styles.buttonDark
        : styles.buttonSecondary;
  const textStyle = variant === 'secondary' ? styles.buttonTextSecondary : styles.buttonTextPrimary;
  const iconColor = variant === 'secondary' ? driveTheme.colors.ink : '#FFFFFF';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        buttonStyle,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <View style={styles.buttonInner}>
        <Text style={textStyle}>{label}</Text>
        {icon ? <MaterialCommunityIcons name={icon} size={18} color={iconColor} /> : null}
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'words',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        style={styles.textInput}
      />
    </View>
  );
}

function VehicleTypePicker({
  value,
  onChange,
}: {
  value: DriverVehicleType;
  onChange: (nextValue: DriverVehicleType) => void;
}) {
  return (
    <View style={styles.vehiclePicker}>
      {vehicleTypeOptions.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.vehicleChip, selected && styles.vehicleChipActive]}>
            <MaterialCommunityIcons
              name={option.icon}
              size={18}
              color={selected ? driveTheme.colors.primaryDark : driveTheme.colors.subtext}
            />
            <Text style={[styles.vehicleChipText, selected && styles.vehicleChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function VehicleColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextValue: string) => void;
}) {
  return (
    <View style={styles.colorPicker}>
      {vehicleColorOptions.map((option) => {
        const selected = option.label === value;

        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.label)}
            style={({ pressed }) => [
              styles.colorChip,
              selected && styles.colorChipActive,
              pressed && styles.buttonPressed,
            ]}>
            <View style={[styles.colorChipSwatch, { backgroundColor: option.swatch }]} />
            <Text style={[styles.colorChipText, selected && styles.colorChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SetupProgress({ activeStep }: { activeStep: SetupStep }) {
  const activeIndex = setupStepOrder.indexOf(activeStep);

  return (
    <View style={styles.setupProgressRow}>
      {setupSteps.map((step, index) => {
        const isComplete = index < activeIndex;
        const isActive = index === activeIndex;
        const iconName = isComplete ? 'check' : step.icon;

        return (
          <React.Fragment key={step.key}>
            <View style={styles.setupStepItem}>
              <View
                style={[
                  styles.setupStepCircle,
                  isComplete && styles.setupStepCircleComplete,
                  isActive && styles.setupStepCircleActive,
                ]}>
                <MaterialCommunityIcons
                  name={iconName}
                  size={18}
                  color={isComplete || isActive ? '#FFFFFF' : driveTheme.colors.primaryDark}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.setupStepLabel,
                  (isComplete || isActive) && styles.setupStepLabelActive,
                ]}>
                {step.label}
              </Text>
            </View>
            {index < setupSteps.length - 1 ? (
              <View
                style={[
                  styles.setupConnector,
                  index < activeIndex && styles.setupConnectorActive,
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function SetupField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'words',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.setupInputShell}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        style={styles.setupTextInput}
      />
    </View>
  );
}

function SetupSelectField({
  value,
  placeholder,
  onPress,
  swatchColor,
}: {
  value?: string;
  placeholder: string;
  onPress: () => void;
  swatchColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.setupInputShell, styles.setupSelectShell, pressed && styles.buttonPressed]}>
      {swatchColor ? <View style={[styles.setupColorSwatch, { backgroundColor: swatchColor }]} /> : null}
      <Text style={[styles.setupSelectText, !value && styles.setupSelectPlaceholder]}>
        {value || placeholder}
      </Text>
      <MaterialCommunityIcons name="menu-down" size={30} color="#7B8B8D" />
    </Pressable>
  );
}

function DocumentUploadList({
  uploads,
  onPick,
}: {
  uploads: DriverDocumentUploads;
  onPick: (key: DocumentKey) => void;
}) {
  return (
    <View style={styles.documentList}>
      {documentRequirements.map((item) => {
        const upload = uploads[item.key];
        const uploaded = !!upload?.uri;

        return (
          <View key={item.key} style={styles.documentRow}>
            <View style={styles.documentIconShell}>
              {uploaded ? (
                <Image source={{ uri: upload.uri }} style={styles.documentThumb} />
              ) : (
                <MaterialCommunityIcons name={item.icon} size={30} color={driveTheme.colors.primaryDark} />
              )}
            </View>
            <View style={styles.documentCopy}>
              <Text style={styles.documentTitle}>{item.label}</Text>
              <Text style={styles.documentHelper}>{uploaded ? upload.fileName || 'Ready for admin review' : item.helper}</Text>
            </View>
            <Pressable
              onPress={() => onPick(item.key)}
              style={({ pressed }) => [
                styles.documentUploadButton,
                uploaded && styles.documentUploadButtonDone,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={[styles.documentUploadText, uploaded && styles.documentUploadTextDone]}>
                {uploaded ? 'Change' : 'Upload'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function TripStopRow({
  tone,
  title,
  label,
}: {
  tone: 'pickup' | 'dropoff';
  title: string;
  label: string;
}) {
  return (
    <View style={styles.tripStopRow}>
      <View style={[styles.tripStopDot, tone === 'pickup' ? styles.tripStopPickup : styles.tripStopDropoff]} />
      <View style={styles.tripStopCopy}>
        <Text style={styles.tripStopTitle}>{title}</Text>
        <Text style={styles.tripStopLabel}>{label}</Text>
      </View>
    </View>
  );
}

function TripMetricChip({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
}) {
  return (
    <View style={styles.tripMetricChip}>
      <MaterialCommunityIcons name={icon} size={16} color={driveTheme.colors.primaryDark} />
      <Text style={styles.tripMetricText}>{label}</Text>
    </View>
  );
}

function MetricTile({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  label: string;
}) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricTileIconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color={driveTheme.colors.primaryDark} />
      </View>
      <Text style={styles.metricTileValue}>{value}</Text>
      <Text style={styles.metricTileLabel}>{label}</Text>
    </View>
  );
}

function PaymentFlowStep({
  index,
  title,
  detail,
  tone,
}: {
  index: string;
  title: string;
  detail: string;
  tone: PaymentStepTone;
}) {
  const isDone = tone === 'done';
  const isActive = tone === 'active';

  return (
    <View style={styles.paymentFlowStep}>
      <View
        style={[
          styles.paymentFlowIndex,
          isDone ? styles.paymentFlowIndexDone : isActive ? styles.paymentFlowIndexActive : styles.paymentFlowIndexMuted,
        ]}>
        <Text style={[styles.paymentFlowIndexText, (isDone || isActive) && styles.paymentFlowIndexTextActive]}>{index}</Text>
      </View>
      <View style={styles.paymentFlowCopy}>
        <Text style={styles.paymentFlowTitle}>{title}</Text>
        <Text style={styles.paymentFlowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function TripMap({
  pickupPoint,
  dropoffPoint,
  driverPoint,
  statusLabel,
  onOpenNavigation,
  MapViewComponent,
  MarkerComponent,
  PolylineComponent,
}: {
  pickupPoint: MapPoint;
  dropoffPoint: MapPoint | null;
  driverPoint: MapPoint | null;
  statusLabel: string;
  onOpenNavigation: () => void;
  MapViewComponent: any;
  MarkerComponent: any;
  PolylineComponent: any;
}) {
  const MapView = MapViewComponent;
  const Marker = MarkerComponent;
  const Polyline = PolylineComponent;
  const fallbackMap = (
    <View style={styles.mapFallbackShell}>
      <View style={styles.mapFallbackScene}>
        <View style={styles.mapFallbackGlowA} />
        <View style={styles.mapFallbackGlowB} />
        <View style={styles.mapRouteLine} />
        <View style={[styles.mapNode, styles.mapNodePickup]}>
          <View style={styles.mapNodeInner} />
        </View>
        <View style={[styles.mapNode, styles.mapNodeDropoff]}>
          <View style={styles.mapNodeInner} />
        </View>
        <View style={[styles.mapNode, styles.mapNodeDriver]}>
          <MaterialCommunityIcons name="car-outline" size={14} color="#FFFFFF" />
        </View>
      </View>
      <View style={styles.mapFallbackCard}>
        <Text style={styles.mapFallbackTitle}>Route guidance</Text>
        <Text style={styles.mapFallbackText}>
          {dropoffPoint ? 'Pickup point and destination are loaded for this trip.' : 'Pickup point is loaded. Destination coordinates are pending.'}
        </Text>
        <Text style={styles.mapFallbackText}>
          Pickup: {pickupPoint.latitude.toFixed(5)}, {pickupPoint.longitude.toFixed(5)}
        </Text>
        {dropoffPoint ? (
          <Text style={styles.mapFallbackText}>
            Drop-off: {dropoffPoint.latitude.toFixed(5)}, {dropoffPoint.longitude.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.mapFallbackText}>Drop-off coordinates are not available yet.</Text>
        )}
        {driverPoint ? (
          <Text style={styles.mapFallbackText}>
            Driver: {driverPoint.latitude.toFixed(5)}, {driverPoint.longitude.toFixed(5)}
          </Text>
        ) : null}
        <AppButton label="Open navigation" icon="navigation-variant-outline" onPress={onOpenNavigation} />
      </View>
    </View>
  );

  if (Platform.OS === 'web') {
    return fallbackMap;
  }

  const routePoints = [pickupPoint, driverPoint, dropoffPoint].filter(Boolean) as MapPoint[];
  const centerPoint = dropoffPoint
    ? {
        latitude: (pickupPoint.latitude + dropoffPoint.latitude) / 2,
        longitude: (pickupPoint.longitude + dropoffPoint.longitude) / 2,
      }
    : pickupPoint;

  return (
    <View style={styles.mapCard}>
      {MapView ? (
        <MapView
          provider={undefined}
          style={styles.mapView}
          mapType="standard"
          showsCompass
          showsTraffic={false}
	          toolbarEnabled={false}
	          showsUserLocation={false}
	          loadingEnabled
	          initialRegion={{
	            latitude: centerPoint.latitude,
	            longitude: centerPoint.longitude,
	            latitudeDelta: dropoffPoint ? Math.max(Math.abs(pickupPoint.latitude - dropoffPoint.latitude) * 2, 0.04) : 0.04,
	            longitudeDelta: dropoffPoint ? Math.max(Math.abs(pickupPoint.longitude - dropoffPoint.longitude) * 2, 0.04) : 0.04,
	          }}>
	          {Marker ? <Marker coordinate={pickupPoint} title="Pickup" description="Pickup point" pinColor="#F97316" /> : null}
	          {dropoffPoint && Marker ? <Marker coordinate={dropoffPoint} title="Drop-off" description="Drop-off point" pinColor="#0F9D58" /> : null}
	          {driverPoint && Marker ? (
	            <Marker coordinate={driverPoint} title="Driver" description="Current driver location" pinColor="#2563EB" />
	          ) : null}
	          {routePoints.length >= 2 && Polyline ? <Polyline coordinates={routePoints} strokeColor="#0F9D58" strokeWidth={4} /> : null}
	        </MapView>
      ) : (
        <View style={[styles.mapView, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#94A3B8' }}>Map unavailable on this device</Text>
        </View>
      )}
      <View pointerEvents="box-none" style={styles.mapOverlay}>
        <View style={styles.mapOverlayTop}>
          <View style={styles.mapBadge}>
            <MaterialCommunityIcons name="map-marker-path" size={14} color="#FFFFFF" />
            <Text style={styles.mapBadgeText}>{statusLabel}</Text>
          </View>
          <View style={styles.mapBadgeMuted}>
            <MaterialCommunityIcons name="navigation-variant-outline" size={14} color={driveTheme.colors.ink} />
            <Text style={styles.mapBadgeMutedText}>Route loaded</Text>
          </View>
        </View>
        <View style={styles.mapOverlayBottom}>
          <Pressable onPress={onOpenNavigation} style={({ pressed }) => [styles.mapNavButton, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="navigation-variant-outline" size={18} color="#FFFFFF" />
            <Text style={styles.mapNavButtonText}>Open navigation</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// NEW: Driver extra fields interface for Firestore
// ──────────────────────────────────────────────
interface DriverExtraFields {
  totalOnlineHours?: number;
  onlineSessionStart?: number;
  cancellationCount?: number;
  rejectionCount?: number;
  disciplinePoints?: number;
  driverScore?: number;
  completedOrderCount?: number;
  suspensionUntil?: number;
  lastCommissionPaymentDateKey?: string;
  lastCommissionPaidAmount?: number;
  lastCommissionPaidAt?: unknown;
  lastCommissionPaymentStatus?: string;
  lastSubscriptionPaymentStatus?: string;
  lastSubscriptionPaymentExpiresAt?: unknown;
  subscriptionPaidUntil?: unknown;
  subscriptionTrialStartedAt?: unknown;
  subscriptionTrialEndsAt?: unknown;
  subscriptionStatus?: string;
  totalCommissionPaid?: number;
}

// ──────────────────────────────────────────────
// NEW: Utility to extract number from currency string
// ──────────────────────────────────────────────
function parseAmountFromLabel(label: string): number {
  const digits = label.replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
}

function toLocalDateKey(value: Date | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function toTanzaniaDateKey(value: Date | number = new Date()) {
  const millis = value instanceof Date ? value.getTime() : value;
  const date = new Date(millis + tanzaniaUtcOffsetMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + tanzaniaUtcOffsetMs);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - tanzaniaUtcOffsetMs;
}

function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + tanzaniaUtcOffsetMs);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * dayMs;
}

function getOrderTimestampMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getDeliveredOrderMillis(order: DeliveryOrder) {
  return getOrderTimestampMillis(order.deliveredAt || order.updatedAt || order.createdAt);
}

function getOrderActivityMillis(order: DeliveryOrder) {
  return getOrderTimestampMillis(
    order.status === 'delivered'
      ? order.deliveredAt || order.updatedAt || order.createdAt
      : order.updatedAt || order.createdAt
  );
}

function getDriverSubscriptionBillingCycleStartMillis() {
  return getTanzaniaWeekStartMillis();
}

// ──────────────────────────────────────────────
// DoorDriveApp Component
// ──────────────────────────────────────────────

export default function DoorDriveApp() {
  useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  // ─── Original state ───────────────────────
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [showStartupSplash, setShowStartupSplash] = useState(true);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [driverOrdersLoading, setDriverOrdersLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [selectedTab, setSelectedTab] = useState<DriverTab>('home');
  const [accountView, setAccountView] = useState<AccountView>('overview');
  const [paymentCheckoutStep, setPaymentCheckoutStep] = useState<PaymentCheckoutStep>('debt');
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
  const [locationPermission, setLocationPermission] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [locationLabel, setLocationLabel] = useState('Location sync has not started yet.');
  const [driverProfile, setDriverProfile] = useState<DriverRecord | null>(null);
  const [driverOrders, setDriverOrders] = useState<DeliveryOrder[]>([]);
  const [tripMessages, setTripMessages] = useState<OrderMessage[]>([]);
  const [tripMessagesLoading, setTripMessagesLoading] = useState(false);
  const [tripMessageDraft, setTripMessageDraft] = useState('');
  const [tripMessageSending, setTripMessageSending] = useState(false);
  const [customerRatingScore, setCustomerRatingScore] = useState(5);
  const [customerRatingComment, setCustomerRatingComment] = useState('');
  const [customerRatingSaving, setCustomerRatingSaving] = useState(false);
  const [language, setLanguage] = useState<DriverLang>('en');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const autoAcceptedOrderIdRef = useRef<string | null>(null);
  const settingsReadyRef = useRef(false);
  const splashProgress = useRef(new Animated.Value(0)).current;
  const copy = getDriverCopy(language);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(getInitialRegisterForm());
  const [registerStep, setRegisterStep] = useState<SetupStep>('profile');
  const [registerDocuments, setRegisterDocuments] = useState<DriverDocumentUploads>(getInitialDocumentUploads());
  const [registerTermsAccepted, setRegisterTermsAccepted] = useState(false);
  const [profileSetup, setProfileSetup] = useState<ProfileSetupState>(getInitialProfileSetup(null));
  const [profileSetupStep, setProfileSetupStep] = useState<SetupStep>('profile');
  const [profileDocuments, setProfileDocuments] = useState<DriverDocumentUploads>(getInitialDocumentUploads());
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);

  // ─── NEW state for performance & payment tracking ───
  const [extraFields, setExtraFields] = useState<DriverExtraFields>({});
  const [onlineHours, setOnlineHours] = useState(0);
  const [onlineSessionTimer, setOnlineSessionTimer] = useState<NodeJS.Timeout | null>(null);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [showPaymentNotice, setShowPaymentNotice] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentPhoneNumber, setPaymentPhoneNumber] = useState('');
  const [selectedPaymentNetwork, setSelectedPaymentNetwork] = useState<DriverPaymentNetworkKey>('mpesa');
  const [driverPaymentStatus, setDriverPaymentStatus] = useState<DriverPaymentStatusResponse | null>(null);
  const [driverPaymentHistory, setDriverPaymentHistory] = useState<DriverPaymentRecord[]>([]);
  const [paymentRefreshing, setPaymentRefreshing] = useState(false);
  const [nowMillis, setNowMillis] = useState(Date.now());
  const sessionAccumulatorRef = useRef<number>(0);
  const knownTripMessageIdsRef = useRef<Set<string>>(new Set());
  const tripMessagesHydratedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const vibratingAssignedOrderRef = useRef<string | null>(null);
  const openedAssignedOrderIdsRef = useRef<Set<string>>(new Set());
  const driverAccessDailyFeeTzs = driverPaymentStatus?.subscription?.dailyFee || driverAccessFallbackDailyFeeTzs;
  const weeklySubscriptionFeeTzs = driverAccessDailyFeeTzs;

  useEffect(() => {
    Animated.timing(splashProgress, {
      toValue: 1,
      duration: 4000,
      useNativeDriver: false,
    }).start();
    const splashTimer = setTimeout(() => setShowStartupSplash(false), 4000);
    return () => clearTimeout(splashTimer);
  }, [splashProgress]);

  useEffect(() => {
    void loadDriverSettings().then((settings) => {
      setLanguage(settings.language);
      setAutoConfirm(settings.autoConfirm);
      settingsReadyRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!settingsReadyRef.current) {
      return;
    }
    void saveDriverSettings({ language, autoConfirm });
  }, [autoConfirm, language]);

  useEffect(() => {
    const timer = setInterval(() => setNowMillis(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Guarded maps import to avoid crashing the app if the native maps module is unavailable.
  const Maps = tryRequire<any>('react-native-maps');
  const MapView = Maps?.default ?? Maps ?? null;
  const Marker = Maps?.Marker ?? null;
  const Polyline = Maps?.Polyline ?? null;

  const normalizedRegisterPhone = useMemo(() => normalizePhoneNumber(registerForm.phoneNumber), [registerForm.phoneNumber]);
  const normalizedSetupPhone = useMemo(() => normalizePhoneNumber(profileSetup.phoneNumber), [profileSetup.phoneNumber]);
  const driverProfileMissing =
    !!authUser &&
    !profileLoading &&
    !registering &&
    !registrationSubmitted &&
    (!driverProfile ||
      !driverProfile.fullName?.trim() ||
      !driverProfile.phoneNumber?.trim() ||
      (!driverProfile.vehicleType && !driverProfile.vehicleLabel?.trim()) ||
      !driverProfile.plateNumber?.trim());
  const hasReadyDriverProfile = !!driverProfile && !driverProfileMissing;
  const activeOrder = useMemo(
    () => {
      const currentOrderId = driverProfile?.currentOrderId?.trim();
      if (currentOrderId) {
        const currentOrder = driverOrders.find((order) => order.id === currentOrderId && isActiveOrderStatus(order.status));
        if (currentOrder) {
          return currentOrder;
        }
      }

      return driverOrders.find((order) => isActiveOrderStatus(order.status)) ?? null;
    },
    [driverOrders, driverProfile?.currentOrderId]
  );
  const trackDriverActivity = (
    eventName: string,
    featureKey: string,
    metadata?: Record<string, string | number | boolean | null | undefined>
  ) => {
    void recordDriverActivity({
      driverId: authUser?.uid,
      driverName: driverProfile?.fullName || authUser?.displayName || authUser?.email || 'DoorDrive driver',
      eventName,
      featureKey,
      featureLabel: 'Driver operations',
      screen: selectedTab,
      route: 'doordrive',
      metadata: {
        vehicleType: driverProfile?.vehicleType,
        isAvailable: driverProfile?.isAvailable,
        hasActiveOrder: Boolean(activeOrder),
        ...metadata,
      },
    });
  };
  const todayDateKey = toLocalDateKey();
  const todayOrders = useMemo(
    () => driverOrders.filter((order) => {
      const activityMillis = getOrderActivityMillis(order);
      return !!activityMillis && toLocalDateKey(activityMillis) === todayDateKey;
    }),
    [driverOrders, todayDateKey]
  );
  const todayDeliveredOrders = useMemo(
    () => todayOrders.filter((order) => order.status === 'delivered'),
    [todayOrders]
  );
  const todayCompletedCount = todayDeliveredOrders.length;
  const todayActiveCount = todayOrders.filter((order) => isActiveOrderStatus(order.status)).length;
  const todayEarnings = todayDeliveredOrders.reduce(
    (sum, order) => sum + parseAmountFromLabel(order.totalLabel || order.fareLabel),
    0
  );
  const driverVerificationStatus = driverProfile?.verificationStatus || 'verified';
  const driverVerificationPending = driverVerificationStatus === 'pending_admin_verification';
  const driverVerificationRejected = driverVerificationStatus === 'rejected';
  const subscriptionPaidUntilMillis = getOrderTimestampMillis(driverPaymentStatus?.subscription?.paidUntil || driverProfile?.subscriptionPaidUntil);
  const subscriptionActive = hasReadyDriverProfile;
  const latestPayment = driverPaymentStatus?.latestPayment || null;
  const latestPaymentStatus = (latestPayment?.status || driverProfile?.lastSubscriptionPaymentStatus || '').toLowerCase();
  const latestPaymentExpiresMillis = getOrderTimestampMillis(latestPayment?.expiresAt || driverProfile?.lastSubscriptionPaymentExpiresAt);
  const subscriptionPaymentPending =
    !subscriptionActive &&
    ['creating', 'pending', 'initiated', 'processing'].includes(latestPaymentStatus) &&
    (!latestPaymentExpiresMillis || latestPaymentExpiresMillis > nowMillis);
  const commissionOrders = useMemo(
    () => driverOrders.filter((order) => order.status === 'delivered' && getDeliveredOrderMillis(order) >= getTanzaniaDayStartMillis()),
    [driverOrders, todayDateKey]
  );
  const weeklyDeliveredOrderCount = commissionOrders.length;
  const commissionDateKey = toTanzaniaDateKey(nowMillis);
  const dailyGrossEarnings = todayEarnings;
  const dailyCommissionDue = driverAccessDailyFeeTzs;
  const hasCommissionDue = hasReadyDriverProfile && !driverVerificationPending && !driverVerificationRejected && !subscriptionActive;
  const subscriptionCountdownLabel = !hasReadyDriverProfile
    ? 'Access starts after verification'
    : 'Free to use';
  const subscriptionCountdownShortLabel = !hasReadyDriverProfile ? 'Pending' : 'Free';
  const subscriptionCountdownCaption = !hasReadyDriverProfile
    ? 'Complete verification first.'
    : 'You can receive and manage DoorDrop orders.';
  const commissionPaymentOverdue = hasCommissionDue && !subscriptionPaymentPending;
  const subscriptionStatusMessage = subscriptionActive ? 'Active' : subscriptionPaymentPending ? 'Pending payment' : 'Renew access';
  const commissionPaidForDate = subscriptionPaymentPending;
  const driverCanReceiveDispatch = !driverVerificationPending && !driverVerificationRejected && subscriptionActive;
  const driverAccessBlocked = hasReadyDriverProfile && !driverVerificationPending && !driverVerificationRejected && !subscriptionActive;
  const paymentNetworks = driverPaymentStatus?.networks?.length ? driverPaymentStatus.networks : defaultMongikePaymentNetworks;
  const selectedNetworkMeta =
    paymentNetworks.find((item) => item.key === selectedPaymentNetwork) ||
    paymentNetworks.find((item) => item.enabled) ||
    defaultMongikePaymentNetworks[0];
  const paymentRecipientPhone = selectedNetworkMeta?.recipientPhone || '0750355402';
  const availabilityLabel = activeOrder
    ? 'Busy on active trip'
    : driverVerificationPending
      ? 'Pending admin verification'
      : driverVerificationRejected
        ? 'Verification needs correction'
        : hasCommissionDue
            ? subscriptionPaymentPending ? 'Payment pending' : 'Payment required'
            : driverProfile?.isAvailable
              ? 'Online for dispatch'
              : 'Offline from dispatch';
  const availabilityNote = activeOrder
    ? 'Dispatch can see that you are currently handling a live order.'
    : driverVerificationPending
      ? 'Admin is reviewing your plate number, vehicle photo, and driver photo.'
      : driverVerificationRejected
        ? 'Your verification was rejected. Contact admin or update your profile details.'
        : hasCommissionDue
            ? subscriptionPaymentPending
              ? 'Approve the mobile money prompt or refresh status after paying.'
              : `Pay TZS ${driverAccessDailyFeeTzs.toLocaleString()} daily to receive and manage orders.`
            : driverProfile?.isAvailable
              ? 'Admin can assign work to you now.'
              : 'Admin will not assign new work until you go online.';
  const commissionPaymentReference = useMemo(() => {
    const plateReference = driverProfile?.plateNumber?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const driverReference = authUser?.uid ? authUser.uid.slice(0, 6).toUpperCase() : 'DRIVER';
    const dateReference = commissionDateKey.replace(/-/g, '');

    return `DD-${plateReference || driverReference}-${dateReference}`;
  }, [authUser?.uid, commissionDateKey, driverProfile?.plateNumber]);
  const pendingCustomerRatingOrder = useMemo(
    () => driverOrders.find((order) => order.status === 'delivered' && !order.driverCustomerRating) ?? null,
    [driverOrders]
  );
  const notificationItems = useMemo<DriverNotification[]>(() => {
    const items: DriverNotification[] = [];

    if (activeOrder) {
      items.push({
        id: `active-${activeOrder.id}`,
        title: 'Active order assigned',
        message: `${activeOrder.orderNumber} is ${getDeliveryOrderStatusLabel(activeOrder.status).toLowerCase()}.`,
        icon: 'truck-delivery-outline',
        tone: 'success',
        time: formatDeliveryDateTime(activeOrder.createdAt),
      });
    }

    const latestCustomerMessage = tripMessages.filter((item) => item.senderRole === 'customer').slice(-1)[0];
    if (latestCustomerMessage) {
      items.push({
        id: `message-${latestCustomerMessage.id}`,
        title: `Message from ${latestCustomerMessage.senderName || 'customer'}`,
        message: latestCustomerMessage.message,
        icon: 'message-text-outline',
        tone: 'info',
        time: formatDeliveryDateTime(latestCustomerMessage.createdAt),
      });
    }

    if (hasCommissionDue) {
      items.push({
        id: 'payment-due',
        title: subscriptionPaymentPending ? 'Access pending' : 'Driver access',
        message: subscriptionPaymentPending
          ? 'Payment is pending. Approve the mobile money prompt.'
          : `Renew daily access with TZS ${driverAccessDailyFeeTzs.toLocaleString()}.`,
        icon: 'cash-clock',
        tone: 'warning',
        time: subscriptionStatusMessage,
      });
    }

    if (driverVerificationPending) {
      items.push({
        id: 'driver-verification-pending',
        title: 'Admin verification pending',
        message: 'DoorDrop admin is reviewing your plate number, vehicle photo, and driver photo.',
        icon: 'shield-lock-outline',
        tone: 'warning',
        time: 'Pending',
      });
    }

    if (driverVerificationRejected) {
      items.push({
        id: 'driver-verification-rejected',
        title: 'Verification needs correction',
        message: 'Contact admin or update your driver details before receiving orders.',
        icon: 'shield-alert-outline',
        tone: 'warning',
        time: 'Action needed',
      });
    }

    if (locationPermission === 'denied') {
      items.push({
        id: 'location-denied',
        title: 'Location permission needed',
        message: 'Turn on location access so customers and dispatch can track active trips.',
        icon: 'map-marker-alert-outline',
        tone: 'warning',
        time: 'Now',
      });
    }

    if (!activeOrder && driverProfile?.isAvailable && !hasCommissionDue && driverCanReceiveDispatch) {
      items.push({
        id: 'waiting-dispatch',
        title: 'Online for dispatch',
        message: 'You are visible to DoorDrop dispatch for the next assignment.',
        icon: 'access-point',
        tone: 'success',
        time: 'Live',
      });
    }

    return items;
  }, [activeOrder, driverCanReceiveDispatch, driverProfile?.isAvailable, driverVerificationPending, driverVerificationRejected, hasCommissionDue, locationPermission, paymentAmount, subscriptionPaymentPending, subscriptionStatusMessage, tripMessages, weeklySubscriptionFeeTzs]);
  const unreadNotificationCount = notificationItems.filter((item) => item.tone !== 'success').length;

  async function refreshDriverPayments(showSpinner = true) {
    if (!authUser?.uid) {
      return;
    }

    if (showSpinner) {
      setPaymentRefreshing(true);
    }

    try {
      const status = await fetchDriverPaymentStatus();
      setDriverPaymentStatus(status);
      setDriverPaymentHistory(status.history || []);
    } catch (error) {
      if (showSpinner) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Could not refresh payment status right now.',
        });
      }
    } finally {
      if (showSpinner) {
        setPaymentRefreshing(false);
      }
    }
  }

  useEffect(() => {
    setDriverPaymentStatus(null);
    setDriverPaymentHistory([]);
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid || !subscriptionPaymentPending) {
      return;
    }

    const timer = setInterval(() => {
      void verifyDriverAccessPayment(latestPayment?.id).then((status) => {
        setDriverPaymentStatus(status);
        setDriverPaymentHistory(status.history || []);
      }).catch(() => null);
    }, 10000);

    return () => clearInterval(timer);
  }, [authUser?.uid, latestPayment?.id, subscriptionPaymentPending]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;

      if (nextState === 'active' && vibratingAssignedOrderRef.current) {
        openedAssignedOrderIdsRef.current.add(vibratingAssignedOrderRef.current);
        vibratingAssignedOrderRef.current = null;
        Vibration.cancel();
      }
    });

    return () => {
      subscription.remove();
      vibratingAssignedOrderRef.current = null;
      Vibration.cancel();
    };
  }, []);

  useEffect(() => {
    const assignedOrderId =
      activeOrder?.status === 'driver_assigned' && !activeOrder.acceptedByDriverAt ? activeOrder.id : '';

    if (!assignedOrderId) {
      if (vibratingAssignedOrderRef.current) {
        vibratingAssignedOrderRef.current = null;
        Vibration.cancel();
      }
      return;
    }

    if (appStateRef.current === 'active') {
      if (vibratingAssignedOrderRef.current === assignedOrderId) {
        vibratingAssignedOrderRef.current = null;
        Vibration.cancel();
      }
      if (!openedAssignedOrderIdsRef.current.has(assignedOrderId)) {
        Vibration.vibrate(foregroundAssignedOrderVibrationPattern, false);
        openedAssignedOrderIdsRef.current.add(assignedOrderId);
      }
      return;
    }

    if (openedAssignedOrderIdsRef.current.has(assignedOrderId) || vibratingAssignedOrderRef.current === assignedOrderId) {
      return;
    }

    vibratingAssignedOrderRef.current = assignedOrderId;
    Vibration.cancel();
    Vibration.vibrate(assignedOrderVibrationPattern, true);
  }, [activeOrder?.acceptedByDriverAt, activeOrder?.id, activeOrder?.status]);

  // ──────────────────────────────────────────────
  // Original effects (unchanged)
  // ──────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setAuthUser(nextUser);
      setAuthInitializing(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authUser) {
      setDriverProfile(null);
      setDriverOrders([]);
      setTripMessages([]);
      setTripMessagesLoading(false);
      setTripMessageDraft('');
      setExtraFields({});
      setOnlineHours(0);
      setProfileLoading(false);
      setDriverOrdersLoading(false);
      setRegisterStep('profile');
      setProfileSetupStep('profile');
      setRegistrationSubmitted(false);
      knownTripMessageIdsRef.current = new Set();
      tripMessagesHydratedRef.current = false;
      return;
    }

    setProfileLoading(true);
    setDriverOrdersLoading(true);

    const unsubscribeDriver = subscribeToDriver(
      authUser.uid,
      (nextDriver) => {
        setDriverProfile(nextDriver);
        if (nextDriver) {
          const nextExtraFields = nextDriver as DriverExtraFields;
          setExtraFields(nextExtraFields);
          if (nextExtraFields.totalOnlineHours !== undefined) {
            setOnlineHours(nextExtraFields.totalOnlineHours);
          }
        } else {
          setExtraFields({});
          setOnlineHours(0);
        }
        setProfileLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not load the driver profile right now.')
              : 'Could not load the driver profile right now.',
        });
        setProfileLoading(false);
      }
    );

    const unsubscribeDriverOrders = subscribeToDriverOrders(
      authUser.uid,
      (orders) => {
        setDriverOrders(orders);
        setDriverOrdersLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not load your delivery feed right now.')
              : 'Could not load your delivery feed right now.',
        });
        setDriverOrdersLoading(false);
      }
    );

    return () => {
      unsubscribeDriver();
      unsubscribeDriverOrders();
    };
  }, [authUser]);

  useEffect(() => {
    const currentOrderId = driverProfile?.currentOrderId?.trim();
    if (!authUser?.uid || !currentOrderId) {
      return;
    }

    const unsubscribeCurrentOrder = subscribeToDeliveryOrder(
      currentOrderId,
      (order) => {
        if (!order || order.driverId !== authUser.uid) {
          return;
        }

        setDriverOrders((currentOrders) => {
          const withoutCurrent = currentOrders.filter((item) => item.id !== order.id);
          return [order, ...withoutCurrent];
        });
        setDriverOrdersLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not sync the assigned order right now.')
              : 'Could not sync the assigned order right now.',
        });
      }
    );

    return unsubscribeCurrentOrder;
  }, [authUser?.uid, driverProfile?.currentOrderId]);

  useEffect(() => {
    if (driverProfile) {
      setRegistrationSubmitted(false);
    }
  }, [driverProfile?.id]);

  useEffect(() => {
    if (!authUser || !driverProfileMissing) {
      return;
    }

    setProfileSetup((current) => ({
      ...current,
      fullName: current.fullName || authUser.displayName?.trim() || '',
    }));
  }, [authUser, driverProfileMissing]);

  useEffect(() => {
    if (!authUser?.uid || !activeOrder?.id || driverProfile?.currentOrderId === activeOrder.id) {
      return;
    }

    updateDoc(doc(db, 'drivers', authUser.uid), {
      currentOrderId: activeOrder.id,
      isAvailable: false,
      updatedAt: serverTimestamp(),
    }).catch(() => null);
  }, [activeOrder?.id, authUser?.uid, driverProfile?.currentOrderId]);

  useEffect(() => {
    if (!activeOrder?.id) {
      setTripMessages([]);
      setTripMessagesLoading(false);
      setTripMessageDraft('');
      knownTripMessageIdsRef.current = new Set();
      tripMessagesHydratedRef.current = false;
      return;
    }

    setTripMessagesLoading(true);
    knownTripMessageIdsRef.current = new Set();
    tripMessagesHydratedRef.current = false;

    const unsubscribe = subscribeToOrderMessages(
      activeOrder.id,
      (nextMessages) => {
        setTripMessages(nextMessages);
        setTripMessagesLoading(false);

        if (!tripMessagesHydratedRef.current) {
          knownTripMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
          tripMessagesHydratedRef.current = true;
          return;
        }

        const freshCustomerMessages = nextMessages.filter(
          (item) => !knownTripMessageIdsRef.current.has(item.id) && item.senderRole === 'customer'
        );

        nextMessages.forEach((item) => {
          knownTripMessageIdsRef.current.add(item.id);
        });

        const latestCustomerMessage = freshCustomerMessages[freshCustomerMessages.length - 1];
        if (latestCustomerMessage) {
          setFeedback({ tone: 'info', message: `Customer message: ${latestCustomerMessage.message}` });
          Alert.alert('New customer message', latestCustomerMessage.message);
        }
      },
      (error) => {
        setTripMessagesLoading(false);
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not sync trip messages right now.')
              : 'Could not sync trip messages right now.',
        });
      }
    );

    return unsubscribe;
  }, [activeOrder?.id]);

  useEffect(() => {
    if (!authUser?.uid || !hasReadyDriverProfile) {
      return;
    }

    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    const pushLocation = async (coords: Location.LocationObjectCoords) => {
      const heading = typeof coords.heading === 'number' && coords.heading >= 0 ? coords.heading : undefined;
      const speedKph = typeof coords.speed === 'number' && coords.speed >= 0 ? coords.speed * 3.6 : undefined;
      const accuracyMeters = typeof coords.accuracy === 'number' ? coords.accuracy : undefined;

      await updateDriverLocation(authUser.uid, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        heading,
        speedKph,
        accuracyMeters,
      });

      if (!active) {
        return;
      }

      setLocationLabel(
        `Live location synced ${new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })}`
      );
    };

    const startLocationSync = async () => {
      setLocationPermission('requesting');

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (!active) {
          return;
        }

        if (permission.status !== 'granted') {
          await recordDriverAppOpen({
            uid: authUser.uid,
            email: authUser.email?.trim().toLowerCase(),
            fullName: driverProfile?.fullName || authUser.displayName?.trim() || 'DoorDrive driver',
            phoneNumber: driverProfile?.phoneNumber || '',
          });
          setLocationPermission('denied');
          setLocationLabel('Location permission is required for live driver tracking.');
          return;
        }

        setLocationPermission('granted');

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        await recordDriverAppOpen({
          uid: authUser.uid,
          email: authUser.email?.trim().toLowerCase(),
          fullName: driverProfile?.fullName || authUser.displayName?.trim() || 'DoorDrive driver',
          phoneNumber: driverProfile?.phoneNumber || '',
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
        await pushLocation(current.coords);

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 10,
            timeInterval: 3000,
            mayShowUserSettingsDialog: true,
          },
          (nextLocation) => {
            void pushLocation(nextLocation.coords).catch(() => null);
          }
        );
      } catch {
        if (!active) {
          return;
        }

        setLocationPermission('denied');
        setLocationLabel('Live location could not be started right now.');
      }
    };

    void startLocationSync();

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    driverProfile?.fullName,
    driverProfile?.phoneNumber,
    hasReadyDriverProfile,
  ]);

  // ──────────────────────────────────────────────
  // NEW: Online session timer
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!hasReadyDriverProfile || !driverProfile?.isAvailable || !authUser?.uid) {
      if (onlineSessionTimer) {
        clearInterval(onlineSessionTimer);
        setOnlineSessionTimer(null);
        if (sessionAccumulatorRef.current > 0 && authUser?.uid) {
          const secondsToAdd = sessionAccumulatorRef.current;
          updateDoc(doc(db, 'drivers', authUser.uid), {
            totalOnlineHours: increment(secondsToAdd / 3600),
            onlineSessionStart: null,
          }).catch(() => {});
          sessionAccumulatorRef.current = 0;
        }
      }
      return;
    }

    if (!onlineSessionTimer) {
      const timer = setInterval(() => {
        sessionAccumulatorRef.current += 10;
        // flush every minute
        if (sessionAccumulatorRef.current % 60 === 0) {
          const secondsToAdd = sessionAccumulatorRef.current;
          updateDoc(doc(db, 'drivers', authUser.uid), {
            totalOnlineHours: increment(secondsToAdd / 3600),
            onlineSessionStart: serverTimestamp(),
          }).catch(() => {});
          sessionAccumulatorRef.current = 0;
        }
      }, 10000);
      setOnlineSessionTimer(timer);
    }

    return () => {
      if (onlineSessionTimer) {
        clearInterval(onlineSessionTimer);
      }
    };
  }, [driverProfile?.isAvailable, authUser?.uid, hasReadyDriverProfile]);

  // ──────────────────────────────────────────────
  // NEW: Total earnings from delivered orders
  // ──────────────────────────────────────────────
  useEffect(() => {
    const deliveredTotal = driverOrders
      .filter(order => order.status === 'delivered')
      .reduce((sum, order) => sum + parseAmountFromLabel(order.totalLabel), 0);
    setTotalEarnings(deliveredTotal);
  }, [driverOrders]);

  // ──────────────────────────────────────────────
  // Keep the renewal banner in sync with the daily Mongike payment state.
  // ──────────────────────────────────────────────
  useEffect(() => {
    setPaymentAmount(dailyCommissionDue);
    setShowPaymentNotice(hasCommissionDue);
  }, [dailyCommissionDue, hasCommissionDue]);

  useEffect(() => {
    if (!hasCommissionDue) {
      setPaymentCheckoutStep('debt');
      return;
    }

    if (commissionPaidForDate) {
      setPaymentCheckoutStep('submitted');
    }
  }, [commissionPaidForDate, hasCommissionDue]);

  // ──────────────────────────────────────────────
  // Original handlers (unchanged)
  // ──────────────────────────────────────────────

  const handleSignIn = async () => {
    const normalizedEmail = loginEmail.trim().toLowerCase();

    if (signingIn) {
      return;
    }

    if (!/\S+@\S+\.\S+/.test(normalizedEmail) || loginPassword.trim().length < 6) {
      setFeedback({ tone: 'error', message: 'Enter your email and password to continue.' });
      return;
    }

    setSigningIn(true);
    setFeedback(null);

    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, loginPassword);
      setFeedback({ tone: 'success', message: 'Signed in to DoorDrive.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseAuthErrorMessage(error.code)
            : 'Unable to sign in right now. Please try again.',
      });
    } finally {
      setSigningIn(false);
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = registerForm.email.trim().toLowerCase();
    const fullName = getRegisterFullName(registerForm);
    const vehicleLabel = getRegisterVehicleLabel(registerForm);
    const password = registerForm.password.trim();
    const confirm = registerForm.confirmPassword.trim();
    const passwordMatches = password.length >= 6 && (!confirm || confirm === password);
    const vehicleColor = registerForm.vehicleColor.trim() || 'White';

    if (
      registering ||
      fullName.length < 2 ||
      !/\S+@\S+\.\S+/.test(normalizedEmail) ||
      !normalizedRegisterPhone ||
      !passwordMatches ||
      !vehicleLabel ||
      !registerForm.plateNumber.trim() ||
      !registerTermsAccepted
    ) {
      setFeedback({
        tone: 'error',
        message: 'Add your name, phone, email, password, plate number, and agree to the terms.',
      });
      return;
    }

    setRegistering(true);
    setFeedback(null);

    try {
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, registerForm.password.trim());

      await updateProfile(credential.user, {
        displayName: fullName,
      });

      const verificationDocuments = getDriverVerificationDocumentPlaceholders(registerDocuments);

      await registerDriver({
        uid: credential.user.uid,
        email: normalizedEmail,
        fullName,
        phoneNumber: normalizedRegisterPhone,
        vehicleType: registerForm.vehicleType,
        vehicleLabel,
        vehicleColor,
        plateNumber: registerForm.plateNumber.trim(),
        verificationStatus: 'pending_admin_verification',
        verificationDocuments,
        acceptedTerms: true,
        acceptedTermsVersion: DOORDRIVE_TERMS_VERSION,
      });

      void syncDriverVerificationImages(credential.user.uid, registerDocuments).catch(() => null);

      setRegisterForm(getInitialRegisterForm());
      setRegisterDocuments(getInitialDocumentUploads());
      setRegisterTermsAccepted(false);
      setRegisterStep('profile');
      setRegistrationSubmitted(true);
      setFeedback({ tone: 'success', message: 'Account imetumwa kwa admin. Utaweza kupokea orders baada ya verification.' });
      void recordDriverActivity({
        driverId: credential.user.uid,
        driverName: fullName,
        eventName: 'driver_registered',
        featureKey: 'driver_onboarding',
        featureLabel: 'Driver onboarding',
        screen: 'register',
        route: 'doordrive',
        metadata: {
          vehicleType: registerForm.vehicleType,
          vehicleLabel,
          verificationStatus: 'pending_admin_verification',
        },
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseAuthErrorMessage(error.code)
            : 'Unable to register the driver account right now.',
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleCompleteProfile = async () => {
    const vehicleLabel = profileSetup.vehicleLabel.trim() || getVehicleTypeLabel(profileSetup.vehicleType);

    if (!authUser || !normalizedSetupPhone || !profileSetup.fullName.trim() || !vehicleLabel || !profileSetup.vehicleColor.trim() || !profileSetup.plateNumber.trim()) {
      setFeedback({ tone: 'error', message: 'Finish the driver profile before continuing.' });
      return;
    }

    setBusyAction('complete-profile');
    setFeedback(null);

    try {
      const verificationDocuments = getDriverVerificationDocumentPlaceholders(profileDocuments);

      await registerDriver({
        uid: authUser.uid,
        email: authUser.email?.trim().toLowerCase(),
        fullName: profileSetup.fullName.trim(),
        phoneNumber: normalizedSetupPhone,
        vehicleType: profileSetup.vehicleType,
        vehicleLabel,
        vehicleColor: profileSetup.vehicleColor.trim(),
        plateNumber: profileSetup.plateNumber.trim(),
        verificationStatus: 'pending_admin_verification',
        verificationDocuments,
      });
      void syncDriverVerificationImages(authUser.uid, profileDocuments).catch(() => null);
      setFeedback({ tone: 'success', message: 'Profile imetumwa kwa admin kwa verification.' });
      setProfileDocuments(getInitialDocumentUploads());
      setProfileSetupStep('profile');
      setRegistrationSubmitted(true);
      trackDriverActivity('driver_profile_completed', 'driver_onboarding', {
        vehicleType: profileSetup.vehicleType,
        verificationStatus: 'pending_admin_verification',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Profile haikuweza kufika admin sasa hivi. Angalia internet kisha jaribu tena.')
            : 'Profile haikuweza kufika admin sasa hivi. Angalia internet kisha jaribu tena.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleAdvanceTrip = async (nextStatus: DeliveryOrderStatus) => {
    if (!authUser || !activeOrder || busyAction) {
      return;
    }

    if (!subscriptionActive) {
      setFeedback({ tone: 'error', message: 'Renew DoorDrive access before managing this trip.' });
      return;
    }

    setBusyAction(`trip-${nextStatus}`);
    setFeedback(null);

    try {
      await updateDriverOrderStatus(authUser.uid, activeOrder.id, nextStatus);
      const localStatusTime = new Date();
      setDriverOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === activeOrder.id
            ? {
                ...order,
                status: nextStatus,
                deliveredAt: nextStatus === 'delivered' ? localStatusTime : order.deliveredAt,
                cancelledAt: nextStatus === 'cancelled' ? localStatusTime : order.cancelledAt,
                cancelledBy: nextStatus === 'cancelled' ? 'driver' : order.cancelledBy,
                updatedAt: localStatusTime,
              }
            : order
        )
      );
      if (nextStatus === 'delivered' || nextStatus === 'cancelled') {
        setDriverProfile((currentProfile) =>
          currentProfile
            ? {
                ...currentProfile,
                currentOrderId: '',
                isAvailable: nextStatus === 'delivered' ? true : currentProfile.isAvailable,
                lastActiveAt: localStatusTime,
                updatedAt: localStatusTime,
              }
            : currentProfile
        );
      }
      trackDriverActivity('driver_trip_status_updated', 'driver_trip', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        previousStatus: activeOrder.status,
        nextStatus,
        serviceLabel: activeOrder.serviceLabel,
      });
      setFeedback({
        tone: 'success',
        message:
          nextStatus === 'delivered'
            ? 'Delivery completed. Rate the customer from History.'
            : nextStatus === 'cancelled'
              ? 'Order cancelled and sent back to dispatch.'
            : `Trip updated to ${getDeliveryOrderStatusLabel(nextStatus).toLowerCase()}.`,
      });
      if (nextStatus === 'delivered') {
        setSelectedTab('history');
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not update the trip status right now.')
            : error instanceof Error
              ? error.message
              : 'Could not update the trip status right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleToggleAvailability = async () => {
    if (!authUser || !driverProfile || activeOrder || busyAction) {
      return;
    }

    if (!driverCanReceiveDispatch) {
      setFeedback({
        tone: 'error',
        message: driverVerificationRejected
          ? 'Verification yako inahitaji kurekebishwa kabla ya kupokea orders.'
          : driverVerificationPending
            ? 'Account yako bado inasubiri admin verification.'
            : `Lipa TZS ${driverAccessDailyFeeTzs.toLocaleString()} daily access kabla ya kwenda online.`,
      });
      return;
    }

    setBusyAction('availability');
    setFeedback(null);

    try {
      await setDriverAvailability(authUser.uid, !driverProfile.isAvailable);
      trackDriverActivity('driver_availability_changed', 'driver_availability', {
        nextAvailability: !driverProfile.isAvailable,
        hasCommissionDue,
      });
      setFeedback({
        tone: 'success',
        message: !driverProfile.isAvailable ? 'You are now visible to dispatch for assignment.' : 'You are now paused from dispatch assignment.',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not update availability right now.')
            : error instanceof Error
              ? error.message
              : 'Could not update availability right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleManualLocationRefresh = async () => {
    if (!authUser || !driverProfile || busyAction) {
      return;
    }

    if (!subscriptionActive) {
      setFeedback({ tone: 'error', message: 'Renew DoorDrive access before refreshing live location.' });
      return;
    }

    setBusyAction('location-refresh');
    setFeedback(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationPermission('denied');
        setLocationLabel('Location permission is still denied.');
        trackDriverActivity('driver_location_permission_denied', 'driver_location', {
          source: 'manual_refresh',
        });
        return;
      }

      setLocationPermission('granted');
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await updateDriverLocation(authUser.uid, {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        heading:
          typeof current.coords.heading === 'number' && current.coords.heading >= 0
            ? current.coords.heading
            : undefined,
        speedKph:
          typeof current.coords.speed === 'number' && current.coords.speed >= 0
            ? current.coords.speed * 3.6
            : undefined,
        accuracyMeters: current.coords.accuracy ?? undefined,
      });
      setLocationLabel(
        `Location refreshed ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
      );
      trackDriverActivity('driver_location_refreshed', 'driver_location', {
        source: 'manual_refresh',
        hasPermission: true,
        accuracyMeters: current.coords.accuracy ?? undefined,
      });
    } catch {
      setFeedback({ tone: 'error', message: 'Could not refresh live location right now.' });
    } finally {
      setBusyAction('');
    }
  };

  const handleCallCustomer = async () => {
    if (!activeOrder?.customerPhone) {
      setFeedback({ tone: 'info', message: 'Customer phone number is not available for this order yet.' });
      return;
    }

    const sanitized = activeOrder.customerPhone.replace(/\s+/g, '');
    const target = `tel:${sanitized}`;
    const supported = await Linking.canOpenURL(target);

    if (!supported) {
      Alert.alert('Call unavailable', `This device cannot call ${activeOrder.customerPhone}.`);
      return;
    }

    await Linking.openURL(target);
  };

  const handleSendCustomerMessage = async () => {
    if (!authUser?.uid || !activeOrder || tripMessageSending) {
      return;
    }

    const trimmedMessage = tripMessageDraft.trim();
    if (!trimmedMessage) {
      return;
    }

    setTripMessageSending(true);
    setFeedback(null);

    try {
      await sendOrderMessage({
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        customerId: activeOrder.userId,
        driverId: authUser.uid,
        senderId: authUser.uid,
        senderRole: 'driver',
        senderName:
          driverProfile?.fullName?.trim() || authUser.displayName?.trim() || activeOrder.driverName || 'DoorDrive driver',
        message: trimmedMessage,
      });
      setTripMessageDraft('');
      trackDriverActivity('driver_message_sent', 'driver_chat', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        messageLength: trimmedMessage.length,
      });
      setFeedback({ tone: 'success', message: 'Message sent to the customer.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not send the customer message right now.')
            : error instanceof Error
              ? error.message
              : 'Could not send the customer message right now.',
      });
    } finally {
      setTripMessageSending(false);
    }
  };

  const handleOpenNavigation = async () => {
    if (!activeOrder) {
      return;
    }

    const target = getDriverNavigationTarget(activeOrder);
    const targetLabel = target.label.trim();

    if (!target.point) {
      setFeedback({
        tone: 'info',
        message: `Coordinates for ${targetLabel || target.kind} are not confirmed yet. Call dispatch or the customer before moving.`,
      });
      return;
    }

    const destination = `${target.point.latitude},${target.point.longitude}`;
    const encodedDestination = encodeURIComponent(destination);
    const navigationUrl =
      Platform.OS === 'ios'
        ? `comgooglemaps://?daddr=${encodedDestination}&directionsmode=driving`
        : `google.navigation:q=${encodedDestination}&mode=d`;
    const fallbackUrl =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;

    try {
      await Linking.openURL(navigationUrl);
      trackDriverActivity('driver_navigation_opened', 'driver_navigation', {
	        orderId: activeOrder.id,
	        orderNumber: activeOrder.orderNumber,
	        targetStatus: activeOrder.status,
	        target: target.kind,
	        provider: Platform.OS === 'ios' ? 'google_maps_ios' : 'google_navigation',
	      });
      return;
    } catch {
      try {
        await Linking.openURL(fallbackUrl);
        trackDriverActivity('driver_navigation_opened', 'driver_navigation', {
	          orderId: activeOrder.id,
	          orderNumber: activeOrder.orderNumber,
	          targetStatus: activeOrder.status,
	          target: target.kind,
	          provider: Platform.OS === 'ios' ? 'apple_maps' : 'google_maps_web',
	        });
        return;
      } catch {
        setFeedback({
          tone: 'info',
          message: `Navigation could not be opened automatically for ${targetLabel || 'this stop'}.`,
        });
      }
    }
  };

  const handleSignOut = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction('sign-out');

    try {
      await signOut(auth);
      setSelectedTab('home');
      setFeedback({ tone: 'info', message: 'Signed out from DoorDrive.' });
    } catch {
      setFeedback({ tone: 'error', message: 'Could not sign out right now.' });
    } finally {
      setBusyAction('');
    }
  };

  // ──────────────────────────────────────────────
  // Driver access, order rejection, and customer rating handlers
  // ──────────────────────────────────────────────
  const handleStartPaymentCheckout = () => {
    if (!hasCommissionDue) {
      setFeedback({
        tone: 'info',
        message: subscriptionActive
          ? 'Driver access iko active kwa sasa.'
          : 'Driver access yako iko clear kwa sasa.',
      });
      return;
    }

    if (subscriptionPaymentPending) {
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'info', message: 'Malipo yako yapo pending. Approve prompt ya mobile money kisha refresh status.' });
      return;
    }

    setFeedback(null);
    setPaymentPhoneNumber((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
    setPaymentCheckoutStep('proof');
  };

  const handleInitiateMongikePayment = async () => {
    if (!authUser?.uid || busyAction === 'commission-payment') {
      return;
    }

    if (!hasCommissionDue || !dailyCommissionDue) {
      setFeedback({
        tone: 'info',
        message: subscriptionActive
          ? 'Driver access iko active kwa sasa.'
          : 'Huhitaji kulipa sasa hivi. Driver access yako iko clear.',
      });
      return;
    }

    if (subscriptionPaymentPending) {
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'info', message: 'Malipo yako yapo pending. Angalia prompt kwenye simu yako.' });
      return;
    }

    const normalizedPaymentPhone = normalizePhoneNumber(paymentPhoneNumber || driverProfile?.phoneNumber || '');

    if (!selectedNetworkMeta?.enabled) {
      setFeedback({ tone: 'info', message: `${selectedNetworkMeta?.label || 'Network hii'} bado haijafunguliwa. Tumia Vodacom M-Pesa kwa sasa.` });
      return;
    }

    if (!normalizedPaymentPhone) {
      setFeedback({ tone: 'error', message: 'Weka namba ya mobile money itakayopokea payment prompt.' });
      return;
    }

    setBusyAction('commission-payment');
    setFeedback(null);

    try {
      const status = await initiateDriverAccessPayment({
        phoneNumber: normalizedPaymentPhone,
        network: selectedPaymentNetwork,
      });
      setDriverPaymentStatus(status);
      setDriverPaymentHistory(status.history || []);
      trackDriverActivity('driver_subscription_payment_submitted', 'driver_payments', {
        dateKey: commissionDateKey,
        grossAmount: dailyGrossEarnings,
        commissionAmount: dailyCommissionDue,
        subscriptionFee: dailyCommissionDue,
        weeklyDeliveredOrderCount,
        method: 'mongike_mobile_money',
        network: selectedPaymentNetwork,
      });
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'success', message: 'Payment prompt imetumwa. Thibitisha kwenye simu yako.' });
      Alert.alert('Payment prompt imetumwa', 'Thibitisha malipo kwenye simu yako. Access itafunguka automatic baada ya Mongike kuthibitisha.');
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not record the access update right now.')
            : error instanceof Error
              ? error.message
              : 'Could not record the access update right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleRefreshPaymentStatus = async () => {
    if (!authUser?.uid || paymentRefreshing) {
      return;
    }

    setPaymentRefreshing(true);
    setFeedback(null);

    try {
      const status = await verifyDriverAccessPayment(latestPayment?.id);
      setDriverPaymentStatus(status);
      setDriverPaymentHistory(status.history || []);
      setFeedback({
        tone: status.subscription.active ? 'success' : 'info',
        message: status.subscription.active
          ? 'Payment imethibitishwa. DoorDrive access imefunguka.'
          : status.subscription.pending
            ? 'Bado pending. Hakikisha ume-approve prompt ya mobile money.'
            : 'Payment haijakamilika bado.',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not verify the payment right now.',
      });
    } finally {
      setPaymentRefreshing(false);
    }
  };

  const handleAcceptOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
      return;
    }

    if (!subscriptionActive) {
      setFeedback({ tone: 'error', message: 'Renew DoorDrive access before accepting orders.' });
      return;
    }

    setBusyAction('accept-order');
    setFeedback(null);

    try {
      await acceptDriverOrder(authUser.uid, activeOrder.id);
      trackDriverActivity('driver_order_accepted', 'driver_order_response', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        serviceLabel: activeOrder.serviceLabel,
        fareLabel: activeOrder.totalLabel || activeOrder.fareLabel,
      });
      setFeedback({ tone: 'success', message: 'Order accepted. Navigate to the pickup point.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not accept the order right now.')
            : error instanceof Error
              ? error.message
              : 'Could not accept the order right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  useEffect(() => {
    if (!autoConfirm || !activeOrder || busyAction) {
      return;
    }
    if (activeOrder.status !== 'driver_assigned' || activeOrder.acceptedByDriverAt) {
      return;
    }
    if (autoAcceptedOrderIdRef.current === activeOrder.id) {
      return;
    }
    autoAcceptedOrderIdRef.current = activeOrder.id;
    void handleAcceptOrder();
  }, [activeOrder, autoConfirm, busyAction]);

  const performDeclineOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
      return;
    }

    if (!subscriptionActive) {
      setFeedback({ tone: 'error', message: 'Renew DoorDrive access before changing order status.' });
      return;
    }

    setBusyAction('decline-order');
    setFeedback(null);

    try {
      await declineDriverOrder(authUser.uid, activeOrder.id, 'Rejected from driver app');
      trackDriverActivity('driver_order_declined', 'driver_order_response', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        serviceLabel: activeOrder.serviceLabel,
        reason: 'Rejected from driver app',
      });
      setSelectedTab('home');
      setFeedback({ tone: 'info', message: 'Order rejected and sent back to dispatch.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not reject the order right now.')
            : error instanceof Error
              ? error.message
              : 'Could not reject the order right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleDeclineOrder = () => {
    Alert.alert(
      'Reject this order?',
      'The order will return to dispatch for another driver.',
      [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Reject order', style: 'destructive', onPress: () => void performDeclineOrder() },
      ]
    );
  };

  const handleCancelActiveTrip = () => {
    Alert.alert(
      'Cancel this trip?',
      'Use this only when you cannot complete the trip. The order will be marked cancelled.',
      [
        { text: 'Keep trip', style: 'cancel' },
        { text: 'Cancel trip', style: 'destructive', onPress: () => void handleAdvanceTrip('cancelled') },
      ]
    );
  };

  const handleRateCustomer = async () => {
    if (!authUser?.uid || !pendingCustomerRatingOrder || customerRatingSaving) {
      return;
    }

    setCustomerRatingSaving(true);
    setFeedback(null);

    try {
      await rateDeliveryCustomer(authUser.uid, pendingCustomerRatingOrder.id, {
        rating: customerRatingScore,
        comment: customerRatingComment,
      });
      trackDriverActivity('driver_customer_rating_submitted', 'driver_customer_rating', {
        orderId: pendingCustomerRatingOrder.id,
        orderNumber: pendingCustomerRatingOrder.orderNumber,
        rating: customerRatingScore,
        hasComment: Boolean(customerRatingComment.trim()),
      });
      setCustomerRatingComment('');
      setCustomerRatingScore(5);
      setFeedback({ tone: 'success', message: 'Customer rating saved. Thank you.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not save the customer rating right now.')
            : error instanceof Error
              ? error.message
              : 'Could not save the customer rating right now.',
      });
    } finally {
      setCustomerRatingSaving(false);
    }
  };

  const pickDocumentImage = async (
    key: DocumentKey,
    setter: React.Dispatch<React.SetStateAction<DriverDocumentUploads>>
  ) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFeedback({ tone: 'error', message: 'Ruhusu app kuchagua picha ili kuendelea na verification.' });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.82,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      setter((current) => ({
        ...current,
        [key]: {
          uri: asset.uri,
          fileName: asset.fileName || `${key}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        },
      }));
      setFeedback(null);
    } catch {
      setFeedback({ tone: 'error', message: 'Picha haikuweza kuchaguliwa sasa hivi. Jaribu tena.' });
    }
  };

  const pickRegisterDocument = (key: DocumentKey) => {
    void pickDocumentImage(key, setRegisterDocuments);
  };

  const pickProfileDocument = (key: DocumentKey) => {
    void pickDocumentImage(key, setProfileDocuments);
  };

  const handleRegisterBack = () => {
    setFeedback(null);
    setAuthMode('signin');
  };

  const handleRegisterContinue = () => {
    const normalizedEmail = registerForm.email.trim().toLowerCase();
    const fullName = getRegisterFullName(registerForm);

    setFeedback(null);

    if (
      fullName.length < 2 ||
      !/\S+@\S+\.\S+/.test(normalizedEmail) ||
      !normalizedRegisterPhone ||
      registerForm.password.trim().length < 6 ||
      !registerForm.plateNumber.trim()
    ) {
      setFeedback({
        tone: 'error',
        message: 'Add your name, phone, email, password, and plate number.',
      });
      return;
    }

    if (!registerTermsAccepted) {
      setFeedback({
        tone: 'error',
        message: 'Please agree to the terms to continue.',
      });
      return;
    }

    void handleRegister();
  };

  const handleProfileSetupBack = () => {
    setFeedback(null);

    if (profileSetupStep === 'profile') {
      void handleSignOut();
      return;
    }

    setProfileSetupStep((current) => getPreviousSetupStep(current));
  };

  const handleProfileSetupContinue = () => {
    setFeedback(null);

    if (profileSetupStep === 'profile') {
      if (!profileSetup.fullName.trim() || !normalizedSetupPhone) {
        setFeedback({ tone: 'error', message: 'Add your full name and phone number before continuing.' });
        return;
      }

      setProfileSetupStep((current) => getNextSetupStep(current));
      return;
    }

    if (profileSetupStep === 'vehicle') {
      if (!profileSetup.vehicleType || !profileSetup.vehicleColor.trim() || !profileSetup.plateNumber.trim()) {
        setFeedback({ tone: 'error', message: 'Choose vehicle type, color, and enter the plate number before continuing.' });
        return;
      }

      void handleCompleteProfile();
      return;
    }

    void handleCompleteProfile();
  };

  // ──────────────────────────────────────────────
  // Auth screen
  // ──────────────────────────────────────────────

  const renderAuthScreen = () => {
    if (authMode === 'register') {
      return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.authCanvas}>
            <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Pressable onPress={handleRegisterBack} style={({ pressed }) => [styles.authBackButton, pressed && styles.buttonPressed]}>
                <MaterialCommunityIcons name="arrow-left" size={22} color={driveTheme.colors.ink} />
              </Pressable>

              <Text style={styles.authPageTitle}>Register</Text>

              {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

              <SetupField
                value={registerForm.firstName}
                onChangeText={(value) => setRegisterForm((current) => ({ ...current, firstName: value, lastName: '', confirmPassword: current.password }))}
                placeholder="Full name"
              />
              <SetupField
                value={registerForm.phoneNumber}
                onChangeText={(value) => setRegisterForm((current) => ({ ...current, phoneNumber: value }))}
                placeholder="Phone number"
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
              <SetupField
                value={registerForm.email}
                onChangeText={(value) => setRegisterForm((current) => ({ ...current, email: value }))}
                placeholder="Email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <SetupField
                value={registerForm.password}
                onChangeText={(value) => setRegisterForm((current) => ({ ...current, password: value, confirmPassword: value }))}
                placeholder="Password"
                secureTextEntry
                autoCapitalize="none"
              />

              <Text style={styles.authFieldHint}>Vehicle</Text>
              <VehicleTypePicker
                value={registerForm.vehicleType}
                onChange={(vehicleType) => setRegisterForm((current) => ({ ...current, vehicleType }))}
              />
              <SetupField
                value={registerForm.plateNumber}
                onChangeText={(value) => setRegisterForm((current) => ({ ...current, plateNumber: value }))}
                placeholder="Plate number"
                autoCapitalize="characters"
              />

              <Pressable
                onPress={() => setRegisterTermsAccepted((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: registerTermsAccepted }}
                style={({ pressed }) => [styles.authTermsRow, pressed && styles.buttonPressed]}>
                <View style={[styles.termsCheckbox, registerTermsAccepted && styles.termsCheckboxActive]}>
                  {registerTermsAccepted ? <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text style={styles.authTermsText}>
                  I agree to the{' '}
                  <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                    Terms
                  </Text>
                  {' '}and{' '}
                  <Text style={styles.authLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                    Privacy Policy
                  </Text>
                </Text>
              </Pressable>

              <AppButton
                label={registering ? 'Creating account...' : 'Create account'}
                onPress={handleRegisterContinue}
                disabled={registering}
              />

              <Pressable
                onPress={handleRegisterBack}
                style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
                <Text style={styles.loginSecondaryActionMuted}>Have an account?</Text>
                <Text style={styles.loginSecondaryActionText}>Login</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      );
    }

    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.authCanvas}>
          <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.authPageTitle}>Login</Text>

            {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

            <SetupField
              value={loginEmail}
              onChangeText={setLoginEmail}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <SetupField
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
            />

            <AppButton
              label={signingIn ? 'Logging in...' : 'Login'}
              onPress={() => void handleSignIn()}
              disabled={signingIn}
            />

            <Pressable
              onPress={() => {
                setFeedback(null);
                setRegisterStep('profile');
                setRegisterTermsAccepted(false);
                setAuthMode('register');
              }}
              style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
              <Text style={styles.loginSecondaryActionMuted}>No account?</Text>
              <Text style={styles.loginSecondaryActionText}>Register</Text>
            </Pressable>

            <View style={styles.authFooter}>
              <Text style={styles.authFooterText}>
                By continuing, you agree to the{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                  Terms
                </Text>
                .
              </Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // ──────────────────────────────────────────────
  // Profile setup (unchanged)
  // ──────────────────────────────────────────────

  const renderProfileSetup = () => {
    const renderProfileStepContent = () => {
      if (profileSetupStep === 'profile') {
        return (
          <View style={styles.setupFormStack}>
            <SetupField
              value={profileSetup.fullName}
              onChangeText={(value) => setProfileSetup((current) => ({ ...current, fullName: value }))}
              placeholder="Full Name"
            />
            <View style={styles.setupPhoneRow}>
              <View style={styles.setupCountryCode}>
                <Text style={styles.setupFlagText}>TZ</Text>
                <MaterialCommunityIcons name="menu-down" size={24} color="#7B8B8D" />
              </View>
              <View style={styles.setupPhoneInput}>
                <SetupField
                  value={profileSetup.phoneNumber}
                  onChangeText={(value) => setProfileSetup((current) => ({ ...current, phoneNumber: value }))}
                  placeholder="+255"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
              </View>
            </View>
          </View>
        );
      }

      if (profileSetupStep === 'vehicle') {
        return (
          <View style={styles.setupFormStack}>
            <View style={styles.setupVehiclePickerWrap}>
              <Text style={styles.setupMiniLabel}>Vehicle type</Text>
              <VehicleTypePicker
                value={profileSetup.vehicleType}
                onChange={(vehicleType) => setProfileSetup((current) => ({ ...current, vehicleType }))}
              />
            </View>
            <View style={styles.setupVehiclePickerWrap}>
              <Text style={styles.setupMiniLabel}>Vehicle color</Text>
              <VehicleColorPicker
                value={profileSetup.vehicleColor}
                onChange={(vehicleColor) => setProfileSetup((current) => ({ ...current, vehicleColor }))}
              />
            </View>
            <SetupField
              value={profileSetup.plateNumber}
              onChangeText={(value) => setProfileSetup((current) => ({ ...current, plateNumber: value }))}
              placeholder="Plate number"
              autoCapitalize="characters"
            />
          </View>
        );
      }

      return (
        <View style={styles.setupFormStack}>
          <DocumentUploadList uploads={profileDocuments} onPick={pickProfileDocument} />
            <View style={styles.setupNotice}>
              <MaterialCommunityIcons name="map-marker-check-outline" size={20} color={driveTheme.colors.primaryDark} />
              <Text style={styles.setupNoticeText}>
                Taarifa za dereva na gari zitatumwa kwa admin kwa verification.
              </Text>
            </View>
        </View>
      );
    };

    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.setupScreen}>
          <View style={styles.setupHeader}>
            <Pressable onPress={handleProfileSetupBack} style={({ pressed }) => [styles.setupBackButton, pressed && styles.buttonPressed]}>
              <MaterialCommunityIcons name="arrow-left" size={28} color={driveTheme.colors.ink} />
            </Pressable>
            <Text style={styles.setupTitle}>Account Setup</Text>
            <View style={styles.setupHeaderSpacer} />
          </View>
          <Text style={styles.setupIntro}>To set up your account, complete these steps:</Text>
          <SetupProgress activeStep={profileSetupStep} />

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          <ScrollView contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {renderProfileStepContent()}
          </ScrollView>

          <View style={styles.setupFooter}>
            <AppButton
              label={
                profileSetupStep === 'vehicle'
                  ? busyAction === 'complete-profile'
                    ? 'Saving profile...'
                    : 'Submit profile'
                  : 'Continue'
              }
              icon={profileSetupStep === 'vehicle' ? 'check' : 'arrow-right'}
              onPress={handleProfileSetupContinue}
              disabled={busyAction === 'complete-profile'}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  };

  const renderVerificationStatusScreen = () => {
    const vehicleLabel = driverProfile
      ? `${driverProfile.vehicleLabel || getVehicleTypeLabel(driverProfile.vehicleType)} • ${driverProfile.plateNumber || 'Plate pending'}`
      : getRegisterVehicleLabel(registerForm);

    return (
      <View style={styles.verificationScreen}>
        <View style={styles.verificationCard}>
          <View style={styles.verificationIconShell}>
            <MaterialCommunityIcons name="shield-lock-outline" size={42} color={driveTheme.colors.primaryDark} />
          </View>
          <Text style={styles.verificationTitle}>Identity yako inasubiri approval</Text>
          <Text style={styles.verificationText}>
            Tunasubiri admin athibitishe plate number, picha ya gari, na picha ya dereva. Ukisha-approved utaweza kwenda online na kupokea oda.
          </Text>

          <View style={styles.verificationChecklist}>
            <View style={styles.verificationCheckRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color={driveTheme.colors.primaryDark} />
              <Text style={styles.verificationCheckText}>Account details zimetumwa</Text>
            </View>
            <View style={styles.verificationCheckRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color={driveTheme.colors.primaryDark} />
              <Text style={styles.verificationCheckText}>Vehicle: {vehicleLabel || 'Submitted'}</Text>
            </View>
            <View style={styles.verificationCheckRow}>
              <MaterialCommunityIcons name="clock-outline" size={20} color={driveTheme.colors.warning} />
              <Text style={styles.verificationCheckText}>Admin verification inaendelea</Text>
            </View>
          </View>

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          <View style={styles.verificationActions}>
            <AppButton label="Subiri approval" icon="timer-sand" disabled />
            <Pressable onPress={() => void handleSignOut()} style={({ pressed }) => [styles.verificationSignOut, pressed && styles.buttonPressed]}>
              <MaterialCommunityIcons name="logout" size={18} color={driveTheme.colors.ink} />
              <Text style={styles.verificationSignOutText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const renderAccessRenewalScreen = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <View style={[styles.paymentDebtCard, styles.paymentDebtCardDue]}>
        <View style={styles.paymentDebtTop}>
          <View style={styles.paymentDebtIcon}>
            <MaterialCommunityIcons name={subscriptionPaymentPending ? 'clock-outline' : 'cash-fast'} size={26} color="#FFFFFF" />
          </View>
          <View style={styles.paymentDebtCopy}>
            <Text style={styles.paymentDebtLabel}>DoorDrive access required</Text>
            <Text style={styles.paymentDebtAmount}>TZS {driverAccessDailyFeeTzs.toLocaleString()} / day</Text>
            <Text style={styles.paymentDebtMeta}>
              {subscriptionPaymentPending
                ? 'Payment iko pending. Thibitisha prompt kwenye simu yako ili access ifunguke.'
                : 'Access imeisha. Driver operations zimefungwa mpaka ufanye malipo.'}
            </Text>
          </View>
        </View>

        <View style={styles.subscriptionCountdownCard}>
          <View style={styles.subscriptionCountdownIcon}>
            <MaterialCommunityIcons name="shield-lock-outline" size={22} color={driveTheme.colors.primaryDark} />
          </View>
          <View style={styles.subscriptionCountdownCopy}>
            <Text style={styles.subscriptionCountdownLabel}>Blocked operations</Text>
            <Text style={styles.subscriptionCountdownValue}>{subscriptionCountdownLabel}</Text>
            <Text style={styles.subscriptionCountdownCaption}>Go online, accept orders, location refresh, and trip controls require active access.</Text>
          </View>
        </View>

        <AppButton
          label={subscriptionPaymentPending ? 'Refresh payment status' : 'Renew with Mongike'}
          icon={subscriptionPaymentPending ? 'refresh' : 'cash-fast'}
          onPress={() => {
            setSelectedTab('account');
            setAccountView('payments');
            setPaymentCheckoutStep(subscriptionPaymentPending ? 'submitted' : 'proof');
            if (subscriptionPaymentPending) {
              void handleRefreshPaymentStatus();
            } else {
              setPaymentPhoneNumber((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
            }
          }}
          disabled={paymentRefreshing}
        />
      </View>

      <SectionCard title="Why blocked?" subtitle="DoorDrive daily access is required for driver operations.">
        <View style={styles.stackMd}>
          <Text style={styles.tripLine}>Mongike payment is initiated by the backend only. The API key is never sent to the app.</Text>
          <Text style={styles.tripLine}>After confirmation, webhook updates your subscription and receipt automatically.</Text>
          <Text style={styles.tripLine}>Active payment: Vodacom M-Pesa to {paymentRecipientPhone}. Other networks are coming soon.</Text>
        </View>
      </SectionCard>
    </ScrollView>
  );

  // ──────────────────────────────────────────────
  // Home tab (navigation-first driver dashboard)
  // ──────────────────────────────────────────────

  const renderHomeTab = () => {
    const orderPickupPoint = activeOrder ? getOrderPickupPoint(activeOrder) : null;
    const currentDriverPoint = getPointFromCoordinates(driverProfile?.currentLatitude, driverProfile?.currentLongitude);
    const pickupPoint =
      orderPickupPoint
        ? orderPickupPoint
        : currentDriverPoint ?? { latitude: -6.7924, longitude: 39.2083 };
    const driverDropoffPoint = activeOrder ? getDriverVisibleDropoffPoint(activeOrder) : null;
    const driverDropoffLabel = activeOrder ? getDriverVisibleDropoffLabel(activeOrder) : '';
    const dropoffPoint =
      driverDropoffPoint ?? pickupPoint;
    const canRenderMap = Platform.OS !== 'web' && MapView && Marker && Polyline;
    const isOnline = Boolean(driverProfile?.isAvailable);
    const awaitingAccept = Boolean(activeOrder && activeOrder.status === 'driver_assigned' && !activeOrder.acceptedByDriverAt);
    const todayAverage = todayCompletedCount > 0 ? Math.round(todayEarnings / todayCompletedCount) : 0;
    const allTimeDeliveredCount = driverProfile?.completedOrderCount || driverOrders.filter((order) => order.status === 'delivered').length;
    const homeAvailabilityNote = activeOrder
      ? copy.orderInProgress
      : driverVerificationPending
        ? copy.verificationReview
        : driverVerificationRejected
          ? copy.verificationRejected
          : hasCommissionDue
            ? subscriptionPaymentPending
              ? copy.paymentPending
              : copy.payToReceive
            : isOnline
              ? copy.ordersWillAppear
              : copy.tapGoToReceive;
    const homeOrderStatusLabel =
      activeOrder?.status === 'driver_assigned'
        ? copy.newOrder
        : activeOrder?.status === 'driver_at_pickup'
          ? copy.atPickup
          : activeOrder?.status === 'in_transit'
            ? copy.onTrip
            : activeOrder?.status === 'delivered'
              ? copy.deliveredStatus
              : copy.waitingOrder;
    const pickupDistanceKm = currentDriverPoint ? haversineDistanceKm(currentDriverPoint, pickupPoint) : null;
    const pickupEtaMin = pickupDistanceKm != null ? Math.max(1, Math.round(pickupDistanceKm / 0.35)) : null;
    const requestCustomerName = activeOrder?.customerName || activeOrder?.recipientName || '';
    const mapLatitude = activeOrder ? (pickupPoint.latitude + dropoffPoint.latitude) / 2 : pickupPoint.latitude;
    const mapLongitude = activeOrder ? (pickupPoint.longitude + dropoffPoint.longitude) / 2 : pickupPoint.longitude;
    const mapLatitudeDelta = activeOrder
      ? Math.max(Math.abs(pickupPoint.latitude - dropoffPoint.latitude) * 2.3, 0.04)
      : 0.02;
    const mapLongitudeDelta = activeOrder
      ? Math.max(Math.abs(pickupPoint.longitude - dropoffPoint.longitude) * 2.3, 0.04)
      : 0.02;

    return (
      <View style={styles.homeScreen}>
        {awaitingAccept ? null : (
        <View style={styles.homeTopPanel}>
          <View style={styles.homeTopRow}>
            <View style={[styles.homeStatusPill, isOnline ? styles.homeStatusPillOnline : styles.homeStatusPillOffline]}>
              <View style={[styles.homeStatusDot, isOnline ? styles.homeStatusDotOnline : styles.homeStatusDotOffline]} />
              <Text style={[styles.homeStatusPillText, isOnline ? styles.homeStatusPillTextOnline : styles.homeStatusPillTextOffline]}>
                {isOnline ? copy.online : copy.offline}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelectedTab('notifications')}
              style={({ pressed }) => [styles.homeIconChip, pressed && styles.buttonPressed]}>
              <MaterialCommunityIcons name="bell-outline" size={22} color="#0F172A" />
              {unreadNotificationCount > 0 ? (
                <View style={styles.notificationDot}>
                  <Text style={styles.notificationDotText}>{Math.min(unreadNotificationCount, 9)}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          <Pressable
            onPress={() => setSelectedTab(activeOrder ? 'trip' : 'history')}
            style={({ pressed }) => [styles.homeEarningsCard, pressed && styles.buttonPressed]}>
            <View style={styles.homeEarningsHead}>
              <Text style={styles.homeEarningsKicker}>{copy.todayEarnings}</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
            </View>
            <Text style={styles.homeEarningsValue}>TZS {todayEarnings.toLocaleString()}</Text>
            <View style={styles.homeEarningsStats}>
              <View style={styles.homeEarningsStat}>
                <Text style={styles.homeEarningsStatValue}>{todayCompletedCount}</Text>
                <Text style={styles.homeEarningsStatLabel}>{copy.delivered}</Text>
              </View>
              <View style={styles.homeEarningsStatDivider} />
              <View style={styles.homeEarningsStat}>
                <Text style={styles.homeEarningsStatValue}>{todayActiveCount}</Text>
                <Text style={styles.homeEarningsStatLabel}>{copy.active}</Text>
              </View>
              <View style={styles.homeEarningsStatDivider} />
              <View style={styles.homeEarningsStat}>
                <Text style={styles.homeEarningsStatValue}>TZS {todayAverage.toLocaleString()}</Text>
                <Text style={styles.homeEarningsStatLabel}>{copy.avgPerOrder}</Text>
              </View>
            </View>
            <View style={styles.homeEarningsFooter}>
              <Text style={styles.homeEarningsFooterText}>
                {copy.allTime} · TZS {totalEarnings.toLocaleString()}
              </Text>
              <Text style={styles.homeEarningsFooterMeta}>{allTimeDeliveredCount} {copy.orders}</Text>
            </View>
          </Pressable>

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          {hasCommissionDue ? (
            <Pressable
              onPress={() => {
                setPaymentCheckoutStep('debt');
                setAccountView('payments');
                setSelectedTab('account');
              }}
              style={({ pressed }) => [
                styles.homeDueBanner,
                commissionPaymentOverdue ? styles.homeDueBannerOverdue : styles.homeDueBannerPending,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.homeDueBannerText} numberOfLines={1}>
                {subscriptionPaymentPending ? copy.paymentPending : copy.payNow} · TZS {weeklySubscriptionFeeTzs.toLocaleString()}
              </Text>
              <Text style={styles.homeDueBannerMeta}>{subscriptionCountdownShortLabel}</Text>
            </Pressable>
          ) : null}
        </View>
        )}

        <View style={styles.homeMapWrap}>
        {canRenderMap ? (
          <MapView
            provider={undefined}
            style={styles.homeMapFill}
            mapType="standard"
            showsCompass={false}
            showsTraffic={false}
            toolbarEnabled={false}
            showsUserLocation={false}
            loadingEnabled
            initialRegion={{
              latitude: mapLatitude,
              longitude: mapLongitude,
              latitudeDelta: mapLatitudeDelta,
              longitudeDelta: mapLongitudeDelta,
            }}>
            {currentDriverPoint ? (
              <Marker coordinate={currentDriverPoint} title="You" pinColor="#14532D" />
            ) : null}
            {activeOrder ? (
              <Marker coordinate={pickupPoint} title="Pickup" description={activeOrder.pickupLabel} pinColor="#16A34A" />
            ) : null}
            {activeOrder && driverDropoffPoint ? (
              <Marker coordinate={dropoffPoint} title="Drop-off" description={driverDropoffLabel} pinColor="#2563EB" />
            ) : null}
            {activeOrder && driverDropoffPoint ? (
              <Polyline coordinates={[pickupPoint, dropoffPoint]} strokeColor="#2563EB" strokeWidth={5} />
            ) : currentDriverPoint && activeOrder ? (
              <Polyline coordinates={[currentDriverPoint, pickupPoint]} strokeColor="#2563EB" strokeWidth={5} />
            ) : null}
          </MapView>
        ) : (
          <View style={[styles.homeMapFill, styles.homeMapFallback]}>
            <View style={styles.homeMapGridLineA} />
            <View style={styles.homeMapGridLineB} />
            <View style={styles.homeMapRoutePreview} />
            <View style={[styles.homeMapPin, styles.homeMapPinPickup]}>
              <MaterialCommunityIcons name="map-marker" size={18} color="#FFFFFF" />
            </View>
            <View style={[styles.homeMapPin, styles.homeMapPinDropoff]}>
              <MaterialCommunityIcons name="flag-checkered" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.homeMapVehicle}>
              <MaterialCommunityIcons name="car" size={18} color="#FFFFFF" />
            </View>
          </View>
        )}

        {awaitingAccept ? (
          <Pressable
            onPress={() => void performDeclineOrder()}
            disabled={busyAction === 'decline-order'}
            style={({ pressed }) => [styles.homeDeclinePill, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="close" size={16} color="#FFFFFF" />
            <Text style={styles.homeDeclinePillText}>
              {busyAction === 'decline-order' ? copy.declining : copy.decline}
            </Text>
          </Pressable>
        ) : null}

        <View pointerEvents="box-none" style={styles.homeBottomOverlay}>
          {awaitingAccept && activeOrder ? (
            <Pressable
              onPress={() => void handleAcceptOrder()}
              disabled={busyAction === 'accept-order'}
              style={({ pressed }) => [styles.homeBoltCard, busyAction === 'accept-order' && styles.buttonDisabled, pressed && styles.buttonPressed]}>
              <Text style={styles.homeBoltStats}>
                {pickupEtaMin != null && pickupDistanceKm != null
                  ? `${pickupEtaMin} min  •  ${pickupDistanceKm.toFixed(1)} km`
                  : activeOrder.totalLabel}
              </Text>
              <Text style={styles.homeBoltPlace} numberOfLines={2}>{activeOrder.pickupLabel}</Text>
              {requestCustomerName ? (
                <Text style={styles.homeBoltCustomer} numberOfLines={1}>{requestCustomerName}</Text>
              ) : null}
              <Text style={styles.homeBoltFare}>{activeOrder.totalLabel}</Text>
              <Text style={styles.homeBoltAcceptText}>
                {busyAction === 'accept-order' ? copy.accepting : copy.accept}
              </Text>
            </Pressable>
          ) : activeOrder ? (
            <View style={styles.homeSheet}>
              <View style={styles.homeSheetHandle} />
              <Text style={styles.homeSheetKicker}>{homeOrderStatusLabel}</Text>
              <Text style={styles.homeSheetTitle} numberOfLines={1}>{activeOrder.pickupLabel}</Text>
              <Text style={styles.homeSheetSubtitle} numberOfLines={1}>{driverDropoffLabel}</Text>
              <View style={styles.homeTripActions}>
                <Pressable
                  onPress={() => void handleOpenNavigation()}
                  style={({ pressed }) => [styles.homeAcceptButton, styles.homeTripActionGrow, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons name="navigation-variant" size={18} color="#FFFFFF" />
                  <Text style={styles.homeAcceptButtonText}>{copy.navigate}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleCallCustomer()}
                  style={({ pressed }) => [styles.homeIconAction, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons name="phone" size={20} color="#14532D" />
                </Pressable>
                <Pressable
                  onPress={() => setSelectedTab('trip')}
                  style={({ pressed }) => [styles.homeIconAction, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#14532D" />
                </Pressable>
              </View>
              <Pressable
                onPress={handleCancelActiveTrip}
                disabled={busyAction === 'trip-cancelled'}
                style={({ pressed }) => [styles.homeGhostButton, pressed && styles.buttonPressed]}>
                <Text style={styles.homeGhostButtonText}>
                  {busyAction === 'trip-cancelled' ? copy.cancelling : copy.cancelTrip}
                </Text>
              </Pressable>
            </View>
          ) : isOnline ? (
            <View style={styles.homeIdleCard}>
              <View style={styles.homeSearchRow}>
                <View style={styles.homeLiveDot} />
                <View style={styles.homeIdleCopy}>
                  <Text style={styles.homeIdleTitle}>{copy.lookingForOrders}</Text>
                  <Text style={styles.homeIdleSubtitle} numberOfLines={2}>{homeAvailabilityNote}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => void handleToggleAvailability()}
                disabled={busyAction === 'availability'}
                style={({ pressed }) => [styles.homeGhostButton, pressed && styles.buttonPressed]}>
                <Text style={styles.homeGhostButtonText}>
                  {busyAction === 'availability' ? copy.updating : copy.goOffline}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.homeOfflineDock}>
              <View style={styles.homeGoHalo}>
                <Pressable
                  onPress={() => void handleToggleAvailability()}
                  disabled={busyAction === 'availability'}
                  style={({ pressed }) => [
                    styles.homeGoButton,
                    busyAction === 'availability' && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
                  ]}>
                  {busyAction === 'availability' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.homeGoText}>{copy.start}</Text>
                  )}
                </Pressable>
              </View>
              <View style={styles.homeGoCopyCard}>
                <Text style={styles.homeGoCaption}>{copy.youAreOffline}</Text>
                <Text style={styles.homeGoHint} numberOfLines={2}>{homeAvailabilityNote}</Text>
              </View>
            </View>
          )}
        </View>
        </View>
      </View>
    );
  };

  // ──────────────────────────────────────────────
  // Trip tab (with enhanced cancellation button)
  // ──────────────────────────────────────────────

  const renderTripTab = () => {
    const nextAction = getNextTripAction(activeOrder?.status);
    const orderPickupPoint = activeOrder ? getOrderPickupPoint(activeOrder) : null;
    const pickupPoint =
      orderPickupPoint
        ? orderPickupPoint
        : {
            latitude: -6.7924,
            longitude: 39.2083,
          };
    const driverDropoffPoint = activeOrder ? getDriverVisibleDropoffPoint(activeOrder) : null;
    const driverDropoffLabel = activeOrder ? getDriverVisibleDropoffLabel(activeOrder) : '';
    const dropoffPoint = driverDropoffPoint;
    const driverPoint =
      getPointFromCoordinates(activeOrder?.driverLatitude, activeOrder?.driverLongitude) ??
      getPointFromCoordinates(driverProfile?.currentLatitude, driverProfile?.currentLongitude);

    return (
      <ScrollView contentContainerStyle={styles.tripScreenContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        {!activeOrder ? (
          <View style={styles.emptyStateLarge}>
            <MaterialCommunityIcons name="map-marker-path" size={34} color={driveTheme.colors.primary} />
            <Text style={styles.emptyTitle}>{copy.noActiveTrip}</Text>
            <Text style={styles.emptyText}>{copy.noActiveTripHint}</Text>
          </View>
        ) : (
          <>
            <View style={styles.tripMapStage}>
              <TripMap
                pickupPoint={pickupPoint}
                dropoffPoint={dropoffPoint}
                driverPoint={driverPoint}
                statusLabel={getDeliveryOrderStatusLabel(activeOrder.status)}
                onOpenNavigation={() => void handleOpenNavigation()}
                MapViewComponent={MapView}
                MarkerComponent={Marker}
                PolylineComponent={Polyline}
              />
            </View>

            <View style={styles.tripBottomSheet}>
              <View style={styles.tripSheetHandle} />
              <View style={styles.tripHero}>
                <Text style={styles.heroKicker}>{copy.activeDelivery}</Text>
                <Text style={styles.tripHeroTitle}>{activeOrder.serviceLabel}</Text>
                <Text style={styles.tripHeroText}>{getDeliveryOrderStatusLabel(activeOrder.status)}</Text>
                <View style={styles.tripMetricRow}>
                  <TripMetricChip icon="pound" label={activeOrder.orderNumber} />
                  <TripMetricChip icon="cash-multiple" label={activeOrder.totalLabel} />
                  <TripMetricChip
                    icon={locationPermission === 'granted' ? 'crosshairs-gps' : 'map-marker-off-outline'}
                    label={locationPermission === 'granted' ? 'Location live' : 'Location pending'}
                  />
                </View>
              </View>

              <View style={styles.tripSheetCard}>
                <Text style={styles.tripSheetTitle}>{copy.tripRoute}</Text>
                <Text style={styles.tripSheetSubtitle}>Navigation stops for this active job.</Text>
                <View style={styles.stackMd}>
                  <TripStopRow tone="pickup" title={copy.pickup} label={activeOrder.pickupLabel} />
                  <TripStopRow tone="dropoff" title={copy.dropoff} label={driverDropoffLabel} />
                  <View style={styles.tripDivider} />
                  <Text style={styles.tripLine}>Recipient: {activeOrder.recipientName} • {activeOrder.recipientPhone}</Text>
                  <Text style={styles.tripLine}>Customer: {activeOrder.customerName} • {activeOrder.customerPhone || activeOrder.customerEmail}</Text>
                  <Text style={styles.tripLine}>Created: {formatDeliveryDateTime(activeOrder.createdAt)}</Text>
                </View>
              </View>

              <View style={styles.tripSheetCard}>
                <Text style={styles.tripSheetTitle}>{copy.customerChat}</Text>
                <Text style={styles.tripSheetSubtitle}>
                  Send pickup updates or ask for delivery instructions without leaving the active trip.
                </Text>

                {tripMessagesLoading ? (
                  <Text style={styles.tripHelperText}>Loading the latest conversation...</Text>
                ) : tripMessages.length ? (
                  <View style={styles.tripMessageThread}>
                    {tripMessages.slice(-6).map((item) => {
                      const isDriverMessage = item.senderRole === 'driver';

                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.tripMessageRow,
                            isDriverMessage ? styles.tripMessageRowSelf : styles.tripMessageRowOther,
                          ]}>
                          <View
                            style={[
                              styles.tripMessageBubble,
                              isDriverMessage ? styles.tripMessageBubbleSelf : styles.tripMessageBubbleOther,
                            ]}>
                            <Text
                              style={[
                                styles.tripMessageSender,
                                isDriverMessage ? styles.tripMessageSenderSelf : styles.tripMessageSenderOther,
                              ]}>
                              {isDriverMessage ? 'You' : item.senderName || activeOrder.customerName}
                            </Text>
                            <Text
                              style={[
                                styles.tripMessageText,
                                isDriverMessage ? styles.tripMessageTextSelf : styles.tripMessageTextOther,
                              ]}>
                              {item.message}
                            </Text>
                            <Text
                              style={[
                                styles.tripMessageTime,
                                isDriverMessage ? styles.tripMessageTimeSelf : styles.tripMessageTimeOther,
                              ]}>
                              {formatDeliveryDateTime(item.createdAt)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.tripHelperText}>
                    No messages yet. Send the customer a quick update when you arrive, need access details, or are close
                    to drop-off.
                  </Text>
                )}

                <View style={styles.tripMessageComposer}>
                  <TextInput
                    value={tripMessageDraft}
                    onChangeText={setTripMessageDraft}
                    editable={!tripMessageSending}
                    multiline
                    maxLength={240}
                    placeholder={copy.messageCustomer}
                    placeholderTextColor="#94A3B8"
                    style={styles.tripMessageInput}
                    textAlignVertical="top"
                  />
                  <Pressable
                    disabled={!tripMessageDraft.trim() || tripMessageSending}
                    onPress={() => void handleSendCustomerMessage()}
                    style={({ pressed }) => [
                      styles.tripMessageSendButton,
                      (!tripMessageDraft.trim() || tripMessageSending) && styles.tripMessageSendButtonDisabled,
                      pressed && tripMessageDraft.trim() && !tripMessageSending && styles.buttonPressed,
                    ]}>
                    <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
                    <Text style={styles.tripMessageSendText}>{tripMessageSending ? copy.sending : copy.send}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.tripActionSheet}>
                {activeOrder.status === 'driver_assigned' && !activeOrder.acceptedByDriverAt ? (
                  <AppButton
                    label={busyAction === 'accept-order' ? copy.accepting : copy.accept}
                    icon="check-circle-outline"
                    onPress={() => void handleAcceptOrder()}
                    disabled={busyAction === 'accept-order'}
                  />
                ) : null}
                {nextAction ? (
                  <AppButton
                    label={busyAction === `trip-${nextAction.nextStatus}` ? `${nextAction.label}...` : nextAction.label}
                    icon={nextAction.icon}
                    onPress={() => void handleAdvanceTrip(nextAction.nextStatus)}
                    disabled={busyAction === `trip-${nextAction.nextStatus}`}
                  />
                ) : null}
                <View style={styles.tripActionGrid}>
                  <AppButton
                    label={copy.openNavigation}
                    icon="navigation-variant-outline"
                    variant="secondary"
                    onPress={() => void handleOpenNavigation()}
                  />
                  <AppButton
                    label={copy.callCustomer}
                    icon="phone-outline"
                    variant="secondary"
                    onPress={() => void handleCallCustomer()}
                  />
                </View>
                <View style={styles.tripActionGrid}>
                  <AppButton
                    label={busyAction === 'location-refresh' ? copy.updating : copy.refreshLocation}
                    icon="crosshairs-gps"
                    variant="secondary"
                    onPress={() => void handleManualLocationRefresh()}
                    disabled={busyAction === 'location-refresh'}
                  />
                  {activeOrder.status === 'driver_assigned' ? (
                    <AppButton
                      label={busyAction === 'decline-order' ? copy.declining : copy.rejectOrder}
                      icon="close-circle-outline"
                      variant="dark"
                      onPress={handleDeclineOrder}
                      disabled={busyAction === 'decline-order'}
                    />
                  ) : (
                    <AppButton
                      label={busyAction === 'trip-cancelled' ? copy.cancelling : copy.cancelTrip}
                      icon="close-circle-outline"
                      variant="dark"
                      onPress={handleCancelActiveTrip}
                      disabled={busyAction === 'trip-cancelled'}
                    />
                  )}
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    );
  };

  // ──────────────────────────────────────────────
  // History tab
  // ──────────────────────────────────────────────

  const renderHistoryTab = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>{copy.historyTitle}</Text>
        <Text style={styles.pageSubtitle}>{copy.historySubtitle}</Text>
      </View>

      <View style={styles.metricTileRow}>
        <MetricTile icon="check-decagram-outline" value={String(driverOrders.filter((order) => order.status === 'delivered').length)} label={copy.delivered} />
        <MetricTile icon="truck-delivery-outline" value={String(driverOrders.filter((order) => isActiveOrderStatus(order.status)).length)} label={copy.active} />
        <MetricTile icon="cash-multiple" value={`TZS ${totalEarnings.toLocaleString()}`} label={copy.earnings} />
      </View>

      {pendingCustomerRatingOrder ? (
        <SectionCard
          title={copy.rateCustomer}
          subtitle={`${pendingCustomerRatingOrder.orderNumber}`}>
          <View style={styles.customerRatingCard}>
            <View style={styles.ratingStarRow}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <Pressable
                  key={rating}
                  onPress={() => setCustomerRatingScore(rating)}
                  style={({ pressed }) => [styles.ratingStarButton, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons
                    name={rating <= customerRatingScore ? 'star' : 'star-outline'}
                    size={32}
                    color={rating <= customerRatingScore ? '#F59E0B' : '#CBD5E1'}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={customerRatingComment}
              onChangeText={setCustomerRatingComment}
              multiline
              maxLength={180}
              placeholder="Optional note about the customer"
              placeholderTextColor="#94A3B8"
              style={styles.customerRatingInput}
              textAlignVertical="top"
            />
            <AppButton
              label={customerRatingSaving ? copy.savingRating : copy.saveRating}
              icon="star-check-outline"
              onPress={() => void handleRateCustomer()}
              disabled={customerRatingSaving}
            />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title={copy.tripRecords} subtitle={copy.historySubtitle}>
        <View style={styles.stackMd}>
          {driverOrdersLoading ? <ActivityIndicator color={driveTheme.colors.primary} /> : null}

          {!driverOrdersLoading && !driverOrders.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{copy.noHistory}</Text>
              <Text style={styles.emptyText}>{copy.noHistoryHint}</Text>
            </View>
          ) : null}

          {driverOrders.map((order) => (
            <View key={order.id} style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyTitle}>{order.serviceLabel}</Text>
                <Text style={styles.historyMeta}>{order.pickupLabel} to {getDriverVisibleDropoffLabel(order)}</Text>
                <Text style={styles.historyMeta}>{order.orderNumber} • {formatDeliveryDateTime(order.createdAt)}</Text>
              </View>
              <View style={styles.historyTrailing}>
                <Text style={styles.historyAmount}>{order.totalLabel}</Text>
                <Text style={styles.historyStatus}>{getDeliveryOrderStatusLabel(order.status)}</Text>
              </View>
            </View>
          ))}
        </View>
      </SectionCard>
    </ScrollView>
  );

  // ──────────────────────────────────────────────
  // Notifications tab
  // ──────────────────────────────────────────────

  const renderNotificationsTab = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>{copy.alertsTitle}</Text>
        <Text style={styles.pageSubtitle}>
          {notificationItems.length ? `${notificationItems.length} ${copy.alertsLive}` : copy.alertsClear}
        </Text>
      </View>

      <SectionCard title={copy.alertsTitle} subtitle={copy.alertsSubtitle}>
        <View style={styles.stackMd}>
          {!notificationItems.length ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="bell-outline" size={28} color={driveTheme.colors.primary} />
              <Text style={styles.emptyTitle}>{copy.noAlerts}</Text>
              <Text style={styles.emptyText}>{copy.noAlertsHint}</Text>
            </View>
          ) : null}

          {notificationItems.map((item) => (
            <View key={item.id} style={styles.notificationRow}>
              <View
                style={[
                  styles.notificationIconWrap,
                  item.tone === 'warning'
                    ? styles.notificationIconWarning
                    : item.tone === 'success'
                      ? styles.notificationIconSuccess
                      : styles.notificationIconInfo,
                ]}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={22}
                  color={
                    item.tone === 'warning'
                      ? driveTheme.colors.warning
                      : item.tone === 'success'
                        ? driveTheme.colors.primaryDark
                        : driveTheme.colors.info
                  }
                />
              </View>
              <View style={styles.notificationCopy}>
                <Text style={styles.notificationTitle}>{item.title}</Text>
                <Text style={styles.notificationMessage}>{item.message}</Text>
                <Text style={styles.notificationTime}>{item.time}</Text>
              </View>
            </View>
          ))}
        </View>
      </SectionCard>

      {locationPermission === 'denied' ? (
        <AppButton
          label={busyAction === 'location-refresh' ? 'Refreshing location...' : 'Try location again'}
          icon="crosshairs-gps"
          variant="secondary"
          onPress={() => void handleManualLocationRefresh()}
          disabled={busyAction === 'location-refresh'}
        />
      ) : null}

      {showPaymentNotice ? (
        <AppButton
          label={subscriptionPaymentPending ? 'Access pending' : 'Open access'}
          icon="cash-fast"
          onPress={() => {
            setPaymentCheckoutStep('debt');
            setAccountView('payments');
            setSelectedTab('account');
          }}
        />
      ) : null}
    </ScrollView>
  );

  // ──────────────────────────────────────────────
  // Account tab
  // ──────────────────────────────────────────────

  const renderPaymentAccountPage = () => {
    const paymentStatusLabel = subscriptionPaymentPending
      ? 'Pending'
      : hasCommissionDue
        ? 'Pay now'
        : subscriptionActive
          ? 'Active'
          : 'Expired';
    const paymentStatusIcon: IconName = subscriptionPaymentPending
      ? 'clock-outline'
      : hasCommissionDue
        ? 'clock-alert-outline'
        : subscriptionActive
          ? 'check-circle-outline'
          : 'cash-fast';
    const paymentStatusColor = commissionPaymentOverdue ? '#92400E' : hasCommissionDue ? driveTheme.colors.info : driveTheme.colors.primaryDark;
    return (
      <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.paymentPageTopbar}>
          <Pressable
            onPress={() => setAccountView('overview')}
            style={({ pressed }) => [styles.paymentBackButton, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={driveTheme.colors.ink} />
          </Pressable>
          <View style={styles.paymentPageTitleWrap}>
            <Text style={styles.paymentPageKicker}>Driver account</Text>
            <Text style={styles.paymentPageTitle}>Mongike payments</Text>
          </View>
        </View>

        <View style={[styles.paymentDebtCard, commissionPaymentOverdue && styles.paymentDebtCardDue]}>
          <View style={styles.paymentDebtTop}>
            <View style={styles.paymentDebtIcon}>
              <MaterialCommunityIcons name={hasCommissionDue ? 'cash-clock' : 'shield-check-outline'} size={24} color="#FFFFFF" />
            </View>
            <View style={styles.paymentDebtCopy}>
              <Text style={styles.paymentDebtLabel}>DoorDrive access</Text>
              <Text style={styles.paymentDebtAmount}>TZS {driverAccessDailyFeeTzs.toLocaleString()} / day</Text>
              <Text style={styles.paymentDebtMeta}>
                {hasCommissionDue
                  ? subscriptionPaymentPending
                    ? 'Malipo yako yako pending. Access itafunguka automatic yakikamilika.'
                    : 'Access imeisha. Hautaweza kupokea au ku-manage oda mpaka ulipe.'
                  : subscriptionActive
                    ? 'Driver access is active for dispatch operations.'
                    : 'Renew daily access to continue.'}
              </Text>
            </View>
            <View style={styles.paymentStatusPill}>
              <MaterialCommunityIcons name={paymentStatusIcon} size={15} color={paymentStatusColor} />
              <Text style={[styles.paymentStatusText, { color: paymentStatusColor }]}>{paymentStatusLabel}</Text>
            </View>
          </View>

          <View style={styles.subscriptionCountdownCard}>
            <View style={styles.subscriptionCountdownIcon}>
              <MaterialCommunityIcons name="timer-sand" size={22} color={driveTheme.colors.primaryDark} />
            </View>
            <View style={styles.subscriptionCountdownCopy}>
              <Text style={styles.subscriptionCountdownLabel}>Access status</Text>
              <Text style={styles.subscriptionCountdownValue}>{subscriptionCountdownLabel}</Text>
              <Text style={styles.subscriptionCountdownCaption}>{subscriptionCountdownCaption}</Text>
            </View>
          </View>

          <View style={styles.subscriptionFeatureList}>
            <View style={styles.subscriptionFeatureRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={driveTheme.colors.primaryDark} />
              <Text style={styles.subscriptionFeatureText}>Secure Mongike mobile money prompt from backend</Text>
            </View>
            <View style={styles.subscriptionFeatureRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={driveTheme.colors.primaryDark} />
              <Text style={styles.subscriptionFeatureText}>Vodacom M-Pesa is active now; other networks are coming soon</Text>
            </View>
            <View style={styles.subscriptionFeatureRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={driveTheme.colors.primaryDark} />
              <Text style={styles.subscriptionFeatureText}>Receipts and expiry update automatically after webhook confirmation</Text>
            </View>
          </View>

          {hasCommissionDue ? (
            <AppButton
              label={subscriptionPaymentPending ? 'View pending payment' : paymentCheckoutStep === 'debt' ? 'Renew with Mongike' : paymentCheckoutStep === 'submitted' ? 'View status' : 'Continue'}
              icon="cash-fast"
              onPress={handleStartPaymentCheckout}
            />
          ) : (
            <View style={styles.paymentClearState}>
              <MaterialCommunityIcons name="check-decagram-outline" size={24} color={driveTheme.colors.primaryDark} />
              <View style={styles.paymentClearCopy}>
                <Text style={styles.paymentClearTitle}>Account iko clear</Text>
                <Text style={styles.paymentClearText}>
                  {subscriptionActive
                    ? 'Driver access iko active na unaweza kupokea oda.'
                    : 'Renew access ikiwa expiry imefika.'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {paymentCheckoutStep === 'proof' && hasCommissionDue ? (
          <View style={styles.paymentCheckoutPanel}>
            <View style={styles.paymentChosenNetwork}>
              <View style={[styles.paymentProviderIcon, { backgroundColor: selectedNetworkMeta?.color || '#16A34A' }]}>
                {selectedNetworkMeta?.logoUrl ? (
                  <Image source={{ uri: selectedNetworkMeta.logoUrl }} style={styles.paymentProviderLogo} resizeMode="contain" />
                ) : (
                  <MaterialCommunityIcons name="cellphone-check" size={20} color="#FFFFFF" />
                )}
              </View>
              <View style={styles.paymentChosenCopy}>
                <Text style={styles.paymentCheckoutTitle}>Vodacom M-Pesa</Text>
                <Text style={styles.paymentChosenMeta}>Active now • TZS {driverAccessDailyFeeTzs.toLocaleString()} daily DoorDrive access</Text>
              </View>
            </View>

            <View style={styles.paymentProviderGrid}>
              {paymentNetworks.map((network) => {
                const selected = selectedPaymentNetwork === network.key;
                return (
                  <Pressable
                    key={network.key}
                    disabled={!network.enabled}
                    onPress={() => {
                      if (network.enabled) {
                        setSelectedPaymentNetwork(network.key as DriverPaymentNetworkKey);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.paymentProviderCard,
                      selected && styles.paymentMethodChipActive,
                      !network.enabled && styles.paymentProviderCardDisabled,
                      pressed && network.enabled && styles.buttonPressed,
                    ]}>
                    <View style={[styles.paymentProviderIcon, { backgroundColor: network.color }]}>
                      {network.logoUrl ? (
                        <Image source={{ uri: network.logoUrl }} style={styles.paymentProviderLogo} resizeMode="contain" />
                      ) : (
                        <MaterialCommunityIcons name="cellphone" size={18} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={[styles.paymentProviderName, selected && styles.paymentMethodTextActive]}>{network.label}</Text>
                    <Text style={styles.paymentChosenMeta}>{network.provider}</Text>
                    <View style={[styles.paymentNetworkBadge, network.enabled ? styles.paymentNetworkBadgeActive : styles.paymentNetworkBadgeMuted]}>
                      <Text style={[styles.paymentNetworkBadgeText, network.enabled && styles.paymentNetworkBadgeTextActive]}>
                        {network.enabled ? 'Active' : 'Coming soon'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.manualPaymentNumberCard}>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Mpokeaji / receiver</Text>
                <Text style={styles.paymentReferenceValue}>Vodacom M-Pesa</Text>
              </View>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Namba ya kupokea</Text>
                <Text selectable style={styles.manualPaymentNumber}>{paymentRecipientPhone}</Text>
              </View>
              <Text style={styles.paymentSafetyNote}>
                Kwa sasa malipo yanafanya kazi kwa Vodacom M-Pesa pekee. Mitandao mingine itaongezwa baadaye.
              </Text>
            </View>

            <Text style={styles.paymentPushText}>
              Mongike itatuma payment prompt kwenye namba yako ya Vodacom. Thibitisha prompt hiyo ili access ifunguke automatic.
            </Text>

            <View style={styles.paymentInputGroup}>
              <Text style={styles.paymentInputLabel}>Namba ya mobile money</Text>
              <TextInput
                value={paymentPhoneNumber}
                onChangeText={setPaymentPhoneNumber}
                keyboardType="phone-pad"
                placeholder={driverProfile?.phoneNumber || '07XX XXX XXX'}
                placeholderTextColor="#94A3B8"
                style={styles.paymentInput}
              />
            </View>

            <AppButton
              label={busyAction === 'commission-payment' ? 'Sending prompt...' : `Pay TZS ${driverAccessDailyFeeTzs.toLocaleString()}`}
              icon="send-check-outline"
              onPress={() => void handleInitiateMongikePayment()}
              disabled={busyAction === 'commission-payment'}
            />
          </View>
        ) : null}

        {paymentCheckoutStep === 'submitted' && hasCommissionDue ? (
          <View style={styles.paymentCheckoutPanel}>
            <View style={styles.paymentPushIcon}>
              <MaterialCommunityIcons
                name={subscriptionPaymentPending ? 'clock-outline' : subscriptionActive ? 'check-circle-outline' : 'clipboard-clock-outline'}
                size={30}
                color={driveTheme.colors.primaryDark}
              />
            </View>
            <Text style={styles.paymentPushTitle}>{subscriptionActive ? 'Payment confirmed' : 'Payment pending'}</Text>
            <Text style={styles.paymentPushText}>
              {subscriptionActive
                ? 'Mongike imethibitisha malipo. Receipt na expiry ziko hapa chini.'
                : 'Thibitisha prompt kwenye simu yako. Webhook ikifika, access itafunguka automatic.'}
            </Text>
            <View style={styles.paymentReferenceBox}>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Order ID</Text>
                <Text style={styles.paymentReferenceValue}>{latestPayment?.orderId || latestPayment?.id || 'Pending'}</Text>
              </View>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Receipt</Text>
                <Text style={styles.paymentReferenceValue}>{latestPayment?.receiptNumber || latestPayment?.gatewayRef || 'Waiting for confirmation'}</Text>
              </View>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Expires</Text>
                <Text style={styles.paymentReferenceValue}>
                  {subscriptionActive ? formatDeliveryDateTime(subscriptionPaidUntilMillis) : latestPayment?.expiresAt ? formatDeliveryDateTime(latestPayment.expiresAt) : 'Pending'}
                </Text>
              </View>
            </View>
            <AppButton
              label={paymentRefreshing ? 'Checking...' : 'Refresh payment status'}
              icon="refresh"
              variant="secondary"
              onPress={() => void handleRefreshPaymentStatus()}
              disabled={paymentRefreshing}
            />
            {!subscriptionPaymentPending && !subscriptionActive ? (
              <AppButton
                label="Try payment again"
                icon="cash-fast"
                onPress={() => setPaymentCheckoutStep('proof')}
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.paymentCheckoutPanel}>
          <View style={styles.paymentFormHeader}>
            <View style={styles.paymentFormIcon}>
              <MaterialCommunityIcons name="receipt-text-outline" size={20} color={driveTheme.colors.primaryDark} />
            </View>
            <View style={styles.paymentFormHeaderCopy}>
              <Text style={styles.paymentFormTitle}>Payment history & receipts</Text>
              <Text style={styles.paymentFormSubtitle}>Latest Mongike access payments for this driver account.</Text>
            </View>
          </View>

          {paymentRefreshing ? <ActivityIndicator color={driveTheme.colors.primary} /> : null}

          {!driverPaymentHistory.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No payments yet</Text>
              <Text style={styles.emptyText}>Your daily access receipts will appear here after the first Mongike payment.</Text>
            </View>
          ) : null}

          {driverPaymentHistory.map((payment) => (
            <View key={payment.id || payment.orderId} style={styles.paymentOrderRow}>
              <View style={styles.paymentOrderIcon}>
                <MaterialCommunityIcons
                  name={payment.status === 'completed' ? 'check-circle-outline' : payment.status === 'failed' ? 'alert-circle-outline' : 'clock-outline'}
                  size={18}
                  color={driveTheme.colors.primaryDark}
                />
              </View>
              <View style={styles.paymentOrderCopy}>
                <Text style={styles.paymentOrderTitle}>
                  TZS {Number(payment.amount || driverAccessDailyFeeTzs).toLocaleString()} • {payment.status}
                </Text>
                <Text style={styles.paymentOrderMeta}>
                  {payment.receiptNumber || payment.gatewayRef || payment.orderId}
                </Text>
                <Text style={styles.paymentOrderMeta}>
                  {payment.completedAt ? `Paid ${formatDeliveryDateTime(payment.completedAt)}` : payment.createdAt ? `Started ${formatDeliveryDateTime(payment.createdAt)}` : 'Pending'}
                </Text>
              </View>
              <View style={styles.paymentOrderAmounts}>
                <Text style={styles.paymentOrderGross}>{payment.network || 'Mongike'}</Text>
                <Text style={styles.paymentOrderCommission}>{payment.subscriptionPaidUntil ? formatDeliveryDateTime(payment.subscriptionPaidUntil) : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderAccountTab = () => {
    if (accountView === 'payments') {
      return renderPaymentAccountPage();
    }

    const driverName = driverProfile?.fullName || authUser?.displayName || 'DoorDrive driver';
    const driverInitials = driverName
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const vehicleLine = `${driverProfile?.vehicleLabel || getVehicleTypeLabel(driverProfile?.vehicleType)} • ${driverProfile?.plateNumber || 'Plate pending'}`;
    const paymentStatusLabel = subscriptionPaymentPending
      ? 'Pending'
      : hasCommissionDue
          ? 'Pay now'
        : 'Free';
    const paymentStatusIcon: IconName = subscriptionPaymentPending
      ? 'clock-outline'
      : hasCommissionDue
          ? 'clock-alert-outline'
        : subscriptionActive
          ? 'check-circle-outline'
          : 'cash-fast';
    const paymentStatusColor = commissionPaymentOverdue ? '#92400E' : hasCommissionDue ? driveTheme.colors.info : driveTheme.colors.primaryDark;

    return (
      <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.accountHeaderCard}>
          <View style={styles.accountAvatar}>
            <Text style={styles.accountAvatarText}>{driverInitials || 'DD'}</Text>
          </View>
          <View style={styles.accountHeaderCopy}>
            <Text style={styles.accountHeaderKicker}>{copy.driverAccount}</Text>
            <Text style={styles.accountHeaderName}>{driverName}</Text>
            <Text style={styles.accountHeaderMeta}>{vehicleLine}</Text>
          </View>
          <View style={[styles.accountStatusBadge, driverProfile?.isAvailable ? styles.accountStatusOnline : styles.accountStatusOffline]}>
            <MaterialCommunityIcons
              name={driverProfile?.isAvailable ? 'check-circle-outline' : 'pause-circle-outline'}
              size={15}
              color={driverProfile?.isAvailable ? driveTheme.colors.primaryDark : driveTheme.colors.subtext}
            />
            <Text style={[styles.accountStatusText, driverProfile?.isAvailable && styles.accountStatusTextOnline]}>
              {driverProfile?.isAvailable ? copy.online : copy.offline}
            </Text>
          </View>
        </View>

        <View style={styles.accountQuickGrid}>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="history" size={18} color={driveTheme.colors.info} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>{driverOrders.length}</Text>
            <Text style={styles.accountQuickLabel}>{copy.jobs}</Text>
          </View>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="access-point" size={18} color={driveTheme.colors.primaryDark} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>{driverProfile?.isAvailable ? copy.online : copy.offline}</Text>
            <Text style={styles.accountQuickLabel}>Dispatch</Text>
          </View>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="cash-multiple" size={18} color={driveTheme.colors.warning} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>TZS {totalEarnings.toLocaleString()}</Text>
            <Text style={styles.accountQuickLabel}>{copy.earnings}</Text>
          </View>
        </View>

        <SectionCard title={copy.profile} subtitle={copy.settingsSubtitle}>
          <View style={styles.accountInfoList}>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="cellphone" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>{copy.phoneNumber}</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.phoneNumber || copy.notSet}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="car" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>{copy.vehicle}</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.vehicleLabel || getVehicleTypeLabel(driverProfile?.vehicleType)}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="card-account-details-outline" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>{copy.plateNumber}</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.plateNumber || copy.notSet}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={locationPermission === 'granted' ? driveTheme.colors.primaryDark : driveTheme.colors.warning} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>{copy.liveLocation}</Text>
                <Text style={styles.accountInfoValue}>{locationPermission === 'granted' ? copy.locationActive : copy.locationNeedsAccess}</Text>
              </View>
            </View>
          </View>
        </SectionCard>

        <SectionCard title={copy.settings} subtitle={copy.settingsSubtitle}>
          <View style={styles.stackMd}>
            <Text style={styles.settingLabel}>{copy.language}</Text>
            <View style={styles.languageRow}>
              <Pressable
                onPress={() => setLanguage('en')}
                style={({ pressed }) => [styles.languageChip, language === 'en' && styles.languageChipActive, pressed && styles.buttonPressed]}>
                <Text style={[styles.languageChipText, language === 'en' && styles.languageChipTextActive]}>{copy.languageEnglish}</Text>
              </Pressable>
              <Pressable
                onPress={() => setLanguage('sw')}
                style={({ pressed }) => [styles.languageChip, language === 'sw' && styles.languageChipActive, pressed && styles.buttonPressed]}>
                <Text style={[styles.languageChipText, language === 'sw' && styles.languageChipTextActive]}>{copy.languageSwahili}</Text>
              </Pressable>
            </View>
            <View style={styles.settingToggleRow}>
              <View style={styles.settingToggleCopy}>
                <Text style={styles.settingToggleTitle}>{copy.autoConfirm}</Text>
                <Text style={styles.settingToggleHint}>{copy.autoConfirmHint}</Text>
              </View>
              <Switch
                value={autoConfirm}
                onValueChange={setAutoConfirm}
                trackColor={{ false: '#E2E8F0', true: '#86EFAC' }}
                thumbColor={autoConfirm ? '#16A34A' : '#F8FAFC'}
              />
            </View>
          </View>
        </SectionCard>

        <SectionCard title="Driver access" subtitle="DoorDrive is free to use for dispatch work.">
          <View style={styles.stackMd}>
            <View style={styles.paymentSummaryBand}>
              <View style={styles.paymentSummaryMain}>
                <Text style={styles.paymentHeroLabel}>DoorDrive access</Text>
                <Text style={styles.paymentHeroAmount}>Free</Text>
                <Text style={styles.paymentSummaryCaption}>
                  {hasCommissionDue
                    ? subscriptionPaymentPending
                      ? 'Payment pending. Approve prompt to unlock access.'
                      : 'Access imeisha. Lipa ili kupokea na ku-manage oda.'
                    : 'You can go online and receive orders without a daily fee.'}
                </Text>
              </View>
              <View style={styles.paymentStatusPill}>
                <MaterialCommunityIcons name={paymentStatusIcon} size={15} color={paymentStatusColor} />
                <Text style={[styles.paymentStatusText, { color: paymentStatusColor }]}>{paymentStatusLabel}</Text>
              </View>
            </View>

            <View style={styles.subscriptionCountdownCard}>
              <View style={styles.subscriptionCountdownIcon}>
                <MaterialCommunityIcons name="timer-sand" size={22} color={driveTheme.colors.primaryDark} />
              </View>
              <View style={styles.subscriptionCountdownCopy}>
                <Text style={styles.subscriptionCountdownLabel}>Access status</Text>
                <Text style={styles.subscriptionCountdownValue}>{subscriptionCountdownLabel}</Text>
                <Text style={styles.subscriptionCountdownCaption}>{subscriptionCountdownCaption}</Text>
              </View>
            </View>

            {hasCommissionDue ? (
              <AppButton
                label="Open access"
                icon="cash-fast"
                onPress={() => {
                  setPaymentCheckoutStep('debt');
                  setAccountView('payments');
                }}
              />
            ) : null}
          </View>
        </SectionCard>

        <SectionCard title="Account controls" subtitle={availabilityLabel}>
          <View style={styles.stackMd}>
            <View style={styles.accountHealthRow}>
              <View style={styles.accountHealthItem}>
                <Text style={styles.disciplineValue}>{driverCanReceiveDispatch ? 'Ready' : 'Hold'}</Text>
                <Text style={styles.disciplineLabel}>Verification</Text>
              </View>
              <View style={styles.accountHealthItem}>
                <Text style={styles.disciplineValue}>{hasCommissionDue ? 'Due' : 'Clear'}</Text>
                <Text style={styles.disciplineLabel}>Access</Text>
              </View>
              <View style={styles.accountHealthItem}>
                <Text style={styles.disciplineValue}>{driverProfile?.isAvailable ? 'Online' : 'Off'}</Text>
                <Text style={styles.disciplineLabel}>Dispatch</Text>
              </View>
            </View>
            <Text style={styles.tripLine}>{locationLabel}</Text>
            {driverProfile?.lastLocationUpdatedAt ? (
              <Text style={styles.tripLine}>Last location write: {formatDeliveryDateTime(driverProfile.lastLocationUpdatedAt)}</Text>
            ) : null}
            <AppButton
              label={busyAction === 'availability' ? copy.updating : driverProfile?.isAvailable ? copy.goOfflineLong : copy.goOnline}
              icon={driverProfile?.isAvailable ? 'pause-circle-outline' : 'check-circle-outline'}
              variant="secondary"
              onPress={() => void handleToggleAvailability()}
              disabled={!!activeOrder || busyAction === 'availability' || (!driverProfile?.isAvailable && !driverCanReceiveDispatch)}
            />
            <AppButton
              label={busyAction === 'location-refresh' ? 'Refreshing location...' : 'Refresh live location'}
              icon="crosshairs-gps"
              variant="secondary"
              onPress={() => void handleManualLocationRefresh()}
              disabled={busyAction === 'location-refresh' || !subscriptionActive}
            />
            <AppButton
              label={busyAction === 'sign-out' ? copy.signingOut : copy.signOut}
              icon="logout"
              variant="dark"
              onPress={() => void handleSignOut()}
              disabled={busyAction === 'sign-out'}
            />
          </View>
        </SectionCard>
      </ScrollView>
    );
  };

  // ──────────────────────────────────────────────
  // Main return (unchanged)
  // ──────────────────────────────────────────────
  if (typeof global !== 'undefined' && (global as any).ErrorUtils && !(global as any).__dd_global_handler_installed) {
    try {
      const previous = (global as any).ErrorUtils.getGlobalHandler?.();
      (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        setFeedback({
          tone: 'error',
          message: isFatal
            ? 'A fatal app error was caught. Restart DoorDrive if the screen becomes unstable.'
            : 'A background app error was caught while DoorDrive kept running.',
        });
        try {
          // call previous if available
          if (typeof previous === 'function') previous(error, isFatal);
        } catch (e) {
          // ignore
        }
      });
      (global as any).__dd_global_handler_installed = true;
    } catch (e) {
      // ignore
    }
  }

  if (showStartupSplash || authInitializing) {
    const progressWidth = splashProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ['16%', '100%'],
    });

    return (
      <ErrorBoundary>
        <View style={styles.splashScreen}>
          <StatusBar style="light" backgroundColor={driveTheme.colors.primary} />
          <View style={styles.splashCenter}>
            <Image source={appLogoImage} style={styles.splashLogo} resizeMode="contain" />
            <Text style={styles.splashTagline}>
              {authInitializing && !showStartupSplash ? 'Connecting...' : 'Drive. Deliver. Earn.'}
            </Text>
          </View>
          <View style={styles.splashFooter}>
            <View style={styles.splashProgressTrack}>
              <Animated.View style={[styles.splashProgressFill, { width: progressWidth }]} />
            </View>
          </View>
        </View>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
	      {!authUser ? (
        renderAuthScreen()
      ) : profileLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={driveTheme.colors.primary} />
          <Text style={styles.loadingText}>Loading driver profile...</Text>
        </View>
      ) : registrationSubmitted && !driverProfile ? (
        renderVerificationStatusScreen()
      ) : driverProfileMissing ? (
        renderProfileSetup()
      ) : driverVerificationPending ? (
        renderVerificationStatusScreen()
      ) : (
        <View style={styles.flex}>
          {driverAccessBlocked && selectedTab !== 'account' ? renderAccessRenewalScreen() : null}
          {!driverAccessBlocked && selectedTab === 'home' ? renderHomeTab() : null}
          {!driverAccessBlocked && selectedTab === 'trip' ? renderTripTab() : null}
          {!driverAccessBlocked && selectedTab === 'history' ? renderHistoryTab() : null}
          {!driverAccessBlocked && selectedTab === 'notifications' ? renderNotificationsTab() : null}
          {selectedTab === 'account' ? renderAccountTab() : null}

          <View style={styles.bottomNav}>
            {tabs.map((tab) => {
              const active = selectedTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    if (tab.key === 'account') {
                      setAccountView('overview');
                    }
                    setSelectedTab(tab.key);
                  }}
                  style={[styles.bottomNavItem, active && styles.bottomNavItemActive]}>
                  <MaterialCommunityIcons
                    name={tab.icon}
                    size={22}
                    color={active ? '#16A34A' : '#94A3B8'}
                  />
                  {tab.key === 'notifications' && unreadNotificationCount > 0 ? (
                    <View style={styles.bottomNavBadge}>
                      <Text style={styles.bottomNavBadgeText}>{Math.min(unreadNotificationCount, 9)}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>
                    {tab.key === 'home'
                      ? copy.tabHome
                      : tab.key === 'trip'
                        ? copy.tabTrip
                        : tab.key === 'history'
                          ? copy.tabHistory
                          : tab.key === 'notifications'
                            ? copy.tabAlerts
                            : copy.tabAccount}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      </SafeAreaView>
    </ErrorBoundary>
  );
}

// ──────────────────────────────────────────────
// Styles (unchanged except for a few new ones)
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  splashSafeArea: {
    flex: 1,
    backgroundColor: driveTheme.colors.primary,
  },
  flex: {
    flex: 1,
  },
  splashScreen: {
    flex: 1,
    backgroundColor: driveTheme.colors.primary,
  },
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  splashLogo: {
    width: 128,
    height: 128,
    borderRadius: 32,
  },
  splashTagline: {
    marginTop: 20,
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: driveType.semibold,
    textAlign: 'center',
  },
  splashFooter: {
    paddingHorizontal: 56,
    paddingBottom: 40,
  },
  splashProgressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  splashProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  loadingText: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  authCanvas: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  authScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 12,
  },
  authBackButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: driveTheme.colors.surface,
    marginBottom: 8,
  },
  authPageTitle: {
    color: driveTheme.colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontFamily: driveType.bold,
    marginBottom: 8,
  },
  authFieldHint: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: driveType.semibold,
    marginTop: 4,
  },
  authTermsRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  authTermsText: {
    flex: 1,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: driveType.regular,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 42,
    paddingBottom: 28,
    gap: 24,
  },
  registerScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 22,
    gap: 18,
  },
  authTopBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  authBrandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authMarkSmall: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: driveTheme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBrandTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  authBrandCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  authLivePill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
  },
  authLivePillText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  authIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
  },
  authHeaderSpacer: {
    width: 44,
  },
  registerTopBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  registerBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E9FBEF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerBrandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  registerLogoShell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFE8D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerLogoImage: {
    width: 26,
    height: 26,
  },
  registerBrandName: {
    color: driveTheme.colors.primaryDark,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  registerHeaderSpacer: {
    width: 42,
  },
  loginIntro: {
    alignItems: 'center',
    gap: 6,
  },
  loginBrandHeader: {
    alignItems: 'center',
    gap: 10,
  },
  loginLogoShell: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#E9FBEF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginLogoImage: {
    width: 42,
    height: 42,
  },
  loginBrandName: {
    color: driveTheme.colors.primaryDark,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
  },
  authHeroMark: {
    width: 78,
    height: 78,
    borderRadius: 24,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#064E3B',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  loginPanel: {
    gap: 15,
  },
  registerHero: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  authEyebrow: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  authHeadline: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  authSubcopy: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  authFormPanel: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  loginHero: {
    minHeight: 452,
    justifyContent: 'space-between',
    backgroundColor: '#0B1220',
  },
  loginHeroImage: {
    opacity: 0.84,
  },
  loginHeroTint: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 64,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(11, 18, 32, 0.42)',
  },
  loginBrandBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  loginBrandText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 13,
    fontWeight: '900',
  },
  loginHeroCopy: {
    maxWidth: 330,
    gap: 8,
  },
  loginHeroTitle: {
    color: '#FFFFFF',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
  },
  loginHeroText: {
    color: '#E2E8F0',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  loginSheet: {
    marginTop: -34,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -12 },
    shadowRadius: 28,
    elevation: 8,
  },
  loginSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emailOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emailOnlyText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  loginCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginTitle: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  loginSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  loginSecondaryAction: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
  },
  loginSecondaryActionText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    fontFamily: driveType.bold,
  },
  loginSecondaryActionMuted: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    fontFamily: driveType.regular,
  },
  setupScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  setupHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setupBackButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0FDF4',
  },
  setupHeaderSpacer: {
    width: 46,
  },
  setupTitle: {
    color: driveTheme.colors.ink,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  setupIntro: {
    color: driveTheme.colors.subtext,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 18,
    marginBottom: 20,
    fontWeight: '700',
  },
  setupProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  setupStepItem: {
    width: 74,
    alignItems: 'center',
    gap: 6,
  },
  setupStepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupStepCircleActive: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  setupStepCircleComplete: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  setupStepLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '800',
  },
  setupStepLabelActive: {
    color: driveTheme.colors.primaryDark,
  },
  setupConnector: {
    flex: 1,
    height: 1,
    backgroundColor: '#CFE8D8',
    marginHorizontal: 4,
    marginBottom: 20,
  },
  setupConnectorActive: {
    backgroundColor: driveTheme.colors.primary,
  },
  setupScroll: {
    flexGrow: 1,
    paddingBottom: 22,
  },
  setupFormStack: {
    gap: 14,
  },
  setupInputShell: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  setupTextInput: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    fontFamily: driveType.regular,
    minHeight: 44,
  },
  setupSelectShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  setupSelectText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  setupSelectPlaceholder: {
    color: '#7B8B8D',
  },
  setupColorSwatch: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  setupPhoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  setupCountryCode: {
    width: 92,
    minHeight: 56,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  setupFlagText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 15,
    fontWeight: '900',
  },
  setupPhoneInput: {
    flex: 1,
  },
  setupMiniLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  setupVehiclePickerWrap: {
    gap: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  setupHintText: {
    color: driveTheme.colors.warning,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  setupNotice: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.primarySoft,
    padding: 14,
    alignItems: 'flex-start',
  },
  setupNoticeText: {
    flex: 1,
    color: driveTheme.colors.primaryDark,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  termsPanel: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    padding: 12,
  },
  termsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  termsPanelTitle: {
    flex: 1,
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  termsFinePrint: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  termsAgreeRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  termsAgreeRowActive: {
    borderColor: driveTheme.colors.primary,
    backgroundColor: '#DCFCE7',
  },
  loginTermsAgreeRow: {
    marginTop: 2,
  },
  termsCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  termsCheckboxActive: {
    backgroundColor: driveTheme.colors.primary,
  },
  termsAgreeText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  registerFooter: {
    borderTopWidth: 1,
    borderTopColor: '#D8EFE0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 18,
  },
  setupFooter: {
    marginHorizontal: -20,
    borderTopWidth: 1,
    borderTopColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 22,
  },
  verificationScreen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 20,
    paddingVertical: 28,
    justifyContent: 'center',
  },
  verificationCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 22,
    gap: 18,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 32,
    elevation: 8,
  },
  verificationIconShell: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  verificationTitle: {
    color: driveTheme.colors.ink,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '900',
    textAlign: 'center',
  },
  verificationText: {
    color: driveTheme.colors.subtext,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    textAlign: 'center',
  },
  verificationChecklist: {
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#F8FFFB',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    padding: 14,
  },
  verificationCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verificationCheckText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  verificationActions: {
    gap: 12,
  },
  verificationSignOut: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  verificationSignOutText: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  documentList: {
    gap: 14,
  },
  documentRow: {
    minHeight: 104,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  documentIconShell: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  documentThumb: {
    width: '100%',
    height: '100%',
  },
  documentCopy: {
    flex: 1,
    gap: 4,
  },
  documentTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  documentHelper: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  documentUploadButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  documentUploadButtonDone: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  documentUploadText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  documentUploadTextDone: {
    color: '#FFFFFF',
  },
  authScroll: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 18,
  },
  authHeroShell: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: driveTheme.radius.xl,
  },
  authGlowPrimary: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(134, 239, 172, 0.14)',
    top: -40,
    right: -30,
    zIndex: 1,
  },
  authGlowSecondary: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    bottom: -30,
    left: -20,
    zIndex: 1,
  },
  dashboardContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
    gap: 14,
  },
  pageHeader: {
    gap: 4,
    paddingTop: 4,
    paddingBottom: 4,
  },
  pageTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 28,
    lineHeight: 34,
  },
  pageSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  homeTabContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 118,
    gap: 12,
  },
  homeScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  homeMapFill: {
    ...StyleSheet.absoluteFillObject,
  },
  homeMapWrap: {
    flex: 1,
    backgroundColor: '#E7EEF0',
    overflow: 'hidden',
  },
  tripScreenContent: {
    paddingBottom: 110,
    gap: 0,
  },
  heroCard: {
    borderRadius: driveTheme.radius.xl,
    padding: 22,
    backgroundColor: driveTheme.colors.dark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 30,
    elevation: 6,
  },
  heroKicker: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginBottom: 10,
  },
  heroText: {
    color: '#D7E1EA',
    fontSize: 14,
    lineHeight: 22,
  },
  authShowcaseRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  authShowcaseCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    gap: 4,
  },
  authShowcaseValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  authShowcaseLabel: {
    color: '#C9D6E2',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  tripHero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: driveTheme.colors.dark,
    gap: 10,
  },
  tripHeroTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
  },
  tripHeroText: {
    color: '#D7E1EA',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  tripMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  tripMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tripMetricText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  homeTopPanel: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  homeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  homeStatusPillOnline: {
    backgroundColor: '#DCFCE7',
  },
  homeStatusPillOffline: {
    backgroundColor: '#F1F5F9',
  },
  homeStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  homeStatusDotOnline: {
    backgroundColor: '#16A34A',
  },
  homeStatusDotOffline: {
    backgroundColor: '#94A3B8',
  },
  homeStatusPillText: {
    fontFamily: driveType.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  homeStatusPillTextOnline: {
    color: '#14532D',
  },
  homeStatusPillTextOffline: {
    color: '#475569',
  },
  homeEarningsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: '#E8EEF2',
  },
  homeEarningsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeEarningsKicker: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  homeEarningsValue: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 30,
    lineHeight: 36,
    marginTop: 4,
    marginBottom: 12,
  },
  homeEarningsStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  homeEarningsStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  homeEarningsStatValue: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  homeEarningsStatLabel: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    textAlign: 'center',
  },
  homeEarningsStatDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  homeEarningsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  homeEarningsFooterText: {
    flex: 1,
    fontFamily: driveType.semibold,
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  homeEarningsFooterMeta: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
  },
  homeIconChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EA580C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationDotText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 9,
  },
  homeDueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  homeDueBannerOverdue: {
    backgroundColor: '#FFF7ED',
  },
  homeDueBannerPending: {
    backgroundColor: '#EFF6FF',
  },
  homeDueBannerText: {
    flex: 1,
    fontFamily: driveType.semibold,
    color: '#0F172A',
    fontSize: 13,
  },
  homeDueBannerMeta: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
  },
  homeBottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    paddingHorizontal: 14,
    paddingBottom: 92,
  },
  homeDeclinePill: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  homeDeclinePillText: {
    fontFamily: driveType.semibold,
    color: '#FFFFFF',
    fontSize: 14,
  },
  homeBoltCard: {
    backgroundColor: '#16A34A',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    gap: 6,
    shadowColor: '#14532D',
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: -8 },
    shadowRadius: 20,
    elevation: 14,
  },
  homeBoltStats: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 32,
  },
  homeBoltPlace: {
    fontFamily: driveType.semibold,
    color: '#F0FDF4',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 2,
  },
  homeBoltCustomer: {
    fontFamily: driveType.regular,
    color: '#DCFCE7',
    fontSize: 14,
    lineHeight: 20,
  },
  homeBoltFare: {
    fontFamily: driveType.semibold,
    color: '#FFFFFF',
    fontSize: 15,
    marginTop: 8,
  },
  homeBoltAcceptText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 18,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: 16,
  },
  homeSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: -6 },
    shadowRadius: 24,
    elevation: 12,
  },
  homeSheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 12,
  },
  homeSheetKicker: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
  },
  homeFare: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 32,
    lineHeight: 38,
    marginTop: 4,
    marginBottom: 14,
  },
  homeSheetTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
  },
  homeSheetSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 14,
  },
  homeStopList: {
    gap: 0,
    marginBottom: 16,
  },
  homeStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
  },
  homeStopRail: {
    width: 14,
    alignItems: 'center',
    paddingTop: 5,
  },
  homeStopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  homeStopDotPickup: {
    backgroundColor: '#16A34A',
  },
  homeStopDotDropoff: {
    backgroundColor: '#0F172A',
  },
  homeStopLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
    backgroundColor: '#E2E8F0',
    marginTop: 4,
  },
  homeStopCopy: {
    flex: 1,
    paddingBottom: 12,
  },
  homeStopLabel: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 14,
  },
  homeStopValue: {
    fontFamily: driveType.semibold,
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  homeAcceptButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  homeTripActionGrow: {
    flex: 1,
  },
  homeAcceptButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
  },
  homeGhostButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  homeGhostButtonText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 15,
  },
  homeTripActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeIconAction: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeIdleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 20,
    elevation: 10,
  },
  homeSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  homeLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16A34A',
  },
  homeIdleCopy: {
    flex: 1,
  },
  homeIdleTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 21,
  },
  homeIdleSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  homeOfflineDock: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  homeGoHalo: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(22, 163, 74, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeGoButton: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14532D',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 10,
  },
  homeGoText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 20,
    letterSpacing: 0.8,
  },
  homeGoCopyCard: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    maxWidth: 320,
  },
  homeGoCaption: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
  },
  homeGoHint: {
    fontFamily: driveType.regular,
    marginTop: 4,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  homeMapFallback: {
    backgroundColor: '#E7EEF0',
    overflow: 'hidden',
  },
  homeMapGridLineA: {
    position: 'absolute',
    width: 460,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.28)',
    top: '42%',
    left: -70,
    transform: [{ rotate: '-22deg' }],
  },
  homeMapGridLineB: {
    position: 'absolute',
    width: 430,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
    top: '58%',
    left: -40,
    transform: [{ rotate: '28deg' }],
  },
  homeMapRoutePreview: {
    position: 'absolute',
    width: 220,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#16A34A',
    top: '48%',
    left: 54,
    transform: [{ rotate: '16deg' }],
  },
  homeMapPin: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  homeMapPinPickup: {
    top: '44%',
    left: 44,
    backgroundColor: '#16A34A',
  },
  homeMapPinDropoff: {
    top: '56%',
    right: 48,
    backgroundColor: '#2563EB',
  },
  homeMapVehicle: {
    position: 'absolute',
    top: '49%',
    left: '52%',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#14532D',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-18deg' }],
  },
  customerRatingCard: {
    gap: 14,
  },
  ratingStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingStarButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  customerRatingInput: {
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  homePrimaryMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#16A34A',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  homePrimaryMiniButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  homeSecondaryMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  homeSecondaryMiniButtonText: {
    color: '#14532D',
    fontSize: 13,
    fontWeight: '700',
  },
  homeOrderDivider: {
    height: 1,
    backgroundColor: driveTheme.colors.line,
    marginVertical: 6,
  },
  homeOrderDetail: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  quickActionGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  quickAction: {
    flex: 1,
    minHeight: 78,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    position: 'relative',
  },
  quickActionText: {
    color: driveTheme.colors.ink,
    fontSize: 11,
    fontWeight: '900',
  },
  quickActionBadge: {
    position: 'absolute',
    top: 11,
    right: 16,
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.warning,
  },
  metricTileRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricTile: {
    flex: 1,
    minHeight: 108,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    justifyContent: 'space-between',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 2,
  },
  metricTileIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTileValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 24,
  },
  metricTileLabel: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 12,
  },
  card: {
    borderRadius: driveTheme.radius.xl,
    backgroundColor: driveTheme.colors.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    gap: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 22,
    elevation: 2,
  },
  cardHeader: {
    gap: 6,
  },
  cardTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 18,
  },
  cardSubtitle: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  authModeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  authModeChip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  authModeChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#BBF7D0',
  },
  authModeText: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  authModeTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  textInput: {
    minHeight: 56,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    color: driveTheme.colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  stackLg: {
    gap: 16,
  },
  stackMd: {
    gap: 12,
  },
  helperCard: {
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  helperText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  authFooter: {
    marginTop: 2,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  authFooterText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  authLink: {
    color: driveTheme.colors.primaryDark,
    fontWeight: '700',
  },
  buttonBase: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 12,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  buttonPrimary: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  buttonSecondary: {
    backgroundColor: '#FFFFFF',
    borderColor: driveTheme.colors.line,
  },
  buttonDark: {
    backgroundColor: driveTheme.colors.dark,
    borderColor: driveTheme.colors.dark,
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  buttonPressed: {
    opacity: 0.86,
  },
  buttonTextPrimary: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
  },
  buttonTextSecondary: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    textAlign: 'center',
  },
  vehiclePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vehicleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
  },
  vehicleChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#BBF7D0',
  },
  vehicleChipText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  vehicleChipTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  colorChipActive: {
    borderColor: driveTheme.colors.primary,
    backgroundColor: driveTheme.colors.primarySoft,
  },
  colorChipSwatch: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  colorChipText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  colorChipTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  feedbackBanner: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  feedbackSuccess: {
    backgroundColor: driveTheme.colors.primarySoft,
  },
  feedbackError: {
    backgroundColor: '#FEE2E2',
  },
  feedbackInfo: {
    backgroundColor: '#EFF6FF',
  },
  feedbackText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: driveTheme.radius.pill,
  },
  infoPillSuccess: {
    backgroundColor: driveTheme.colors.primarySoft,
  },
  infoPillInfo: {
    backgroundColor: '#DBEAFE',
  },
  infoPillMuted: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  infoPillText: {
    color: '#D7E1EA',
    fontSize: 12,
    fontWeight: '800',
  },
  infoPillTextSuccess: {
    color: driveTheme.colors.primaryDark,
  },
  infoPillTextInfo: {
    color: driveTheme.colors.info,
  },
  statusCard: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  statusCardOnline: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#BBF7D0',
  },
  statusCardOffline: {
    backgroundColor: '#F8FAFC',
    borderColor: driveTheme.colors.line,
  },
  statusCardInfo: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  statusCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusCopy: {
    flex: 1,
  },
  statusCardTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusCardText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 250,
  },
  paymentNoticeCard: {
    borderRadius: driveTheme.radius.xl,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 18,
    gap: 12,
  },
  paymentNoticeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentNoticeTitle: {
    flex: 1,
    color: '#92400E',
    fontSize: 18,
    fontWeight: '900',
  },
  paymentNoticeText: {
    color: '#92400E',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  paymentPageTopbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentBackButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentPageTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  paymentPageKicker: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentPageTitle: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  paymentDebtCard: {
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    padding: 16,
    gap: 14,
  },
  paymentDebtCardDue: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  paymentDebtTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  paymentDebtIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: driveTheme.colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentDebtCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentDebtLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentDebtAmount: {
    color: driveTheme.colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
  },
  paymentDebtMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  subscriptionCountdownCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subscriptionCountdownIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#E9FBEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscriptionCountdownCopy: {
    flex: 1,
    minWidth: 0,
  },
  subscriptionCountdownLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subscriptionCountdownValue: {
    color: driveTheme.colors.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  subscriptionCountdownCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  subscriptionFeatureList: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.26)',
    padding: 13,
    gap: 10,
  },
  subscriptionFeatureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  subscriptionFeatureText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  paymentReferenceBox: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.32)',
    padding: 12,
    gap: 10,
  },
  paymentReferenceItem: {
    gap: 2,
  },
  paymentReferenceLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentReferenceValue: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentSafetyNote: {
    color: '#92400E',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  paymentCheckoutPanel: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    gap: 14,
  },
  paymentCheckoutTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  paymentProviderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  paymentProviderCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 124,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  paymentProviderCardDisabled: {
    opacity: 0.58,
  },
  paymentProviderIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  paymentProviderLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  paymentProviderName: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  paymentChosenNetwork: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  paymentChosenCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentChosenMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  paymentNetworkBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  paymentNetworkBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  paymentNetworkBadgeMuted: {
    backgroundColor: '#E2E8F0',
  },
  paymentNetworkBadgeText: {
    color: driveTheme.colors.subtext,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentNetworkBadgeTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  manualPaymentNumberCard: {
    borderRadius: 18,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
    gap: 12,
  },
  manualPaymentNumber: {
    color: driveTheme.colors.primaryDark,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
  },
  manualPaymentCopyButton: {
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  manualPaymentCopyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  paymentMiniButton: {
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paymentMiniButtonText: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentPushIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  paymentPushTitle: {
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  paymentPushText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  paymentOrderList: {
    gap: 10,
  },
  paymentOrderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 12,
  },
  paymentOrderIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentOrderCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentOrderTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  paymentOrderMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentOrderAmounts: {
    alignItems: 'flex-end',
    gap: 2,
  },
  paymentOrderGross: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  paymentOrderCommission: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  mobileMoneyRouteList: {
    gap: 10,
  },
  mobileMoneyRouteCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 13,
    gap: 11,
  },
  mobileMoneyRouteCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  mobileMoneyRouteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileMoneyIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMoneyRouteCopy: {
    flex: 1,
    minWidth: 0,
  },
  mobileMoneyRouteName: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  mobileMoneyRouteMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  mobileMoneyRouteHint: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  mobileMoneyRouteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  mobileMoneySelectButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMoneySelectButtonActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#86EFAC',
  },
  mobileMoneySelectText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  mobileMoneySelectTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  mobileMoneyDialButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  mobileMoneyDialText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  accountHeaderCard: {
    borderRadius: 24,
    backgroundColor: driveTheme.colors.dark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 5,
  },
  accountAvatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  accountHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountHeaderKicker: {
    color: '#86EFAC',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountHeaderName: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 27,
  },
  accountHeaderMeta: {
    fontFamily: driveType.regular,
    color: '#D7E1EA',
    fontSize: 12,
    lineHeight: 17,
  },
  accountStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  accountStatusOnline: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  accountStatusOffline: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  accountStatusText: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
  },
  accountStatusTextOnline: {
    color: driveTheme.colors.primaryDark,
  },
  accountQuickGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  accountQuickItem: {
    flex: 1,
    minHeight: 86,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  accountQuickValue: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    maxWidth: '100%',
  },
  accountQuickLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountInfoList: {
    gap: 10,
  },
  accountInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
  },
  accountInfoCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountInfoLabel: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
  },
  accountInfoValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  settingLabel: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 13,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  languageChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageChipActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
  },
  languageChipText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 14,
  },
  languageChipTextActive: {
    color: '#14532D',
  },
  settingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
  },
  settingToggleCopy: {
    flex: 1,
    gap: 2,
  },
  settingToggleTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
  },
  settingToggleHint: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  paymentSummaryBand: {
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentSummaryMain: {
    flex: 1,
    minWidth: 0,
  },
  paymentSummaryCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 3,
  },
  paymentBreakdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paymentBreakdownItem: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 3,
  },
  paymentBreakdownLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentBreakdownValue: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  paymentHero: {
    borderRadius: 22,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentHeroLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentHeroAmount: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  paymentStatusPill: {
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentStatusText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentStatusTextDue: {
    color: '#92400E',
  },
  paymentFlowStep: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 13,
  },
  paymentFlowIndex: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentFlowIndexDone: {
    backgroundColor: driveTheme.colors.primary,
  },
  paymentFlowIndexActive: {
    backgroundColor: driveTheme.colors.warning,
  },
  paymentFlowIndexMuted: {
    backgroundColor: '#E2E8F0',
  },
  paymentFlowIndexText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentFlowIndexTextActive: {
    color: '#FFFFFF',
  },
  paymentFlowCopy: {
    flex: 1,
    gap: 3,
  },
  paymentFlowTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  paymentFlowDetail: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentForm: {
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 14,
    gap: 12,
  },
  paymentFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentFormIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentFormHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentFormTitle: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentFormSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentMethodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paymentMethodChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentMethodChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#86EFAC',
  },
  paymentMethodText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentMethodTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  paymentInputGroup: {
    gap: 7,
  },
  paymentInputLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  paymentInput: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  paymentClearState: {
    borderRadius: 20,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentClearCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentClearTitle: {
    color: driveTheme.colors.primaryDark,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentClearText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  accountHealthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  accountHealthItem: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  accountSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accountSummaryItem: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 13,
    gap: 4,
  },
  accountSummaryLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountSummaryValue: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  disciplineRow: {
    flexDirection: 'row',
    gap: 10,
  },
  disciplineItem: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  disciplineValue: {
    color: driveTheme.colors.ink,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
  },
  disciplineLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  emptyState: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#F8FAFC',
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyStateLarge: {
    borderRadius: driveTheme.radius.xl,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 18,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  orderCard: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 10,
  },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  orderCopy: {
    flex: 1,
  },
  orderTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  orderMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  orderPriceWrap: {
    marginLeft: 12,
  },
  orderPrice: {
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    fontWeight: '800',
  },
  orderRoute: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  orderDetail: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  orderHint: {
    color: driveTheme.colors.info,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  infoCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  infoCalloutMuted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  infoCalloutText: {
    flex: 1,
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  infoCalloutTextMuted: {
    flex: 1,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  mapCard: {
    position: 'relative',
  },
  tripMapStage: {
    paddingHorizontal: 0,
    backgroundColor: driveTheme.colors.dark,
  },
  mapView: {
    width: '100%',
    height: 440,
    borderRadius: 0,
  },
  mapOverlay: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'space-between',
    padding: 18,
  },
  mapOverlayTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  mapOverlayBottom: {
    alignItems: 'flex-end',
  },
  mapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mapBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  mapBadgeMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mapBadgeMutedText: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  mapNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 4,
  },
  mapNavButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  tripBottomSheet: {
    marginTop: -36,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 110,
    gap: 16,
  },
  tripSheetHandle: {
    width: 58,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 2,
  },
  tripSheetCard: {
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 18,
    gap: 12,
  },
  tripSheetTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  tripSheetSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  tripHelperText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  tripActionSheet: {
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 18,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 3,
  },
  tripMessageThread: {
    gap: 10,
  },
  tripMessageRow: {
    flexDirection: 'row',
  },
  tripMessageRowSelf: {
    justifyContent: 'flex-end',
  },
  tripMessageRowOther: {
    justifyContent: 'flex-start',
  },
  tripMessageBubble: {
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  tripMessageBubbleSelf: {
    backgroundColor: driveTheme.colors.primary,
    borderBottomRightRadius: 8,
  },
  tripMessageBubbleOther: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    borderBottomLeftRadius: 8,
  },
  tripMessageSender: {
    fontSize: 12,
    fontWeight: '800',
  },
  tripMessageSenderSelf: {
    color: '#DCFCE7',
  },
  tripMessageSenderOther: {
    color: driveTheme.colors.info,
  },
  tripMessageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  tripMessageTextSelf: {
    color: '#FFFFFF',
  },
  tripMessageTextOther: {
    color: driveTheme.colors.ink,
  },
  tripMessageTime: {
    fontSize: 11,
    fontWeight: '700',
  },
  tripMessageTimeSelf: {
    color: '#DCFCE7',
  },
  tripMessageTimeOther: {
    color: driveTheme.colors.subtext,
  },
  tripMessageComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  tripMessageInput: {
    flex: 1,
    minHeight: 52,
    maxHeight: 112,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
  },
  tripMessageSendButton: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.primary,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tripMessageSendButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  tripMessageSendText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  mapFallbackShell: {
    gap: 12,
  },
  mapFallbackScene: {
    height: 440,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#E8F1EC',
  },
  mapFallbackGlowA: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(15, 157, 88, 0.12)',
    top: -30,
    left: -20,
  },
  mapFallbackGlowB: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    bottom: -10,
    right: -10,
  },
  mapRouteLine: {
    position: 'absolute',
    left: 72,
    top: 94,
    width: 180,
    height: 6,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
    transform: [{ rotate: '28deg' }],
  },
  mapNode: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  mapNodePickup: {
    top: 82,
    left: 56,
    backgroundColor: '#F97316',
  },
  mapNodeDropoff: {
    right: 54,
    bottom: 64,
    backgroundColor: driveTheme.colors.primary,
  },
  mapNodeDriver: {
    top: 148,
    left: 160,
    backgroundColor: driveTheme.colors.info,
  },
  mapNodeInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  mapFallbackCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#F8FAFC',
    padding: 14,
    gap: 10,
  },
  mapFallbackTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  mapFallbackText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  tripStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tripStopDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    marginTop: 4,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  tripStopPickup: {
    backgroundColor: '#F97316',
  },
  tripStopDropoff: {
    backgroundColor: driveTheme.colors.primary,
  },
  tripStopCopy: {
    flex: 1,
    gap: 4,
  },
  tripStopTitle: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '800',
  },
  tripStopLabel: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  tripDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  tripActionPrimary: {
    gap: 12,
  },
  tripActionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 14,
    marginBottom: 4,
  },
  historyMeta: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 210,
  },
  historyTrailing: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  historyAmount: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  historyStatus: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '700',
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  notificationIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationIconSuccess: {
    backgroundColor: driveTheme.colors.primarySoft,
  },
  notificationIconInfo: {
    backgroundColor: '#EFF6FF',
  },
  notificationIconWarning: {
    backgroundColor: '#FFF7ED',
  },
  notificationCopy: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
  },
  notificationMessage: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
  },
  notificationTime: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  tripLine: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  bottomNav: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: 'row',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 6,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 12,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: 16,
    position: 'relative',
  },
  bottomNavItemActive: {
    backgroundColor: 'transparent',
  },
  bottomNavBadge: {
    position: 'absolute',
    top: 2,
    right: 14,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bottomNavBadgeText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 9,
  },
  bottomNavLabel: {
    fontFamily: driveType.semibold,
    color: '#94A3B8',
    fontSize: 10,
  },
  bottomNavLabelActive: {
    color: '#16A34A',
  },
});
