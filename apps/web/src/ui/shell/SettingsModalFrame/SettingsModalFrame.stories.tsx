import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { NavItem } from '../../primitives/NavItem/NavItem.js';
import { SearchInput } from '../../primitives/SearchInput/SearchInput.js';
import { Switch } from '../../primitives/Switch/Switch.js';
import { SectionHeader } from '../../patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection, SettingsStatusFooter } from '../../patterns/SettingsSection/SettingsSection.js';
import { SettingsModalFrame } from './SettingsModalFrame.js';

const GROUPS = [
  { label: 'App', items: ['General', 'Appearance'] },
  { label: 'Agents & models', items: ['Providers', 'Agents', 'Skills', 'MCP servers', 'Templates'] },
  { label: 'System', items: ['Security', 'Storage', 'Diagnostics'] },
];

function Nav({ active, onSelect }: { active: string; onSelect: (item: string) => void }) {
  const [query, setQuery] = useState('');
  return (
    <>
      <SearchInput size="sm" label="Search settings" placeholder="Search" value={query} onValueChange={setQuery} className="mb-2.5" />
      {GROUPS.map((group) => (
        <div key={group.label}>
          <SectionHeader title={group.label} variant="label" className="mt-2" />
          {group.items.map((item) => (
            <NavItem key={item} label={item} dense active={item === active} render={<a href="#" onClick={(e) => (e.preventDefault(), onSelect(item))} />} />
          ))}
        </div>
      ))}
    </>
  );
}

function Demo() {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState('Appearance');
  const [autoUpdate, setAutoUpdate] = useState(true);
  return (
    <SettingsModalFrame open={open} onOpenChange={setOpen} nav={<Nav active={active} onSelect={setActive} />} footer={<SettingsStatusFooter>Changes apply instantly</SettingsStatusFooter>}>
      <SettingsSection title={active} description={`Settings for ${active.toLowerCase()}.`}>
        <SettingRow
          label="Install updates automatically"
          control={<Switch aria-label="Install updates automatically" checked={autoUpdate} onCheckedChange={setAutoUpdate} />}
        />
        <SettingRow label="Version" control={<span className="text-small text-fg-3">2026.9.1</span>} />
      </SettingsSection>
    </SettingsModalFrame>
  );
}

const meta = {
  component: SettingsModalFrame,
  tags: ['vrt-themes'],
  args: { open: true, onOpenChange: () => undefined, nav: null, children: null },
} satisfies Meta<typeof SettingsModalFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Searchable nav (grouped, dense rows) beside the active section; a footer status bar. The Dialog portals to
 * `document.body`, so its content is queried with `screen`, not `canvas` (scoped to the story root). */
export const Default: Story = {
  render: () => <Demo />,
  play: async () => {
    await expect(await screen.findByRole('link', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    await expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(screen.getByText('Changes apply instantly')).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Security' }));
    await expect(screen.getByRole('heading', { name: 'Security' })).toBeVisible();
  },
};

/** The visible close button (found by testid — the dialog also keeps a sr-only Close for touch readers) closes it. */
export const Closes: Story = {
  render: () => <Demo />,
  play: async () => {
    const closeButton = await screen.findByTestId('settings-modal-close');
    await userEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument());
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: () => <Demo /> };
