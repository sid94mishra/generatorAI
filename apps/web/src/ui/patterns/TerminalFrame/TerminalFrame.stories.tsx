import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Badge } from '../../primitives/Badge/Badge.js';
import { Button } from '../../primitives/Button/Button.js';
import { StatusDot } from '../../primitives/StatusDot/StatusDot.js';
import { FindWidget } from '../FindWidget/FindWidget.js';
import { TerminalFrame } from './TerminalFrame.js';

// Scaffolding (D-45): the xterm host is a plain block of output lines.
const OUTPUT = [
  '~/payments-service $ pnpm vitest run checkout',
  ' RUN  v3.2.4 /Users/dev/payments-service',
  ' ✓ checkout.test.ts > computes totals (12 ms)',
  ' ✗ checkout.test.ts > applies coupon',
  '   Expected 42, received 40',
  ' Test Files  1 failed (1)',
  '~/payments-service $ ',
];

function Output() {
  return (
    <div data-testid="terminal-container">
      {OUTPUT.map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line}
        </div>
      ))}
    </div>
  );
}

function Instances() {
  const [active, setActive] = useState('1');
  return (
    <>
      {['1', '2'].map((id) => (
        <Button key={id} variant="ghost" size="sm" icon="terminal" pressed={active === id} onClick={() => setActive(id)}>
          {`zsh ${id}`}
        </Button>
      ))}
      <span className="min-w-0 truncate font-mono text-micro text-fg-3" data-testid="terminal-cwd">
        ~/payments-service
      </span>
      <Badge>pty</Badge>
    </>
  );
}

const status = (
  <>
    <StatusDot tone="ok" size="sm" />
    <span>Connected · zsh · pid 48213</span>
  </>
);

const meta = {
  component: TerminalFrame,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: {
    toolbar: <Instances />,
    status,
    children: <Output />,
    onClear: fn(),
    onKill: fn(),
  },
  render: (args) => <TerminalFrame {...args} data-testid="terminal-panel" />,
  decorators: [(Story) => <div className="flex h-[384px] w-dock flex-col bg-surface">{Story()}</div>],
} satisfies Meta<typeof TerminalFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Toolbar (instances, cwd, host) + Clear + Kill; key-owning body; status footer. */
export const Default: Story = {
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByTestId('terminal-panel')).toBeVisible();
    await expect(canvasElement.querySelector('[data-gai-keys="own"]')).toContainElement(canvas.getByTestId('terminal-container'));
    await userEvent.click(canvas.getByRole('button', { name: 'Clear scrollback' }));
    await expect(args.onClear).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Kill the terminal process' }));
    await expect(args.onKill).toHaveBeenCalledOnce();
    await expect(canvas.getByText(/Connected/)).toBeVisible();
  },
};

function WithFindFrame() {
  const [query, setQuery] = useState('checkout');
  return (
    <TerminalFrame
      toolbar={<Instances />}
      status={status}
      onClear={() => undefined}
      onKill={() => undefined}
      find={
        <FindWidget
          query={query}
          onQueryChange={setQuery}
          matches={{ current: 1, total: 4 }}
          onPrev={() => undefined}
          onNext={() => undefined}
          onClose={() => undefined}
        />
      }
    >
      <Output />
    </TerminalFrame>
  );
}

/** C-32 FindWidget floated top-right over the body, outside the key-owning element. */
export const WithFind: Story = {
  render: () => <WithFindFrame />,
  play: async ({ canvas, canvasElement }) => {
    const search = canvas.getByRole('search');
    await expect(search).toBeVisible();
    await expect(canvasElement.querySelector('[data-gai-keys="own"]')).not.toContainElement(search);
  },
};

/** Kill disabled, no footer, toolbar without actions. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex h-[192px] flex-col">
        <TerminalFrame toolbar={<Instances />} onClear={() => undefined} onKill={() => undefined} killDisabled>
          <div className="text-fg-3">Process exited with code 1.</div>
        </TerminalFrame>
      </div>
      <div className="flex h-[192px] flex-col">
        <TerminalFrame toolbar={<span className="text-small text-fg-3">Connecting…</span>} status="Waiting for the workspace">
          <Output />
        </TerminalFrame>
      </div>
    </div>
  ),
};

/** Tab reaches the instance tabs first, then Clear and Kill. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'zsh 1' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Clear scrollback' })).toHaveFocus();
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** Compact density: sm buttons draw 20px and keep a 24px hit area. */
export const TargetSize: Story = {
  globals: { density: 'compact' },
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
