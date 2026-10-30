// MP-33 ErrorState (03 MP-33; MD-25): EmptyState geometry with the `warning` glyph in err, "Couldn't load <thing>",
// the mapped error text (never a stack) and a ghost "Retry". `inline`: one row (icon + text + Retry) inside a list,
// role alert. Never an err-bg fill.
import React from 'react';
import { View } from 'react-native';

import { errorText } from '../../lib/format';
import { nativePlatform } from '../../platform/geometry';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { ErrorStateProps } from './ErrorState.types';

export type { ErrorStateProps } from './ErrorState.types';

export function ErrorState({ title, error, onRetry, inline = false, testID }: ErrorStateProps): React.ReactElement {
  const detail = errorText(error);
  if (inline) {
    return (
      <View testID={testID} accessibilityRole="alert" className="min-h-item flex-row items-center gap-3 px-4 py-2">
        <Icon concept="warning" size={16} tone="err" />
        <View className="flex-1">
          <Text role="subhead">{title}</Text>
          <Text role="footnote" tone="fg-3" numberOfLines={2}>
            {detail}
          </Text>
        </View>
        {onRetry ? <Button label="Retry" variant="ghost" size="sm" onPress={onRetry} /> : null}
      </View>
    );
  }
  return (
    <View testID={testID} accessibilityLiveRegion="polite" className="items-center gap-1.5 px-8 py-12">
      <Icon concept="warning" size={nativePlatform === 'android' ? 24 : 22} tone="err" />
      <Text role="headline" align="center" accessibilityRole="header">
        {title}
      </Text>
      <Text role="subhead" tone="fg-3" align="center" selectable className="max-w-67.5">
        {detail}
      </Text>
      {onRetry ? (
        <View className="pt-2.5">
          <Button label="Retry" variant="ghost" icon="retry" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
