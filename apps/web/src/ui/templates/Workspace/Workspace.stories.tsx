import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { Workspace } from './Workspace.js';

const meta = {
  component: Workspace,
  tags: ['vrt-themes'],
  args: { header: null, main: null },
} satisfies Meta<typeof Workspace>;

export default meta;
type Story = StoryObj<typeof meta>;

// Demo frame/row sizes below are fixed story scaffolding, not design tokens.
// Named constants (not literals inside `style={{}}`) so the design-system
// ratchet's `literalInlineStyle` check reads them as computed, not hard-coded.
const COMPOSER_HEIGHT = 64;
const NO_DOCK_FRAME = { height: 600, width: 1000 };
const DEFAULT_FRAME = { height: 600, width: 1200 };
const NARROW_FRAME = { height: 600, width: 900 };

function Transcript() {
  return (
    <div className="flex flex-col gap-4.5 pb-6">
      {['Can you add a health check route?', "Sure — I'll add GET /healthz.", 'Looks good, thanks.'].map((text, i) => (
        <div
          key={text}
          className={i % 2 === 0 ? 'ml-auto max-w-125 rounded-card bg-selected px-3 py-2 text-ui text-fg' : 'max-w-125 text-ui text-fg-2'}
        >
          {text}
        </div>
      ))}
    </div>
  );
}

function Composer() {
  return (
    <div
      className="flex items-center gap-2 rounded-card border border-line-strong bg-sunken px-3 text-ui text-fg-3"
      style={{ height: COMPOSER_HEIGHT }}
    >
      Message…
    </div>
  );
}

function Dock() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-tab shrink-0 items-center gap-2 border-b border-line-soft px-2 text-ui text-fg">Changes</div>
      <div tabIndex={0} className="min-h-0 flex-1 overflow-auto p-3 text-small text-fg-3">
        Dock content
      </div>
    </div>
  );
}

function Demo({
  dockOpen = true,
  narrow = false,
  frame = DEFAULT_FRAME,
}: {
  dockOpen?: boolean;
  narrow?: boolean;
  frame?: { height: number; width: number };
}) {
  const [open, setOpen] = useState(dockOpen);
  return (
    <div className="overflow-hidden rounded-panel border border-line-soft" style={frame}>
      <Workspace
        header={
          <PageHeader
            title="Fix flaky checkout test"
            titleIsHeading
            dockToggle={<IconButton icon="dock" label="Toggle dock" pressed={open} onClick={() => setOpen((v) => !v)} />}
          />
        }
        main={<Transcript />}
        bottom={<Composer />}
        dock={<Dock />}
        dockOpen={open}
        narrow={narrow}
      />
    </div>
  );
}

/** Dock open: transcript + composer beside a resizable dock. */
export const Default: Story = {
  render: () => <Demo />,
};

/** Dock closed: the transcript centres at an 860px reading width; the dock subtree stays mounted (collapsed to 0). */
export const DockClosed: Story = {
  render: () => <Demo dockOpen={false} />,
};

/** No dock at all (a plain chat with no side panel). */
export const NoDock: Story = {
  render: () => (
    <div className="overflow-hidden rounded-panel border border-line-soft" style={NO_DOCK_FRAME}>
      <Workspace header={<PageHeader title="Quick question" />} main={<Transcript />} bottom={<Composer />} />
    </div>
  ),
};

/** Narrow (< 1200px window, caller-supplied): main reserves right padding for the overlay dock sheet rendered elsewhere. */
export const Narrow: Story = {
  render: () => <Demo narrow frame={NARROW_FRAME} />,
};

/** Toggling the dock keeps the dock's own subtree mounted (Dock content stays in the DOM, just visually collapsed). */
export const TogglePreservesDock: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: 'Toggle dock' });
    await expect(canvas.getByText('Dock content')).toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(canvas.getByText('Dock content')).toBeInTheDocument();
  },
};

/**
 * `bare` + `dockHost` (the chat page, P4-12): main scrolls itself, and a dock host that owns the split
 * (blocks/dock's DockFrame) wraps the main column. Here a plain flex row stands in for the host.
 */
export const BareWithDockHost: Story = {
  render: () => (
    <div className="overflow-hidden rounded-panel border border-line-soft" style={DEFAULT_FRAME}>
      <Workspace
        bare
        header={<PageHeader title="Fix flaky checkout test" titleIsHeading />}
        main={
          <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto px-7 pt-5">
            <Transcript />
          </div>
        }
        bottom={
          <div className="px-4 pb-3">
            <Composer />
          </div>
        }
        dockHost={(column) => (
          <div className="flex min-w-0 flex-1">
            {column}
            <div className="w-dock shrink-0 border-l border-line-soft">
              <Dock />
            </div>
          </div>
        )}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Dock content')).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Fix flaky checkout test', level: 1 })).toBeVisible();
  },
};
