import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { apiBaseUrl } from '@/lib/api-config';

export type PickedDoc = {
  kind: string;
  uri: string;
  name: string;
  mimeType: string;
};

export async function pickDocument(kind: string): Promise<PickedDoc | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    kind,
    uri: asset.uri,
    name: asset.name || `${kind}.bin`,
    mimeType: asset.mimeType || 'application/octet-stream',
  };
}

export async function pickImageDocument(kind: string): Promise<PickedDoc | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    kind,
    uri: asset.uri,
    name: asset.fileName || `${kind}.jpg`,
    mimeType: asset.mimeType || 'image/jpeg',
  };
}

export async function uploadCarrierDocument(doc: PickedDoc, idToken: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(doc.uri, {
    encoding: 'base64',
  });
  const response = await fetch(`${apiBaseUrl()}/media/carrier-document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fileBase64: base64,
      contentType: doc.mimeType,
      docKind: doc.kind,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    downloadURL?: string;
  };
  if (!response.ok || !payload.downloadURL) {
    throw new Error(payload.error || 'Imeshindwa kupakia hati.');
  }
  return payload.downloadURL;
}
