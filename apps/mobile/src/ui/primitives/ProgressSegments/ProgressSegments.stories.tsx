import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ProgressSegments } from './ProgressSegments';

const RUN = [
  { state: 'succeeded' as const, label: 'Plan' },
  { state: 'succeeded' as const, label: 'Assess risk' },
  { state: 'needs_you' as const, label: 'Apply upgrades' },
  { state: 'queued' as const, label: 'Test' },
  { state: 'queued' as const, label: 'Review' },
  { state: 'skipped' as const, label: 'Release' },
];

function ProgressSegmentsGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Sizes sm / md / lg with fraction">
        <ProgressSegments segments={RUN} showFraction />
        <ProgressSegments segments={RUN} size="md" showFraction />
        <ProgressSegments segments={RUN} size="lg" />
      </StorySection>
      <StorySection title="Tracker on the current stage">
        <ProgressSegments segments={RUN} size="md" tracker={2} />
      </StorySection>
      <StorySection title="Running and failed">
        <ProgressSegments segments={[{ state: 'succeeded', label: 'A' }, { state: 'running', label: 'B' }, { state: 'failed', label: 'C' }]} showFraction />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ProgressSegments segments={RUN} showFraction />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ProgressSegments', component: ProgressSegmentsGallery } satisfies Meta<typeof ProgressSegmentsGallery>;
export default meta;
export const Stages: StoryObj<typeof meta> = {};
