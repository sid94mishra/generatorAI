import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, View, type ViewProps } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '../../theme/ThemeProvider';

/** Native glass belongs to controls, never the code or transcript beneath them. */
export function GlassSurface({ style, ...props }: ViewProps): React.ReactElement {
  const { colors, appearance } = useTheme();
  // Start opaque: never flash transparency before the accessibility query resolves.
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (mounted) setReduceTransparency(value);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { mounted = false; sub.remove(); };
  }, []);

  if (reduceTransparency || !isGlassEffectAPIAvailable() || !isLiquidGlassAvailable()) {
    return <View {...props} style={[{ backgroundColor: colors.raised }, style]} />;
  }
  return <GlassView {...props} colorScheme={appearance} glassEffectStyle="regular" style={style} />;
}
