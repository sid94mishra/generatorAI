import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { ActionBar } from '../../patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '../../patterns/Breadcrumb/Breadcrumb.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { FormSection } from '../../patterns/FormSection/FormSection.js';
import { SummaryAside } from '../../patterns/SummaryAside/SummaryAside.js';
import { FormWithAside } from './FormWithAside.js';

const header = <PageHeader breadcrumb={<Breadcrumb items={[{ label: 'Chats' }, { label: 'New chat' }]} />} />;
const form = (
  <FormSection title="Task" first>
    <Field label="What should happen?">
      <Input aria-label="What should happen?" placeholder="Fix the flaky test suite" />
    </Field>
  </FormSection>
);
const aside = <SummaryAside sections={[{ label: 'Who works', content: 'An agent' }]} />;
const actions = <ActionBar primary={<Button variant="primary" shortcut={['Ctrl', '↵']}>Start chat</Button>} />;

const meta = {
  component: FormWithAside,
  tags: ['vrt-themes'],
  args: { header, form, actions },
} satisfies Meta<typeof FormWithAside>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[560px] w-260 overflow-hidden rounded-panel border border-line-soft">
      <FormWithAside header={header} form={form} aside={aside} actions={actions} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Task')).toBeInTheDocument();
  },
};

/** wide (sticky aside) vs narrow (`asideCollapsed`: a "Summary" disclosure above the ActionBar). */
export const Matrix: Story = {
  render: () => (
    // Each demo is wrapped in a <section>: a page <header> only counts as a
    // "banner" landmark when it is a direct child of <body> — inside a
    // sectioning element it is not, so two side-by-side page frames (each
    // with its own PageHeader) do not collide as two banner landmarks. Each
    // also gets its own plain-title header (no Breadcrumb) so their `nav`s
    // do not collide either — both would render `aria-label="Breadcrumb"`.
    <div className="flex flex-col gap-4">
      <section aria-label="Wide" className="h-[400px] w-260 overflow-hidden rounded-panel border border-line-soft">
        <FormWithAside header={<PageHeader title="Wide" />} form={form} aside={aside} actions={actions} />
      </section>
      <section aria-label="Narrow" className="h-[400px] w-160 overflow-hidden rounded-panel border border-line-soft">
        <FormWithAside header={<PageHeader title="Narrow" />} form={form} aside={aside} actions={actions} asideCollapsed />
      </section>
    </div>
  ),
};
