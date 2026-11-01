import { Linking, NativeModules, Platform } from 'react-native';

import { getDoorDropApiBaseUrl } from '@/lib/api-config';
import { auth } from '@/lib/firebase';

export const NINUNULIE_MAX_PHOTOS = 4;

export type PickedOrderImage = {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  mimeType?: string | null;
};

type PermissionResult = {
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
  accessPrivileges?: 'all' | 'limited' | 'none';
};

type ImagePickerModule = {
  getMediaLibraryPermissionsAsync: () => Promise<PermissionResult>;
  requestMediaLibraryPermissionsAsync: () => Promise<PermissionResult>;
  getCameraPermissionsAsync: () => Promise<PermissionResult>;
  requestCameraPermissionsAsync: () => Promise<PermissionResult>;
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: Array<{
      uri: string;
      width?: number;
      height?: number;
      fileName?: string | null;
      mimeType?: string | null;
    }>;
  }>;
  launchCameraAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: Array<{
      uri: string;
      width?: number;
      height?: number;
      fileName?: string | null;
      mimeType?: string | null;
    }>;
  }>;
};

const PICKER_UNAVAILABLE =
  'Gallery inahitaji AAB/APK mpya ya DoorDrop yenye image picker. Endelea bila picha kwa sasa.';

let cachedPicker: ImagePickerModule | null | undefined;
let pickerProbeDone = false;

/**
 * Android gallery picks use the system Photo Picker / content intent.
 * Do not request READ_MEDIA_* — Play rejects undeclared broad photo permissions.
 */
function canUseAndroidSystemPhotoPicker() {
  return Platform.OS === 'android';
}

/**
 * Expo Modules (SDK 50+) register via expo-modules-core, NOT classic NativeModules.
 * Checking NativeModules.ExponentImagePicker falsely reports "missing" on every modern build.
 */
function resolveImagePickerModule(): ImagePickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    if (typeof requireOptionalNativeModule === 'function') {
      const native = requireOptionalNativeModule('ExponentImagePicker') as
        | ImagePickerModule
        | null
        | undefined;
      if (native && typeof native.launchImageLibraryAsync === 'function') {
        // Prefer the JS wrapper so options mapping / validation stay consistent.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-image-picker') as ImagePickerModule;
      }
    }
  } catch {
    // Fall through to JS require / classic NativeModules.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-image-picker') as ImagePickerModule;
    if (mod && typeof mod.launchImageLibraryAsync === 'function') {
      return mod;
    }
  } catch {
    // Continue.
  }

  const modules = NativeModules as Record<string, unknown>;
  const classic = (modules.ExponentImagePicker ||
    modules.ExpoImagePicker ||
    modules.ImagePicker) as ImagePickerModule | undefined;
  if (classic && typeof classic.launchImageLibraryAsync === 'function') {
    return classic;
  }
  return null;
}

function getImagePicker(): ImagePickerModule {
  if (cachedPicker === null) {
    throw new Error(PICKER_UNAVAILABLE);
  }
  if (cachedPicker) {
    return cachedPicker;
  }
  const resolved = resolveImagePickerModule();
  if (!resolved) {
    cachedPicker = null;
    throw new Error(PICKER_UNAVAILABLE);
  }
  cachedPicker = resolved;
  return cachedPicker;
}

export function isImagePickerAvailable() {
  if (cachedPicker === null && pickerProbeDone) return false;
  try {
    getImagePicker();
    pickerProbeDone = true;
    return true;
  } catch {
    pickerProbeDone = true;
    return false;
  }
}

function isPermissionUsable(result: PermissionResult | null | undefined) {
  if (!result) return false;
  if (result.granted) return true;
  if (result.accessPrivileges === 'all' || result.accessPrivileges === 'limited') return true;
  return false;
}

