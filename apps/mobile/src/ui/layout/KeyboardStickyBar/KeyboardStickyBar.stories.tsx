import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Input } from '../../primitives/Input';
import { Text } from '../../primitives/Text';
import { KeyboardStickyBar } from './KeyboardStickyBar';

function KeyboardStickyBarGallery(): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <View className="flex-1 justify-end bg-surface">
      <Text role="footnote" tone="fg-3" className="p-4">
        Focus the field: the bar rides on the keyboard, and sits above the home indicator when it closes.
      </Text>
      <KeyboardStickyBar>
        <View className="border-t border-line-soft bg-raised p-3">
          <Input label="Message" presentation="standalone" value={text} onChangeText={setText} />
        </View>
      </KeyboardStickyBar>
    </View>
  );
}

const meta = { title: 'UI/Layout/KeyboardStickyBar', component: KeyboardStickyBarGallery } satisfies Meta<typeof KeyboardStickyBarGallery>;
export default meta;
export const RidesTheKeyboard: StoryObj<typeof meta> = {};
