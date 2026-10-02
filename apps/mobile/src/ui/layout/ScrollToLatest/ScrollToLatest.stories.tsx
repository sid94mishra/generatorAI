import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { GlassBackdrop, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ScrollToLatest } from './ScrollToLatest';

const noop = (): void => undefined;

function ScrollToLatestGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Latest, with new count, hidden">
        <GlassBackdrop>
          <ScrollToLatest visible onPress={noop} />
          <ScrollToLatest visible onPress={noop} newCount={3} />
          <ScrollToLatest visible={false} onPress={noop} />
        </GlassBackdrop>
      </StorySection>
      <StorySection title="Font scale 2.0">
        <WithFontScale scale={2}>
          <ScrollToLatest visible onPress={noop} />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ScrollToLatest visible onPress={noop} newCount={3} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ScrollToLatest', component: ScrollToLatestGallery } satisfies Meta<typeof ScrollToLatestGallery>;
export default meta;
export const Pill: StoryObj<typeof meta> = {};
