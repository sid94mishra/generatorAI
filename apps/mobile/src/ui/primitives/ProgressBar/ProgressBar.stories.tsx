import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ProgressBar } from './ProgressBar';

function ProgressBarGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Determinate run, neutral meter, label row">
        <ProgressBar value={0.38} accessibilityLabel="Cloning" />
        <ProgressBar value={0.72} tone="neutral" label="Storage" valueText="7.2 GB of 10 GB" />
        <ProgressBar value={1} label="Model download" valueText="100%" />
      </StorySection>
      <StorySection title="Indeterminate (static at 30 % under Reduce Motion)">
        <ProgressBar label="Uploading" />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ProgressBar value={0.5} label="Context" valueText="50%" tone="neutral" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ProgressBar', component: ProgressBarGallery } satisfies Meta<typeof ProgressBarGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};
