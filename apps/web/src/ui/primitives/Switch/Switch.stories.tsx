import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Switch } from './Switch.js';

function Controlled(props: { label: string; initial?: boolean }) {
  const [checked, setChecked] = useState(props.initial ?? false);
  return <Switch label={props.label} checked={checked} onCheckedChange={setChecked} />;
}

const meta = {
  component: Switch,
  tags: ['vrt-themes'],
  args: { label: 'Auto-approve file edits' },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking the label toggles it; Space toggles it from the keyboard. */
export const Default: Story = {
  render: () => <Controlled label="Auto-approve file edits" />,
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch', { name: 'Auto-approve file edits' });
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(canvas.getByText('Auto-approve file edits'));
    await expect(control).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard(' ');
    await expect(control).toHaveAttribute('aria-checked', 'false');
  },
};

/** off / on × enabled / disabled, bare and labelled. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Switch aria-label="Off" />
        <Switch aria-label="On" checked />
        <Switch aria-label="Disabled off" disabled />
        <Switch aria-label="Disabled on" disabled checked />
      </div>
      <Switch label="Run tests after edits" />
      <Switch label="Share usage data" checked />
      <Switch label="Managed by your organisation" disabled checked />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, checked: true, label: 'Managed by your organisation' },
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch', { name: 'Managed by your organisation' });
    await expect(control).toHaveAttribute('data-disabled');
    await userEvent.click(canvas.getByText('Managed by your organisation'));
    await expect(control).toHaveAttribute('aria-checked', 'true');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('switch', { name: 'Auto-approve file edits' })).toHaveFocus();
  },
};

/** The 16px-high track keeps a 24×24 target. */
export const TargetSize: Story = {
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
