// MP-32 EmptyState (03 MP-32): a centred column, gap 6 — glyph 22 / 24 fg-3, the title (headline), the description
// (subhead fg-3, max 270 wide) and at most one secondary action. Copy comes from EMPTY_STATE_COPY by key.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { EmptyStateProps } from './EmptyState.types';
import { emptyCopy } from './emptyStateModel';

export type { EmptyStateProps } from './EmptyState.types';

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { action, compact = false, testID } = props;
  const copy = emptyCopy(props);
  return (
    <View testID={testID} className={cn('items-center gap-1.5', compact ? 'px-4 py-5' : 'px-8 py-12')}>
      {copy.icon ? <Icon concept={copy.icon} size={nativePlatform === 'android' ? 24 : 22} tone="fg-3" /> : null}
      <Text role="headline" align="center" accessibilityRole="header">
        {copy.title}
      </Text>
      {copy.description ? (
        <Text role="subhead" tone="fg-3" align="center" className="max-w-67.5">
          {copy.description}
        </Text>
      ) : null}
      {action ? (
        <View className="pt-2.5">
          <Button label={action.label} icon={action.icon} size="sm" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
