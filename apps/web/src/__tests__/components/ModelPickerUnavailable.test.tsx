// The model chip when the chat's provider is not available.
//
// Observed live: with the Claude provider failing to load, a Claude chat's
// composer showed the GitHub Copilot mark next to the raw id `opus[1m]` — the
// primary provider's brand, borrowed because the model was not in the catalog.
// Wrong vendor, stated with confidence, and no hint that anything was wrong.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const providers = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/queries.js', () => ({
  useHarnessProviders: () => ({ data: providers.value, isLoading: false, isFetching: false, refetch: vi.fn() }),
}));

import { ModelPicker, getModelShortName, guessProviderOfModel } from '@/components/shared/ModelPicker.js';

afterEach(cleanup);

const catalog = (claudeReady: boolean) => ({
  primary: 'copilot',
  stale: false,
  providers: [
    { type: 'copilot', label: 'GitHub Copilot', installed: true, ready: false, models: [] },
    {
      type: 'claude-agent', label: 'Claude Code', installed: true, ready: claudeReady,
      models: claudeReady ? [{ id: 'opus[1m]', name: 'Opus 5 (1M context)', provider: 'claude-agent' }] : [],
    },
  ],
});

describe('ModelPicker trigger', () => {
  it('says the model is unavailable instead of wearing another provider\'s brand', () => {
    providers.value = catalog(false);
    render(<ModelPicker value="opus[1m]" onChange={() => {}} variant="inline" />);
    const trigger = screen.getByRole('button', { name: 'Select model' });
    expect(trigger).toHaveAttribute('data-unavailable', 'true');
    expect(trigger).toHaveTextContent('Opus (1M)'); // a name, not a key
    expect(trigger.getAttribute('title')).toMatch(/Claude Code is not ready/);
  });

  it('shows the catalog name and no warning once the provider is back', () => {
    providers.value = catalog(true);
    render(<ModelPicker value="opus[1m]" onChange={() => {}} variant="inline" />);
    const trigger = screen.getByRole('button', { name: 'Select model' });
    expect(trigger).not.toHaveAttribute('data-unavailable');
    expect(trigger).toHaveTextContent('Opus 5 (1M context)');
  });

  it('does not cry wolf while the catalog is still empty', () => {
    providers.value = { primary: 'copilot', providers: [] };
    render(<ModelPicker value="opus[1m]" onChange={() => {}} variant="inline" />);
    expect(screen.getByRole('button', { name: 'Select model' })).not.toHaveAttribute('data-unavailable');
  });
});

describe('uncatalogued model ids', () => {
  it('reads like a name', () => {
    expect(getModelShortName('opus[1m]')).toBe('Opus (1M)');
    expect(getModelShortName('haiku')).toBe('Haiku');
    expect(getModelShortName('gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(getModelShortName('claude-sonnet-4')).toBe('Sonnet 4');
  });
  it('guesses the owning provider for the icon only', () => {
    expect(guessProviderOfModel('opus[1m]')).toBe('claude-agent');
    expect(guessProviderOfModel('gpt-5.6-sol')).toBe('codex');
    expect(guessProviderOfModel('llama-3')).toBeNull();
  });
});
