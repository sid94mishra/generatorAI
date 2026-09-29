import React, { useState } from 'react';
import { Button, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

/** Story-only bootstrap fixture; the production Button kit lands in M4. */
export function NativeButtonProbe({ disabled = false }: { disabled?: boolean }): React.ReactElement {
  const [count, setCount] = useState(0);
  return (
    <View className="flex-1 items-center justify-center">
      <Button accessibilityLabel={`Storybook ready: ${count}`} title={`Storybook ready: ${count}`} disabled={disabled} onPress={() => setCount((value) => value + 1)} />
    </View>
  );
}
const meta = {
  title: 'ui/verification/NativeButton',
  component: NativeButtonProbe,
  excludeStories: ['NativeButtonProbe'],
  args: { disabled: false },
  parameters: { vrt: { skip: 'Bootstrap harness; production kit begins at M4.' } },
} satisfies Meta<typeof NativeButtonProbe>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Enabled: Story = {};
export const Disabled: Story = { args: { disabled: true } };
