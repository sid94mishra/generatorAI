import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Separator } from './Separator';

function SeparatorGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Insets 0 / 16 / 56">
        <Text>Row</Text>
        <Separator />
        <Text>Row</Text>
        <Separator inset={16} />
        <Text>Row</Text>
        <Separator inset={56} />
        <Text>Row</Text>
      </StorySection>
      <StorySection title="Vertical and band">
        <StoryRow>
          <Text>Left</Text>
          <Separator orientation="vertical" />
          <Text>Right</Text>
        </StoryRow>
        <Separator variant="band" />
      </StorySection>
      <StorySection title="Right to left (inset follows start)">
        <RightToLeft>
          <Separator inset={56} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Separator />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Separator', component: SeparatorGallery } satisfies Meta<typeof SeparatorGallery>;
export default meta;
export const Variants: StoryObj<typeof meta> = {};
