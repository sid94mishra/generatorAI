// ML-19 KeyValueList (03 ML-19): rows min-h 44 / 48 — a footnote fg-3 label column (96 iOS / 112 Android) and the
// value (subhead, mono optional, selectable, wrapping). iOS draws them as one inset group; Android flat. Copyable
// values get a copy control (and a "Copy" accessibility action).
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { IconButton } from '../../primitives/IconButton';
import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { KeyValueListProps } from './KeyValueList.types';

export type { KeyValueItem, KeyValueListProps } from './KeyValueList.types';

export function KeyValueList({ items, testID }: KeyValueListProps): React.ReactElement {
  const android = nativePlatform === 'android';
  return (
    <View testID={testID} className={cn(!android && 'mx-4 overflow-hidden rounded-group bg-raised')}>
      {items.map((item, i) => {
        const text = typeof item.value === 'string' ? item.value : undefined;
        const copy = item.copyable && text ? () => void Clipboard.setStringAsync(text) : undefined;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 && !android ? <Separator inset={16} /> : null}
            <View
              accessible={!copy}
              accessibilityLabel={text ? `${item.label}, ${text}` : item.label}
              accessibilityActions={copy ? [{ name: 'copy', label: 'Copy' }] : undefined}
              onAccessibilityAction={() => copy?.()}
              className="min-h-item flex-row items-center gap-3 py-2 pe-2 ps-4"
            >
              <Text role="footnote" tone="fg-3" className="w-24 android:w-28">
                {item.label}
              </Text>
              <View className="flex-1">
                {text !== undefined ? (
                  <Text role={item.mono ? 'mono' : 'subhead'} selectable>
                    {text}
                  </Text>
                ) : (
                  item.value
                )}
              </View>
              {copy ? <IconButton icon="copy" label={`Copy ${item.label}`} size="sm" onPress={copy} /> : null}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}
