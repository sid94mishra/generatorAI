import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { FormSection } from './FormSection.js';

const meta = {
  component: FormSection,
  tags: ['vrt-themes'],
  args: { title: 'Details' },
} satisfies Meta<typeof FormSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-120">
      <FormSection title="Details" hint="Shown to teammates" first columns={2}>
        <Field label="Name">
          <Input aria-label="Name" placeholder="Nightly dependency audit" />
        </Field>
        <Field label="Owner">
          <Input aria-label="Owner" placeholder="reviewer-01" />
        </Field>
      </FormSection>
      <FormSection title="Scheduling" hint="Optional">
        <Field label="Cron">
          <Input aria-label="Cron" mono placeholder="0 2 * * *" />
        </Field>
      </FormSection>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Details')).toBeInTheDocument();
  },
};

/** 1/2/3 column field grids. */
export const Matrix: Story = {
  render: () => (
    <div className="w-160 flex flex-col">
      {([1, 2, 3] as const).map((columns) => (
        <FormSection key={columns} title={`${columns} column${columns > 1 ? 's' : ''}`} first={columns === 1} columns={columns}>
          {Array.from({ length: columns }, (_, i) => (
            <Field key={i} label={`Field ${i + 1}`}>
              <Input aria-label={`Field ${i + 1}`} />
            </Field>
          ))}
        </FormSection>
      ))}
    </div>
  ),
};
