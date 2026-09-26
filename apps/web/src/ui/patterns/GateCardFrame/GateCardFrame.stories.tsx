import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { GateCardFrame, type GateAction } from './GateCardFrame.js';

const deny = fn();
const allow = fn();

const ACTIONS: GateAction[] = [
  { label: 'Deny', variant: 'ghost', shortcut: ['Esc'], onClick: deny },
  { label: 'Allow once', variant: 'secondary', shortcut: ['↵'] },
  { label: 'Always allow', variant: 'primary', shortcut: ['Ctrl', '↵'], onClick: allow },
];

const command = (
  <pre className="overflow-x-auto rounded-control border border-line-soft bg-sunken px-2.5 py-2 font-mono text-small text-fg-2">
    pnpm --filter @generatorai/web test --run
  </pre>
);

const meta = {
  component: GateCardFrame,
  tags: ['vrt-themes'],
  args: {
    icon: 'terminal',
    title: 'Run a command',
    meta: 'Bash · apps/web',
    explanation: 'Runs in the chat workspace',
    actions: ACTIONS,
    children: command,
  },
  decorators: [(Story) => <div className="w-160">{Story()}</div>],
} satisfies Meta<typeof GateCardFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Warn header by default; buttons carry their keyboard defaults as Kbd chips. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const card = canvas.getByRole('group', { name: 'Run a command' });
    await expect(card).toBeVisible();
    await expect(canvas.getByText('Esc')).toBeVisible();
    await expect(canvas.getByText('Ctrl ↵')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /Always allow/ }));
    await expect(allow).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: /Deny/ }));
    await expect(deny).toHaveBeenCalledOnce();
  },
};

/** tone warn · err · ok · run; with and without meta / explanation. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <GateCardFrame icon="hand" title="Approve file edit" meta="src/app.tsx" explanation="Edits 1 file" actions={ACTIONS}>
        <p className="text-ui text-fg-2">Replace the router setup with the new route modules.</p>
      </GateCardFrame>
      <GateCardFrame
        tone="err"
        icon="warning"
        title="Command failed"
        meta="exit 1"
        actions={[{ label: 'Retry', variant: 'primary', shortcut: ['↵'] }]}
      >
        {command}
      </GateCardFrame>
      <GateCardFrame tone="ok" icon="plan" title="Plan ready" meta="Step 3 of 5" actions={[{ label: 'Start', variant: 'primary' }]}>
        <p className="text-ui text-fg-2">Five steps, about 20 minutes.</p>
      </GateCardFrame>
      <GateCardFrame
        tone="run"
        icon="message"
        title="The agent has a question"
        explanation="Answering continues the run"
        actions={[
          { label: 'Skip', variant: 'ghost', shortcut: ['Esc'] },
          { label: 'Answer', variant: 'primary', shortcut: ['↵'] },
        ]}
      >
        <p className="text-ui text-fg-2">Should the migration keep the old table until the next release?</p>
      </GateCardFrame>
      <GateCardFrame icon="shield" title="Read-only notice" actions={[]}>
        <p className="text-ui text-fg-2">No action row when there are no actions or explanation.</p>
      </GateCardFrame>
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: /Deny/ })).toHaveFocus();
  },
};

/** The sm action buttons keep 24×24 targets at compact density. */
export const Compact: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
