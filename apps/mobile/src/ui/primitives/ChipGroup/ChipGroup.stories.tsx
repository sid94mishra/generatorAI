import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ChipGroup } from './ChipGroup';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active', count: 12 },
  { id: 'archived', label: 'Archived' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'unread', label: 'Unread' },
];

function Single(): React.ReactElement {
  const [value, setValue] = React.useState<string | string[]>('all');
  return <ChipGroup items={FILTERS} selection="single" value={value} onValueChange={setValue} accessibilityLabel="Filter chats" />;
}

function Multi(): React.ReactElement {
  const [value, setValue] = React.useState<string | string[]>(['active']);
  return <ChipGroup items={FILTERS} selection="multi" value={value} onValueChange={setValue} layout="wrap" accessibilityLabel="Tags" />;
}

function ChipGroupGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Single, scrolling">
        <Single />
      </StorySection>
      <StorySection title="Multi, wrapping">
        <Multi />
      </StorySection>
      <StorySection title="Wrap with max 3 (+N)">
        <ChipGroup items={FILTERS} layout="wrap" max={3} onItemPress={() => undefined} accessibilityLabel="Tags" />
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Single />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Single />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ChipGroup', component: ChipGroupGallery } satisfies Meta<typeof ChipGroupGallery>;
export default meta;
export const Selection: StoryObj<typeof meta> = {};
