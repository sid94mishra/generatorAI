import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { CarryTable, type CarryExpressionSlot, type CarryNameSlot, type CarrySchemaSlot, type CarryValues } from './CarryTable.js';

const VALUE: CarryValues = {
  carry: { openComments: 'stages.review.output.comments' },
  carryInit: { attempts: '0' },
  carrySchema: { attempts: { type: 'number' } },
};

// Plain inputs stand in for the builder's name, expression and JSON editors.
const name = (slot: CarryNameSlot) => (
  <Input mono size="sm" defaultValue={slot.name} aria-label={slot.ariaLabel} onBlur={(e) => slot.onRename(e.target.value)} />
);
const expression = (slot: CarryExpressionSlot) => (
  <Input
    mono
    size="sm"
    value={slot.value}
    onChange={(e) => slot.onChange(e.target.value)}
    aria-label={slot.ariaLabel}
    placeholder={slot.placeholder}
  />
);
const schema = (slot: CarrySchemaSlot) => (
  <Textarea
    rows={2}
    textareaClassName="font-mono"
    defaultValue={slot.value ? JSON.stringify(slot.value) : ''}
    aria-label={slot.ariaLabel}
    onBlur={(e) => slot.onChange(e.target.value ? (JSON.parse(e.target.value) as Record<string, unknown>) : undefined)}
  />
);

function Stateful({ initial }: { initial: CarryValues }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-inspector p-4">
      <CarryTable value={value} onChange={setValue} renderName={name} renderExpression={expression} renderSchema={schema} />
    </div>
  );
}

const meta = {
  component: CarryTable,
  tags: ['vrt-themes'],
  args: { value: VALUE, onChange: () => {}, renderName: name, renderExpression: expression, renderSchema: schema },
} satisfies Meta<typeof CarryTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two carried values, one with a declared type; add then remove a row. */
export const Default: Story = {
  render: () => <Stateful initial={VALUE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add carried value' }));
    await expect(canvas.getByRole('textbox', { name: 'Carried value value_3 expression' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove carried value value_3' }));
    await expect(canvas.queryByRole('textbox', { name: 'Carried value value_3 expression' })).not.toBeInTheDocument();
  },
};

/** No carried value yet: only the add button. */
export const Empty: Story = { render: () => <Stateful initial={{}} /> };
