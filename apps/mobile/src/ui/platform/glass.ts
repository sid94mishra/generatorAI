// useGlass() — whether iOS floating chrome may draw Liquid Glass (mobile 02 §8.2): iOS, the glass APIs present in
// this client, and Reduce Transparency off. Otherwise GlassSurface draws the opaque fallback (bg-overlay +
// border-line + shadow-float). Only this file and ui/native/GlassSurface import expo-glass-effect (lint `glassImport`).
import { Platform } from 'react-native';
import { useReduceTransparency } from './transparency';

function detectGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const glass = require('expo-glass-effect') as { isLiquidGlassAvailable?: () => boolean; isGlassEffectAPIAvailable?: () => boolean };
    return Boolean(glass.isLiquidGlassAvailable?.() && glass.isGlassEffectAPIAvailable?.());
  } catch {
    return false;
  }
}

const glassAvailable = detectGlass();

export function useGlass(): boolean {
  const reduceTransparency = useReduceTransparency();
  return glassAvailable && !reduceTransparency;
}
