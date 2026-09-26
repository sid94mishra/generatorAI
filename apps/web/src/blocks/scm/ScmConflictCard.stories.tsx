import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { ScmConflictCard } from './ScmConflictCard.js';

const onResolveManually = fn();
const onAbort = fn();
const onContinue = fn();
const onOpenFile = fn();

const meta = {
  component: ScmConflictCard,
  tags: ['vrt-themes'],
  args: {
    conflicts: {
      base: 'main',
      head: 'fix/checkout-flake',
      files: ['src/cart/applyCoupon.ts', 'tests/checkout.spec.ts'],
      mergeStarted: false,
    },
    mode: 'idle',
    canAskAgent: true,
    onResolveManually,
    onAskAgent: fn(),
    onContinue,
    onAbort,
  },
  decorators: [(Story) => <div className="w-115">{Story()}</div>],
} satisfies Meta<typeof ScmConflictCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing applied yet: three genuinely different decisions. */
export const Idle: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-conflict-files')).toHaveTextContent('src/cart/applyCoupon.ts');
    await userEvent.click(canvas.getByRole('button', { name: 'Resolve manually' }));
    await expect(onResolveManually).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Abort' }));
    await expect(onAbort).toHaveBeenCalledOnce();
  },
};

/** No chat in scope (a workflow run): no "Ask the agent". */
export const WithoutChat: Story = {
  args: { canAskAgent: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Ask the agent' })).toBeNull();
  },
};

/** The merge is applied: edit (or open) the files, then Continue. */
export const Manual: Story = {
  args: { mode: 'manual', onOpenFile },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-conflict-instructions')).toHaveTextContent(/conflict markers/);
    await userEvent.click(canvas.getAllByRole('button', { name: 'Open in editor' })[0]!);
    await expect(onOpenFile).toHaveBeenCalledWith('src/cart/applyCoupon.ts');
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await expect(onContinue).toHaveBeenCalledOnce();
  },
};

/** The agent is resolving the files in this chat. */
export const Agent: Story = {
  args: { mode: 'agent' },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-conflict-instructions')).toHaveTextContent(/agent is resolving/i);
  },
};

/** Continue is running. */
export const Busy: Story = {
  args: { mode: 'manual', busy: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-conflict-continue')).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByTestId('scm-conflict-abort')).toBeDisabled();
  },
};

/** Continue was premature: the paths still unresolved. */
export const Unresolved: Story = {
  args: { mode: 'manual', error: 'Still unresolved: src/cart/applyCoupon.ts' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('src/cart/applyCoupon.ts');
  },
};

/** Continue succeeded (the transcript card, where nothing re-runs the flow). */
export const Resolved: Story = {
  args: { mode: 'resolved' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Merge resolved.');
  },
};
