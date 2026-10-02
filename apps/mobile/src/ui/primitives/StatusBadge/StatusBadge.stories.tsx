import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { STATUS_STATES } from '@generatorai/shared';
import { StatusBadge } from './StatusBadge';

const started = new Date(Date.now() - 252_000).toISOString();

function StatusBadgeGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="8 states · run context · md">
        <StoryRow>
          {STATUS_STATES.map((state) => (
            <StatusBadge key={state} state={state} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Chat context (Done) · sm">
        <StoryRow>
          {STATUS_STATES.map((state) => (
            <StatusBadge key={state} state={state} context="chat" size="sm" />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Phase, detail, elapsed, label override">
        <StatusBadge state="running" phase="Finalizing" />
        <StatusBadge state="running" detail="Bug Fixer" elapsedSince={started} />
        <StatusBadge state="skipped" label="Cancelled" />
        <StatusBadge state="needs_you" detail={LONG_TEXT} />
      </StorySection>
      <StorySection title="Font scale 2.0 (chrome cap 1.4)">
        <WithFontScale scale={2}>
          <StatusBadge state="failed" />
        </WithFontScale>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <StatusBadge state="running" detail="Orchestrator" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <StatusBadge state="running" />
            <StatusBadge state="needs_you" />
            <StatusBadge state="succeeded" />
            <StatusBadge state="failed" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/StatusBadge', component: StatusBadgeGallery } satisfies Meta<typeof StatusBadgeGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
