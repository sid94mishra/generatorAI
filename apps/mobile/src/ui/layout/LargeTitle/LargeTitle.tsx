// LargeTitle (ML-02 companion; MChats; MD-153): the iOS module-root large title drawn in the scroll content when the
// title carries a count ("Chats 48") that a native large title cannot style — `largeTitle` 32/600 + a mono `fg-3`
// Count, padded like the native one. The Header (role 'top' with `count`) hides the native large title and fades its
// inline headline in as this scrolls under the bar. Android draws the count in its bar, so this renders nothing there.
import React from 'react';
import { View } from 'react-native';

import { nativePlatform } from '../../platform/geometry';
import { Count } from '../../primitives/Count';
import { Text } from '../../primitives/Text';
import type { LargeTitleProps } from './LargeTitle.types';

export type { LargeTitleProps } from './LargeTitle.types';

export function largeTitleLabel(title: string, count?: number | null): string {
  return count == null ? title : `${title}, ${count}`;
}

export function LargeTitle({ title, count, testID }: LargeTitleProps): React.ReactElement | null {
  if (nativePlatform === 'android') return null;
  return (
    <View testID={testID} accessible accessibilityRole="header" accessibilityLabel={largeTitleLabel(title, count)} className="flex-row items-baseline gap-2 px-gutter-title pb-2 pt-1">
      <Text role="largeTitle" numberOfLines={1} className="shrink">
        {title}
      </Text>
      {count != null ? <Count value={count} hidden /> : null}
    </View>
  );
}
