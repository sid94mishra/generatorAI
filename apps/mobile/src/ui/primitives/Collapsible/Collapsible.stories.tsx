import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Collapsible } from './Collapsible';

function CollapsibleGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Collapsed and expanded">
        <Collapsible header={<Text role="subhead" weight={600}>Read 3 files, ran 2 commands</Text>} accessibilityLabel="Steps">
          <Text role="footnote" tone="fg-2">{LONG_TEXT}</Text>
        </Collapsible>
        <Collapsible defaultExpanded header={<Text role="subhead" weight={600}>Provider settings</Text>} accessibilityLabel="Provider settings">
          <Text role="footnote" tone="fg-2">Expanded by default.</Text>
        </Collapsible>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Collapsible header={<Text>Header</Text>} accessibilityLabel="Header">
            <Text>Body</Text>
          </Collapsible>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Collapsible defaultExpanded header={<Text>Header</Text>} accessibilityLabel="Header">
            <Text tone="fg-2">Body</Text>
          </Collapsible>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Collapsible', component: CollapsibleGallery } satisfies Meta<typeof CollapsibleGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};