export async function openAppSettings() {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

async function ensureMediaLibraryPermission() {
  if (canUseAndroidSystemPhotoPicker()) {
    return { granted: true, viaSystemPicker: true as const };
  }

  const ImagePicker = getImagePicker();
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (isPermissionUsable(current)) {
    return { granted: true, viaSystemPicker: false as const, permission: current };
  }

  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (isPermissionUsable(requested)) {
    return { granted: true, viaSystemPicker: false as const, permission: requested };
  }

  return {
    granted: false,
    viaSystemPicker: false as const,
    permission: requested,
    canAskAgain: requested.canAskAgain !== false,
  };
}

async function ensureCameraPermission() {
  const ImagePicker = getImagePicker();
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (isPermissionUsable(current)) return { granted: true as const, permission: current };

  const requested = await ImagePicker.requestCameraPermissionsAsync();
  if (isPermissionUsable(requested)) return { granted: true as const, permission: requested };

  return {
    granted: false as const,
    permission: requested,
    canAskAgain: requested.canAskAgain !== false,
  };
}

export async function pickOrderImageFromLibrary(options?: {
  selectionLimit?: number;
}): Promise<PickedOrderImage[]> {
  const ImagePicker = getImagePicker();
  const access = await ensureMediaLibraryPermission();

  if (!access.granted && !access.viaSystemPicker) {
    if (access.canAskAgain === false) {
      throw new Error(
        'Ruhusa ya picha imezimwa. Fungua Settings → DoorDrop → Permissions → Photos/Files, kisha ruhusu.'
      );
    }
    throw new Error('Ruhusu ufikiaji wa picha ili uambatanishe screenshot kutoka gallery.');
  }

  const selectionLimit = Math.max(1, Math.min(NINUNULIE_MAX_PHOTOS, options?.selectionLimit ?? 1));

  let result: Awaited<ReturnType<ImagePickerModule['launchImageLibraryAsync']>>;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
      allowsMultipleSelection: selectionLimit > 1,
      selectionLimit,
      exif: false,
      preferredAssetRepresentationMode: 'compatible',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/permission|denied|access/i.test(message)) {
      throw new Error('Ruhusu gallery kwenye Settings ili kuchagua picha.');
    }
    throw new Error(message || 'Imeshindikana kufungua gallery.');
  }

  if (result.canceled || !result.assets?.length) return [];

  return result.assets.slice(0, selectionLimit).map((asset) => ({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
  }));
}

