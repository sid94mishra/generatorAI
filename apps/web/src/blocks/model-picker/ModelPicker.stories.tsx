import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { buildModelPickerCatalog } from '@generatorai/client-core';
import type { HarnessCatalogModel, HarnessProvidersResponse } from '@generatorai/shared';
import { ModelPickerView } from './ModelPicker.view.js';

// Catalog in the wire shape (`GET /api/harness/providers`), turned into the
// view's read model by client-core exactly as the connected block does. The
// rows are what the providers really returned on 2026-10-10 (Claude Code CLI
// 2.1.291 `supportedModels()` for a Max account, Codex 0.162 `model/list` for a
// ChatGPT account) after each adapter's mapping — D-131: nothing invented.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const claudeModels: HarnessCatalogModel[] = [
  {
    id: 'opus', name: 'Opus 5.5', provider: 'claude-agent', description: 'For complex work and everyday tasks', isDefault: true,
    resolvedModel: 'claude-opus-5-5', features: ['Adaptive thinking', 'Fast mode', 'Auto mode'],
    supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium',
  },
  {
    id: 'fable', name: 'Fable 5.1', provider: 'claude-agent', description: 'For your toughest challenges', resolvedModel: 'claude-fable-5-1',
    features: ['Adaptive thinking', 'Auto mode'], supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium',
  },
  {
    id: 'sonnet', name: 'Sonnet 5.5', provider: 'claude-agent', description: 'Most efficient for simpler tasks', resolvedModel: 'claude-sonnet-5-5',
    features: ['Adaptive thinking', 'Auto mode'], supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium',
  },
  { id: 'haiku', name: 'Haiku 4.5', provider: 'claude-agent', description: 'Fastest for quick answers', resolvedModel: 'claude-haiku-4-5-20251001' },
  {
    id: 'claude-opus-4-8', name: 'Opus 4.8', provider: 'claude-agent', description: 'Best for everyday, complex tasks',
    features: ['Adaptive thinking', 'Fast mode', 'Auto mode'], supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium',
  },
];
const codexModels: HarnessCatalogModel[] = [
  {
    id: 'gpt-6-luna', name: 'GPT-6-Luna', provider: 'codex', description: 'Fast and affordable model for easier tasks.', isDefault: true,
    supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'], supportsVision: true,
  },
  {
    id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', provider: 'codex', description: 'Older balanced model for straightforward work.',
    supportsReasoning: true, reasoningEfforts: EFFORTS, defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'], supportsVision: true,
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
      type: 'codex', label: 'Codex', installed: true, connected: true, authenticated: true, ready: true,
      modelCount: codexModels.length, models: codexModels, supportsLogin: true,
    },
    {
      type: 'opencode', label: 'OpenCode', installed: false, connected: false, authenticated: false, ready: false,
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
    value: 'sonnet',
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
    await expect(trigger).toHaveTextContent('Sonnet 5.5');
    await expect(trigger).toHaveAttribute('aria-haspopup');
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole('searchbox', { name: 'Search models' });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith('haiku');
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
  },
};

/** Open on the selected model's provider: one plain list, the provider-flagged default, details on hover/focus. */
export const DefaultOpen: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const list = await body.findByRole('listbox', { name: 'Claude Code models' });
    await expect(within(list).queryAllByRole('group')).toHaveLength(0);
    await expect(within(list).getByRole('option', { name: /Opus 5\.5/ })).toHaveTextContent('default');
    await expect(within(list).getByRole('option', { name: /Sonnet 5\.5/ })).toHaveAttribute('aria-selected', 'true');
    const detail = body.getByTestId('model-picker-detail');
    await expect(within(detail).getByText('claude-sonnet-5-5')).toBeVisible();
    await expect(within(detail).queryByText('Context (prompt)')).toBeNull();
    // The detail pane follows the keyboard highlight.
    await userEvent.keyboard('{ArrowDown}');
    await expect(within(detail).getByText('Haiku 4.5')).toBeVisible();
    await expect(within(detail).queryByText('Reasoning')).toBeNull();
    await expect(within(detail).getByText('Changing the model applies from the next turn.')).toBeVisible();
  },
};

/** Codex: the account's real models with the provider's own default. */
export const CodexModels: Story = {
  args: { defaultOpen: true, value: 'gpt-5.6-terra' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const list = await body.findByRole('listbox', { name: 'Codex models' });
    await expect(within(list).getAllByRole('option')).toHaveLength(2);
    await expect(within(list).getByRole('option', { name: /GPT-6-Luna/ })).toHaveTextContent('default');
    await expect(within(body.getByTestId('model-picker-detail')).getByText('text, image')).toBeVisible();
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
    await expect(body.getByRole('button', { name: /OpenCode/ })).toHaveTextContent('Not installed');
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
    await userEvent.type(search, 'haiku');
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
    await expect(body.getByRole('option', { name: /Sonnet 5\.5/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** The selected model is gone from a conclusive catalog (its provider signed out). */
export const SelectionUnavailable: Story = {
  args: { value: 'gpt-5.4-retired' },
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
    await expect(trigger).toHaveTextContent('Sonnet 5.5');
    await expect(trigger).toHaveTextContent('Claude Code');
  },
};
