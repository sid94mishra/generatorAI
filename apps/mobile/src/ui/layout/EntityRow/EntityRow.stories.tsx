import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import type { MenuEntry } from '../../native/Menu/Menu.types';
import { AgentGlyph } from '../../primitives/AgentGlyph';
import { Button } from '../../primitives/Button';
import { DiffStat } from '../../primitives/DiffStat';
import { StatusBadge } from '../../primitives/StatusBadge';
import { Text } from '../../primitives/Text';
import { EntityRow } from './EntityRow';

const noop = (): void => undefined;
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
const MENU: MenuEntry[] = [
  { id: 'pin', label: 'Pin', icon: 'pin' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { type: 'separator' },
  { id: 'delete', label: 'Delete', icon: 'trash', destructive: true },
];
const show = (id: string): void => Alert.alert('Menu', id);
const project = (
  <Text role="monoSm" tone="fg-3">
    payments-service
  </Text>
);

function Selecting(): React.ReactElement {
  const [checked, setChecked] = useState(false);
  return <EntityRow title="Draft release notes 2.4" leading={{ checkbox: checked }} meta={['docs-site']} onPress={() => setChecked((v) => !v)} />;
}

function EntityRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Chats: needs you + menu, running + timer, unread + pinned, archived, diff stat">
        <View className="ios:rounded-group ios:bg-raised">
          <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} meta={[project, <AgentGlyph key="a" kind="agent" name="Bug Fixer" size={12} />]} time={minutesAgo(3)} menu={MENU} onMenuSelect={show} onPress={noop} />
          <EntityRow title="React Flow to v12" leading={{ status: 'running' }} meta={[<AgentGlyph key="m" kind="model" name="Claude Opus 5.5" size={12} />]} time={minutesAgo(0)} trailing={<StatusBadge state="running" size="sm" elapsedSince={minutesAgo(4)} />} onPress={noop} />
          <EntityRow title="Draft release notes 2.4" leading={{ status: 'succeeded' }} meta={['docs-site', 'Claude Sonnet 5']} time={minutesAgo(60)} unread pinned trailing={<DiffStat additions={14} deletions={6} />} onPress={noop} />
          <EntityRow title="Old experiment" leading={{ status: 'skipped' }} meta={['sandbox']} time={minutesAgo(60 * 24 * 9)} archived onPress={noop} />
        </View>
      </StorySection>
      <StorySection title="Icon leading + row action, selected, selection mode">
        <EntityRow title="Nightly dependency audit" leading={{ icon: 'automations' }} meta={['Daily 02:00']} trailing={<Button label="Run" size="sm" variant="tonal" onPress={noop} />} onPress={noop} />
        <EntityRow title="payments-service" leading={{ icon: 'projects' }} meta={['3 codebases']} selected onPress={noop} />
        <Selecting />
      </StorySection>
      <StorySection title="Long text, font scale 2.0, right to left">
        <EntityRow title={LONG_TEXT} leading={{ status: 'failed' }} meta={[LONG_TEXT]} time={minutesAgo(5)} onPress={noop} />
        <WithFontScale scale={2}>
          <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} meta={['payments-service']} time={minutesAgo(3)} onPress={noop} />
        </WithFontScale>
        <RightToLeft>
          <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} meta={['payments-service']} time={minutesAgo(3)} onPress={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} meta={['payments-service']} time={minutesAgo(3)} unread onPress={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/EntityRow', component: EntityRowGallery } satisfies Meta<typeof EntityRowGallery>;
export default meta;
export const ChatRows: StoryObj<typeof meta> = {};
