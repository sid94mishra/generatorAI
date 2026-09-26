import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Kbd } from '../Kbd/Kbd.js';
import { Input } from './Input.js';

const meta = {
  component: Input,
  tags: ['vrt-themes'],
  args: { 'aria-label': 'Workflow name', placeholder: 'Nightly dependency audit', className: 'w-80' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Workflow name' });
    await userEvent.type(input, 'Nightly');
    await expect(input).toHaveValue('Nightly');
  },
};

/** size × state (Components board "Inputs"). */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-col gap-2">
          <Input size={size} aria-label={`Name ${size}`} defaultValue="Nightly dependency audit" />
          <Input size={size} aria-label={`Search ${size}`} leading="search" placeholder="Search agents" trailing={<Kbd keys="/" />} />
          <Input size={size} aria-label={`Cron ${size}`} mono defaultValue="0 2 * * 8" invalid />
          <Input size={size} aria-label={`Generated ${size}`} mono readOnly defaultValue="wf_01J9ZQ4N7X" />
          <Input size={size} aria-label={`Disabled ${size}`} disabled defaultValue="Disabled" />
          <Input size={size} aria-label={`Budget ${size}`} mono defaultValue="200" trailing={<span className="text-micro text-fg-3">K tokens</span>} />
        </div>
      ))}
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Workflow name' })).toHaveFocus();
  },
};

export const Invalid: Story = {
  args: { invalid: true, mono: true, defaultValue: '0 2 * * 8', 'aria-label': 'Cron schedule' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Cron schedule' })).toHaveAttribute('aria-invalid', 'true');
  },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: 'Read only for workers' } };

export const LongText: Story = {
  args: { defaultValue: 'List every dependency upgrade with its changelog link and risk, grouped by package manager' },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
