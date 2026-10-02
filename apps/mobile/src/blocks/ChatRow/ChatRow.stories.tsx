import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../ui/storybook/StoryKit';
import { ChatRow } from './ChatRow';
import { chatRowView, type ChatRowActionId, type ChatRowView } from './chatRowModel';

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
const show = (id: ChatRowActionId, row: ChatRowView): void => Alert.alert(row.title, id);
const ROWS: ChatRowView[] = [
  chatRowView({ id: 'a', title: 'Fix flaky checkout test', status: { state: 'needs_you' }, archived: false, pinned: true, projectName: 'payments-service', agentName: 'Bug Fixer', changes: { files: 2, additions: 18, deletions: 8 }, lastActivityAt: minutesAgo(3), tags: [] }),
  chatRowView({ id: 'b', title: 'Upgrade React Flow to v12', status: { state: 'running' }, archived: false, unread: true, projectName: 'web-dashboard', agentName: 'Orchestrator', changes: { files: 9, additions: 146, deletions: 92 }, lastActivityAt: minutesAgo(0), tags: [] }),
  chatRowView({ id: 'c', title: 'Refactor pricing module', status: { state: 'succeeded' }, archived: false, projectName: 'payments-service', modelLabel: 'Claude Opus 5.5', lastActivityAt: minutesAgo(12), tags: [] }),
  chatRowView({ id: 'd', title: 'Never ran', status: null, archived: false, lastActivityAt: minutesAgo(90), tags: [] }),
  chatRowView({ id: 'e', title: 'Old experiment', status: null, archived: true, lastActivityAt: minutesAgo(60 * 24 * 9), tags: [] }),
];

function Selection(): React.ReactElement {
  const [selected, setSelected] = useState(false);
  return <ChatRow row={ROWS[0]!} onAction={show} selection={{ selected, onToggle: () => setSelected((v) => !v) }} />;
}

function ChatRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Pinned + needs you · running + unread · model-only · never ran · archived (swipe, long-press)">
        <View>
          {ROWS.map((row) => (
            <ChatRow key={row.id} row={row} onAction={show} />
          ))}
        </View>
      </StorySection>
      <StorySection title="Selection mode (MD-60)">
        <Selection />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ChatRow row={ROWS[1]!} onAction={show} swipe={false} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'Blocks/ChatRow', component: ChatRowGallery } satisfies Meta<typeof ChatRowGallery>;
export default meta;
export const Rows: StoryObj<typeof meta> = {};
