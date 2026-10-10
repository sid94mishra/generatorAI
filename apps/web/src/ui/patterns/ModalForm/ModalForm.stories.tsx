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
      <ModalForm.Section first>
        <Field label="Name">
          <Input placeholder="e.g. Fix the login redirect" />
        </Field>
        <Field label="First message" optional hint="Sent when the chat opens.">
          <Textarea variant="prose" placeholder="What should the agent do?" />
        </Field>
      </ModalForm.Section>
      <ModalForm.Section title="Who" hint="The agent brings its own instructions, skills and MCP servers.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Agent">
            <Input placeholder="No agent" />
          </Field>
          <Field label="Model">
            <Input placeholder="Opus 5.5" />
          </Field>
        </div>
      </ModalForm.Section>
      <ModalForm.Section title="Where" hint="What the agent works on.">
        <Field label="Project">
          <Input placeholder="No project" />
        </Field>
      </ModalForm.Section>
    </ModalForm>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Who' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: /First message/ })).toBeInTheDocument();
  },
};
