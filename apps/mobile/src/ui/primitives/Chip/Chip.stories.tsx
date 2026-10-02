import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Chip } from './Chip';

const noop = (): void => undefined;

function FilterToggle({ label }: { label: string }): React.ReactElement {
  const [on, setOn] = React.useState(false);
  return <Chip label={label} selected={on} onPress={() => setOn((v) => !v)} />;
}

function ChipGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Filter (toggle), with count">
        <StoryRow>
          <Chip label="All" selected onPress={noop} />
          <Chip label="Active" count={12} onPress={noop} />
          <FilterToggle label="Archived" />
          <Chip label="Disabled" disabled onPress={noop} />
        </StoryRow>
      </StorySection>
      <StorySection title="Dropdown, input, add, composer">
        <StoryRow>
          <Chip label="Sonnet 5" variant="dropdown" onPress={noop} />
          <Chip label="frontend" variant="input" onRemove={noop} />
          <Chip label="Tag" variant="add" icon="plus" onPress={noop} />
          <Chip label="Bug Fixer" variant="composer" locked icon="agents" onPress={noop} />
          <Chip label="Claude Sonnet 5" variant="composer" onPress={noop} />
        </StoryRow>
      </StorySection>
      <StorySection title="Attachment: uploading, failed">
        <StoryRow>
          <Chip label="screenshot.png" variant="attachment" icon="image" progress={0.4} onRemove={noop} />
          <Chip label="trace.log" variant="attachment" icon="file" error="Upload failed" onPress={noop} onRemove={noop} />
        </StoryRow>
      </StorySection>
      <StorySection title="Long label, font scale 2.0, right to left">
        <Chip label={LONG_TEXT} onPress={noop} />
        <WithFontScale scale={2}>
          <Chip label="Active" count={12} onPress={noop} />
        </WithFontScale>
        <RightToLeft>
          <Chip label="frontend" variant="input" onRemove={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <Chip label="All" selected onPress={noop} />
            <Chip label="Active" onPress={noop} />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Chip', component: ChipGallery } satisfies Meta<typeof ChipGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};
