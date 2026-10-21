import React from 'react';
import { SvgXml } from 'react-native-svg';

import { TIER_MEDAL_XML } from '@/components/tier-medal-art';
import type { CarrierTierId } from '@/constants/carrier-desk';

/** Metallic medal. Artwork lives in assets/badges/medal-*.svg. */
export function TierMedal({ id, width = 36 }: { id: CarrierTierId; width?: number }) {
  const height = Math.round((width * 156) / 128);
  return <SvgXml xml={TIER_MEDAL_XML[id]} width={width} height={height} />;
}
