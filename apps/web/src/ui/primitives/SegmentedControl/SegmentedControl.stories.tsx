import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { SegmentedControl, type SegmentedControlProps } from './SegmentedControl.js';

const SCOPES = [
  { value: 'all', label: 'All', count: 48 },
  { value: 'active', label: 'Active', count: 41 },
  { value: 'archived', label: 'Archived', count: 7 },
];

function Controlled(props: SegmentedControlProps) {
  const [value, setValue] = useState(props.value);
  return <SegmentedControl {...props} value={value} onValueChange={setValue} />;
}

const meta = {
  component: SegmentedControl,
  tags: ['vrt-themes'],
  args: { value: 'all', onValueChange: () => undefined, items: SCOPES, label: 'Chat scope', semantics: 'tabs' },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `tabs`: list scopes (ChatsList All/Active/Archived); arrow keys + Enter. */
export const Tabs: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Chat scope' })).toBeVisible();
    await userEvent.click(canvas.getByRole('tab', { name: /Active/ }));
    await expect(canvas.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** `radio`: a value (density, effort). */
export const Radio: Story = {
  args: {
    semantics: 'radio',
    label: 'Density',
    value: 'comfortable',
    items: [
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' },
    ],
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: 'Compact' }));
    await expect(canvas.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
  },
};

/** Sizes, icons, icon-only view toggle, disabled with a reason, full width. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col items-start gap-3">
      <Controlled value="all" onValueChange={() => undefined} items={SCOPES} label="Scope sm" semantics="tabs" />
      <Controlled
        value="medium"
        onValueChange={() => undefined}
        size="md"
        label="Effort"
        items={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ]}
      />
      <Controlled
        value="list"
        onValueChange={() => undefined}
        label="View"
        items={[
          { value: 'list', icon: 'list', ariaLabel: 'List view' },
          { value: 'grid', icon: 'layers', ariaLabel: 'Grid view' },
        ]}
      />
      <Controlled
        value="local"
        onValueChange={() => undefined}
        fullWidth
        label="Network exposure"
        items={[
          { value: 'local', label: 'This computer' },
          { value: 'lan', label: 'Local network' },
          { value: 'public', label: 'Internet', disabled: true, reason: 'Needs a relay' },
        ]}
      />
    </div>
  ),
};

export const Hover: Story = { parameters: { pseudo: { hover: true } } };

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('tab', { name: /All/ })).toHaveFocus();
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
