import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Dialog, DialogFooter } from '../../primitives/Dialog/Dialog.js';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { ModalWithAside } from './ModalWithAside.js';

const main = (
  <>
    <h3 className="text-title text-fg">Variables</h3>
    <Field label="target_branch">
      <Input defaultValue="main" />
    </Field>
  </>
);
const aside = (
  <div className="flex flex-col gap-2">
    <span className="text-title text-fg">Plan preview</span>
    <span className="text-small text-fg-3">L1 scan · L2 assess_risk</span>
  </div>
);

const meta = {
  component: ModalWithAside,
  tags: ['vrt-themes'],
  args: { main, aside, asideLabel: 'Plan preview' },
} satisfies Meta<typeof ModalWithAside>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex h-[480px] w-240 flex-col overflow-hidden rounded-dialog border border-line bg-overlay">
      <ModalWithAside {...args} />
      <DialogFooter hint="Published workflows run v7.">
        <Button>Cancel</Button>
        <Button variant="primary">Run</Button>
      </DialogFooter>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('complementary', { name: 'Plan preview' })).toBeInTheDocument();
  },
};

export const Stacked: Story = {
  args: { asideStacked: true },
  render: (args) => (
    <div className="flex h-[480px] w-140 flex-col overflow-hidden rounded-dialog border border-line bg-overlay">
      <ModalWithAside {...args} />
    </div>
  ),
};

export const InDialog: Story = {
  render: (args) => (
    <Dialog defaultOpen size="xl" title="Run Nightly dependency audit">
      <ModalWithAside {...args} />
      <DialogFooter>
        <Button variant="primary">Run</Button>
      </DialogFooter>
    </Dialog>
  ),
};
