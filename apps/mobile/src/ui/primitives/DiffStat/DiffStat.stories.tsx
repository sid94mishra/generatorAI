import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { DiffStat } from './DiffStat';

function DiffStatGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Counts, files, unknown">
        <DiffStat additions={14} deletions={6} />
        <DiffStat additions={18} deletions={8} files={2} />
        <DiffStat files={1} />
        <DiffStat />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <DiffStat additions={14} deletions={6} files={2} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/DiffStat', component: DiffStatGallery } satisfies Meta<typeof DiffStatGallery>;
export default meta;
export const Counts: StoryObj<typeof meta> = {};
