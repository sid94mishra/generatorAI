import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Radio, RadioGroup, RadioOption } from './RadioGroup';

function Options({ initial = 'tests' }: { initial?: string | null }): React.ReactElement {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <View className="rounded-group bg-raised">
      <RadioGroup value={value} onValueChange={setValue} accessibilityLabel="Where should the fixture live?">
        <RadioOption value="tests" label="With the other fixtures" description="tests/fixtures/" />
        <RadioOption value="inline" label="Inline in checkout.spec.ts" />
        <RadioOption value="shared" label="In the shared package" disabled />
        <RadioOption value="long" label={LONG_TEXT} />
      </RadioGroup>
    </View>
  );
}

function RadioGroupGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Indicator: selected, unselected, disabled (iOS ✓ trailing / Android radio leading)">
        <StoryRow>
          <Radio value="a" selected />
          <Radio value="b" selected={false} />
          <Radio value="c" selected disabled />
          <Radio value="d" selected={false} disabled />
        </StoryRow>
      </StorySection>
      <StorySection title="Group: selection, none selected">
        <Options />
        <Options initial={null} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Options />
        </WithFontScale>
        <RightToLeft>
          <Options />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Options />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/RadioGroup', component: RadioGroupGallery } satisfies Meta<typeof RadioGroupGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
