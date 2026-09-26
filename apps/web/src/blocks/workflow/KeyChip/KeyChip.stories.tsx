import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyChip } from './KeyChip.js';

const meta = {
  component: KeyChip,
  args: { stageKey: 'assess_risk' },
} satisfies Meta<typeof KeyChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Bare: Story = { args: { bare: true } };
export const WithHint: Story = { args: { hint: 'from name' } };
