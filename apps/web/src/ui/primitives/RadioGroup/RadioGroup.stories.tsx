import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Radio, RadioGroup } from './RadioGroup.js';

function Controlled() {
  const [value, setValue] = useState('comfortable');
  return (
    <RadioGroup aria-label="Density" value={value} onValueChange={(next) => setValue(next as string)}>
      <Radio value="comfortable" label="Comfortable" />
      <Radio value="compact" label="Compact" />
    </RadioGroup>
  );
}

const meta = {
  component: RadioGroup,
  tags: ['vrt-themes'],
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrow keys move the selection; clicking a label selects it. */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText('Compact'));
    await expect(canvas.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowUp}');
    await expect(canvas.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
  },
};

/** default vertical/horizontal, disabled, and the swatch variant (Settings › Accent, P6). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <RadioGroup aria-label="Orientation demo" value="one" onValueChange={() => {}} orientation="horizontal">
        <Radio value="one" label="One" />
        <Radio value="two" label="Two" />
        <Radio value="three" label="Three" disabled />
      </RadioGroup>
      <RadioGroup aria-label="Accent" value="ink" onValueChange={() => {}} orientation="horizontal">
        <Radio value="ink" variant="swatch" swatchClassName="bg-fg" aria-label="Ink" />
        <Radio value="run" variant="swatch" swatchClassName="bg-run" aria-label="Blue" />
        <Radio value="ok" variant="swatch" swatchClassName="bg-ok" aria-label="Green" />
      </RadioGroup>
    </div>
  ),
};
