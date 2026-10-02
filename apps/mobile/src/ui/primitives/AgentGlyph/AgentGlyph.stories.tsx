import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { AgentGlyph } from './AgentGlyph';

function AgentGlyphGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Agent, model only, team, you (never initials)">
        <AgentGlyph kind="agent" name="Bug Fixer" model="Sonnet 5" />
        <AgentGlyph kind="model" name="Claude Sonnet 5" />
        <AgentGlyph kind="team" name="Orchestrator" members={['Bug Fixer', 'Code Reviewer', 'Test Writer']} />
        <AgentGlyph kind="you" name="You" />
        <AgentGlyph kind="agent" name="Bug Fixer" locked />
      </StorySection>
      <StorySection title="Sizes 12 / 16 / 20">
        <AgentGlyph kind="agent" name="Bug Fixer" size={12} />
        <AgentGlyph kind="agent" name="Bug Fixer" size={16} />
        <AgentGlyph kind="agent" name="Bug Fixer" size={20} />
      </StorySection>
      <StorySection title="Long name, right to left">
        <AgentGlyph kind="agent" name={LONG_TEXT} model="Sonnet 5" />
        <RightToLeft>
          <AgentGlyph kind="agent" name="Bug Fixer" model="Sonnet 5" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <AgentGlyph kind="agent" name="Bug Fixer" model="Sonnet 5" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/AgentGlyph', component: AgentGlyphGallery } satisfies Meta<typeof AgentGlyphGallery>;
export default meta;
export const Kinds: StoryObj<typeof meta> = {};
