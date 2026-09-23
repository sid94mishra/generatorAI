// ────────────────────────────────────────────────────────────────
// BrandMark — the GeneratorAI mark, as the desktop sidebar draws it.
//
// Desktop's sidebar header is a rounded square in the theme's primary colour
// holding a white lightning bolt (apps/web Sidebar.tsx). Drawing it from
// tokens rather than shipping a bitmap keeps it on the active theme's accent,
// exactly like desktop. The launch splash uses the same mark, rendered to
// `assets/splash-mark.png`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { Zap } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';

export function BrandMark({ size = 24 }: { size?: number }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        // Desktop: 24px square, 8px radius.
        borderRadius: size / 3,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Zap size={Math.round(size * 0.58)} color="#ffffff" strokeWidth={2.25} />
    </View>
  );
}
