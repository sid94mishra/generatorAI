import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { SectionHeader } from './SectionHeader';

const noop = (): void => undefined;

function SectionHeaderGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="list (Pinned / Recent), home (Needs you + warn count + See all), label (drawer)">
        <SectionHeader title="Pinned" icon="pin" />
        <SectionHeader title="Recent" count={42} />
        <SectionHeader title="Needs you" variant="home" count={3} countTone="warn" action={{ label: 'See all', onPress: noop }} />
        <SectionHeader title="Running" variant="label" count={3} />
      </StorySection>
      <StorySection title="Long title, font scale 2.0, right to left">
        <SectionHeader title={LONG_TEXT} action={{ label: 'See all', onPress: noop }} />
        <WithFontScale scale={2}>
          <SectionHeader title="Needs you" variant="home" count={3} countTone="warn" />
        </WithFontScale>
        <RightToLeft>
          <SectionHeader title="Recent" count={42} action={{ label: 'See all', onPress: noop }} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <SectionHeader title="Needs you" variant="home" count={3} countTone="warn" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/SectionHeader', component: SectionHeaderGallery } satisfies Meta<typeof SectionHeaderGallery>;
export default meta;
export const Variants: StoryObj<typeof meta> = {};
