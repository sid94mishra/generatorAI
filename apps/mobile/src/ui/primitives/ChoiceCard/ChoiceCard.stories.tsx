import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { RadioGroup } from '../RadioGroup';
import { ChoiceCard } from './ChoiceCard';

const KINDS = [
  { value: 'schedule', title: 'Schedule', description: 'Runs at set times', icon: 'calendar' },
  { value: 'webhook', title: 'Webhook', description: 'Runs when a URL is called', icon: 'webhook' },
  { value: 'manual', title: 'Manual', description: LONG_TEXT, icon: 'play' },
] as const;

function Trigger(): React.ReactElement {
  const [value, setValue] = useState<string>('schedule');
  return (
    <RadioGroup value={value} onValueChange={setValue} accessibilityLabel="Trigger">
      <View className="gap-2">
        {KINDS.map((k) => (
          <ChoiceCard key={k.value} {...k} selected={value === k.value} onPress={() => setValue(k.value)} />
        ))}
        <ChoiceCard value="event" title="Repository event" icon="branch" selected={false} locked="Requires admin access" onPress={() => undefined} />
        <ChoiceCard value="off" title="Disabled choice" selected={false} disabled onPress={() => undefined} />
      </View>
    </RadioGroup>
  );
}

function ChoiceCardGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Selected, unselected, long description, locked, disabled">
        <Trigger />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <ChoiceCard value="a" title="Schedule" description="Runs at set times" icon="calendar" selected onPress={() => undefined} />
        </WithFontScale>
        <RightToLeft>
          <ChoiceCard value="a" title="Schedule" description="Runs at set times" icon="calendar" selected onPress={() => undefined} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ChoiceCard value="a" title="Schedule" description="Runs at set times" icon="calendar" selected onPress={() => undefined} />
          <ChoiceCard value="b" title="Webhook" description="Runs when a URL is called" icon="webhook" selected={false} onPress={() => undefined} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ChoiceCard', component: ChoiceCardGallery } satisfies Meta<typeof ChoiceCardGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
