import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ActivityCard } from '../../patterns/ActivityCard/ActivityCard.js';
import { SectionHeader } from '../../patterns/SectionHeader/SectionHeader.js';
import { EmptyState } from '../../primitives/EmptyState/EmptyState.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { SegmentedControl } from '../../primitives/SegmentedControl/SegmentedControl.js';
import { ActivityColumn, ActivityColumnHeader, ActivityCountBadge, ActivityGroup } from './ActivityColumn.js';

/** The Activity column frame (D-92; boards EnhActivityColumn, EnhActivityCards "Header, … empty"). */
const meta = {
  component: ActivityColumn,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { width: 288, minWidth: 248, maxWidth: 400, defaultWidth: 288, header: null, children: null },
} satisfies Meta<typeof ActivityColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

const header = (
  <ActivityColumnHeader
    badges={
      <span className="flex items-center gap-1">
        <ActivityCountBadge tone="warn" count={3} label="3 need you" />
        <ActivityCountBadge tone="run" count={4} label="4 running" />
        <ActivityCountBadge tone="err" count={1} label="1 failed" />
      </span>
    }
    actions={
      <>
        <IconButton icon="filter" label="Filter activity" size="sm" />
        <IconButton icon="x" label="Hide activity" size="sm" />
      </>
    }
  >
    Activity
  </ActivityColumnHeader>
);

function Tabs() {
  const [value, setValue] = useState('all');
  return (
    <SegmentedControl
      semantics="tabs"
      fullWidth
      label="Activity kind"
      value={value}
      onValueChange={setValue}
      items={[
        { value: 'all', label: 'All', count: 10 },
        { value: 'chat', ariaLabel: 'Chats', icon: 'chats', count: 3 },
        { value: 'orchestrator', ariaLabel: 'Orchestrators', icon: 'users', count: 2 },
        { value: 'workflow', ariaLabel: 'Workflows', icon: 'workflows', count: 4 },
        { value: 'automation', ariaLabel: 'Automations', icon: 'automations', count: 1 },
      ]}
    />
  );
}

const body = (
  <>
    <ActivityGroup aria-label="Needs you">
      <SectionHeader variant="label" title="Needs you" count={1} countTone="warn" className="px-1.5" />
      <ActivityCard tone="ask" selected kindIcon="chats" kindLabel="Chat" title="Fix flaky checkout test" time="3m" line={{ tone: 'warn', icon: 'hand', text: 'Allow git push?', mono: true }} meta={['Bug Fixer', 'Sonnet 5']} link={<a href="#a" />} />
    </ActivityGroup>
    <ActivityGroup aria-label="Running">
      <SectionHeader variant="label" title="Running" count={1} className="px-1.5" />
      <ActivityCard kindIcon="workflows" kindLabel="Workflow run" title="PR review pipeline" time="1:05" line={{ tone: 'run', icon: 'status-running', text: 'Review diff', spin: true }} stages={['done', 'current', 'pending', 'pending']} meta={['Stage 2 of 4']} link={<a href="#b" />} />
    </ActivityGroup>
    <ActivityGroup aria-label="Recent">
      <SectionHeader variant="label" title="Recent" count="today" className="px-1.5" />
      <ActivityCard kindIcon="chats" kindLabel="Chat" title="Audit IAM policies" time="13:05" line={{ tone: 'ok', icon: 'status-succeeded', text: 'Done' }} meta={['Security Bot', 'Sonnet 5']} link={<a href="#c" />} />
    </ActivityGroup>
  </>
);

/** Docked beside the sidebar: header + badges, kind tabs, groups; resizable from its right edge. */
function DockedDemo() {
  const [width, setWidth] = useState(288);
  return (
    <div className="flex h-[640px] bg-ground">
      <ActivityColumn width={width} minWidth={248} maxWidth={400} defaultWidth={288} onWidthChange={setWidth} header={header} toolbar={<Tabs />}>
        {body}
      </ActivityColumn>
      <div className="m-2 flex-1 rounded-panel border border-line-soft bg-surface" />
    </div>
  );
}

export const Docked: Story = {
  render: () => <DockedDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('complementary', { name: 'Activity' })).toBeVisible();
    const separator = canvas.getByRole('separator', { name: 'Resize activity column' });
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(separator).toHaveAttribute('aria-valuenow', '304');
    await userEvent.keyboard('{Home}');
    await expect(separator).toHaveAttribute('aria-valuenow', '248');
    await expect(canvas.getByRole('img', { name: '3 need you' })).toBeVisible();
  },
};

/** Overlay: the same column floating over the main card in a narrow window (not resizable). */
export const Overlay: Story = {
  render: (args) => (
    <div className="relative flex h-[640px] bg-ground">
      <div className="w-rail shrink-0" />
      <div className="m-2 flex-1 rounded-panel border border-line-soft bg-surface" />
      <ActivityColumn {...args} variant="overlay" offsetLeft={48} header={header} toolbar={<Tabs />}>
        {body}
      </ActivityColumn>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const column = within(canvasElement).getByRole('complementary', { name: 'Activity' });
    await expect(column).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(within(column).queryByRole('separator')).toBeNull();
  },
};

/** Nothing running today: the empty state. */
export const Empty: Story = {
  render: (args) => (
    <div className="flex h-[480px] bg-ground">
      <ActivityColumn {...args} header={<ActivityColumnHeader>Activity</ActivityColumnHeader>}>
        <EmptyState
          framed
          icon="activity"
          title="Nothing running"
          description="Chats, workflow runs and automations show up here while they work and for the rest of the day after they finish."
          className="mt-2 border-dashed"
        />
      </ActivityColumn>
    </div>
  ),
};
