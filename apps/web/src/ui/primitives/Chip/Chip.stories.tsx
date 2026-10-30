import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Chip, ChipList } from './Chip.js';

function ToggleChip() {
  const [on, setOn] = useState(true);
  return (
    <Chip pressed={on} onClick={() => setOn((v) => !v)}>
      read:chats
    </Chip>
  );
}

const meta = {
  component: Chip,
  tags: ['vrt-themes'],
  args: { children: 'backend' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** variant × size, with icon, mono, dropdown and removable (Components board "Chips & tags"). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-2">
          <Chip size={size}>backend</Chip>
          <Chip size={size} variant="ghost">
            flaky
          </Chip>
          <Chip size={size} icon="branch" mono>
            fix/checkout-flake
          </Chip>
          <Chip size={size} dropdown onClick={() => undefined}>
            Any
          </Chip>
          <Chip size={size} icon="file" mono onRemove={() => undefined}>
            ci-log-4412.txt
          </Chip>
          <Chip size={size} pressed onClick={() => undefined}>
            read:chats
          </Chip>
          <Chip size={size} pressed={false} onClick={() => undefined}>
            write:chats
          </Chip>
        </div>
      ))}
    </div>
  ),
};

/** Interactive chip: a button; dropdown chips announce a popup. */
export const Interactive: Story = {
  args: { children: 'Project', dropdown: true, onClick: fn() },
  play: async ({ canvas, args }) => {
    const chip = canvas.getByRole('button', { name: 'Project' });
    await expect(chip).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(chip);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/** The remove button has its own accessible name. */
export const Removable: Story = {
  args: { children: 'ci-log-4412.txt', mono: true, icon: 'file', onRemove: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove ci-log-4412.txt' }));
    await expect(args.onRemove).toHaveBeenCalledOnce();
  },
};

/** Toggle chip with its check box (aria-pressed). */
export const Pressed: Story = {
  render: () => <ToggleChip />,
  play: async ({ canvas }) => {
    const chip = canvas.getByRole('button', { name: 'read:chats' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } }, render: Matrix.render };

export const FocusVisible: Story = {
  args: { onClick: fn(), children: 'Status', dropdown: true },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Status' })).toHaveFocus();
  },
};

export const LongText: Story = {
  args: { children: 'feature/very-long-branch-name-for-the-nightly-dependency-audit', mono: true, icon: 'branch' },
  render: (args) => (
    <div className="w-56">
      <Chip {...args} />
    </div>
  ),
};

/** ChipList never truncates silently: the rest become "+N". */
export const Overflow: Story = {
  render: () => (
    <ChipList max={3}>
      <Chip>backend</Chip>
      <Chip>flaky</Chip>
      <Chip>checkout</Chip>
      <Chip>payments</Chip>
      <Chip>ci</Chip>
      <Chip>nightly</Chip>
    </ChipList>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('+3')).toBeVisible();
  },
};

export const Compact: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
