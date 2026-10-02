import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { LargeTitle } from './LargeTitle';

function LargeTitleGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="With a count, without (iOS only; Android draws the count in its bar)">
        <LargeTitle title="Chats" count={48} />
        <LargeTitle title="Projects" />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <LargeTitle title="Chats" count={1280} />
        </WithFontScale>
        <RightToLeft>
          <LargeTitle title="Chats" count={7} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <LargeTitle title="Chats" count={48} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/LargeTitle', component: LargeTitleGallery } satisfies Meta<typeof LargeTitleGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};
