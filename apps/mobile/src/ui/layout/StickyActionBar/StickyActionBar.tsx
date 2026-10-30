// ML-23 StickyActionBar (03 ML-23). iOS: a floating Liquid Glass capsule 12 from the edges and the safe area, h64,
// radius 32, padding 8 8 8 20 — summary (14/600 + caption) and the lg primary. Android: a docked bar (min-h 76,
// raised, top line-soft) with the summary and the filled lg primary. Both ride above the keyboard.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { KeyboardStickyView } from '../../lib/styled';
import { GlassSurface } from '../../native/GlassSurface';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import type { StickyActionBarProps } from './StickyActionBar.types';

export type { StickyActionBarProps } from './StickyActionBar.types';

function Summary({ summary }: Pick<StickyActionBarProps, 'summary'>): React.ReactElement | null {
  if (!summary) return null;
  return (
    <View className="flex-1 gap-0.5">
      <Text role="subhead" weight={600} numberOfLines={1}>
        {summary.title}
      </Text>
      {summary.subtitle ? (
        <Text role="caption" tone="fg-3" numberOfLines={1}>
          {summary.subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function StickyActionBar({ summary, primary, secondary, testID }: StickyActionBarProps): React.ReactElement {
  const insets = useInsets();
  const android = nativePlatform === 'android';
  const buttons = (
    <>
      {secondary ? <Button {...secondary} size="lg" /> : null}
      <Button {...primary} variant="primary" size="lg" fullWidth={!summary && !secondary} />
    </>
  );
  if (android) {
    return (
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View testID={testID} className="min-h-19 flex-row items-center gap-3 border-t border-line-soft bg-raised px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <Summary summary={summary} />
          {summary ? null : <View className={cn(secondary ? 'flex-1' : 'hidden')} />}
          {buttons}
        </View>
      </KeyboardStickyView>
    );
  }
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      <View className="px-3" style={{ paddingBottom: insets.bottom + 12 }}>
        <GlassSurface testID={testID} radiusStep="full" className="min-h-16 flex-row items-center gap-3 py-2 pe-2 ps-5">
          <Summary summary={summary} />
          {buttons}
        </GlassSurface>
      </View>
    </KeyboardStickyView>
  );
}
