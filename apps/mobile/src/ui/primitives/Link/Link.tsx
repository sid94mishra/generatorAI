// MP-44 Link (03 MP-44): an inline underlined link inside prose, or a standalone "See all ›" link with its own hit
// frame. External links open expo-web-browser.
import React, { useCallback } from 'react';
import { Text as RNText, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { LinkProps } from './Link.types';

export type { LinkProps } from './Link.types';

export function Link({ label, url, onPress, external, standalone = false, testID }: LinkProps): React.ReactElement {
  const isExternal = external ?? Boolean(url);
  const press = useCallback(() => {
    if (onPress) onPress();
    else if (url) void WebBrowser.openBrowserAsync(url).catch(() => undefined);
  }, [onPress, url]);
  const hint = isExternal ? 'Opens in the browser' : undefined;
  if (!standalone) {
    return (
      <RNText testID={testID} accessibilityRole="link" accessibilityHint={hint} onPress={press} className="text-fg underline">
        {label}
      </RNText>
    );
  }
  return (
    <Pressable testID={testID} onPress={press} accessibilityRole="link" accessibilityLabel={label} accessibilityHint={hint} className="self-start">
      <View className="flex-row items-center gap-1">
        <Text role="subhead" weight={500} tone="fg-2">
          {label}
        </Text>
        <Icon concept={isExternal ? 'external-link' : 'chevron-right'} size={isExternal ? 12 : 14} tone="fg-2" />
      </View>
    </Pressable>
  );
}
