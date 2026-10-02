import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { BrandMark } from './BrandMark';
import type { BrandMarkKind, BrandMarkSize } from './BrandMark.types';

const MARKS: BrandMarkKind[] = ['app', 'github', 'claude-agent', 'codex', 'copilot', 'opencode', 'acp'];
const SIZES: BrandMarkSize[] = [16, 20, 22, 26, 36];

function BrandMarkGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Marks at 26">
        <StoryRow>
          {MARKS.map((mark) => (
            <BrandMark key={mark} mark={mark} size={26} label={mark} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="App mark sizes">
        <StoryRow>
          {SIZES.map((size) => (
            <BrandMark key={size} mark="app" size={size} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix (accent tile, fg vendor marks)">
        <ThemeMatrix>
          <StoryRow>
            <BrandMark mark="app" size={36} />
            <BrandMark mark="github" size={26} />
            <BrandMark mark="claude-agent" size={26} />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/BrandMark', component: BrandMarkGallery } satisfies Meta<typeof BrandMarkGallery>;
export default meta;
export const AllMarks: StoryObj<typeof meta> = {};
