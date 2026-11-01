import { auth } from '@/lib/firebase';
import { getDoorDropApiBaseUrl } from '@/lib/api-config';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';

const scope = 'ParcelPhotoUpload';

/** 1x1 JPEG — used only to prove the live upload API + auth path. */
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';

async function compressToCacheJpeg(localUri: string) {
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
      { compress: 0.7, format: manipulator.SaveFormat.JPEG }
    );
    if (compressed?.uri) return compressed.uri;
  } catch (error) {
    logWarning(scope, 'compress skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return localUri;
}

async function readLocalImageBase64(localUri: string) {
  const uri = String(localUri || '').trim();
  if (!uri) throw new Error('Imeshindikana kusoma picha ya mzigo.');

  // Always prefer legacy reader — main expo-file-system throws on readAsStringAsync (SDK 54).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const LegacyFileSystem = require('expo-file-system/legacy') as {
    readAsStringAsync: (fileUri: string, options: { encoding: string }) => Promise<string>;
    EncodingType?: { Base64: string };
  };
  const encoding = LegacyFileSystem.EncodingType?.Base64 || 'base64';

  try {
    const encoded = await LegacyFileSystem.readAsStringAsync(uri, { encoding });
    if (encoded) return encoded.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  } catch (legacyError) {
    logWarning(scope, 'legacy read failed', {
      uri: uri.slice(0, 80),
      error: legacyError instanceof Error ? legacyError.message : String(legacyError),
    });
  }

  try {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    const encoded = await file.base64();
    if (encoded) return encoded.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  } catch (fileError) {
    logWarning(scope, 'File.base64 failed', {
      error: fileError instanceof Error ? fileError.message : String(fileError),
    });
  }

  throw new Error('Imeshindikana kusoma picha ya mzigo kwenye simu.');
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

async function uploadBase64ToApi(params: {
  userId: string;
  imageBase64: string;
  orderKey: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid || currentUser.uid !== params.userId) {
    throw new Error('Ingia akaunti kabla ya kupakia picha ya mzigo.');
  }

  const idToken = await currentUser.getIdToken();
  const apiBase = getDoorDropApiBaseUrl().replace(/\/+$/, '');
  if (!apiBase) throw new Error('API haipatikani. Angalia muunganisho.');

  const response = await fetch(`${apiBase}/media/ninunulie`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      imageBase64: params.imageBase64,
      contentType: 'image/jpeg',
      orderKey: params.orderKey,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    downloadURL?: string;
    storagePath?: string;
    error?: string;
  };
  if (!response.ok || !payload.downloadURL) {
    throw new Error(payload.error || `Upload failed (${response.status}).`);
  }
  return {
    downloadURL: payload.downloadURL,
    storagePath: payload.storagePath || '',
  };
}

async function uploadBase64ToStorageFallback(params: {
  userId: string;
  imageBase64: string;
  orderKey: string;
}) {
  const bytes = base64ToUint8Array(params.imageBase64);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storagePath = `ninunulie/${params.userId}/${params.orderKey}/${fileName}`;
  const { getDownloadURL, ref, uploadBytes } = await import('firebase/storage');
  const { storage } = await import('@/lib/firebase');
  const objectRef = ref(storage, storagePath);
  await uploadBytes(objectRef, bytes, {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
    customMetadata: { purpose: 'parcel', uploadedBy: params.userId },
  });
  const downloadURL = await getDownloadURL(objectRef);
  if (!downloadURL) throw new Error('Imeshindikana kupakia picha ya mzigo.');
  return { downloadURL, storagePath };
}

export async function uploadParcelCargoPhoto(params: {
  userId: string;
  localUri: string;
  orderKey?: string;
}) {
  const userId = String(params.userId || '').trim();
  if (!userId) throw new Error('Ingia akaunti kabla ya kupakia picha ya mzigo.');

  const orderKey = `parcel-${String(params.orderKey || Date.now())}`
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);

  logAsyncStart(scope, 'uploadParcelCargoPhoto', { userId, orderKey });
  try {
    const localUri = await compressToCacheJpeg(params.localUri);
    const imageBase64 = await readLocalImageBase64(localUri);
    if (!imageBase64) throw new Error('Imeshindikana kusoma picha ya mzigo.');

    try {
      const uploaded = await uploadBase64ToApi({ userId, imageBase64, orderKey });
      logAsyncSuccess(scope, 'uploadParcelCargoPhoto', { via: 'api', url: uploaded.downloadURL.slice(0, 60) });
      return uploaded;
    } catch (apiError) {
      logWarning(scope, 'api upload failed, trying storage', {
        error: apiError instanceof Error ? apiError.message : String(apiError),
      });
      const uploaded = await uploadBase64ToStorageFallback({ userId, imageBase64, orderKey });
      logAsyncSuccess(scope, 'uploadParcelCargoPhoto', { via: 'storage', url: uploaded.downloadURL.slice(0, 60) });
      return uploaded;
    }
  } catch (error) {
    logAsyncFailure(scope, 'uploadParcelCargoPhoto', error);
    throw error instanceof Error ? error : new Error('Imeshindikana kupakia picha ya mzigo.');
  }
}

/** Proves auth + `/media/ninunulie` without camera/gallery. */
export async function proveParcelPhotoUploadApi(userId: string) {
  const orderKey = `parcel-probe-${Date.now()}`;
  return uploadBase64ToApi({
    userId,
    imageBase64: TINY_JPEG_BASE64,
    orderKey,
  });
}
