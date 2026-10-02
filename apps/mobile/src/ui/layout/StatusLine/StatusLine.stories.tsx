import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { StatusLine } from './StatusLine';

const since = new Date(Date.now() - 252_000).toISOString();

function StatusLineGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Running with a ticking timer + meta, needs you, succeeded with schedule">
        <StatusLine status={{ state: 'running', elapsedSince: since, detail: 'Bug Fixer' }} meta={['v7', 'last run 248']} />
        <StatusLine status={{ state: 'needs_you', label: 'Needs you · approve' }} />
        <StatusLine status={{ state: 'succeeded' }} meta={['daily 02:00']} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <StatusLine status={{ state: 'failed' }} meta={['exit 1']} />
        </WithFontScale>
        <RightToLeft>
          <StatusLine status={{ state: 'paused' }} meta={['v7']} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StatusLine status={{ state: 'needs_you' }} meta={['v7']} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/StatusLine', component: StatusLineGallery } satisfies Meta<typeof StatusLineGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};
