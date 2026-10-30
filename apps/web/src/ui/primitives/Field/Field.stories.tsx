import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Input } from '../Input/Input.js';
import { Field } from './Field.js';

const meta = {
  component: Field,
  tags: ['vrt-themes'],
  args: { label: 'Display name' },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Vertical field with a hint; typing in the control still works. */
export const Default: Story = {
  render: (args) => (
    <Field {...args} className="w-72">
      <Input aria-label="Display name" placeholder="Nightly dependency audit" />
    </Field>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Display name' });
    await userEvent.type(input, 'Release');
    await expect(input).toHaveValue('Release');
  },
};

/** Vertical, horizontal, optional and error states. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <Field label="Display name" hint="Shown to teammates">
        <Input aria-label="Display name" defaultValue="Nightly dependency audit" />
      </Field>
      <Field label="Description" optional>
        <Input aria-label="Description" placeholder="One sentence" />
      </Field>
      <Field label="Webhook URL" error="Must start with https://">
        <Input aria-label="Webhook URL" invalid defaultValue="http://example.com" />
      </Field>
      <Field label="Agent" orientation="horizontal" labelWidth={100}>
        <Input aria-label="Agent" defaultValue="reviewer-01" />
      </Field>
    </div>
  ),
};

export const Error: Story = {
  args: { label: 'Webhook URL', error: 'Must start with https://' },
  render: (args) => (
    <Field {...args} className="w-72">
      <Input aria-label="Webhook URL" invalid defaultValue="http://example.com" />
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Must start with https://');
  },
};
