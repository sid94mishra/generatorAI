import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Icon } from '../../icons/Icon.js';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Spinner } from '../../primitives/Spinner/Spinner.js';
import { DiffStat } from '../DiffStat/DiffStat.js';
import { StepRail, type StepRailItem } from './StepRail.js';

// Stand-in for C-23 CodeBlock (scaffolding, D-45): the rail takes any node for `detail`.
const code = (text: string) => (
  <pre className="overflow-x-auto rounded-card border border-line-soft bg-sunken p-2 font-mono text-small text-fg-2">{text}</pre>
);

const ITEMS: StepRailItem[] = [
  {
    id: 'read',
    glyph: <Icon concept="file-text" size={16} className="text-fg-3" />,
    verb: 'Read',
    target: 'src/payments/checkout.test.ts',
    result: '212 lines',
    resultTone: 'muted',
    time: '0.2s',
  },
  {
    id: 'edit',
    glyph: <Icon concept="edit" size={16} className="text-fg-3" />,
    verb: 'Edited',
    target: 'src/payments/checkout.ts',
    result: <DiffStat added={12} removed={3} />,
    time: '1.4s',
    expandable: true,
    detail: code("-  await flush();\n+  await flush({ timeout: 5_000 });\n+  expect(cart.total).toBe(42);"),
  },
  {
    id: 'test',
    glyph: <Icon concept="status-failed" size={16} className="text-err" />,
    verb: 'Ran',
    target: 'pnpm vitest run checkout',
    result: '2 failed',
    resultTone: 'err',
    time: '8.1s',
    expandable: true,
    detail: code('FAIL  checkout.test.ts > applies coupon\n  Expected 42, received 40'),
  },
  {
    id: 'retry',
    glyph: <Spinner size={16} />,
    verb: 'Running',
    target: 'pnpm vitest run checkout --retry 2',
    result: 'running',
    resultTone: 'run',
  },
];

const meta = {
  component: StepRail,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { items: ITEMS, label: 'Steps', onExpandedChange: fn() },
  decorators: [(Story) => <div className="w-dock bg-surface p-3">{Story()}</div>],
} satisfies Meta<typeof StepRail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rows with glyph · verb · target · result · time; expandable rows open their detail. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('list', { name: 'Steps' })).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(4);
    const edit = canvas.getByRole('button', { name: /Edited/ });
    await expect(edit).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(edit);
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await expect(args.onExpandedChange).toHaveBeenCalledWith('edit', true);
    await waitFor(() => expect(canvas.getByText(/timeout: 5_000/)).toBeVisible());
    await userEvent.keyboard('{Enter}');
    await expect(edit).toHaveAttribute('aria-expanded', 'false');
    // Non-expandable rows are not buttons.
    await expect(canvas.queryByRole('button', { name: /Read/ })).toBeNull();
  },
};

/** Result tones, an open row, a long target truncating, a single row (no rail line). */
export const Matrix: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <StepRail {...args} defaultExpandedIds={['test']} />
      <div className="w-72">
        <StepRail
          label="Truncation"
          items={[
            {
              id: 'long',
              glyph: <Icon concept="status-succeeded" size={16} className="text-ok" />,
              verb: 'Read',
              target: 'packages/client-runtime/src/transport/very/deeply/nested/websocketReconnect.ts',
              result: 'ok',
              resultTone: 'ok',
              time: '0.1s',
            },
            {
              id: 'warn',
              glyph: <Icon concept="warning" size={16} className="text-warn" />,
              verb: 'Skipped',
              target: 'e2e/checkout.spec.ts',
              result: 'needs Docker',
              resultTone: 'warn',
            },
          ]}
        />
      </div>
      <StepRail label="Single" items={[ITEMS[0]!]} />
    </div>
  ),
};

function ControlledRail() {
  const [open, setOpen] = useState<string[]>(['edit']);
  return (
    <div className="flex flex-col gap-2">
      <StepRail
        items={ITEMS}
        label="Controlled steps"
        expandedIds={open}
        onExpandedChange={(id, expanded) => setOpen((prev) => (expanded ? [...prev, id] : prev.filter((x) => x !== id)))}
      />
      <span className="text-small text-fg-3" data-testid="open-ids">
        {open.join(',')}
      </span>
    </div>
  );
}

/** `expandedIds` + `onExpandedChange` hold the open rows outside the rail. */
export const Controlled: Story = {
  render: () => <ControlledRail />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Edited/ })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(canvas.getByRole('button', { name: /Ran/ }));
    await expect(canvas.getByTestId('open-ids')).toHaveTextContent('edit,test');
    await userEvent.click(canvas.getByRole('button', { name: /Edited/ }));
    await expect(canvas.getByTestId('open-ids')).toHaveTextContent('test');
  },
};

/** Tab reaches the first expandable row; Space toggles it. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const edit = canvas.getByRole('button', { name: /Edited/ });
    await expect(edit).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
  },
};

/** `actions` sit after the row, outside its toggle (never a button inside a button); `busy` marks a live row; `below` is always shown under its row. */
export const WithActions: Story = {
  args: {
    items: [
      { ...ITEMS[1]!, actions: <IconButton icon="diff" label="Show in changes" size="sm" onClick={fn()} /> },
      { ...ITEMS[3]!, busy: true, actions: <IconButton icon="terminal" label="Open in terminal" size="sm" onClick={fn()} /> },
      {
        ...ITEMS[2]!,
        id: 'below',
        expandable: false,
        below: <p className="rounded-control bg-sunken px-2 py-1 font-mono text-small text-err">BrowserService: max concurrent sessions (5) reached</p>,
      },
    ],
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('button', { name: /Edited/ });
    const action = canvas.getByRole('button', { name: 'Show in changes' });
    await expect(toggle.contains(action)).toBe(false);
    await userEvent.click(action);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** Compact density: rows draw 24h and stay ≥ 24×24 targets. */
export const TargetSize: Story = {
  globals: { density: 'compact' },
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
