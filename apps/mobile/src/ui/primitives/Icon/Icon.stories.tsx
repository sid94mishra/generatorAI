import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';
import { ICON_CONCEPTS, MOBILE_ICON_CONCEPTS, type MobileIconConcept } from '@generatorai/design-tokens';

import { Icon } from './Icon';
import type { IconTone } from './Icon.types';

const CONCEPTS = Object.keys({ ...ICON_CONCEPTS, ...MOBILE_ICON_CONCEPTS }) as MobileIconConcept[];
const TONES: IconTone[] = ['fg', 'fg-2', 'accent', 'err'];

/** The visual check for SF / Material names (02 §5.4): every concept at 20 in four tones. */
function AllConcepts({ filled = false }: { filled?: boolean }): React.ReactElement {
  return (
    <ScrollView contentContainerClassName="gap-2 p-4">
      {CONCEPTS.map((concept) => (
        <View key={concept} className="flex-row items-center gap-3">
          {TONES.map((tone) => (
            <Icon key={tone} concept={concept} size={20} tone={tone} filled={filled} />
          ))}
          <Text className="text-small text-fg-2">{concept}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function States(): React.ReactElement {
  return (
    <View className="flex-row flex-wrap items-center gap-4 p-4">
      <Icon concept="play" tone="fg" />
      <Icon concept="play" tone="fg" filled accessibilityLabel="Run" />
      <Icon concept="pin" tone="accent" filled />
      <Icon concept="status-running" tone="run" spinning accessibilityLabel="Running" />
      <Icon concept="status-needs-you" tone="warn" />
      <Icon concept="chevron-right" size={16} />
      <Icon concept="changes" tone="fg" size={24} />
    </View>
  );
}

const meta = {
  title: 'ui/primitives/Icon',
  component: AllConcepts,
  args: { filled: false },
} satisfies Meta<typeof AllConcepts>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllConceptsOutlined: Story = {};
export const AllConceptsFilled: Story = { args: { filled: true } };
export const StatesAndSizes: Story = { render: () => <States /> };
