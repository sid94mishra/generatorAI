// ML-27 BottomToolbar (03 ML-27). iOS: a floating glass group — a capsule of navigation icon buttons (44) plus
// separate buttons and the optional primary, 12 above the safe area. Android: the M3 bottom app bar (h80, raised):
// icon buttons at the start, actions at the end, the primary in the 48 × 48 radius-16 FAB slot.
import React from 'react';
import { View } from 'react-native';

import { GlassGroup, GlassSurface } from '../../native/GlassSurface';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { Button } from '../../primitives/Button';
import { IconButton } from '../../primitives/IconButton';
import type { BottomToolbarProps } from './BottomToolbar.types';

export type { BottomToolbarProps } from './BottomToolbar.types';

export function BottomToolbar({ nav = [], actions = [], primary, testID }: BottomToolbarProps): React.ReactElement {
  const insets = useInsets();
  if (nativePlatform === 'android') {
    return (
      <View testID={testID} className="min-h-20 flex-row items-center gap-1 bg-raised pe-4 ps-1" style={{ paddingBottom: insets.bottom }}>
        {nav.map((n) => (
          <IconButton key={n.label} {...n} />
        ))}
        <View className="flex-1" />
        {actions.map((a) => (
          <Button key={a.label} {...a} variant={a.variant ?? 'ghost'} />
        ))}
        {primary ? <IconButton icon={primary.icon ?? 'check'} label={primary.accessibilityLabel ?? primary.label} variant="filled" onPress={primary.onPress} disabled={primary.disabled} testID={primary.testID} /> : null}
      </View>
    );
  }
  return (
    <View testID={testID} className="flex-row items-center gap-2 px-4" style={{ paddingBottom: insets.bottom + 12 }}>
      <GlassGroup>
        {nav.length ? (
          <GlassSurface radiusStep="full" className="flex-row">
            {nav.map((n) => (
              <IconButton key={n.label} {...n} />
            ))}
          </GlassSurface>
        ) : null}
      </GlassGroup>
      <View className="flex-1" />
      {actions.map((a) => (
        <Button key={a.label} {...a} />
      ))}
      {primary ? <Button {...primary} variant="primary" /> : null}
    </View>
  );
}
