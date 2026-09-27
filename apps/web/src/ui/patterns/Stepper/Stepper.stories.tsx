import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Stepper, type StepperStep } from './Stepper.js';

const STEPS: readonly StepperStep[] = [
  { id: 'basics', title: 'Basics', subtitle: 'Nightly audit', state: 'done' },
  { id: 'trigger', title: 'Trigger', subtitle: 'Schedule', state: 'current' },
  { id: 'workflow', title: 'Workflow & permission', subtitle: 'Permission mode is required', state: 'future' },
  { id: 'dataset', title: 'Dataset', subtitle: 'Optional · one run per row', state: 'future' },
];

const meta = {
  component: Stepper,
  tags: ['vrt-themes'],
  args: { steps: STEPS, current: 'trigger', onSelect: () => {} },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: /Trigger/ });
    await expect(trigger).toHaveAttribute('aria-current', 'step');
  },
};

export const WithError: Story = {
  args: {
    steps: STEPS.map((step) => (step.id === 'workflow' ? { ...step, error: true, subtitle: 'Select at least one workflow' } : step)),
  },
};

export const WithFooter: Story = {
  args: { footer: 'Saving validates every step.\nWebhook tokens are shown once, after saving.' },
};

export const Interactive: Story = {
  render: () => {
    function Demo() {
      const [current, setCurrent] = useState('basics');
      return <Stepper steps={STEPS.map((s) => ({ ...s, state: s.id === current ? 'current' : s.state }))} current={current} onSelect={setCurrent} />;
    }
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Dataset/ }));
    await expect(canvas.getByRole('button', { name: /Dataset/ })).toHaveAttribute('aria-current', 'step');
  },
};
