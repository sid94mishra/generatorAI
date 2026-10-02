import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Select } from './Select';
import type { SelectProps } from './Select.types';
import { SelectJs } from './SelectJs';

const BRANCHES = [
  { value: 'main', label: 'main' },
  { value: 'develop', label: 'develop', description: 'Default for previews' },
  { value: 'release', label: 'release/2.4' },
  { value: 'locked', label: 'production', disabled: true },
];

function Live({ initial, js, ...rest }: Omit<SelectProps, 'value' | 'onValueChange'> & { initial: string | null; js?: boolean }): React.ReactElement {
  const [value, setValue] = useState<string | null>(initial);
  const Control = js ? SelectJs : Select;
  return <Control {...rest} value={value} onValueChange={setValue} />;
}

function SelectGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Row (iOS group row / Android outlined): chosen, placeholder, disabled">
        <View className="rounded-group bg-raised">
          <Live label="Base branch" options={BRANCHES} initial="main" />
          <Live label="Timezone" options={[{ value: 'utc', label: 'UTC' }, { value: 'ist', label: 'Asia/Kolkata' }]} initial={null} placeholder="Choose" />
          <Live label="Model" options={BRANCHES} initial="main" disabled />
        </View>
      </StorySection>
      <StorySection title="Field presentation">
        <Live label="Base branch" presentation="field" options={BRANCHES} initial="develop" />
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <Live js label="Base branch" options={BRANCHES} initial="main" />
      </StorySection>
      <StorySection title="Long value, font scale 2.0, right to left">
        <Live label="Description" presentation="field" options={[{ value: 'l', label: LONG_TEXT }]} initial="l" />
        <WithFontScale scale={2}>
          <Live js label="Base branch" options={BRANCHES} initial="main" />
        </WithFontScale>
        <RightToLeft>
          <Live label="Base branch" options={BRANCHES} initial="main" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live label="Base branch" presentation="field" options={BRANCHES} initial="main" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/Select', component: SelectGallery } satisfies Meta<typeof SelectGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
