import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { STATUS_STATES } from '@generatorai/shared';
import { Text } from '../Text';
import { StatusDot } from './StatusDot';

function StatusDotGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="States (with the word beside, MD-25)">
        {STATUS_STATES.map((state) => (
          <StoryRow key={state}>
            <StatusDot state={state} />
            <Text role="footnote">{state}</Text>
          </StoryRow>
        ))}
      </StorySection>
      <StorySection title="Health, sm, ring, hollow">
        <StoryRow>
          <StatusDot health="ok" size="sm" label="Connected" />
          <StatusDot health="warn" label="Reconnecting" />
          <StatusDot health="err" ring label="Disconnected" />
          <StatusDot health="idle" hollow label="Offline" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <StatusDot state="running" label="Running" />
            <StatusDot state="needs_you" label="Needs you" />
            <StatusDot state="failed" label="Failed" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/StatusDot', component: StatusDotGallery } satisfies Meta<typeof StatusDotGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};
