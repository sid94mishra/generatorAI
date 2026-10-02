// MP-50 QrCode (03 MP-50): the payload as one SVG path (react-native-svg) of dark modules on a quiet zone of four.
// Always dark-on-light for scanners: the active theme's literals in light mode, and the default theme's light
// literals in dark mode (the one sanctioned exception to following the appearance). A payload too long to encode
// renders nothing (the caller still shows the code and link).
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useThemeColors } from '../../lib/themeColors';
import { loadPalette } from '../../../theme/palettes';
import type { QrCodeProps } from './QrCode.types';
import { qrMatrix, qrPath } from './qrMatrix';

export type { QrCodeProps } from './QrCode.types';

const QUIET_ZONE = 4;

/** The encoded path and its extent, or null when the payload does not fit (exported for tests). */
export function qrDrawing(value: string): { path: string; extent: number } | null {
  try {
    const matrix = qrMatrix(value);
    return { path: qrPath(matrix, QUIET_ZONE), extent: matrix.size + QUIET_ZONE * 2 };
  } catch {
    return null;
  }
}

function useLightLiterals(): { fg: string; surface: string } {
  const colors = useThemeColors();
  return useMemo(() => {
    if (colors.appearance === 'light') return { fg: colors.fg, surface: colors.surface };
    const light = loadPalette('instrument').light.tokens;
    return { fg: light.fg, surface: light.surface };
  }, [colors]);
}

export function QrCode({ value, size = 200, label, testID }: QrCodeProps): React.ReactElement | null {
  const drawn = useMemo(() => qrDrawing(value), [value]);
  const ink = useLightLiterals();
  if (!drawn) return null;
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} className="overflow-hidden rounded-card" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${drawn.extent} ${drawn.extent}`}>
        <Rect x={0} y={0} width={drawn.extent} height={drawn.extent} fill={ink.surface} />
        <Path d={drawn.path} fill={ink.fg} />
      </Svg>
    </View>
  );
}
