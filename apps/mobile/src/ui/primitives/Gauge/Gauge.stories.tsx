import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Gauge } from './Gauge';

function GaugeGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Thresholds: 40 %, 85 %, 97 % · sizes 32 / 20">
        <StoryRow>
          <Gauge value={0.4} label="Context 40%" />
          <Gauge value={0.85} label="Context 85%" />
          <Gauge value={0.97} label="Context 97%" />
          <Gauge value={0.6} size={20} label="Context 60%" />
          <Text role="monoSm" tone="fg-2">60%</Text>
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Gauge value={0.85} label="Context 85%" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Gauge', component: GaugeGallery } satisfies Meta<typeof GaugeGallery>;
export default meta;
export const Thresholds: StoryObj<typeof meta> = {};
