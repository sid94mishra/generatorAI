import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { Textarea } from '../../primitives/Textarea/Textarea.js';
import { ModalForm } from './ModalForm.js';

const meta = {
  component: ModalForm,
  tags: ['vrt-themes'],
} satisfies Meta<typeof ModalForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ModalForm className="w-120">
      <Field label="Task">
        <Textarea aria-label="Task" variant="prose" placeholder="What should the agent do?" />
      </Field>
      <ModalForm.Section title="Details" hint="Optional">
        <Field label="Agent" orientation="horizontal" labelWidth={64}>
          <Input aria-label="Agent" placeholder="reviewer-01" />
        </Field>
      </ModalForm.Section>
    </ModalForm>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Details')).toBeInTheDocument();
  },
};
