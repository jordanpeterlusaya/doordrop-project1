import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const ink = '#0F172A';

/** Wallet — money the company keeps. */
export function EarnedIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="6.5" width="18" height="13" rx="2.2" stroke={ink} strokeWidth="1.6" />
      <Path d="M3 10.5h18" stroke={ink} strokeWidth="1.6" />
      <Circle cx="16.2" cy="14.2" r="1.15" fill={ink} />
    </Svg>
  );
}

/** Receipt — commission still owed to HAUL. */
export function OwedIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3.5h8.2L19 7.2V20.5H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"
        stroke={ink}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <Path d="M15 3.8V7.4H19" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
      <Path d="M8 11.5h8M8 15h5.5" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}
