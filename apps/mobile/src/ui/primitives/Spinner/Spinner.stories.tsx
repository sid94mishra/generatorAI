import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Spinner } from './Spinner';

function SpinnerGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Sizes and tones">
        <StoryRow>
          <Spinner size={12} />
          <Spinner size={14} />
          <Spinner size={16} label="Loading" />
          <Spinner size={20} tone="fg-2" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Spinner label="Loading" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Spinner', component: SpinnerGallery } satisfies Meta<typeof SpinnerGallery>;
export default meta;
export const Sizes: StoryObj<typeof meta> = {};