export async function pickOrderImageFromCamera(): Promise<PickedOrderImage | null> {
  const ImagePicker = getImagePicker();
  const access = await ensureCameraPermission();
  if (!access.granted) {
    if (access.canAskAgain === false) {
      throw new Error('Ruhusa ya kamera imezimwa. Fungua Settings → DoorDrop → Camera.');
    }
    throw new Error('Ruhusu kamera ili upige picha.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
  };
}

async function tryOpenUrl(url: string) {
  try {
    if (!(await Linking.canOpenURL(url))) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function openInstagramForScreenshot() {
  for (const url of ['instagram://app', 'https://www.instagram.com/']) {
    if (await tryOpenUrl(url)) return true;
  }
  return false;
}

export async function openWhatsAppForScreenshot() {
  for (const url of ['whatsapp://app', 'https://wa.me/']) {
    if (await tryOpenUrl(url)) return true;
  }
  return false;
}

async function compressImageUri(localUri: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manipulator = require('expo-image-manipulator') as {
      manipulateAsync: (
        uri: string,
        actions: Array<{ resize: { width: number } }>,
        options: { compress: number; format: unknown }
      ) => Promise<{ uri: string }>;
      SaveFormat: { JPEG: unknown };
    };
    const compressed = await manipulator.manipulateAsync(
      localUri,
      [{ resize: { width: 1280 } }],
      { compress: 0.72, format: manipulator.SaveFormat.JPEG }
    );
    return compressed.uri;
  } catch {
    return localUri;
  }
}

async function readUriAsBase64(localUri: string) {
  const uri = String(localUri || '').trim();
  if (!uri) throw new Error('Imeshindikana kusoma picha.');

  const readLegacy = async () => {
    // Expo SDK 54+: main package throws on readAsStringAsync; use /legacy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const LegacyFileSystem = require('expo-file-system/legacy') as {
      readAsStringAsync: (fileUri: string, options: { encoding: string }) => Promise<string>;
      EncodingType?: { Base64: string };
    };
    const encoding = LegacyFileSystem.EncodingType?.Base64 || 'base64';
    return LegacyFileSystem.readAsStringAsync(uri, { encoding });
  };

  // content:// / ph:// need the legacy SAF-aware reader.
  if (/^(content|ph|assets-library):/i.test(uri)) {
    return readLegacy();
  }

  try {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    if (typeof file.base64 === 'function') {
      const encoded = await file.base64();
      if (encoded) return encoded;
    }
  } catch {
    // Fall through.
  }

  return readLegacy();
}

function base64ToUint8Array(base64: string) {
  const binary =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Upload Ninunulie photos via authenticated Firebase Storage (client SDK).
 * Backend /media/ninunulie is kept as a fallback when Storage rules/IAM allow it.
 */
export async function uploadNinunuliePhoto(params: {
  userId: string;
  localUri: string;
  orderKey?: string;
}) {
  const userId = String(params.userId || '').trim();
  if (!userId) throw new Error('Ingia akaunti kabla ya kupakia picha.');

  const currentUser = auth.currentUser;
  if (!currentUser?.uid || currentUser.uid !== userId) {
    throw new Error('Ingia akaunti kabla ya kupakia picha.');
  }

  const uploadUri = await compressImageUri(params.localUri);
  const imageBase64 = await readUriAsBase64(uploadUri);
  if (!imageBase64) {
    throw new Error('Imeshindikana kusoma picha.');
  }

  const orderKey = String(params.orderKey || `draft-${Date.now()}`)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storagePath = `ninunulie/${userId}/${orderKey || `draft-${Date.now()}`}/${fileName}`;

  // Prefer backend upload (Cloud Run runtime SA → GCS media bucket).
  const idToken = await currentUser.getIdToken();
  const apiBase = getDoorDropApiBaseUrl().replace(/\/+$/, '');
  let apiError = '';
  if (apiBase) {
    const response = await fetch(`${apiBase}/media/ninunulie`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        imageBase64,
        contentType: 'image/jpeg',
        orderKey: orderKey || `draft-${Date.now()}`,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      downloadURL?: string;
      storagePath?: string;
      error?: string;
    };
    if (response.ok && payload.downloadURL) {
      return {
        downloadURL: payload.downloadURL,
        storagePath: payload.storagePath || storagePath,
      };
    }
    apiError = payload.error || `upload_http_${response.status}`;
  }

  // Fallback: client Firebase Storage (requires Storage to be enabled on the project).
  try {
    const bytes = base64ToUint8Array(imageBase64);
    const { getDownloadURL, ref, uploadBytes } = await import('firebase/storage');
    const { storage } = await import('@/lib/firebase');
    const objectRef = ref(storage, storagePath);
    await uploadBytes(objectRef, bytes, {
      contentType: 'image/jpeg',
      cacheControl: 'public,max-age=31536000',
      customMetadata: { purpose: 'ninunulie', uploadedBy: userId },
    });
    const downloadURL = await getDownloadURL(objectRef);
    if (!downloadURL) throw new Error('Imeshindikana kupakia picha.');
    return { downloadURL, storagePath };
  } catch (clientError) {
    const clientMsg = clientError instanceof Error ? clientError.message : '';
    throw new Error(apiError || clientMsg || 'Imeshindikana kupakia picha.');
  }
}

export async function uploadParcelPhoto(params: { userId: string; localUri: string; orderKey?: string }) {
  // Reuse the live /media/ninunulie path (already provisioned) under a parcel order key.
  return uploadNinunuliePhoto({
    userId: params.userId,
    localUri: params.localUri,
    orderKey: `parcel-${String(params.orderKey || Date.now())}`,
  });
}
