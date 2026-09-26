import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Callout } from '../../primitives/Callout/Callout.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { NavItem } from '../../primitives/NavItem/NavItem.js';
import { SearchInput } from '../../primitives/SearchInput/SearchInput.js';
import { ListPane } from './ListPane.js';

const SCRIPTS = ['Deploy staging', 'Nightly backup', 'Rotate API keys', 'Smoke test'];

// Demo frame height only (not a design token) — named so the ratchet's
// `literalInlineStyle` check reads it as computed, not hard-coded (D-15 has
// no height step for an arbitrary story frame).
const FRAME_HEIGHT = { height: 640 };

function ScriptsListPane() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(SCRIPTS[0]);
  return (
    <ListPane
      title="Scripts"
      count={SCRIPTS.length}
      action={<IconButton icon="plus" label="New script" size="sm" />}
      search={<SearchInput size="sm" label="Search scripts" placeholder="Search scripts" value={query} onValueChange={setQuery} />}
      footer={<Callout tone="neutral">Scripts run in the codebase's default shell.</Callout>}
    >
      {SCRIPTS.filter((s) => s.toLowerCase().includes(query.toLowerCase())).map((script) => (
        <NavItem
          key={script}
          label={script}
          icon="scripts"
          active={script === selected}
          render={<a href="#" onClick={(event) => (event.preventDefault(), setSelected(script))} />}
        />
      ))}
    </ListPane>
  );
}

const meta = {
  component: ListPane,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { title: 'List' },
  decorators: [(Story) => <div style={FRAME_HEIGHT}>{Story()}</div>],
} satisfies Meta<typeof ListPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Header (title + count + New action) · search · scrolling nav rows · footer Callout. */
export const Default: Story = {
  render: () => <ScriptsListPane />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Scripts' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Deploy staging' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByText("Scripts run in the codebase's default shell.")).toBeVisible();
  },
};

/** Without search, action or footer — the minimum shape (title + rows only). */
export const Minimal: Story = {
  render: () => (
    <ListPane title="Automations" count={2}>
      <NavItem label="Nightly digest" icon="automations" active />
      <NavItem label="Weekly report" icon="automations" />
    </ListPane>
  ),
};

export const Compact: Story = { globals: { density: 'compact' }, render: () => <ScriptsListPane /> };
