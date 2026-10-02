import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { StatusBadge } from '../../primitives/StatusBadge';
import { FactStrip } from './FactStrip';

const FACTS = [
  { label: 'Status', value: <StatusBadge state="failed" size="sm" /> },
  { label: 'Exit code', value: '1', mono: true },
  { label: 'Duration', value: '48.2s', mono: true },
];

function FactStripGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Step detail: status, exit code, duration; two facts">
        <FactStrip facts={FACTS} />
        <FactStrip facts={[{ label: 'Trigger', value: 'Schedule' }, { label: 'Next run', value: '02:00', mono: true }]} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <FactStrip facts={FACTS} />
        </WithFontScale>
        <RightToLeft>
          <FactStrip facts={FACTS} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <FactStrip facts={FACTS} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/FactStrip', component: FactStripGallery } satisfies Meta<typeof FactStripGallery>;
export default meta;
export const Facts: StoryObj<typeof meta> = {};
