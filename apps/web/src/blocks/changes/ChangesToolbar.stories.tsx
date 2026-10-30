import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { ChangesToolbar, type ChangesToolbarProps } from './ChangesToolbar.js';
import type { DiffViewMode } from './diffTypes.js';
import type { TreePosition } from './useChangesViewSettings.js';

function Stateful(props: Partial<ChangesToolbarProps>) {
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const [wrapLines, setWrapLines] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [treePosition, setTreePosition] = useState<TreePosition>('left');
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  return (
    <div className="w-120 border border-line-soft bg-surface">
      <ChangesToolbar
        stats={{ files: 5, additions: 41, deletions: 28 }}
        keptCount={0}
        showTree={showTree}
        onToggleTree={() => setShowTree((v) => !v)}
        allExpanded={false}
        expandDisabled={false}
        onToggleExpandAll={fn()}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        wrapLines={wrapLines}
        onToggleWrapLines={() => setWrapLines((v) => !v)}
        treePosition={treePosition}
        onPlaceTree={(p) => {
          setTreePosition(p);
          setShowTree(true);
        }}
        checkpointsOpen={checkpointsOpen}
        onToggleCheckpoints={() => setCheckpointsOpen((v) => !v)}
        refreshing={false}
        onRefresh={fn()}
        {...props}
      />
    </div>
  );
}

const meta = {
  component: ChangesToolbar,
  tags: ['vrt-themes'],
  render: () => <Stateful />,
} satisfies Meta<typeof ChangesToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {} as ChangesToolbarProps,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('changes-count')).toHaveTextContent(/^5 changes$/);
    await userEvent.click(canvas.getByRole('button', { name: 'Show file tree' }));
    await expect(canvas.getByRole('button', { name: 'Hide file tree' })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** Something is kept: the header says how much is left to review. */
export const WithKept: Story = {
  args: {} as ChangesToolbarProps,
  render: () => <Stateful keptCount={2} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('changes-kept-count')).toHaveTextContent('3 to review · 2 kept');
  },
};

/** View settings: Unified / Split, Wrap lines, tree position; the menu stays open while toggling. */
export const ViewSettingsOpen: Story = {
  args: {} as ChangesToolbarProps,
  // The menu is non-modal (the diff stays scrollable), so Base UI brackets it
  // with focus-guard sentinels: aria-hidden spans with tabindex=0 that only
  // redirect Tab back into the menu. axe's aria-hidden-focus cannot tell them
  // from a real hidden control.
  parameters: { a11y: { config: { rules: [{ id: 'aria-hidden-focus', enabled: false }] } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'View settings' }));
    const split = await screen.findByRole('menuitemcheckbox', { name: 'Split view' });
    await userEvent.click(split);
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'Split view' })).toHaveAttribute('aria-checked', 'true'));
    await expect(screen.getByRole('menuitemcheckbox', { name: 'Unified view' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Right' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Hide file tree' })).toBeInTheDocument());
  },
};

/** Refreshing: the Refresh control spins and is disabled. */
export const Refreshing: Story = {
  args: {} as ChangesToolbarProps,
  render: () => <Stateful refreshing />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  },
};

/** No changes: counts only; Expand all has nothing to open. */
export const Empty: Story = {
  args: {} as ChangesToolbarProps,
  render: () => <Stateful stats={{ files: 0, additions: 0, deletions: 0 }} expandDisabled />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('changes-count')).toHaveTextContent('0 changes');
    await expect(canvas.getByRole('button', { name: 'Expand all files' })).toBeDisabled();
  },
};
