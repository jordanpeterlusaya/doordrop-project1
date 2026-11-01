type ParcelPhotoDraft = {
  localUri: string;
  downloadURL?: string;
  updatedAt: number;
};

let draft: ParcelPhotoDraft | null = null;

export function setParcelPhotoDraft(next: { localUri: string; downloadURL?: string }) {
  const localUri = String(next.localUri || '').trim();
  if (!localUri) {
    draft = null;
    return;
  }
  draft = {
    localUri,
    downloadURL: next.downloadURL ? String(next.downloadURL).trim() : undefined,
    updatedAt: Date.now(),
  };
}

export function patchParcelPhotoDraft(patch: { downloadURL?: string }) {
  if (!draft) return;
  if (patch.downloadURL) {
    draft = { ...draft, downloadURL: String(patch.downloadURL).trim(), updatedAt: Date.now() };
  }
}

export function getParcelPhotoDraft() {
  return draft;
}

export function clearParcelPhotoDraft() {
  draft = null;
}
