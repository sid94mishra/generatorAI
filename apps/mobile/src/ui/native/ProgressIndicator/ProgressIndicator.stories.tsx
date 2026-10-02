import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { ProgressIndicator } from './ProgressIndicator';

function ProgressIndicatorGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="md / lg / contained (Android M3 Expressive; iOS ProgressView)">
        <StoryRow>
          <ProgressIndicator label="Connecting" />
          <ProgressIndicator size="lg" label="Committing" />
          <ProgressIndicator contained label="Loading" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ProgressIndicator label="Loading" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/ProgressIndicator', component: ProgressIndicatorGallery } satisfies Meta<typeof ProgressIndicatorGallery>;
export default meta;
export const Sizes: StoryObj<typeof meta> = {};
