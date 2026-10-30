import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Count } from './Count';

function CountGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Inline (fg-3, warn, run) and capped">
        <StoryRow>
          <Count value={12} />
          <Count value={3} tone="warn" />
          <Count value={5} tone="run" />
          <Count value={128} max={99} />
        </StoryRow>
      </StorySection>
      <StorySection title="Bubble (pane toggle) and dot (pane tab)">
        <StoryRow>
          <Count value={2} form="bubble" />
          <Count value={4} form="bubble" tone="run" />
          <Count value={120} form="bubble" max={99} />
          <Count value={1} form="dot" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <Count value={12} />
            <Count value={2} form="bubble" />
            <Count value={1} form="dot" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Count', component: CountGallery } satisfies Meta<typeof CountGallery>;
export default meta;
export const Forms: StoryObj<typeof meta> = {};
