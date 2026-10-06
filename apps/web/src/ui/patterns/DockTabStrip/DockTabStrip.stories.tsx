import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { DockTabStrip, type DockAddItem, type DockTab, type DockTabStripProps } from './DockTabStrip.js';

const TABS: DockTab[] = [
  { id: 'changes', label: 'Changes', icon: 'changes', count: 3, testId: 'right-pane-tab-changes' },
  { id: 'files', label: 'Files', icon: 'files', testId: 'right-pane-tab-files' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', closable: true, dot: { tone: 'run', label: 'Running' } },
  { id: 'browser', label: 'Browser', icon: 'browser', closable: true },
];

const MANY_TABS: DockTab[] = [
  ...TABS,
  { id: 'tasks', label: 'Tasks', icon: 'tasks', count: 12 },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'terminal-2', label: 'Terminal 2', icon: 'terminal', closable: true },
  { id: 'browser-2', label: 'Browser 2', icon: 'browser', closable: true, overflowTestId: 'right-pane-overflow-browser' },
];

const ADD_ITEMS: DockAddItem[] = [
  { value: 'widget', label: 'Widget', icon: 'widgets' },
  { value: 'browser', label: 'Browser', icon: 'browser', description: '1 of 5 open' },
  { value: 'terminal', label: 'Terminal', icon: 'terminal', description: '4 of 4 open', disabled: true },
];

type ControlledProps = Omit<DockTabStripProps, 'value' | 'onValueChange'> & { initial?: string; width?: 'dock' | 'narrow' };

/** Holds the active tab and the tab set (so close works); `width` stands in for the dock frame. */
function Controlled({ initial, width = 'dock', tabs: initialTabs, onCloseTab, ...props }: ControlledProps) {
  const [tabs, setTabs] = useState(initialTabs);
  const [value, setValue] = useState(initial ?? initialTabs[0]?.id ?? '');
  return (
    <div className={width === 'dock' ? 'w-dock bg-surface' : 'w-72 bg-surface'}>
      <DockTabStrip
        {...props}
        tabs={tabs}
        value={value}
        onValueChange={setValue}
        onCloseTab={(id) => {
          onCloseTab?.(id);
          setTabs((prev) => prev.filter((t) => t.id !== id));
          if (id === value) setValue(tabs[0]?.id ?? '');
        }}
      />
    </div>
  );
}

const meta = {
  component: DockTabStrip,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: {
    tabs: TABS,
    value: 'changes',
    onValueChange: fn(),
    addItems: ADD_ITEMS,
    onAddSelect: fn(),
    onMaximize: fn(),
    onClose: fn(),
    onCloseTab: fn(),
    testIds: { add: 'right-pane-add-tab', maximize: 'right-pane-fullscreen', close: 'right-pane-close' },
  },
  decorators: [(Story) => <div className="min-h-80">{Story()}</div>],
  render: (args) => <Controlled {...args} initial={args.value} />,
} satisfies Meta<typeof DockTabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wide dock: tabs with count and dot, "+", spacer, Maximize. Click and arrow keys + Enter select. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const list = canvas.getByRole('tablist', { name: 'Side dock' });
    await waitFor(() => expect(list).toBeVisible());
    await expect(canvas.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(canvas.getByTestId('right-pane-tab-changes')).toBeVisible());
    await userEvent.click(canvas.getByRole('tab', { name: /Files/ }));
    await expect(canvas.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await expect(canvas.getByRole('tab', { name: /Terminal/ })).toHaveAttribute('aria-selected', 'true');
    // Close (narrow only) is absent in the wide layout.
    await expect(canvas.queryByRole('button', { name: 'Close dock' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Maximize' }));
    await expect(args.onMaximize).toHaveBeenCalledOnce();
  },
};

/** Wide × narrow, maximized, a plain "+" (onAdd, no menu), no maximize. */
export const Matrix: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Controlled {...args} initial="changes" />
      <Controlled {...args} initial="terminal" maximized />
      <Controlled {...args} initial="files" compact width="narrow" onMaximize={undefined} />
      <Controlled {...args} tabs={TABS.slice(0, 2)} addItems={undefined} onAdd={fn()} testIds={undefined} />
    </div>
  ),
};

