import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { StatStrip } from './StatStrip';

const noop = (): void => undefined;
const TILES = [
  { id: 'needs', value: 3, label: 'Need you', tone: 'warn' as const, onPress: noop },
  { id: 'running', value: 2, label: 'Running', tone: 'run' as const, onPress: noop },
  { id: 'done', value: 14, label: 'Finished today', onPress: noop },
];
const WEEK = [
  { id: 'runs', value: 128, label: 'Runs' },
  { id: 'rate', value: '94%', label: 'Succeeded' },
  { id: 'cost', value: null, label: 'Spend' },
];

function StatStripGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Tiles (Home): warn / run / fg tones, pressable">
        <StatStrip variant="tiles" items={TILES} />
      </StorySection>
      <StorySection title="Strip (“This week”): unknown value reads —">
        <StatStrip variant="strip" items={WEEK} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <StatStrip variant="tiles" items={TILES} />
        </WithFontScale>
        <RightToLeft>
          <StatStrip variant="strip" items={WEEK} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StatStrip variant="tiles" items={TILES} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/StatStrip', component: StatStripGallery } satisfies Meta<typeof StatStripGallery>;
export default meta;
export const Variants: StoryObj<typeof meta> = {};
