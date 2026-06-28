import ErrorBoundary from './components/ErrorBoundary';
import { tryRequire } from './lib/safety';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
    markDriverCommissionPaid,
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
import { auth, db, storage } from './lib/firebase';
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
  { key: 'bodaboda', label: 'Bodaboda / Motorcycle', icon: 'motorbike' },
  { key: 'toyo', label: 'TOYO', icon: 'car-pickup' },
  { key: 'kirikuu', label: 'Kirikuu', icon: 'truck-fast-outline' },
];
const tabs: { key: DriverTab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'view-dashboard-outline' },
  { key: 'trip', label: 'Navigate', icon: 'navigation-variant-outline' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'notifications', label: 'Alerts', icon: 'bell-outline' },
  { key: 'account', label: 'Account', icon: 'account-circle-outline' },
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
const manualCommissionPaymentPhone = '0796904849';
const manualCommissionPaymentMethod = 'DoorDrive legacy access review';
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
    primary: '#0F9D58',
    primaryDark: '#0B5A34',
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
    vehicleColor: '',
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
        placeholderTextColor="#7B8B8D"
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

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTermsAccepted, setLoginTermsAccepted] = useState(false);
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
  const [commissionPayerPhone, setCommissionPayerPhone] = useState('');
  const [commissionTransactionReference, setCommissionTransactionReference] = useState('');
  const sessionAccumulatorRef = useRef<number>(0);
  const knownTripMessageIdsRef = useRef<Set<string>>(new Set());
  const tripMessagesHydratedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const vibratingAssignedOrderRef = useRef<string | null>(null);
  const openedAssignedOrderIdsRef = useRef<Set<string>>(new Set());
  const weeklySubscriptionFeeTzs = 0;

  useEffect(() => {
    const splashTimer = setTimeout(() => setShowStartupSplash(false), 4000);
    return () => clearTimeout(splashTimer);
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
  const subscriptionCycleStartMillis = getDriverSubscriptionBillingCycleStartMillis();
  const subscriptionActive = true;
  const commissionOrders = useMemo(
    () => driverOrders.filter((order) => order.status === 'delivered' && getDeliveredOrderMillis(order) >= subscriptionCycleStartMillis),
    [driverOrders, subscriptionCycleStartMillis]
  );
  const weeklyDeliveredOrderCount = commissionOrders.length;
  const subscriptionPaymentPending = false;
  const commissionDateKey = toTanzaniaDateKey(subscriptionCycleStartMillis);
  const dailyGrossEarnings = commissionOrders.reduce((sum, order) => sum + parseAmountFromLabel(order.totalLabel || order.fareLabel), 0);
  const dailyCommissionDue = 0;
  const hasCommissionDue = false;
  const subscriptionCountdownLabel = hasReadyDriverProfile ? 'Free driver access' : 'Access starts after verification';
  const subscriptionCountdownShortLabel = hasReadyDriverProfile ? 'Free' : 'Pending';
  const subscriptionCountdownCaption = 'DoorDrive is free to use for drivers.';
  const commissionPaymentOverdue = false;
  const subscriptionStatusMessage = 'Free driver access';
  const commissionPaidForDate = false;
  const driverVerificationStatus = driverProfile?.verificationStatus || 'verified';
  const driverVerificationPending = driverVerificationStatus === 'pending_admin_verification';
  const driverVerificationRejected = driverVerificationStatus === 'rejected';
  const driverCanReceiveDispatch = !driverVerificationPending && !driverVerificationRejected;
  const availabilityLabel = activeOrder
    ? 'Busy on active trip'
    : driverVerificationPending
      ? 'Pending admin verification'
      : driverVerificationRejected
        ? 'Verification needs correction'
        : hasCommissionDue
            ? subscriptionPaymentPending ? 'Access pending' : 'Access required'
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
              ? 'Your access update is waiting for admin verification.'
              : 'Driver access is free. Go online to receive new orders.'
            : driverProfile?.isAvailable
              ? 'Admin can assign work to you now. Driver access is free.'
              : 'Admin will not assign new work until you go online. Driver access is free.';
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
          ? 'Admin is reviewing your driver access.'
          : 'DoorDrive is free to use for drivers.',
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
  // Driver access is free; keep the legacy payment state cleared.
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
      setFeedback({ tone: 'error', message: 'Enter your DoorDrive email and password to continue.' });
      return;
    }

    if (!loginTermsAccepted) {
      setFeedback({ tone: 'error', message: 'Accept the DoorDrive terms and conditions before logging in.' });
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
    const passwordMatches =
      registerForm.password.trim().length >= 6 && registerForm.password.trim() === registerForm.confirmPassword.trim();

    if (
      registering ||
      fullName.length < 2 ||
      !/\S+@\S+\.\S+/.test(normalizedEmail) ||
      !normalizedRegisterPhone ||
      !passwordMatches ||
      !vehicleLabel ||
      !registerForm.vehicleColor ||
      !registerForm.plateNumber.trim() ||
      !registerTermsAccepted
    ) {
      setFeedback({
        tone: 'error',
        message: 'Complete profile, vehicle, email, password, phone, color, plate details, and accept the DoorDrive terms.',
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
        vehicleColor: registerForm.vehicleColor.trim(),
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
          : 'Account yako bado inasubiri admin verification.',
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
      setFeedback({ tone: 'info', message: 'Malipo yako tayari yametumwa na yanasubiri admin verification.' });
      return;
    }

    setFeedback(null);
    setCommissionPayerPhone((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
    setPaymentCheckoutStep('proof');
  };

  const handleCopyManualPaymentNumber = async () => {
    try {
      const clipboard = (globalThis as any).navigator?.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(manualCommissionPaymentPhone);
        setFeedback({ tone: 'success', message: `Namba ${manualCommissionPaymentPhone} imecopywa.` });
        return;
      }
    } catch {
      // Fall back to showing the number clearly below.
    }

    Alert.alert('Vodacom M-Pesa number', manualCommissionPaymentPhone);
    setFeedback({ tone: 'info', message: `Copy namba hii: ${manualCommissionPaymentPhone}` });
  };

  const handleMarkPaymentPaid = async () => {
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
      setFeedback({ tone: 'info', message: 'Malipo yako yanasubiri admin verification.' });
      return;
    }

    const normalizedPaymentPhone = normalizePhoneNumber(commissionPayerPhone || driverProfile?.phoneNumber || '');
    const paymentReference = commissionTransactionReference.trim();

    if (!normalizedPaymentPhone) {
      setFeedback({ tone: 'error', message: 'Weka namba iliyotumika kufanya malipo.' });
      return;
    }

    if (paymentReference.length < 4) {
      setFeedback({ tone: 'error', message: 'Weka transaction ID au confirmation code ya M-Pesa.' });
      return;
    }

    setBusyAction('commission-payment');
    setFeedback(null);

    try {
      await markDriverCommissionPaid(authUser.uid, {
        dateKey: commissionDateKey,
        grossAmount: dailyGrossEarnings,
        commissionAmount: dailyCommissionDue,
        orderIds: commissionOrders.map((order) => order.id),
        method: manualCommissionPaymentMethod,
        payerPhone: normalizedPaymentPhone,
        transactionReference: paymentReference,
      });
      trackDriverActivity('driver_subscription_payment_submitted', 'driver_payments', {
        dateKey: commissionDateKey,
        grossAmount: dailyGrossEarnings,
        commissionAmount: dailyCommissionDue,
        subscriptionFee: dailyCommissionDue,
        weeklyDeliveredOrderCount,
        method: manualCommissionPaymentMethod,
      });
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'success', message: 'Uthibitisho umetumwa kwa admin kwa verification.' });
      Alert.alert('Uthibitisho umetumwa', 'Admin atakagua taarifa hii na kufungua access yako.');
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

  const handleAcceptOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
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

  const performDeclineOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
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

    if (registerStep === 'profile') {
      setAuthMode('signin');
      return;
    }

    setRegisterStep((current) => getPreviousSetupStep(current));
  };

  const handleRegisterContinue = () => {
    const normalizedEmail = registerForm.email.trim().toLowerCase();
    const fullName = getRegisterFullName(registerForm);
    const passwordMatches =
      registerForm.password.trim().length >= 6 && registerForm.password.trim() === registerForm.confirmPassword.trim();

    setFeedback(null);

    if (registerStep === 'profile') {
      if (fullName.length < 2 || !/\S+@\S+\.\S+/.test(normalizedEmail) || !normalizedRegisterPhone || !passwordMatches) {
        setFeedback({
          tone: 'error',
          message: 'Add your name, email, phone number, and matching password before continuing.',
        });
        return;
      }

      setRegisterStep((current) => getNextSetupStep(current));
      return;
    }

    if (registerStep === 'vehicle') {
      if (!registerForm.vehicleType || !registerForm.vehicleColor || !registerForm.plateNumber.trim()) {
        setFeedback({
          tone: 'error',
          message: 'Choose vehicle type, color, and enter the plate number before continuing.',
        });
        return;
      }

      if (!registerTermsAccepted) {
        setFeedback({
          tone: 'error',
          message: 'Accept the DoorDrive driver terms and conditions before creating the account.',
        });
        return;
      }

      void handleRegister();
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
    const registerPasswordsMatch =
      registerForm.password.trim().length >= 6 &&
      registerForm.password.trim() === registerForm.confirmPassword.trim();

    const renderRegisterStepContent = () => {
      if (registerStep === 'profile') {
        return (
          <View style={styles.setupFormStack}>
            <SetupField
              value={registerForm.firstName}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, firstName: value }))}
              placeholder="First Name"
            />
            <SetupField
              value={registerForm.lastName}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, lastName: value }))}
              placeholder="Last Name"
            />
            <View style={styles.setupPhoneRow}>
              <View style={styles.setupCountryCode}>
                <Text style={styles.setupFlagText}>TZ</Text>
                <MaterialCommunityIcons name="menu-down" size={24} color="#7B8B8D" />
              </View>
              <View style={styles.setupPhoneInput}>
                <SetupField
                  value={registerForm.phoneNumber}
                  onChangeText={(value) => setRegisterForm((current) => ({ ...current, phoneNumber: value }))}
                  placeholder="+255"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
              </View>
            </View>
            <SetupField
              value={registerForm.email}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, email: value }))}
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <SetupField
              value={registerForm.password}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, password: value }))}
              placeholder="Create password"
              secureTextEntry
              autoCapitalize="none"
            />
            <SetupField
              value={registerForm.confirmPassword}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, confirmPassword: value }))}
              placeholder="Confirm password"
              secureTextEntry
              autoCapitalize="none"
            />
            {!registerPasswordsMatch && registerForm.confirmPassword ? (
              <Text style={styles.setupHintText}>Passwords must match and be at least 6 characters long.</Text>
            ) : null}
          </View>
        );
      }

      if (registerStep === 'vehicle') {
        return (
          <View style={styles.setupFormStack}>
            <View style={styles.setupVehiclePickerWrap}>
              <Text style={styles.setupMiniLabel}>Vehicle type</Text>
              <VehicleTypePicker
                value={registerForm.vehicleType}
                onChange={(vehicleType) => setRegisterForm((current) => ({ ...current, vehicleType }))}
              />
            </View>
            <View style={styles.setupVehiclePickerWrap}>
              <Text style={styles.setupMiniLabel}>Vehicle color</Text>
              <VehicleColorPicker
                value={registerForm.vehicleColor}
                onChange={(vehicleColor) => setRegisterForm((current) => ({ ...current, vehicleColor }))}
              />
            </View>
            <SetupField
              value={registerForm.plateNumber}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, plateNumber: value }))}
              placeholder="Plate number"
              autoCapitalize="characters"
            />
            <View style={styles.termsPanel}>
              <View style={styles.termsPanelHeader}>
                <MaterialCommunityIcons name="file-document-check-outline" size={22} color={driveTheme.colors.primaryDark} />
                <Text style={styles.termsPanelTitle}>Terms & Privacy</Text>
              </View>
              <Text style={styles.termsFinePrint}>
                DoorDrive is free to use for drivers. Please review and accept the legal terms before creating your account.
              </Text>
              <Pressable
                onPress={() => setRegisterTermsAccepted((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: registerTermsAccepted }}
                style={({ pressed }) => [
                  styles.termsAgreeRow,
                  registerTermsAccepted && styles.termsAgreeRowActive,
                  pressed && styles.buttonPressed,
                ]}>
                <View style={[styles.termsCheckbox, registerTermsAccepted && styles.termsCheckboxActive]}>
                  {registerTermsAccepted ? <MaterialCommunityIcons name="check" size={17} color="#FFFFFF" /> : null}
                </View>
                <Text style={styles.termsAgreeText}>
                  I have read and agree to the{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                    Terms & Conditions
                </Text>
                {' '}and{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </Text>
                .
                </Text>
              </Pressable>
            </View>
          </View>
        );
      }

      return (
        <View style={styles.setupFormStack}>
          <View style={styles.setupNotice}>
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={driveTheme.colors.primaryDark} />
            <Text style={styles.setupNoticeText}>
              Your account is ready to submit. Admin will verify your driver details after signup.
            </Text>
          </View>
        </View>
      );
    };

    const registerStepCopy: Record<SetupStep, { title: string; subtitle: string }> = {
      profile: {
        title: 'Create your driver account',
        subtitle: 'Your name, phone, email, and password are enough to start.',
      },
      vehicle: {
        title: 'Add your vehicle',
        subtitle: 'Keep it accurate so dispatch and admin can approve you quickly.',
      },
      documents: {
        title: 'Finish setup',
        subtitle: 'Submit your account so admin can verify the driver details.',
      },
    };

    if (authMode === 'register') {
      const currentStepCopy = registerStepCopy[registerStep];

      return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.authCanvas}>
            <ScrollView contentContainerStyle={styles.registerScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.registerTopBar}>
                <Pressable onPress={handleRegisterBack} style={({ pressed }) => [styles.registerBackButton, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons name="arrow-left" size={22} color={driveTheme.colors.primaryDark} />
                </Pressable>
                <View style={styles.registerBrandLockup}>
                  <View style={styles.registerLogoShell}>
                    <Image source={appLogoImage} style={styles.registerLogoImage} resizeMode="contain" />
                  </View>
                  <Text style={styles.registerBrandName}>DoorDrive</Text>
                </View>
                <View style={styles.registerHeaderSpacer} />
              </View>

              <View style={styles.registerHero}>
                <Text style={styles.authHeadline}>{currentStepCopy.title}</Text>
                <Text style={styles.authSubcopy}>{currentStepCopy.subtitle}</Text>
              </View>

              <SetupProgress activeStep={registerStep} />

              {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

              <View style={styles.authFormPanel}>{renderRegisterStepContent()}</View>
            </ScrollView>

            <View style={styles.registerFooter}>
              <AppButton
                label={
                  registerStep === 'vehicle'
                    ? registering
                      ? 'Creating account...'
                      : 'Create account'
                    : 'Continue'
                }
                icon={registerStep === 'vehicle' ? 'check' : 'arrow-right'}
                onPress={handleRegisterContinue}
                disabled={registering || (registerStep === 'vehicle' && !registerTermsAccepted)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      );
    }

    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.authCanvas}>
          <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.loginBrandHeader}>
              <View style={styles.loginLogoShell}>
                <Image source={appLogoImage} style={styles.loginLogoImage} resizeMode="contain" />
              </View>
              <Text style={styles.loginBrandName}>DoorDrive</Text>
            </View>

            <View style={styles.loginIntro}>
              <Text style={styles.loginTitle}>Welcome Back!</Text>
              <Text style={styles.loginSubtitle}>Ready to receive orders? Log in now.</Text>
            </View>

            {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

            <View style={styles.loginPanel}>
              <Field
                label="Email"
                value={loginEmail}
                onChangeText={setLoginEmail}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Field
                label="Password"
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="Enter your password"
                secureTextEntry
                autoCapitalize="none"
              />
              <Pressable
                onPress={() => setLoginTermsAccepted((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: loginTermsAccepted }}
                style={({ pressed }) => [
                  styles.termsAgreeRow,
                  styles.loginTermsAgreeRow,
                  loginTermsAccepted && styles.termsAgreeRowActive,
                  pressed && styles.buttonPressed,
                ]}>
                <View style={[styles.termsCheckbox, loginTermsAccepted && styles.termsCheckboxActive]}>
                  {loginTermsAccepted ? <MaterialCommunityIcons name="check" size={17} color="#FFFFFF" /> : null}
                </View>
                <Text style={styles.termsAgreeText}>
                  I have read and agree to the{' '}
                  <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                    Terms & Conditions
                  </Text>
                  .
                </Text>
              </Pressable>
              <AppButton
                label={signingIn ? 'Signing in...' : 'Login'}
                onPress={() => void handleSignIn()}
                disabled={signingIn || !loginTermsAccepted}
              />
            </View>

            <Pressable
              onPress={() => {
                setFeedback(null);
                setRegisterStep('profile');
                setRegisterTermsAccepted(false);
                setLoginTermsAccepted(false);
                setAuthMode('register');
              }}
              style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
              <Text style={styles.loginSecondaryActionMuted}>New driver?</Text>
              <Text style={styles.loginSecondaryActionText}>Create account</Text>
            </Pressable>

            <View style={styles.authFooter}>
              <Text style={styles.authFooterText}>
                By continuing you agree to {"DoorDrop's"}{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                  Terms
                </Text>
                {' '}and{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
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
    return (
      <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
        <View style={styles.homeHeader}>
          <View style={styles.homeIdentity}>
            <View style={styles.driverAvatarSmall}>
              <Text style={styles.driverAvatarSmallText}>
                {(driverProfile?.fullName || authUser?.displayName || 'DD')
                  .split(' ')
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </Text>
            </View>
            <View style={styles.homeIdentityText}>
              <Text style={styles.homeGreeting}>Karibu, {driverProfile?.fullName?.split(' ')[0] || 'Driver'}</Text>
              <Text style={styles.homeSubGreeting}>{availabilityLabel}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => setSelectedTab('notifications')}
            style={({ pressed }) => [styles.homeNotificationButton, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="bell-outline" size={22} color={driveTheme.colors.ink} />
            {unreadNotificationCount > 0 ? (
              <View style={styles.notificationDot}>
                <Text style={styles.notificationDotText}>{Math.min(unreadNotificationCount, 9)}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <Pressable
          onPress={() => setSelectedTab(activeOrder ? 'trip' : 'history')}
          style={({ pressed }) => [styles.homeTodayCard, pressed && styles.buttonPressed]}>
          <View style={styles.homeTodayHeader}>
            <View style={styles.homeTodayIcon}>
              <MaterialCommunityIcons name="calendar-check-outline" size={22} color={driveTheme.colors.primaryDark} />
            </View>
            <View style={styles.homeTodayCopy}>
              <Text style={styles.homeTodayKicker}>{"Today's work"}</Text>
              <Text style={styles.homeTodayTitle}>
                {activeOrder ? 'Active trip in progress' : driverProfile?.isAvailable ? 'Online for dispatch' : 'Ready when you go online'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={driveTheme.colors.primaryDark} />
          </View>
          <View style={styles.homeTodayMetricRow}>
            <View style={styles.homeTodayMetric}>
              <Text style={styles.homeTodayMetricValue}>{todayCompletedCount}</Text>
              <Text style={styles.homeTodayMetricLabel}>Delivered</Text>
            </View>
            <View style={styles.homeTodayMetric}>
              <Text style={styles.homeTodayMetricValue}>{todayActiveCount}</Text>
              <Text style={styles.homeTodayMetricLabel}>Active</Text>
            </View>
            <View style={styles.homeTodayMetricWide}>
              <Text style={styles.homeTodayMetricValue}>TZS {todayEarnings.toLocaleString()}</Text>
              <Text style={styles.homeTodayMetricLabel}>Today earnings</Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            setPaymentCheckoutStep('debt');
            setAccountView('payments');
            setSelectedTab('account');
          }}
          style={({ pressed }) => [
            styles.homePaymentCard,
            commissionPaymentOverdue ? styles.homePaymentCardDue : hasCommissionDue ? styles.homePaymentCardPending : styles.homePaymentCardClear,
            pressed && styles.buttonPressed,
          ]}>
          <View style={styles.homePaymentTop}>
            <View style={styles.homePaymentIcon}>
              <MaterialCommunityIcons name={hasCommissionDue ? 'cash-clock' : 'shield-check-outline'} size={21} color="#FFFFFF" />
            </View>
            <View style={styles.homePaymentCopy}>
              <Text style={styles.homePaymentKicker}>DoorDrive access</Text>
              <Text style={styles.homePaymentTitle}>
                {hasCommissionDue
                  ? `${subscriptionPaymentPending ? 'Pending review' : 'Una deni'}: TZS ${weeklySubscriptionFeeTzs.toLocaleString()}`
                  : subscriptionActive
                    ? 'Free driver access'
                    : 'Free to use'}
              </Text>
            </View>
            <View style={styles.homePaymentTimer}>
              <Text style={styles.homePaymentTimerText}>{subscriptionCountdownShortLabel}</Text>
            </View>
          </View>
          <View style={styles.homePaymentMetaRow}>
            <Text style={styles.homePaymentMeta}>{subscriptionCountdownCaption}</Text>
            {hasCommissionDue ? (
              <Text style={styles.homePaymentMeta}>Go online to receive orders</Text>
            ) : subscriptionActive ? (
              <Text style={styles.homePaymentMeta}>Free to use</Text>
            ) : (
              <Text style={styles.homePaymentMeta}>Service access clear</Text>
            )}
            <Text style={styles.homePaymentMeta}>{driverProfile?.isAvailable ? 'Visible to dispatch' : 'Offline from dispatch'}</Text>
          </View>
          <View style={styles.homePaymentButton}>
            <Text style={styles.homePaymentButtonText}>{hasCommissionDue ? 'Open access' : 'View access'}</Text>
            <MaterialCommunityIcons name="arrow-right" size={17} color="#FFFFFF" />
          </View>
        </Pressable>

        <View style={styles.homeMapCard}>
          <View style={styles.homeMapStage}>
            {canRenderMap ? (
              <MapView
                provider={undefined}
                style={styles.homeMapView}
                mapType="standard"
                showsCompass
                showsTraffic={false}
                toolbarEnabled={false}
                showsUserLocation={false}
                loadingEnabled
                initialRegion={{
                  latitude: (pickupPoint.latitude + dropoffPoint.latitude) / 2,
                  longitude: (pickupPoint.longitude + dropoffPoint.longitude) / 2,
                  latitudeDelta: Math.max(Math.abs(pickupPoint.latitude - dropoffPoint.latitude) * 2.3, 0.04),
                  longitudeDelta: Math.max(Math.abs(pickupPoint.longitude - dropoffPoint.longitude) * 2.3, 0.04),
                }}>
                <Marker coordinate={pickupPoint} title="Pickup" description={activeOrder?.pickupLabel || 'Current area'} pinColor="#16A34A" />
                {activeOrder && driverDropoffPoint ? <Marker coordinate={dropoffPoint} title="Drop-off" description={driverDropoffLabel} pinColor="#EA580C" /> : null}
                {activeOrder && driverDropoffPoint ? <Polyline coordinates={[pickupPoint, dropoffPoint]} strokeColor="#991B1B" strokeWidth={4} /> : null}
              </MapView>
            ) : (
              <View style={styles.homeMapFallback}>
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
            <View style={styles.homeMapTopBadge}>
              <MaterialCommunityIcons name="navigation-variant-outline" size={15} color="#FFFFFF" />
              <Text style={styles.homeMapTopBadgeText}>Navigate</Text>
            </View>
          </View>

          <View style={styles.homeOrderPanel}>
            {activeOrder ? (
              <>
                <Text style={styles.homeOrderEyebrow}>Pokea kutoka kwa</Text>
                <Text style={styles.homeOrderTitle}>{activeOrder.pickupLabel}</Text>
                <Text style={styles.homeOrderSubtitle}>{driverDropoffLabel}</Text>
                <View style={styles.homeActionRow}>
                  <Pressable onPress={() => void handleOpenNavigation()} style={({ pressed }) => [styles.homePrimaryMiniButton, pressed && styles.buttonPressed]}>
                    <MaterialCommunityIcons name="directions" size={18} color="#FFFFFF" />
                    <Text style={styles.homePrimaryMiniButtonText}>Ramani</Text>
                  </Pressable>
                  <Pressable onPress={() => void handleCallCustomer()} style={({ pressed }) => [styles.homeSecondaryMiniButton, pressed && styles.buttonPressed]}>
                    <MaterialCommunityIcons name="phone-outline" size={18} color={driveTheme.colors.primaryDark} />
                    <Text style={styles.homeSecondaryMiniButtonText}>Piga Simu</Text>
                  </Pressable>
                </View>
                <View style={styles.homeOrderDivider} />
                <Text style={styles.homeOrderDetail}>Namba ya oda: {activeOrder.orderNumber}</Text>
                <Text style={styles.homeOrderDetail}>Status: {getDeliveryOrderStatusLabel(activeOrder.status)}</Text>
                <Text style={styles.homeOrderDetail}>Malipo: {activeOrder.totalLabel}</Text>
                {activeOrder.status === 'driver_assigned' && !activeOrder.acceptedByDriverAt ? (
                  <View style={styles.homePanelButtonGrid}>
                    <AppButton
                      label={busyAction === 'accept-order' ? 'Accepting...' : 'Accept'}
                      icon="check-circle-outline"
                      onPress={() => void handleAcceptOrder()}
                      disabled={busyAction === 'accept-order'}
                    />
                    <AppButton
                      label="Reject"
                      icon="close-circle-outline"
                      variant="dark"
                      onPress={handleDeclineOrder}
                      disabled={busyAction === 'decline-order'}
                    />
                  </View>
                ) : (
                  <View style={styles.homePanelButtonGrid}>
                    <AppButton label="Fungua safari" icon="chevron-right" onPress={() => setSelectedTab('trip')} />
                    <AppButton
                      label={busyAction === 'trip-cancelled' ? 'Cancelling...' : 'Cancel'}
                      icon="close-circle-outline"
                      variant="dark"
                      onPress={handleCancelActiveTrip}
                      disabled={busyAction === 'trip-cancelled'}
                    />
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.homeOrderEyebrow}>DoorDrop dispatch</Text>
                <Text style={styles.homeOrderTitle}>Waiting for your next order</Text>
                <Text style={styles.homeOrderSubtitle}>{availabilityNote}</Text>
                <AppButton
                  label={
                    busyAction === 'availability'
                      ? 'Updating...'
                      : driverProfile?.isAvailable
                        ? 'Go offline'
                        : 'Go online'
                  }
                  icon={driverProfile?.isAvailable ? 'pause-circle-outline' : 'check-circle-outline'}
                  onPress={() => void handleToggleAvailability()}
                  disabled={busyAction === 'availability'}
                />
              </>
            )}
          </View>
        </View>

      </ScrollView>
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
            <Text style={styles.emptyTitle}>No active trip right now</Text>
            <Text style={styles.emptyText}>Wait for dispatch to assign an order and your live trip controls will appear here.</Text>
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
                <Text style={styles.heroKicker}>Active delivery</Text>
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
                <Text style={styles.tripSheetTitle}>Trip route</Text>
                <Text style={styles.tripSheetSubtitle}>Navigation stops for this active job.</Text>
                <View style={styles.stackMd}>
                  <TripStopRow tone="pickup" title="Pickup" label={activeOrder.pickupLabel} />
                  <TripStopRow tone="dropoff" title="Drop-off" label={driverDropoffLabel} />
                  <View style={styles.tripDivider} />
                  <Text style={styles.tripLine}>Recipient: {activeOrder.recipientName} • {activeOrder.recipientPhone}</Text>
                  <Text style={styles.tripLine}>Customer: {activeOrder.customerName} • {activeOrder.customerPhone || activeOrder.customerEmail}</Text>
                  <Text style={styles.tripLine}>Created: {formatDeliveryDateTime(activeOrder.createdAt)}</Text>
                </View>
              </View>

              <View style={styles.tripSheetCard}>
                <Text style={styles.tripSheetTitle}>Customer chat</Text>
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
                    placeholder="Message the customer"
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
                    <Text style={styles.tripMessageSendText}>{tripMessageSending ? 'Sending...' : 'Send'}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.tripActionSheet}>
                {activeOrder.status === 'driver_assigned' && !activeOrder.acceptedByDriverAt ? (
                  <AppButton
                    label={busyAction === 'accept-order' ? 'Accepting order...' : 'Accept order'}
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
                    label="Open navigation"
                    icon="navigation-variant-outline"
                    variant="secondary"
                    onPress={() => void handleOpenNavigation()}
                  />
                  <AppButton
                    label="Call customer"
                    icon="phone-outline"
                    variant="secondary"
                    onPress={() => void handleCallCustomer()}
                  />
                </View>
                <View style={styles.tripActionGrid}>
                  <AppButton
                    label={busyAction === 'location-refresh' ? 'Refreshing location...' : 'Refresh live location'}
                    icon="crosshairs-gps"
                    variant="secondary"
                    onPress={() => void handleManualLocationRefresh()}
                    disabled={busyAction === 'location-refresh'}
                  />
                  {activeOrder.status === 'driver_assigned' ? (
                    <AppButton
                      label={busyAction === 'decline-order' ? 'Rejecting...' : 'Reject order'}
                      icon="close-circle-outline"
                      variant="dark"
                      onPress={handleDeclineOrder}
                      disabled={busyAction === 'decline-order'}
                    />
                  ) : (
                    <AppButton
                      label={busyAction === 'trip-cancelled' ? 'Cancelling...' : 'Cancel active trip'}
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

      <View style={styles.heroCard}>
        <Text style={styles.heroKicker}>Delivery history</Text>
        <Text style={styles.heroTitle}>{driverOrders.length} driver jobs</Text>
        <Text style={styles.heroText}>Review assigned trips, delivery status, earnings, and completed work from this driver account.</Text>
      </View>

      <View style={styles.metricTileRow}>
        <MetricTile icon="check-decagram-outline" value={String(driverOrders.filter((order) => order.status === 'delivered').length)} label="delivered" />
        <MetricTile icon="truck-delivery-outline" value={String(driverOrders.filter((order) => isActiveOrderStatus(order.status)).length)} label="active" />
        <MetricTile icon="cash-multiple" value={`TZS ${totalEarnings.toLocaleString()}`} label="earnings" />
      </View>

      {pendingCustomerRatingOrder ? (
        <SectionCard
          title="Rate customer"
          subtitle={`Delivery ${pendingCustomerRatingOrder.orderNumber} is complete. Rate the customer before moving on.`}>
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
              label={customerRatingSaving ? 'Saving rating...' : 'Save customer rating'}
              icon="star-check-outline"
              onPress={() => void handleRateCustomer()}
              disabled={customerRatingSaving}
            />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Trip records" subtitle="Orders assigned to this driver from DoorDrop dispatch.">
        <View style={styles.stackMd}>
          {driverOrdersLoading ? <ActivityIndicator color={driveTheme.colors.primary} /> : null}

          {!driverOrdersLoading && !driverOrders.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No delivery history yet</Text>
              <Text style={styles.emptyText}>Trips assigned by dispatch will appear here after you complete your first job.</Text>
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

      <View style={styles.heroCard}>
        <Text style={styles.heroKicker}>Notifications</Text>
        <Text style={styles.heroTitle}>{notificationItems.length ? `${notificationItems.length} live alerts` : 'All clear'}</Text>
        <Text style={styles.heroText}>Trip messages, payment reminders, location notices, and dispatch status updates appear here.</Text>
      </View>

      <SectionCard title="Notification center" subtitle="Pulled from your active trip, messages, payment state, and tracking status.">
        <View style={styles.stackMd}>
          {!notificationItems.length ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="bell-check-outline" size={28} color={driveTheme.colors.primary} />
              <Text style={styles.emptyTitle}>No notifications right now</Text>
              <Text style={styles.emptyText}>You will see dispatch, trip, and customer updates here.</Text>
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
    const paymentStatusLabel = commissionPaidForDate
      ? 'Pending admin'
      : hasCommissionDue
        ? commissionPaymentOverdue
          ? 'Pay now'
          : subscriptionStatusMessage
        : subscriptionActive
          ? 'Active'
          : 'Clear';
    const paymentStatusIcon: IconName = commissionPaidForDate
      ? 'check-decagram-outline'
      : hasCommissionDue
        ? commissionPaymentOverdue
          ? 'clock-alert-outline'
          : 'clock-outline'
        : subscriptionActive
          ? 'check-circle-outline'
          : 'gift-outline';
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
            <Text style={styles.paymentPageTitle}>Free access</Text>
          </View>
        </View>

        <View style={[styles.paymentDebtCard, commissionPaymentOverdue && styles.paymentDebtCardDue]}>
          <View style={styles.paymentDebtTop}>
            <View style={styles.paymentDebtIcon}>
              <MaterialCommunityIcons name={hasCommissionDue ? 'cash-clock' : 'shield-check-outline'} size={24} color="#FFFFFF" />
            </View>
            <View style={styles.paymentDebtCopy}>
              <Text style={styles.paymentDebtLabel}>DoorDrive access</Text>
              <Text style={styles.paymentDebtAmount}>Free for drivers</Text>
              <Text style={styles.paymentDebtMeta}>
                {hasCommissionDue
                  ? 'Una deni. Hautaweza kupokea oda mpya mpaka ulipie.'
                  : subscriptionActive
                    ? 'Driver access is active.'
                    : 'Driver access iko clear kwa sasa.'}
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
              <Text style={styles.subscriptionFeatureText}>Free app access for DoorDrive driver tools</Text>
            </View>
            <View style={styles.subscriptionFeatureRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={driveTheme.colors.primaryDark} />
              <Text style={styles.subscriptionFeatureText}>Dispatch visibility without access payments</Text>
            </View>
            <View style={styles.subscriptionFeatureRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={driveTheme.colors.primaryDark} />
              <Text style={styles.subscriptionFeatureText}>Trip management, navigation, and payment review support</Text>
            </View>
          </View>

          {hasCommissionDue ? (
            <AppButton
              label={subscriptionPaymentPending ? 'Waiting for admin' : paymentCheckoutStep === 'debt' ? 'Open access' : paymentCheckoutStep === 'submitted' ? 'Edit details' : 'Continue'}
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
                    ? 'Driver access iko active na dereva anaweza kupokea oda.'
                    : 'Hakuna malipo yanayohitajika sasa hivi.'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {paymentCheckoutStep === 'proof' && hasCommissionDue ? (
          <View style={styles.paymentCheckoutPanel}>
            <View style={styles.paymentChosenNetwork}>
              <View style={[styles.paymentProviderIcon, { backgroundColor: '#16A34A' }]}>
                <MaterialCommunityIcons name="cellphone-check" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.paymentChosenCopy}>
                <Text style={styles.paymentCheckoutTitle}>Vodacom M-Pesa</Text>
                <Text style={styles.paymentChosenMeta}>Driver access is free</Text>
              </View>
            </View>

            <View style={styles.manualPaymentNumberCard}>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Namba ya kulipia</Text>
                <Text selectable style={styles.manualPaymentNumber}>{manualCommissionPaymentPhone}</Text>
              </View>
              <Pressable onPress={() => void handleCopyManualPaymentNumber()} style={({ pressed }) => [styles.manualPaymentCopyButton, pressed && styles.buttonPressed]}>
                <MaterialCommunityIcons name="content-copy" size={17} color="#FFFFFF" />
                <Text style={styles.manualPaymentCopyText}>Copy number</Text>
              </Pressable>
            </View>

            <Text style={styles.paymentPushText}>
              DoorDrive driver access is free. This panel is kept only for legacy access review records.
            </Text>

            <View style={styles.paymentInputGroup}>
              <Text style={styles.paymentInputLabel}>Namba iliyotumika kulipa</Text>
              <TextInput
                value={commissionPayerPhone}
                onChangeText={setCommissionPayerPhone}
                keyboardType="phone-pad"
                placeholder={driverProfile?.phoneNumber || '07XX XXX XXX'}
                placeholderTextColor="#94A3B8"
                style={styles.paymentInput}
              />
            </View>

            <View style={styles.paymentInputGroup}>
              <Text style={styles.paymentInputLabel}>Transaction ID</Text>
              <TextInput
                value={commissionTransactionReference}
                onChangeText={setCommissionTransactionReference}
                autoCapitalize="characters"
                placeholder="Mfano: QAB12CDE34"
                placeholderTextColor="#94A3B8"
                style={styles.paymentInput}
              />
            </View>

            <AppButton
              label={busyAction === 'commission-payment' ? 'Sending proof...' : 'Send proof to admin'}
              icon="send-check-outline"
              onPress={() => void handleMarkPaymentPaid()}
              disabled={busyAction === 'commission-payment'}
            />
          </View>
        ) : null}

        {paymentCheckoutStep === 'submitted' && hasCommissionDue ? (
          <View style={styles.paymentCheckoutPanel}>
            <View style={styles.paymentPushIcon}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={30} color={driveTheme.colors.primaryDark} />
            </View>
            <Text style={styles.paymentPushTitle}>Inasubiri admin</Text>
            <Text style={styles.paymentPushText}>
              Taarifa zimetumwa. Dereva atafunguliwa baada ya admin kuthibitisha access.
            </Text>
            <View style={styles.paymentReferenceBox}>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Paid to</Text>
                <Text style={styles.paymentReferenceValue}>{manualCommissionPaymentPhone}</Text>
              </View>
              <View style={styles.paymentReferenceItem}>
                <Text style={styles.paymentReferenceLabel}>Transaction ID</Text>
                <Text style={styles.paymentReferenceValue}>{commissionTransactionReference || 'Submitted'}</Text>
              </View>
            </View>
            <AppButton
              label="Edit proof"
              icon="pencil-outline"
              variant="secondary"
              onPress={() => setPaymentCheckoutStep('proof')}
            />
          </View>
        ) : null}
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
    const paymentStatusLabel = commissionPaidForDate
      ? 'Pending admin'
      : hasCommissionDue
          ? commissionPaymentOverdue
            ? 'Pay now'
            : subscriptionStatusMessage
        : subscriptionActive
          ? 'Active'
          : 'Clear';
    const paymentStatusIcon: IconName = commissionPaidForDate
      ? 'check-decagram-outline'
      : hasCommissionDue
          ? commissionPaymentOverdue
            ? 'clock-alert-outline'
            : 'clock-outline'
        : subscriptionActive
          ? 'check-circle-outline'
          : 'gift-outline';
    const paymentStatusColor = commissionPaymentOverdue ? '#92400E' : hasCommissionDue ? driveTheme.colors.info : driveTheme.colors.primaryDark;

    return (
      <ScrollView contentContainerStyle={styles.dashboardContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.accountHeaderCard}>
          <View style={styles.accountAvatar}>
            <Text style={styles.accountAvatarText}>{driverInitials || 'DD'}</Text>
          </View>
          <View style={styles.accountHeaderCopy}>
            <Text style={styles.accountHeaderKicker}>Driver account</Text>
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
              {driverProfile?.isAvailable ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        <View style={styles.accountQuickGrid}>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="history" size={18} color={driveTheme.colors.info} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>{driverOrders.length}</Text>
            <Text style={styles.accountQuickLabel}>Jobs</Text>
          </View>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="access-point" size={18} color={driveTheme.colors.primaryDark} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>{driverProfile?.isAvailable ? 'Online' : 'Off'}</Text>
            <Text style={styles.accountQuickLabel}>Dispatch</Text>
          </View>
          <View style={styles.accountQuickItem}>
            <MaterialCommunityIcons name="cash-multiple" size={18} color={driveTheme.colors.warning} />
            <Text numberOfLines={1} style={styles.accountQuickValue}>TZS {totalEarnings.toLocaleString()}</Text>
            <Text style={styles.accountQuickLabel}>Earned</Text>
          </View>
        </View>

        <SectionCard title="Profile" subtitle="Dispatch identity and vehicle details.">
          <View style={styles.accountInfoList}>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="cellphone" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>Phone number</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.phoneNumber || 'Not set'}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="car" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>Vehicle</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.vehicleLabel || getVehicleTypeLabel(driverProfile?.vehicleType)}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="card-account-details-outline" size={20} color={driveTheme.colors.primaryDark} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>Plate number</Text>
                <Text style={styles.accountInfoValue}>{driverProfile?.plateNumber || 'Not set'}</Text>
              </View>
            </View>
            <View style={styles.accountInfoRow}>
              <MaterialCommunityIcons name="map-marker-outline" size={20} color={locationPermission === 'granted' ? driveTheme.colors.primaryDark : driveTheme.colors.warning} />
              <View style={styles.accountInfoCopy}>
                <Text style={styles.accountInfoLabel}>Live location</Text>
                <Text style={styles.accountInfoValue}>{locationPermission === 'granted' ? 'Active' : 'Needs access'}</Text>
              </View>
            </View>
          </View>
        </SectionCard>

        <SectionCard title="Driver access" subtitle="Free access for dispatch work.">
          <View style={styles.stackMd}>
            <View style={styles.paymentSummaryBand}>
              <View style={styles.paymentSummaryMain}>
                <Text style={styles.paymentHeroLabel}>DoorDrive access</Text>
                <Text style={styles.paymentHeroAmount}>Free</Text>
                <Text style={styles.paymentSummaryCaption}>
                  {hasCommissionDue
                    ? 'Una deni. Hautaweza kupokea oda mpya mpaka ulipie.'
                    : subscriptionActive
                      ? 'Driver access iko active.'
                      : 'Driver access iko clear.'}
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

	            <AppButton
	              label={hasCommissionDue ? 'Open access' : 'View access'}
	              icon={hasCommissionDue ? 'cash-fast' : subscriptionActive ? 'shield-check-outline' : 'gift-outline'}
              onPress={() => {
                setPaymentCheckoutStep('debt');
                setAccountView('payments');
              }}
            />
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
              label={busyAction === 'availability' ? 'Updating availability...' : driverProfile?.isAvailable ? 'Pause dispatch visibility' : 'Go visible to dispatch'}
              icon={driverProfile?.isAvailable ? 'pause-circle-outline' : 'check-circle-outline'}
              variant="secondary"
              onPress={() => void handleToggleAvailability()}
              disabled={!!activeOrder || busyAction === 'availability'}
            />
            <AppButton
              label={busyAction === 'location-refresh' ? 'Refreshing location...' : 'Refresh live location'}
              icon="crosshairs-gps"
              variant="secondary"
              onPress={() => void handleManualLocationRefresh()}
              disabled={busyAction === 'location-refresh'}
            />
            <AppButton
              label={busyAction === 'sign-out' ? 'Signing out...' : 'Sign out'}
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
    return (
      <ErrorBoundary>
        <SafeAreaView style={styles.splashSafeArea}>
          <StatusBar style="light" backgroundColor={driveTheme.colors.primary} />
          <View style={styles.splashScreen}>
            <View style={styles.splashLogoShell}>
              <Image source={appLogoImage} style={styles.splashLogo} resizeMode="contain" />
            </View>
            <Text style={styles.splashTitle}>DoorDrive</Text>
            <Text style={styles.splashSubtitle}>
              {authInitializing && !showStartupSplash ? 'Connecting securely...' : 'Driver dispatch is loading...'}
            </Text>
            <View style={styles.splashProgressTrack}>
              <View style={styles.splashProgressFill} />
            </View>
          </View>
        </SafeAreaView>
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
          {selectedTab === 'home' ? renderHomeTab() : null}
          {selectedTab === 'trip' ? renderTripTab() : null}
          {selectedTab === 'history' ? renderHistoryTab() : null}
          {selectedTab === 'notifications' ? renderNotificationsTab() : null}
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
                    color={active ? driveTheme.colors.primaryDark : '#94A3B8'}
                  />
                  {tab.key === 'notifications' && unreadNotificationCount > 0 ? (
                    <View style={styles.bottomNavBadge}>
                      <Text style={styles.bottomNavBadgeText}>{Math.min(unreadNotificationCount, 9)}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{tab.label}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: driveTheme.colors.primary,
  },
  splashLogoShell: {
    width: 132,
    height: 132,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#064E3B',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  splashLogo: {
    width: 96,
    height: 96,
  },
  splashTitle: {
    marginTop: 24,
    color: '#FFFFFF',
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
  },
  splashSubtitle: {
    marginTop: 8,
    color: '#DCFCE7',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  splashProgressTrack: {
    width: 164,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginTop: 24,
    overflow: 'hidden',
  },
  splashProgressFill: {
    width: '72%',
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
    backgroundColor: '#F7FCF8',
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
  },
  loginSecondaryActionText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    fontWeight: '900',
  },
  loginSecondaryActionMuted: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    fontWeight: '700',
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
    minHeight: 56,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  setupTextInput: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    fontWeight: '700',
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
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 110,
    gap: 14,
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
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 54,
  },
  homeIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverAvatarSmall: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarSmallText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  homeIdentityText: {
    flex: 1,
  },
  homeGreeting: {
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },
  homeSubGreeting: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  homeNotificationButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: driveTheme.colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationDotText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  homeTodayCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 13,
  },
  homeTodayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  homeTodayIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: '#E9FBEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeTodayCopy: {
    flex: 1,
    minWidth: 0,
  },
  homeTodayKicker: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeTodayTitle: {
    color: driveTheme.colors.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  homeTodayMetricRow: {
    flexDirection: 'row',
    gap: 8,
  },
  homeTodayMetric: {
    flex: 0.82,
    minHeight: 70,
    borderRadius: 16,
    backgroundColor: '#F7FCF8',
    borderWidth: 1,
    borderColor: '#D8EFE0',
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  homeTodayMetricWide: {
    flex: 1.36,
    minHeight: 70,
    borderRadius: 16,
    backgroundColor: '#F7FCF8',
    borderWidth: 1,
    borderColor: '#D8EFE0',
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  homeTodayMetricValue: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  homeTodayMetricLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  homePaymentCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  homePaymentCardDue: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  homePaymentCardPending: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  homePaymentCardClear: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  homePaymentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  homePaymentIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homePaymentCopy: {
    flex: 1,
  },
  homePaymentKicker: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homePaymentTitle: {
    color: driveTheme.colors.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  homePaymentTimer: {
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  homePaymentTimerText: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  homePaymentMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  homePaymentMeta: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.72)',
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  homePaymentButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: driveTheme.colors.dark,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  homePaymentButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  homeMapCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 28,
    elevation: 4,
  },
  homeMapStage: {
    height: 250,
    backgroundColor: '#E8F1EC',
    overflow: 'hidden',
  },
  homeMapView: {
    width: '100%',
    height: '100%',
  },
  homeMapFallback: {
    flex: 1,
    backgroundColor: '#E8F1EC',
    overflow: 'hidden',
  },
  homeMapGridLineA: {
    position: 'absolute',
    width: 460,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.36)',
    top: 112,
    left: -70,
    transform: [{ rotate: '-22deg' }],
  },
  homeMapGridLineB: {
    position: 'absolute',
    width: 430,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.28)',
    top: 210,
    left: -40,
    transform: [{ rotate: '28deg' }],
  },
  homeMapRoutePreview: {
    position: 'absolute',
    width: 250,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#991B1B',
    top: 155,
    left: 54,
    transform: [{ rotate: '16deg' }],
  },
  homeMapPin: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  homeMapPinPickup: {
    top: 128,
    left: 44,
    backgroundColor: driveTheme.colors.primary,
  },
  homeMapPinDropoff: {
    top: 178,
    right: 48,
    backgroundColor: driveTheme.colors.warning,
  },
  homeMapVehicle: {
    position: 'absolute',
    top: 146,
    left: '52%',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#B91C1C',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-18deg' }],
  },
  homeMapTopBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  homeMapTopBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  homeOrderPanel: {
    marginTop: -20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 10,
  },
  homeOrderEyebrow: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  homeOrderTitle: {
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },
  homeOrderSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  homeActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  homePanelButtonGrid: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'stretch',
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
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#991B1B',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  homePrimaryMiniButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  homeSecondaryMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  homeSecondaryMiniButtonText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    fontWeight: '900',
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
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
  },
  metricTileLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  cardSubtitle: {
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
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonTextSecondary: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    fontWeight: '800',
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
    minHeight: 98,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  paymentProviderIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
  },
  accountHeaderMeta: {
    color: '#D7E1EA',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  accountInfoValue: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
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
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
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
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  historyMeta: {
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
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  notificationMessage: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
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
    left: 18,
    right: 18,
    bottom: 18,
    flexDirection: 'row',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 4,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 18,
    position: 'relative',
  },
  bottomNavItemActive: {
    backgroundColor: driveTheme.colors.primarySoft,
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
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  bottomNavLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  bottomNavLabelActive: {
    color: driveTheme.colors.primaryDark,
  },
});
