import React from 'react';
import { Alert, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../../primitives/Text';
import { TopAppBar } from './TopAppBar';

const noop = (): void => undefined;
const say = (what: string) => () => Alert.alert(what);
const CRUMBS = [{ label: 'Chats', onPress: say('Chats') }, { label: 'payments-service', onPress: say('Project') }];

function Bars(): React.ReactElement {
  return (
    <View className="gap-4">
      <TopAppBar
        role="top"
        title="Chats"
        onSidebarToggle={noop}
        actions={[
          { id: 'search', icon: 'search', label: 'Search', onPress: noop },
          { id: 'select', icon: 'check', label: 'Select chats', onPress: noop, testID: 'chats-select' },
          { id: 'sort', icon: 'sort', label: 'Sort', onPress: noop },
        ]}
      />
      <TopAppBar
        role="top"
        title="Home"
        largeTitle
        onSidebarToggle={noop}
        subtitle={
          <Text role="footnote" tone="fg-3">
            Wed, Sep 23 · Connected local:3100
          </Text>
        }
        actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: noop }]}
      />
      <TopAppBar role="detail" title="Run 248" breadcrumb={[{ label: 'Workflows', onPress: noop }, { label: 'Nightly dependency audit', onPress: noop }]} onBack={noop} status={{ state: 'running' }} />
      <TopAppBar
        role="workspace"
        title="Fix flaky checkout test"
        breadcrumb={CRUMBS}
        onBack={noop}
        testIDs={{ back: 'chat-back' }}
        paneToggle={{ open: false, count: 2, attention: false, onPress: noop }}
        actions={[
          { id: 'rename', icon: 'edit', label: 'Rename', onPress: noop },
          { id: 'delete', icon: 'trash', label: 'Delete', destructive: true, onPress: noop },
        ]}
      />
      <TopAppBar role="modal" title="Edit agent" modal={{ onCancel: noop, primary: { label: 'Save', onPress: noop } }} />
    </View>
  );
}

function TopAppBarGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Android top app bar: module root (≤ 2 + ⋮), Home large headline, detail + status, workspace + pane toggle, modal">
        <Bars />
      </StorySection>
      <StorySection title="Long title, font scale 2.0 (one action + overflow), right to left">
        <TopAppBar role="detail" title={LONG_TEXT} breadcrumb={CRUMBS} onBack={noop} />
        <WithFontScale scale={2}>
          <TopAppBar role="top" title="Chats" onSidebarToggle={noop} actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: noop }, { id: 'sort', icon: 'sort', label: 'Sort', onPress: noop }]} />
        </WithFontScale>
        <RightToLeft>
          <TopAppBar role="detail" title="Fix flaky checkout test" breadcrumb={CRUMBS} onBack={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <TopAppBar role="workspace" title="Fix flaky checkout test" breadcrumb={CRUMBS} onBack={noop} paneToggle={{ open: true, count: 0, attention: true, onPress: noop }} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/TopAppBar', component: TopAppBarGallery } satisfies Meta<typeof TopAppBarGallery>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
