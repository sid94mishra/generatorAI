// ML-12 ListSection (03 ML-12; MD-68). iOS: an inset group — header (15/600 fg, sentence case) padded 12 4 6 4 over
// a raised rounded-group 22 card with rows separated by hairlines inset after the icon column, footnote footer.
// Android: flat full-bleed rows under a 14/600 fg-2 header at start 16, dividers inset 56 (or full); `carded`
// composites use the M3 segmented list (2 dp gaps, large outer / small inner corners). Platform differences are
// classes and nativePlatform (MD-115).
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Count } from '../../primitives/Count';
import { Link } from '../../primitives/Link';
import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { ListSectionProps } from './ListSection.types';
import { ANDROID_CARDED_CORNERS, rowPosition } from './listSectionModel';

export type { ListSectionProps, RowPosition } from './ListSection.types';

export function ListSection({ title, count, action, footer, variant = 'grouped', dividers = 'inset', children, testID }: ListSectionProps): React.ReactElement {
  const android = nativePlatform === 'android';
  const rows = React.Children.toArray(children).filter(React.isValidElement);
  const divider = dividers === 'none' ? null : <Separator inset={dividers === 'full' ? 0 : android ? 56 : 48} />;
  const carded = android && variant === 'carded';
  return (
    <View testID={testID} className={cn(!android && 'mx-4')}>
      {title ? (
        <View className={cn('flex-row items-center gap-2', android ? 'px-4 pb-2 pt-4' : 'px-1 pb-1.5 pt-3')}>
          <Text role="subhead" weight={600} tone={android ? 'fg-2' : 'fg'} accessibilityRole="header" className="shrink">
            {title}
          </Text>
          {count !== undefined ? <Count value={count} /> : null}
          <View className="flex-1" />
          {action ? <Link label={action.label} onPress={action.onPress} standalone /> : null}
        </View>
      ) : null}
      {carded ? (
        <View className="mx-4 gap-0.5">
          {rows.map((row, i) => (
            <View key={row.key ?? i} className={cn('overflow-hidden bg-raised', ANDROID_CARDED_CORNERS[rowPosition(i, rows.length)])}>
              {row}
            </View>
          ))}
        </View>
      ) : (
        <View className={cn(!android && 'overflow-hidden rounded-group bg-raised')}>
          {rows.map((row, i) => (
            <React.Fragment key={row.key ?? i}>
              {i > 0 ? divider : null}
              {row}
            </React.Fragment>
          ))}
        </View>
      )}
      {footer ? (
        <Text role="footnote" tone="fg-3" className={android ? 'p-4' : 'px-4 pt-1.5'}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
