import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { NewAction } from './NewAction';

const noop = (): void => undefined;

function Toggle(): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <View className="gap-2">
      <Button label={collapsed ? 'Expand (scroll up)' : 'Collapse (scroll down)'} size="sm" onPress={() => setCollapsed((v) => !v)} />
      <View className="rounded-card bg-sunken pt-4">
        <NewAction label="New chat" icon="plus" onPress={noop} collapsed={collapsed} testID="home-new-chat" />
      </View>
    </View>
  );
}

function NewActionGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Expanded ↔ collapsed (iOS glass capsule / Android Extended FAB)">
        <Toggle />
      </StorySection>
      <StorySection title="Per module labels, long label, font scale 2.0">
        <NewAction label="New workflow" icon="workflows" onPress={noop} />
        <NewAction label="Run" icon="play" onPress={noop} />
        <NewAction label={LONG_TEXT.slice(0, 30)} icon="plus" onPress={noop} />
        <WithFontScale scale={2}>
          <NewAction label="New chat" icon="plus" onPress={noop} />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <NewAction label="New chat" icon="plus" onPress={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/NewAction', component: NewActionGallery } satisfies Meta<typeof NewActionGallery>;
export default meta;
export const ExpandCollapse: StoryObj<typeof meta> = {};
