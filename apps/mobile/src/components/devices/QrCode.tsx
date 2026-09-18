// ────────────────────────────────────────────────────────────────
// QrCode — a pairing QR drawn with react-native-svg.
//
// Always dark modules on a white quiet zone, regardless of theme: scanners
// expect that contrast, and an inverted code on a dark card fails on many
// camera apps. The encoding itself is `qrMatrix.ts`.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { qrMatrix, qrPath } from './qrMatrix';

const QUIET_ZONE = 4;

export function QrCode({
  value,
  size = 220,
  accessibilityLabel = 'Pairing QR code',
}: {
  value: string;
  size?: number;
  accessibilityLabel?: string;
}): React.ReactElement | null {
  const drawn = useMemo(() => {
    try {
      const matrix = qrMatrix(value);
      return { path: qrPath(matrix, QUIET_ZONE), extent: matrix.size + QUIET_ZONE * 2 };
    } catch {
      // Too long to encode — the caller still shows the code and link.
      return null;
    }
  }, [value]);

  if (!drawn) return null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="overflow-hidden rounded-2xl"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${drawn.extent} ${drawn.extent}`}>
        <Rect x={0} y={0} width={drawn.extent} height={drawn.extent} fill="#ffffff" />
        <Path d={drawn.path} fill="#000000" />
      </Svg>
    </View>
  );
}