/** Narrow sheet: inactive tabs icon-only (label = name), Close shown, no Maximize. */
export const Compact: Story = {
  args: { compact: true, onMaximize: undefined },
  render: (args) => <Controlled {...args} initial="changes" width="narrow" />,
  play: async ({ canvas, args }) => {
    const files = canvas.getByRole('tab', { name: 'Files' });
    await expect(files).not.toHaveTextContent('Files');
    await waitFor(() => expect(canvas.getByRole('tab', { name: 'Terminal (Running)' })).toBeVisible());
    await userEvent.click(files);
    await expect(files).toHaveAttribute('aria-selected', 'true');
    await expect(files).toHaveTextContent('Files');
    await expect(canvas.queryByRole('button', { name: 'Maximize' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Close dock' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** "+" opens the D-19 menu ("Open another panel"); disabled rows stay unselectable. */
export const AddMenu: Story = {
  play: async ({ canvas, args }) => {
    const add = canvas.getByRole('button', { name: 'Add tab' });
    await expect(add).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(add);
    await screen.findByRole('menu');
    await expect(document.querySelector('[data-gai-overlay="menu"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByText('Open another panel')).toBeVisible());
    await expect(screen.getByRole('menuitem', { name: /Terminal/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: /Widget/ }));
    await expect(args.onAddSelect).toHaveBeenCalledWith('widget');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  },
};

/** Too many tabs for the width: the hidden ones are listed under "More tabs" in the "+" menu. */
export const Overflow: Story = {
  args: { tabs: MANY_TABS },
  render: (args) => <Controlled {...args} initial="changes" width="narrow" />,
  play: async ({ canvas }) => {
    const add = await canvas.findByRole('button', { name: /^Add tab, \d+ more$/ });
    await userEvent.click(add);
    await screen.findByRole('menu');
    await waitFor(() => expect(screen.getByText('More tabs')).toBeVisible());
    await userEvent.click(screen.getByTestId('right-pane-overflow-browser'));
    const picked = canvas.getByRole('tab', { name: /Browser 2/ });
    await expect(picked).toHaveAttribute('aria-selected', 'true');
    // Scrolled into view: the picked tab is no longer an overflow row.
    await userEvent.click(canvas.getByRole('button', { name: /^Add tab/ }));
    await screen.findByRole('menu');
    await expect(screen.queryByTestId('right-pane-overflow-browser')).toBeNull();
    await userEvent.keyboard('{Escape}');
  },
};

/** Closable tabs: the inline x (pointer) and Delete on the focused tab (keyboard). */
export const CloseTab: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: /Browser/ }));
    // The x is pointer-only (aria-hidden), found by its label like the desktop smokes do.
    const x = canvasElement.querySelector<HTMLButtonElement>('button[aria-label="Close Browser tab"]');
    await expect(x).not.toBeNull();
    await userEvent.click(x!);
    await expect(args.onCloseTab).toHaveBeenCalledWith('browser');
    await waitFor(() => expect(canvas.queryByRole('tab', { name: /Browser/ })).toBeNull());
    const terminal = canvas.getByRole('tab', { name: /Terminal/ });
    await expect(terminal).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await userEvent.click(terminal);
    await userEvent.keyboard('{Delete}');
    await expect(args.onCloseTab).toHaveBeenCalledWith('terminal');
    // Non-closable tabs ignore Delete.
    await userEvent.click(canvas.getByRole('tab', { name: /Files/ }));
    await userEvent.keyboard('{Delete}');
    await waitFor(() => expect(canvas.getByRole('tab', { name: /Files/ })).toBeVisible());
  },
};

/** Tab lands on the active tab (one stop for the tablist), then the "+" button. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('tab', { name: /Changes/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Add tab' })).toHaveFocus();
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } }, render: Matrix.render };

/** Compact density: the ib-sm buttons draw at 20px and keep a 24px hit area. */
export const TargetSize: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
