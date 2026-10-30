import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Checkbox } from './Checkbox.js';

function Controlled(props: { label: string; initial?: boolean }) {
  const [checked, setChecked] = useState(props.initial ?? false);
  return <Checkbox label={props.label} checked={checked} onCheckedChange={setChecked} />;
}

const meta = {
  component: Checkbox,
  tags: ['vrt-themes'],
  args: { label: 'Run tests after edits' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking the label toggles it. */
export const Default: Story = {
  render: () => <Controlled label="Run tests after edits" />,
  play: async ({ canvas }) => {
    const box = canvas.getByRole('checkbox', { name: 'Run tests after edits' });
    await userEvent.click(canvas.getByText('Run tests after edits'));
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard(' ');
    await expect(box).toHaveAttribute('aria-checked', 'false');
  },
};

/** unchecked / checked / mixed / disabled × md / sm. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex items-center gap-4">
          <Checkbox size={size} aria-label={`Untracked ${size}`} />
          <Checkbox size={size} aria-label={`Checked ${size}`} checked />
          <Checkbox size={size} aria-label={`Select all ${size}`} indeterminate />
          <Checkbox size={size} aria-label={`Disabled ${size}`} disabled />
          <Checkbox size={size} aria-label={`Disabled checked ${size}`} disabled checked />
        </div>
      ))}
      <Checkbox label="Untracked files" />
      <Checkbox label="Run tests after edits" checked />
    </div>
  ),
};

export const Indeterminate: Story = {
  args: { indeterminate: true, label: undefined, 'aria-label': 'Select all' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute('aria-checked', 'mixed');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('checkbox')).toHaveFocus();
  },
};

/** The 14px box keeps a 24×24 target. */
export const TargetSize: Story = {
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
