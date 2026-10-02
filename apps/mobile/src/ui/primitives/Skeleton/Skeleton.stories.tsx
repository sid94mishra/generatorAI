import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Skeleton } from './Skeleton';

function SkeletonGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Shapes">
        <StoryRow>
          <Skeleton shape="circle" />
          <Skeleton shape="bar" width={120} />
          <Skeleton shape="block" width={80} height={40} />
        </StoryRow>
      </StorySection>
      <StorySection title="Presets: row, row-2, list, card, transcript">
        <Skeleton preset="row" />
        <Skeleton preset="row-2" />
        <Skeleton preset="list" count={2} />
        <Skeleton preset="card" />
        <Skeleton preset="transcript" />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Skeleton preset="row-2" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Skeleton', component: SkeletonGallery } satisfies Meta<typeof SkeletonGallery>;
export default meta;
export const Presets: StoryObj<typeof meta> = {};
