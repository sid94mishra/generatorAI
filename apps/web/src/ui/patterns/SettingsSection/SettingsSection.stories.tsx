import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { EmptyState } from '../../primitives/EmptyState/EmptyState.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { NumberField } from '../../primitives/NumberField/NumberField.js';
import { SegmentedControl } from '../../primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '../../primitives/Switch/Switch.js';
import { SectionHeader } from '../SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection, SettingsStatusFooter, SettingsTable } from './SettingsSection.js';

interface McpServer {
  id: string;
  name: string;
  transport: string;
  status: 'connected' | 'disconnected';
}

const SERVERS: McpServer[] = [
  { id: '1', name: 'filesystem', transport: 'stdio', status: 'connected' },
  { id: '2', name: 'linear', transport: 'http', status: 'connected' },
  { id: '3', name: 'stale-server', transport: 'stdio', status: 'disconnected' },
];

function AppearanceSection() {
  const [density, setDensity] = useState('comfortable');
  const [autoUpdate, setAutoUpdate] = useState(true);
  return (
    <SettingsSection title="Appearance" description="Theme, density and motion for this device.">
      <SettingRow
        label="Density"
        hint="Comfortable adds more breathing room to lists and rows."
        control={
          <SegmentedControl
            label="Density"
            semantics="radio"
            value={density}
            onValueChange={setDensity}
            items={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
          />
        }
      />
      <SettingRow
        label="Install updates automatically"
        control={<Switch aria-label="Install updates automatically" checked={autoUpdate} onCheckedChange={setAutoUpdate} />}
      />
    </SettingsSection>
  );
}

function RetentionSection() {
  const [days, setDays] = useState<number | null>(30);
  return (
    <SettingsSection title="Storage" description="How long finished runs and worktrees are kept.">
      <SettingRow
        label="Retention"
        hint="Older worktrees are reclaimed automatically."
        control={<NumberField aria-label="Retention in days" size="sm" min={1} max={365} unit="days" value={days} onValueChange={setDays} />}
      />
    </SettingsSection>
  );
}

function McpSection() {
  return (
    <SettingsSection title="MCP servers" description="Servers available to every agent in this workspace.">
      <SectionHeader title="Configured servers" count={SERVERS.length} variant="title" level={3} />
      <SettingsTable
        label="MCP servers"
        columns={[
          { id: 'name', header: 'Name', width: '1fr', cell: (row: McpServer) => row.name },
          { id: 'transport', header: 'Transport', width: 120, mono: true, cell: (row: McpServer) => row.transport },
          {
            id: 'status',
            header: 'Status',
            width: 120,
            cell: (row: McpServer) => (
              <span className={row.status === 'connected' ? 'text-ok' : 'text-fg-3'}>{row.status}</span>
            ),
          },
        ]}
        rows={SERVERS}
        getRowId={(row) => row.id}
        rowActions={() => <IconButton icon="trash" label="Remove server" size="sm" />}
      />
    </SettingsSection>
  );
}

const meta = {
  component: SettingsSection,
  tags: ['vrt-themes'],
  args: { title: 'Section' },
  decorators: [(Story) => <div className="w-160">{Story()}</div>],
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One section: title + description, two rows, a group heading and a table. */
export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <AppearanceSection />
      <McpSection />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(canvas.getByRole('table', { name: 'MCP servers' })).toBeVisible();
    await expect(canvas.getByText('filesystem')).toBeVisible();
  },
};

/** A stacked full-width block under a row (theme tiles stand-in), a NumberField row, and the footer status bar. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <SettingsSection title="Theme" description="Applies instantly on this device.">
        <SettingRow
          label="Accent colour"
          stacked={
            <div className="mt-2 grid grid-cols-6 gap-2">
              {['bg-run', 'bg-ok', 'bg-warn', 'bg-err', 'bg-fg', 'bg-fg-3'].map((tone) => (
                <div key={tone} className={`size-6 rounded-badge ${tone}`} />
              ))}
            </div>
          }
          control={<span className="text-small text-fg-3">Blue</span>}
        />
      </SettingsSection>
      <RetentionSection />
      <SettingsTable
        label="Empty extensions"
        columns={[{ id: 'name', header: 'Name', width: '1fr', cell: (row: McpServer) => row.name }]}
        rows={[]}
        getRowId={(row) => row.id}
        empty={<EmptyState icon="mcp" title="No extensions installed" />}
      />
      <SettingsStatusFooter>Changes apply instantly</SettingsStatusFooter>
      <SettingsStatusFooter icon="check">Saved on this device</SettingsStatusFooter>
    </div>
  ),
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
