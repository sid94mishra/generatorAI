import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { AgentToolPolicy } from '@generatorai/shared';
import type { CatalogEntry } from '@/hooks/agentQueries.js';
import { TOOL_GROUP_LABELS } from '@/lib/agentCopy.js';
import { CapabilityToggleList, ToolPolicyTriState } from './CapabilityToggleList.js';

const ENTRIES: CatalogEntry[] = [
  { id: 'code-review', name: 'Code review', description: 'Review diffs for correctness and style.', source: 'system' },
  { id: 'release-notes', name: 'Release notes', description: 'Draft release notes from merged PRs.', source: 'project' },
  { id: 'test-writer', name: 'Test writer', source: 'system' },
];

const meta = {
  component: CapabilityToggleList,
  tags: ['vrt-themes'],
} satisfies Meta<typeof CapabilityToggleList>;

export default meta;
type Story = StoryObj<typeof meta>;

function Toggles() {
  const [selected, setSelected] = useState<string[]>(['code-review']);
  return (
    <div className="w-100">
      <CapabilityToggleList
        label="Skills"
        icon="skills"
        entries={ENTRIES}
        selectedIds={selected}
        onChange={setSelected}
        emptyHint="No skills in the catalog yet."
        data-testid="agent-skills"
      />
    </div>
  );
}

/** The "toggles" mode: AgentEditor Skills / MCP servers sections. */
export const Toggles_: Story = {
  name: 'Toggles',
  // `render` ignores `args`; a custom render (local state) needs its own
  // component, but the typed `Meta` still requires `args` to satisfy
  // `CapabilityToggleListProps`.
  args: { label: 'Skills', icon: 'skills', entries: ENTRIES, selectedIds: [], onChange: () => {}, emptyHint: '' },
  render: () => <Toggles />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('1/3 enabled')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('switch', { name: 'Test writer' }));
    await expect(canvas.getByText('2/3 enabled')).toBeInTheDocument();
  },
};

/** No catalog entries yet. */
export const Empty: Story = {
  args: {
    label: 'MCP servers',
    icon: 'mcp',
    entries: [],
    selectedIds: [],
    onChange: () => {},
    emptyHint: 'No MCP servers registered.',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No MCP servers registered.')).toBeInTheDocument();
  },
};

function TriState() {
  const [value, setValue] = useState<Partial<AgentToolPolicy>>({ shell: true, web: false });
  return (
    <div className="w-120">
      <ToolPolicyTriState
        value={value}
        onChange={setValue}
        effective={{ browser: true, widgets: true, extensionAuthoring: false, orchestration: false, fileRead: true, fileWrite: true, shell: true, web: false }}
        labels={TOOL_GROUP_LABELS}
        lockedGroups={{ orchestration: { value: true, reason: 'Always on for orchestrators — they cannot delegate without it.' } }}
        data-testid="agent-capabilities"
      />
    </div>
  );
}

/** The "tristate" mode: AgentEditor Capabilities — Inherit / On / Off per group, one group locked. */
export const TriState_: Story = {
  name: 'Tri-state',
  args: { label: 'Capabilities', icon: 'lock', entries: [], selectedIds: [], onChange: () => {}, emptyHint: '' },
  render: () => <TriState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Most groups inherit the platform default (several read "On").
    await expect(canvas.getAllByText('inherits On').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('set on this agent').length).toBeGreaterThan(0);
    await expect(canvas.getByText('Always on for orchestrators — they cannot delegate without it.')).toBeInTheDocument();
  },
};
