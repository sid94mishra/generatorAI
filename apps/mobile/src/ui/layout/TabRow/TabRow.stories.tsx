import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { TabRow } from './TabRow';

const TABS = [
  { id: 'codebases', label: 'Codebases', count: 2 },
  { id: 'chats', label: 'Chats', count: 6 },
  { id: 'runs', label: 'Runs', count: 14 },
  { id: 'pull-requests', label: 'Pull requests' },
  { id: 'customization', label: 'Customization' },
  { id: 'settings', label: 'Settings' },
];

function Live({ initial = 'codebases' }: { initial?: string }): React.ReactElement {
  const [active, setActive] = useState(initial);
  return <TabRow tabs={TABS} active={active} onSelect={setActive} accessibilityLabel="Project sections" testID="tabs" />;
}

function TabRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Project tabs (first, scrolled to the last)">
        <Live />
        <Live initial="settings" />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Live />
        </WithFontScale>
        <RightToLeft>
          <Live />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/TabRow', component: TabRowGallery } satisfies Meta<typeof TabRowGallery>;
export default meta;
export const ProjectTabs: StoryObj<typeof meta> = {};
