// ML-26 ScrollToLatest (03 ML-26): the "↓ Latest" pill shown when the transcript is scrolled up more than a screen —
// iOS a Liquid Glass capsule (GlassSurface full, interactive), Android bg-overlay + shadow-pop; h40, padding 0 14,
// arrow 16 + "Latest" 600, optional "N new". Centred, 12 above the composer (the caller places it). The accessible
// name is TRANSCRIPT_COPY.jumpToLatest. Android fades; iOS scales (opacity would kill the glass, 02 §8.2); none under
// Reduce Motion.
import React from 'react';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';

import { nativePlatform } from '../../platform/geometry';
import { useMotion } from '../../platform/motion';
import { GlassSurface } from '../../native/GlassSurface';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { ScrollToLatestProps } from './ScrollToLatest.types';

export type { ScrollToLatestProps } from './ScrollToLatest.types';

export function ScrollToLatest({ visible, onPress, newCount, testID }: ScrollToLatestProps): React.ReactElement | null {
  const reveal = useMotion('reveal');
  if (!visible) return null;
  const name = newCount ? `${TRANSCRIPT_COPY.jumpToLatest}, ${newCount} new` : TRANSCRIPT_COPY.jumpToLatest;
  const content = (
    <>
      <Icon concept="latest" size={16} tone="fg" />
      <Text role="subhead" weight={600} chrome>
        {newCount ? `${newCount} new` : 'Latest'}
      </Text>
    </>
  );
  return (
    <Animated.View
      entering={reveal.reduced ? undefined : nativePlatform === 'android' ? FadeIn.duration(180) : ZoomIn.duration(180)}
      exiting={reveal.reduced ? undefined : nativePlatform === 'android' ? FadeOut.duration(120) : ZoomOut.duration(120)}
      className="items-center"
    >
      <Pressable testID={testID} onPress={onPress} feedback="scale" accessibilityRole="button" accessibilityLabel={name}>
        {nativePlatform === 'android' ? (
          <Animated.View className="min-h-10 flex-row items-center gap-1.5 rounded-full bg-overlay px-3.5 shadow-pop">{content}</Animated.View>
        ) : (
          <GlassSurface radiusStep="full" interactive className="min-h-10 flex-row items-center gap-1.5 px-3.5">
            {content}
          </GlassSurface>
        )}
      </Pressable>
    </Animated.View>
  );
}
