import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { SegmentedControl } from './SegmentedControl';
import type { Segment } from './SegmentedControl.types';
import { SegmentedControlJs } from './SegmentedControlJs';

const MODE: Segment<string>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'plan', label: 'Plan' },
];
const FILTER: Segment<string>[] = [
  { value: 'all', label: 'All', count: 42 },
  { value: 'active', label: 'Active', count: 12 },
  { value: 'archived', label: 'Archived', count: 30 },
];
const PROVIDERS: Segment<string>[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'copilot', label: 'Copilot', locked: true },
  { value: 'gemini', label: 'Gemini', disabled: true },
];
const EFFORT: Segment<string>[] = ['Minimal', 'Low', 'Medium', 'High', 'Max'].map((l) => ({ value: l.toLowerCase(), label: l }));

function Live({ segments, initial, js, fullWidth, size }: { segments: Segment<string>[]; initial: string; js?: boolean; fullWidth?: boolean; size?: 'sm' | 'md' }): React.ReactElement {
  const [value, setValue] = useState(initial);
  const Control = js ? SegmentedControlJs : SegmentedControl;
  return <Control segments={segments} value={value} onValueChange={setValue} accessibilityLabel="Segments" fullWidth={fullWidth} size={size} testID="seg" />;
}

function SegmentedControlGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Native: two segments, full width">
        <Live segments={MODE} initial="auto" />
        <Live segments={MODE} initial="plan" fullWidth />
      </StorySection>
      <StorySection title="Drawn path: counts (MChats), locked + disabled, Android sm">
        <Live segments={FILTER} initial="all" fullWidth />
        <Live segments={PROVIDERS} initial="claude" fullWidth />
        <Live segments={MODE} initial="auto" js size="sm" />
      </StorySection>
      <StorySection title="Overflow → Select: 5 segments (MD-47), font scale 2.0">
        <Live segments={EFFORT} initial="medium" />
        <WithFontScale scale={2}>
          <Live segments={MODE} initial="auto" />
        </WithFontScale>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Live segments={FILTER} initial="active" fullWidth />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix (drawn path)">
        <ThemeMatrix>
          <Live segments={FILTER} initial="all" js fullWidth />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/SegmentedControl', component: SegmentedControlGallery } satisfies Meta<typeof SegmentedControlGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};
