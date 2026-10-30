// MP-39 KbdHint (03 MP-39): a key-chord hint shown only while a hardware keyboard is attached (iPad / Android
// tablets). iPad formats as the Mac (⌘ glyphs), Android as Windows/Linux words (Ctrl).
import React from 'react';
import { View } from 'react-native';
import { formatBindingText } from '@generatorai/shared/ui-contract';

import { nativePlatform } from '../../platform/geometry';
import { useHardwareKeyboard } from '../../platform/keyboard';
import { Text } from '../Text';
import type { KbdHintProps } from './KbdHint.types';

export type { KbdHintProps } from './KbdHint.types';

export function kbdText(binding: string, platform: 'ios' | 'android' = nativePlatform): string {
  return formatBindingText(binding, platform === 'ios' ? 'desktopMac' : 'desktopWinLinux');
}

export function KbdHint({ binding, testID }: KbdHintProps): React.ReactElement | null {
  const keyboard = useHardwareKeyboard();
  if (!keyboard) return null;
  return (
    <View testID={testID} className="min-h-4.5 min-w-4.5 items-center justify-center self-start rounded-badge border border-line bg-sunken px-1">
      <Text role="monoSm" tone="fg-3" chrome>
        {kbdText(binding)}
      </Text>
    </View>
  );
}
