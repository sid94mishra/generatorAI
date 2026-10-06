import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Combobox, type ComboboxGroup, type ComboboxItem, type ComboboxProps } from './Combobox.js';

interface ModelItem extends ComboboxItem {
  context: string;
  output: string;
}

const MODELS: ComboboxGroup<ModelItem>[] = [
  {
    label: 'Fast',
    items: [
      { value: 'haiku', label: 'Claude Haiku 4.5', meta: 'Anthropic', context: '200K', output: '64K' },
      { value: 'gpt-mini', label: 'GPT-5 mini', meta: 'OpenAI', context: '400K', output: '128K' },
    ],
  },
  {
    label: 'Balanced',
    items: [
      { value: 'sonnet', label: 'Claude Sonnet 4.5', meta: 'Anthropic', context: '1M', output: '64K', keywords: ['default'] },
      { value: 'gpt', label: 'GPT-5', meta: 'OpenAI', context: '400K', output: '128K' },
    ],
  },
  {
    label: 'Powerful',
    items: [{ value: 'opus', label: 'Claude Opus 4.1', meta: 'Anthropic', context: '200K', output: '32K' }],
  },
];

const TAGS: ComboboxItem[] = [
  { value: 'frontend', label: 'frontend' },
  { value: 'backend', label: 'backend' },
  { value: 'infra', label: 'infra' },
  { value: 'docs', label: 'docs' },
  { value: 'security', label: 'security', disabled: true },
];

const onValueChange = fn();

/** Holds the value so the stories behave like a real form control. */
function Controlled(props: Partial<ComboboxProps<ModelItem>>) {
  if (props.multiple) {
    return <MultipleControlled {...props} />;
  }
  return <SingleControlled {...props} />;
}

function SingleControlled(props: Partial<ComboboxProps<ModelItem>>) {
  const [value, setValue] = useState<string | null>(typeof props.value === 'string' ? props.value : null);
  return (
    <Combobox<ModelItem>
      label="Model"
      placeholder="Choose a model"
      {...(props as Partial<ComboboxProps<ModelItem>>)}
      multiple={false}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

function MultipleControlled(props: Partial<ComboboxProps<ModelItem>>) {
  const [value, setValue] = useState<string[]>(Array.isArray(props.value) ? [...props.value] : []);
  return (
    <Combobox<ModelItem>
      label="Tags"
      placeholder="Add tags"
      {...(props as Partial<ComboboxProps<ModelItem>>)}
      multiple
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

const modelDetail = (item: ModelItem): ReactNode => (
  <div className="flex flex-col gap-3">
    <div className="text-ui font-semibold text-fg">{item.label}</div>
    <dl className="grid grid-cols-2 gap-y-1.5 text-small">
      <dt className="text-fg-3">Provider</dt>
      <dd className="text-fg-2">{item.meta}</dd>
      <dt className="text-fg-3">Context</dt>
      <dd className="font-mono text-fg-2">{item.context}</dd>
      <dt className="text-fg-3">Max output</dt>
      <dd className="font-mono text-fg-2">{item.output}</dd>
    </dl>
  </div>
);

const meta = {
  component: Combobox,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { label: 'Model', groups: MODELS, value: null, onValueChange },
  render: (args) => (
    <div className="w-72">
      <Controlled {...(args as Partial<ComboboxProps<ModelItem>>)} />
    </div>
  ),
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Trigger → searchable popup (a D-19 overlay); typing filters, Enter selects and closes. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox', { name: /Model/ });
    await expect(trigger).toHaveTextContent('Choose a model');
    await userEvent.click(trigger);
    const search = await screen.findByRole('combobox', { name: 'Search Model' });
    await expect(document.querySelector('[data-gai-overlay="combobox"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Model' })).toBeVisible());
    await waitFor(() => expect(screen.getByText('Balanced')).toBeVisible());
    await userEvent.type(search, 'opus');
    await waitFor(() => expect(screen.getByRole('option', { name: /Claude Opus/ })).toBeVisible());
    await expect(screen.queryByRole('option', { name: /Claude Haiku/ })).toBeNull();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onValueChange).toHaveBeenLastCalledWith('opus'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveTextContent('Claude Opus 4.1');
  },
};

/** trigger (empty, selected, multiple chips, disabled) · field (single, multiple chips). */
export const Matrix: Story = {
  render: () => (
    <div className="grid w-160 grid-cols-2 gap-4">
      <SingleControlled label="Model" groups={MODELS} />
      <SingleControlled label="Model" groups={MODELS} value="sonnet" icon="model" />
      <MultipleControlled label="Tags" items={TAGS as ModelItem[]} multiple value={['frontend', 'backend', 'infra']} />
      <SingleControlled label="Model" groups={MODELS} value="sonnet" disabled />
      <SingleControlled label="Time zone" variant="field" placeholder="Search time zones" groups={MODELS} />
      <MultipleControlled label="Tags" variant="field" items={TAGS as ModelItem[]} multiple value={['frontend', 'docs']} />
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('combobox', { name: /Model/ })).toHaveFocus();
  },
};

/** The model picker shell: 620-wide popup, list beside a detail pane that follows the highlight. */
export const WithDetail: Story = {
  render: () => <SingleControlled label="Model" groups={MODELS} value="sonnet" detail={modelDetail} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: /Model/ }));
    const pane = await screen.findByTestId('combobox-detail');
    await waitFor(() => expect(within(pane).getByText('Claude Sonnet 4.5')).toBeVisible());
    await userEvent.hover(screen.getByRole('option', { name: /GPT-5 mini/ }));
    await waitFor(() => expect(within(pane).getByText('GPT-5 mini')).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="combobox"]')).not.toBeNull();
  },
};

/** Several values: chips in the field; each chip's remove button keeps a 24×24 target. */
export const MultipleField: Story = {
  render: () => (
    <div className="w-80">
      <MultipleControlled label="Tags" variant="field" items={TAGS as ModelItem[]} multiple value={['frontend', 'infra']} />
    </div>
  ),
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getByText('frontend')).toBeVisible());
    assertTargetSize(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove frontend' }));
    await waitFor(() => expect(onValueChange).toHaveBeenLastCalledWith(['infra']));
    await userEvent.click(canvas.getByRole('combobox', { name: 'Tags' }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));
    await waitFor(() => expect(onValueChange).toHaveBeenLastCalledWith(['infra', 'docs']));
    await expect(document.querySelector('[data-gai-overlay="combobox"]')).not.toBeNull();
  },
};

export const Empty: Story = {
  args: { emptyText: 'No models match' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: /Model/ }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Search Model' }), 'zzzz');
    await waitFor(() => expect(screen.getByText('No models match')).toBeVisible());
  },
};

/** Compact density: the field's chevron trigger and chip removes keep 24×24 targets. */
export const Compact: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
