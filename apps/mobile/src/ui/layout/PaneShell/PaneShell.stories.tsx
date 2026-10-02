import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Text } from '../../primitives/Text';
import { PaneTabStrip } from '../PaneTabStrip';
import { PaneShell } from './PaneShell';

function Sample({ mode }: { mode: 'overlay' | 'fullscreen' | 'docked' }): React.ReactElement {
  const [active, setActive] = useState('changes');
  return (
    <View className="h-96 overflow-hidden rounded-card border border-line-soft bg-surface">
      <PaneShell
        title="Workspace"
        subtitle="Fix flaky checkout test"
        mode={mode}
        onToggleFullscreen={() => undefined}
        onClose={() => undefined}
        onBackToChat={() => undefined}
        tabs={
          <PaneTabStrip
            tabs={[
              { id: 'changes', type: 'changes', label: 'Changes', icon: 'changes', count: 2 },
              { id: 'files', type: 'files', label: 'Files', icon: 'files' },
              { id: 'terminal', type: 'terminal', label: 'Terminal', icon: 'terminal' },
              { id: 'browser', type: 'browser', label: 'Browser', icon: 'browser' },
            ]}
            active={active}
            onSelect={setActive}
            accessibilityLabel="Workspace tabs"
          />
        }
      >
        <View className="flex-1 items-center justify-center">
          <Text role="subhead" tone="fg-2">{`${active} body`}</Text>
        </View>
      </PaneShell>
    </View>
  );
}

function PaneShellGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Overlay / docked">
        <Sample mode="overlay" />
      </StorySection>
      <StorySection title="Full screen: Back to chat + Exit full screen, tabs kept">
        <Sample mode="fullscreen" />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Sample mode="docked" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/PaneShell', component: PaneShellGallery } satisfies Meta<typeof PaneShellGallery>;
export default meta;
export const Modes: StoryObj<typeof meta> = {};
