import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { buildModelPickerCatalog } from '@generatorai/client-core';
import type { HarnessCatalogModel, HarnessProvidersResponse } from '@generatorai/shared';
import { ModelPickerView } from './ModelPicker.view.js';

// Demo catalog in the wire shape (`GET /api/harness/providers`), turned into the
// view's read model by client-core exactly as the connected block does.
const claudeModels: HarnessCatalogModel[] = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', category: 'lightweight', promptTokenLimit: 200_000, maxOutputTokens: 64_000, supportsReasoning: false },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    category: 'versatile',
    description: 'Balanced speed and depth for everyday coding.',
    promptTokenLimit: 200_000,
    longContext: { promptTokenLimit: 1_000_000 },
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', category: 'versatile', promptTokenLimit: 200_000, maxOutputTokens: 64_000 },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    category: 'powerful',
    description: 'Deepest reasoning for long, multi-step coding work. Slower and costlier per turn.',
    promptTokenLimit: 200_000,
    longContext: { promptTokenLimit: 1_000_000 },
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
];

const response = (overrides: Partial<HarnessProvidersResponse> = {}): HarnessProvidersResponse => ({
  primary: 'copilot',
  stale: false,
  providers: [
    {
      type: 'copilot', label: 'GitHub Copilot', installed: true, connected: true, authenticated: false, ready: false,
      modelCount: 0, models: [], supportsLogin: true,
    },
    {
      type: 'claude-agent', label: 'Claude Code', installed: true, connected: true, authenticated: true, ready: true,
      modelCount: claudeModels.length, models: claudeModels, supportsLogin: false,
    },
    {
      type: 'codex', label: 'Codex', installed: false, connected: false, authenticated: false, ready: false,
      modelCount: 0, models: [], supportsLogin: false,
    },
  ],
  ...overrides,
});

const catalog = buildModelPickerCatalog(response());

const meta = {
  component: ModelPickerView,
  tags: ['vrt-themes'],
  args: {
    value: 'claude-sonnet-5',
    onSelect: fn(),
    onRefresh: fn(),
    onOpenProviderSettings: fn(),
    catalog,
    variant: 'chip',
  },
  decorators: [(Story) => <div className="flex min-h-110 w-170 items-start p-4">{Story()}</div>],
} satisfies Meta<typeof ModelPickerView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The composer chip, closed: open it, pick a model with the keyboard. */
export const Chip: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Select model' });
    await expect(trigger).toHaveTextContent('Claude Sonnet 5');
    await expect(trigger).toHaveAttribute('aria-haspopup');
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole('searchbox', { name: 'Search models' });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith('claude-sonnet-4-6');
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
  },
};

/** Open on the selected model's provider: tier groups, detail pane, footer hints. */
export const DefaultOpen: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const list = await body.findByRole('listbox', { name: 'Claude Code models' });
    await expect(within(list).getByRole('group', { name: 'Fast' })).toBeVisible();
    await expect(within(list).getByRole('group', { name: 'Powerful' })).toBeVisible();
    await expect(within(list).getByRole('option', { name: /Claude Sonnet 5/ })).toHaveAttribute('aria-selected', 'true');
    const detail = body.getByTestId('model-picker-detail');
    await expect(within(detail).getByText('Long context (prompt)')).toBeVisible();
    await expect(within(detail).getByText('Changing the model applies from the next turn.')).toBeVisible();
  },
};

/** A provider that is not signed in lists no models and says what to do. */
export const ProviderNotSignedIn: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const copilot = await body.findByRole('button', { name: /GitHub Copilot/ });
    await expect(copilot).toHaveTextContent('Not signed in');
    await userEvent.click(copilot);
    await expect(body.queryByRole('listbox')).toBeNull();
    await expect(body.getAllByText('Sign in to this provider to use its models, then refresh the list.').length).toBeGreaterThan(0);
    await expect(body.getByRole('button', { name: /Codex/ })).toHaveTextContent('Not installed');
  },
};

/** First probe in flight: skeleton rows. */
export const Loading: Story = {
  args: { defaultOpen: true, catalog: undefined, loading: true, value: '' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('status', { name: 'Loading models' })).toBeVisible();
  },
};

/** A query nothing matches. */
export const EmptySearch: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole('searchbox', { name: 'Search models' });
    await userEvent.type(search, 'gemini');
    await expect(await body.findByText('No models match “gemini”.')).toBeVisible();
    await userEvent.clear(search);
    await userEvent.type(search, 'opus');
    await expect(body.getAllByRole('option')).toHaveLength(1);
  },
};

/** The server answered from its snapshot and an explicit refresh is running. */
export const StaleRefreshing: Story = {
  args: { defaultOpen: true, refreshing: true, catalog: buildModelPickerCatalog(response({ stale: true })) },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Refreshing models…')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Refresh models' })).toBeDisabled();
    // The selection is kept while the catalog is stale.
    await expect(body.getByRole('option', { name: /Claude Sonnet 5/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** The selected model is gone from a conclusive catalog (its provider signed out). */
export const SelectionUnavailable: Story = {
  args: { value: 'gpt-5.6-terra' },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Select model' });
    await expect(trigger).toHaveAttribute('data-unavailable', 'true');
  },
};

/** The form variant (create chat, agent editor, settings). */
export const Field: Story = {
  args: { variant: 'field', ariaLabel: 'Chat model' },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Chat model' });
    await expect(trigger).toHaveTextContent('Balanced · 200K · Claude Code');
  },
};
