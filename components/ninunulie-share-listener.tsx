import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import {
  subscribeNinunulieShare,
  type NinunulieShareDraft,
} from '@/lib/ninunulie-share';

function draftParams(draft: NinunulieShareDraft) {
  const params: Record<string, string> = {
    shared: '1',
    sourceMode: 'haul_source',
  };
  if (draft.text) params.sharedText = draft.text.slice(0, 2000);
  if (draft.url) params.productUrl = draft.url;
  if (draft.itemHint) params.itemTitle = draft.itemHint;
  draft.imageUris.forEach((uri, index) => {
    params[index === 0 ? 'sharedImage' : `sharedImage${index}`] = uri;
  });
  return params;
}

export function NinunulieShareListener() {
  const router = useRouter();
  const lastKeyRef = useRef('');

  useEffect(() => {
    return subscribeNinunulieShare((draft) => {
      const key = `${draft.url}|${draft.text}|${draft.imageUris.join(',')}`;
      if (lastKeyRef.current === key) {
        return;
      }
      lastKeyRef.current = key;
      router.push({
        pathname: '/ninunulie',
        params: draftParams(draft),
      });
    });
  }, [router]);

  return null;
}
