import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DockTabStrip, type DockTab } from '../../patterns/DockTabStrip/DockTabStrip.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { DockFrame, DockPanel, type DockMode } from './DockFrame.js';

// Fixed demo frames (story scaffolding, D-45): the main card at 1440 and at 1100.
const FRAME_WIDE = 'h-[640px] w-[1180px]';
const FRAME_NARROW = 'h-[640px] w-[860px]';

const TABS: DockTab[] = [
  { id: 'changes', label: 'Changes', icon: 'changes', count: 2 },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'browser' },
];

function Demo({
  mode = 'panel',
  initialOpen = true,
  initialMaximized = false,
  splitId = 'story-dock',
}: {
  mode?: DockMode;
  initialOpen?: boolean;
  initialMaximized?: boolean;
  splitId?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [active, setActive] = useState('changes');
  const [maximized, setMaximized] = useState(initialMaximized);
  return (
    <div className={`${mode === 'panel' ? FRAME_WIDE : FRAME_NARROW} flex flex-col overflow-hidden rounded-panel border border-line-soft bg-surface`}>
      <div className="flex h-bar shrink-0 items-center gap-2 border-b border-line-soft px-4 text-ui text-fg">
        <span className="flex-1">payments-service / Fix flaky checkout test</span>
        <IconButton icon="dock" label={open ? 'Hide side pane' : 'Show side pane'} pressed={open} onClick={() => setOpen((o) => !o)} />
      </div>
      <DockFrame
        open={open}
        mode={mode}
        maximized={maximized}
        splitId={splitId}
        layoutStorageKey={`${splitId}:layout`}
        onUserCollapse={() => setOpen(false)}
        onEscape={() => (maximized ? setMaximized(false) : setOpen(false))}
        labels={{ dock: 'Right side pane', sheet: 'Side pane', separator: 'Resize right pane' }}
        testIds={{ dock: 'right-pane', sheet: 'dock-sheet' }}
        main={
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-7 text-body text-fg-2">
            <p>The coupon request and the total recalculation race each other.</p>
            <p>The total now derives from the coupon response instead of a second fetch.</p>
          </div>
        }
        strip={
          <DockTabStrip
            tabs={TABS}
            value={active}
            onValueChange={setActive}
            compact={mode !== 'panel'}
            maximized={maximized}
            {...(mode !== 'full' ? { onMaximize: () => setMaximized((m) => !m) } : {})}
            onClose={() => setOpen(false)}
            addItems={[{ value: 'widget', label: 'Widget', icon: 'widgets' }]}
          />
        }
      >
        {TABS.map((tab) => (
          <DockPanel key={tab.id} active={tab.id === active} label={tab.label} data-testid={`panel-${tab.id}`}>
            <div className="p-4 text-ui text-fg-2">{tab.label} panel</div>
          </DockPanel>
        ))}
      </DockFrame>
    </div>
  );
}

/** S-08: the right dock inside the main card — tab strip, panels, resizable separator. */
const meta = {
  component: DockFrame,
  tags: ['vrt-themes'],
  parameters: { layout: 'centered' },
  args: {
    main: null,
    strip: null,
    children: null,
    open: true,
    mode: 'panel',
    splitId: 'meta',
  },
  render: () => <Demo />,
} satisfies Meta<typeof DockFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ≥ 1200px: an inline panel; inactive panels stay mounted, hidden with visibility. */
export const Panel: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('right-pane')).toHaveAttribute('data-state', 'open');
    await expect(canvas.queryByTestId('dock-sheet')).toBeNull();
    const inactive = canvas.getByTestId('panel-files');
    await expect(inactive).toHaveAttribute('aria-hidden', 'true');
    await expect(getComputedStyle(inactive).visibility).toBe('hidden');
    await expect(getComputedStyle(inactive).display).not.toBe('none');
  },
};

/** The separator is keyboard-operable and the layout persists only after the user resizes. */
export const KeyboardResize: Story = {
  render: () => <Demo splitId="story-dock-kbd" />,
  play: async ({ canvasElement }) => {
    window.localStorage.removeItem('story-dock-kbd:layout');
    const canvas = within(canvasElement);
    const separator = canvas.getByRole('separator', { name: 'Resize right pane' });
    await expect(separator).toHaveAttribute('tabindex', '0');
    const dock = canvas.getByTestId('right-pane');
    const before = Math.round(dock.getBoundingClientRect().width);
    separator.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    // The body follows the spacer: the dock got wider.
    await waitFor(() => expect(Math.round(dock.getBoundingClientRect().width)).toBeGreaterThan(before));
    await waitFor(() => expect(window.localStorage.getItem('story-dock-kbd:layout')).not.toBeNull());
  },
};

/** Closed: collapsed to 0 and hidden, never unmounted. */
export const Closed: Story = {
  render: () => <Demo initialOpen={false} />,
  play: async ({ canvas }) => {
    const dock = canvas.getByTestId('right-pane');
    await expect(dock).toHaveAttribute('data-state', 'closed');
    await expect(canvas.getByTestId('panel-changes')).toBeInTheDocument();
    await expect(canvas.queryByRole('separator')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Show side pane' }));
    await expect(dock).toHaveAttribute('data-state', 'open');
  },
};

/** Maximize: the dock covers the main card; the chat column is hidden. */
export const Maximized: Story = {
  render: () => <Demo initialMaximized />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true');
    await expect(canvas.getByRole('button', { name: 'Restore' })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** < 1200px: the S-09 non-modal sheet (no backdrop, no aria-modal), compact strip with Close. */
export const Sheet: Story = {
  render: () => <Demo mode="sheet" />,
  play: async ({ canvas }) => {
    const sheet = canvas.getByTestId('dock-sheet');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(sheet).not.toHaveAttribute('aria-modal');
    await expect(canvas.queryByRole('separator')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Close dock' }));
    await expect(canvas.getByTestId('right-pane')).toHaveAttribute('data-state', 'closed');
  },
};

/** Viewport < 768 (or a host under 760): the sheet takes the whole card; no Maximize. */
export const FullWidth: Story = {
  render: () => <Demo mode="full" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('right-pane')).toHaveAttribute('data-narrow', 'true');
    await expect(canvas.queryByRole('button', { name: 'Maximize' })).toBeNull();
  },
};
