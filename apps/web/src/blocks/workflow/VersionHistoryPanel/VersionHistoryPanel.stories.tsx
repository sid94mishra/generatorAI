import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { VersionChip } from '../chips/WorkflowChips.js';
import { DRAFT_ID, VersionHistoryPanel, type VersionHistoryPanelProps, type VersionHistoryRow } from './VersionHistoryPanel.js';

const VERSIONS: VersionHistoryRow[] = [
  { id: 'v7', version: 7, kind: 'published', createdAt: new Date(2026, 8, 22), hash: '3f9a1c2e7d', live: true },
  { id: 'v6', version: 6, kind: 'published', createdAt: new Date(2026, 8, 15), hash: 'b81e07d44a' },
  { id: 'v5', version: 5, kind: 'test', createdAt: new Date(2026, 8, 9), hash: '9c4d2aa010' },
  { id: 'v4', version: 4, kind: 'published', createdAt: new Date(2026, 7, 30), hash: 'e02b5f1c9d' },
  { id: 'v3', version: 3, kind: 'published', createdAt: new Date(2026, 7, 21), hash: '71ac3e9b2b' },
  { id: 'v2', version: 2, kind: 'published', createdAt: new Date(2026, 7, 14), hash: '51ab0e9c11' },
  { id: 'v1', version: 1, kind: 'published', createdAt: new Date(2026, 7, 2), hash: '0c3e7aa712' },
];

const DRAFT: VersionHistoryPanelProps['draft'] = {
  badges: (
    <>
      <VersionChip status="draft" />
      <Badge icon="agents">Agent draft</Badge>
    </>
  ),
  revision: 13,
  meta: 'Never published',
  note: 'Publishing makes it v8 and replaces v7 for new runs.',
};

function Stateful(args: VersionHistoryPanelProps) {
  const [selected, setSelected] = useState<string[]>([...args.selected]);
  return <VersionHistoryPanel {...args} selected={selected} onSelectionChange={setSelected} />;
}

const meta = {
  component: VersionHistoryPanel,
  args: {
    intro: 'Every run pins the version it started on. Run 248 ran v7.',
    draft: DRAFT,
    versions: VERSIONS,
    selected: ['v7', 'v6'],
    onSelectionChange: fn(),
    onCompare: fn(),
    compared: true,
    onRestore: fn(),
    onClose: fn(),
    diff: {
      title: 'v6 ↔ v7',
      summary: '3 stages, 1 edge',
      rows: [
        { id: '1', op: 'changed', subject: { kind: 'stage', key: 'assess_risk' }, field: 'session.reasoningEffort', before: '"medium"', after: '"high"' },
        { id: '2', op: 'added', subject: { kind: 'stage', key: 'check_licenses' }, detail: 'Check licenses (check)' },
        { id: '3', op: 'changed', subject: { kind: 'stage', key: 'apply_upgrades' }, field: 'retry.maxAttempts', before: '2', after: '3' },
        { id: '4', op: 'added', subject: { kind: 'edge', from: 'assess_risk', to: 'notify_owner' }, detail: "success, when max_risk == 'high'" },
        { id: '5', op: 'removed', subject: { kind: 'stage', key: 'old_notify' }, detail: 'Old notify (agent)' },
      ],
    },
  },
  render: (args) => <Stateful {...args} />,
  decorators: [
    (Story) => (
      <div className="flex min-h-200 justify-end bg-sunken">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VersionHistoryPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Restore v6 as draft/ }));
    await expect(args.onRestore).toHaveBeenCalledWith('v6');
    await userEvent.click(canvas.getByRole('button', { name: '2 older' }));
    await expect(canvas.getByText('v1')).toBeInTheDocument();
  },
};

export const CompareWithDraft: Story = {
  args: { selected: ['v7', DRAFT_ID], compared: false, diff: { title: 'v7 ↔ Draft', rows: [], summary: '' } },
};

export const DiffLoading: Story = { args: { diff: { title: 'v6 ↔ v7', rows: [], loading: true } } };

export const Loading: Story = { args: { versions: undefined, loading: true, diff: null, selected: [] } };

export const Empty: Story = { args: { versions: [], diff: null, selected: [] } };

export const LoadError: Story = { args: { versions: undefined, error: 'Request failed (500)', diff: null, selected: [] } };

export const RestoreFailed: Story = { args: { restoreError: 'Could not load the version' } };
