import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Badge } from './Badge';

function BadgeGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Tones × sizes">
        <StoryRow>
          <Badge label="Draft" />
          <Badge label="Project" tone="outline" icon="projects" />
          <Badge label="Writes files" tone="outline" />
          <Badge label="Workflow" suffix="v7" />
          <Badge label="Draft" size="sm" />
          <Badge label="fix/checkout-flake" mono size="sm" icon="branch" />
        </StoryRow>
      </StorySection>
      <StorySection title="Long label and font scale 2.0 (chrome cap 1.4)">
        <Badge label={LONG_TEXT} />
        <WithFontScale scale={2}>
          <Badge label="Sensitive" tone="outline" />
        </WithFontScale>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Badge label="Project" tone="outline" icon="projects" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <Badge label="Draft" />
            <Badge label="Worktree" tone="outline" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Badge', component: BadgeGallery } satisfies Meta<typeof BadgeGallery>;
export default meta;
export const AllTones: StoryObj<typeof meta> = {};
