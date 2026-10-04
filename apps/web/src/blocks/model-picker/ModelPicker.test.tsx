// B-01 ModelPicker, connected to the provider catalog through the platform
// client (`getHarnessProviders`) as in the app.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarnessProvidersResponse } from '@generatorai/shared';
import { renderWithProviders } from '@/__tests__/helpers/renderWithProviders.js';
import { MockPlatformClient } from '@/__tests__/helpers/MockPlatformClient.js';
import { ModelPicker } from './ModelPicker.js';

afterEach(cleanup);

// Copilot is the configured primary but not signed in: the picker must still
// open on Claude Code (the first READY provider) and list Copilot after it.
const providers: HarnessProvidersResponse = {
  primary: 'copilot',
  stale: false,
  providers: [
    {
      type: 'copilot', label: 'GitHub Copilot', installed: true, connected: true, authenticated: false, ready: false,
      modelCount: 0, models: [], supportsLogin: true,
    },
    {
      type: 'claude-agent', label: 'Claude Code', installed: true, connected: true, authenticated: true, ready: true,
      modelCount: 3, supportsLogin: false,
      models: [
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', category: 'lightweight', promptTokenLimit: 200_000 },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', category: 'versatile', promptTokenLimit: 200_000, longContext: { promptTokenLimit: 1_000_000 } },
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', category: 'powerful', promptTokenLimit: 200_000 },
      ],
    },
    {
      type: 'codex', label: 'Codex', installed: false, connected: false, authenticated: false, ready: false,
      modelCount: 0, models: [], supportsLogin: false,
    },
  ],
};

function setup(value = '', catalog: HarnessProvidersResponse = providers) {
  const platform = new MockPlatformClient();
  platform.getHarnessProviders.mockResolvedValue(catalog);
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<ModelPicker value={value} onChange={onChange} />, { platform });
  return { onChange, user, platform };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Select model' }));
  return screen.findByTestId('model-picker-popup');
}

describe('ModelPicker', () => {
  it('lists ready providers first and opens on one, never on the unready primary', async () => {
    const { user } = setup();
    const popup = await openPicker(user);
    expect(await within(popup).findByRole('listbox', { name: 'Claude Code models' })).toBeInTheDocument();
    const rows = within(popup)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-availability'));
    expect(rows.map((b) => b.getAttribute('data-availability'))).toEqual(['ready', 'signed_out', 'not_installed']);
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(popup).getByRole('group', { name: 'Balanced' })).toBeInTheDocument();
  });

  it('shows why an unready provider is unusable and lists none of its models', async () => {
    const { user } = setup('claude-sonnet-5');
    const popup = await openPicker(user);
    const copilot = await within(popup).findByRole('button', { name: /GitHub Copilot/ });
    expect(copilot).toHaveTextContent('Not signed in');
    expect(within(popup).getByRole('button', { name: /Codex/ })).toHaveTextContent('Not installed');
    await user.click(copilot);
    expect(within(popup).queryByRole('listbox')).toBeNull();
    expect(within(popup).queryAllByRole('option')).toHaveLength(0);
    expect(
      within(popup).getAllByText('Sign in to this provider to use its models, then refresh the list.').length,
    ).toBeGreaterThan(0);
  });

  it('selecting a model calls onChange and closes', async () => {
    const { user, onChange } = setup('claude-sonnet-5');
    const popup = await openPicker(user);
    await user.click(await within(popup).findByRole('option', { name: /Claude Opus 5\.5/ }));
    expect(onChange).toHaveBeenCalledWith('claude-opus-5-5');
    await waitFor(() => expect(screen.queryByTestId('model-picker-popup')).toBeNull());
  });

  it('search filters the list, and the keyboard picks from what is visible', async () => {
    const { user, onChange } = setup('claude-sonnet-5');
    const popup = await openPicker(user);
    await within(popup).findByRole('listbox');
    const search = within(popup).getByRole('searchbox', { name: 'Search models' });
    await user.type(search, 'haiku');
    expect(within(popup).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Claude Haiku 4.5'),
    ]);
    await user.clear(search);
    await user.type(search, 'nothing-like-this');
    expect(within(popup).getByText('No models match “nothing-like-this”.')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'claude');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('claude-opus-5-5');
  });

  it('a search with no match in the open provider shows the ready provider that matches', async () => {
    const withCodex: HarnessProvidersResponse = {
      ...providers,
      providers: providers.providers.map((p) =>
        p.type === 'codex'
          ? { ...p, installed: true, connected: true, authenticated: true, ready: true, modelCount: 1,
              models: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', category: 'versatile', promptTokenLimit: 272_000 }] }
          : p,
      ),
    };
    const { user, onChange } = setup('claude-sonnet-5', withCodex);
    const popup = await openPicker(user);
    await within(popup).findByRole('listbox', { name: 'Claude Code models' });
    await user.type(within(popup).getByRole('searchbox', { name: 'Search models' }), 'terra');
    expect(within(popup).getByRole('listbox', { name: 'Codex models' })).toBeInTheDocument();
    expect(within(popup).getByRole('button', { name: /^Codex/ })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('gpt-5.6-terra');
  });

  it('refresh re-probes the providers', async () => {
    const { user, platform } = setup('claude-sonnet-5');
    const popup = await openPicker(user);
    await user.click(within(popup).getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(platform.getHarnessProviders).toHaveBeenCalledWith({ refresh: true }));
  });
});
