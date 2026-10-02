import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Card } from './Card';

function CardGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Radius card / group / gate · outlined · padding">
        <Card><Text>card</Text></Card>
        <Card radius="group" outlined><Text>group, outlined</Text></Card>
        <Card radius="gate" padding="sm"><Text>gate, sm padding</Text></Card>
      </StorySection>
      <StorySection title="Pressable (scales on iOS, ripples on Android)">
        <Card onPress={() => undefined} accessibilityLabel="Open project payments-service">
          <Text role="headline">payments-service</Text>
          <Text role="footnote" tone="fg-2">{LONG_TEXT}</Text>
        </Card>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Card outlined><Text>Card on surface</Text></Card>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Card', component: CardGallery } satisfies Meta<typeof CardGallery>;
export default meta;
export const Variants: StoryObj<typeof meta> = {};
