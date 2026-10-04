// ────────────────────────────────────────────────────────────────
// ChatInput characterization — TOOLBAR CHIPS and LAYOUT.
//
// Pins (09-verification.md §5.1 "Chips"; 03-component-inventory-domain.md
// §6.1 items 1, 15–18, 22): the skeleton while models are pending (and the
// composer despite a catalog error), stale-model substitution only on a
// conclusive catalog, the effort / context-tier chips and their 15 % live
// agreement, the "Agent mode: …" listbox, one per-turn menu at a time closed
// by outside click or a capture-phase Escape, the < 420 px fold into "More
// options" (driven through a ResizeObserver stub), the bound-agent chip, and
// the 200 px autogrow.
//
// These assertions must stay unchanged through the P4 split of ChatInput;
// only the marked import line changes when the component moves.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessCatalogModel } from '@generatorai/shared';

import {
  MODEL_FULL,
  MODEL_PLAIN,
  createComposerHarness,
  providersFor,
  setStreamContextLimit,
  setupComposerTest,
  textbox,
} from './helpers/renderComposer.js';

// Import under test — the only line that changes when P4 moves the file.
import { Composer as ChatInput } from '@/blocks/composer/index.js';

vi.mock('@/hooks/composerQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).composerQueriesModule(await importOriginal()));
vi.mock('@/hooks/queries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).queriesModule(await importOriginal()));
vi.mock('@/hooks/harnessQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).harnessQueriesModule(await importOriginal()));
vi.mock('@/hooks/projectQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).projectQueriesModule(await importOriginal()));
vi.mock('@/platform/surfaceCapabilities.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).surfaceCapabilitiesModule(await importOriginal()));
vi.mock('@/hooks/useSpeechToText.js', async () =>
  (await import('./helpers/composerMocks.js')).speechModule());

setupComposerTest();
const renderComposer = createComposerHarness(ChatInput);

const effortChip = () => screen.queryByTitle('Reasoning effort');
const tierChip = () => screen.queryByTitle('Context window');
const modeChip = () => screen.getByRole('button', { name: /^Agent mode: / });

describe('ChatInput — skeleton (09 §5.1; 03 §6.1 #1)', () => {
  it('renders chat-input-skeleton while models are pending', () => {
    renderComposer({}, { modelsPending: true });
    expect(screen.getByTestId('chat-input-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('renders the composer even if the catalog errored', () => {
    renderComposer({}, { models: [], modelsError: new Error('probe failed'), providers: undefined });
    expect(screen.queryByTestId('chat-input-skeleton')).not.toBeInTheDocument();
    expect(textbox()).toBeInTheDocument();
  });
});

describe('ChatInput — model substitution (09 §5.1; 03 §6.1 #15)', () => {
  const OTHER: HarnessCatalogModel = { ...MODEL_PLAIN, id: 'model-other', name: 'Model Other' };

  it('a selection missing from a conclusive catalog is replaced by the first model, persisted once', () => {
    const onModelChange = vi.fn();
    const r = renderComposer({ selectedModel: 'retired-model', onModelChange }, { models: [MODEL_PLAIN, OTHER] });
    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith('model-plain');
    r.update({});
    expect(onModelChange).toHaveBeenCalledTimes(1);
    // The parent echoes the substitution back: nothing more to do.
    r.update({ selectedModel: 'model-plain' });
    expect(onModelChange).toHaveBeenCalledTimes(1);
  });

  it('no selection at all is filled with the first model', () => {
    const onModelChange = vi.fn();
    renderComposer({ onModelChange }, { models: [OTHER, MODEL_PLAIN] });
    expect(onModelChange).toHaveBeenCalledWith('model-other');
  });

  it('a stale catalog keeps the selection', () => {
    const onModelChange = vi.fn();
    renderComposer(
      { selectedModel: 'retired-model', onModelChange },
      { models: [MODEL_PLAIN], providers: providersFor([MODEL_PLAIN], { stale: true }) },
    );
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('an installed-but-not-ready provider makes the catalog inconclusive: the selection is kept', () => {
    const onModelChange = vi.fn();
    const providers = providersFor([MODEL_PLAIN]);
    providers.providers.push({
      type: 'claude-agent', label: 'Claude', installed: true, connected: false, authenticated: false,
      ready: false, modelCount: 0, models: [], supportsLogin: true,
    });
    renderComposer({ selectedModel: 'retired-model', onModelChange }, { models: [MODEL_PLAIN], providers });
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('a selection the catalog offers is left alone', () => {
    const onModelChange = vi.fn();
    renderComposer({ selectedModel: 'model-other', onModelChange }, { models: [MODEL_PLAIN, OTHER] });
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('an empty catalog never substitutes', () => {
    const onModelChange = vi.fn();
    renderComposer({ selectedModel: 'retired-model', onModelChange }, { models: [] });
    expect(onModelChange).not.toHaveBeenCalled();
  });
});

describe('ChatInput — effort and context-tier chips (03 §6.1 #16)', () => {
  it('are hidden for a model without reasoning or a long-context tier', () => {
    renderComposer({ selectedModel: 'model-plain' }, { models: [MODEL_PLAIN] });
    expect(effortChip()).not.toBeInTheDocument();
    expect(tierChip()).not.toBeInTheDocument();
  });

  it('are hidden when the model selector is hidden', () => {
    renderComposer({ selectedModel: 'model-full', showModelSelector: false }, { models: [MODEL_FULL] });
    expect(effortChip()).not.toBeInTheDocument();
    expect(tierChip()).not.toBeInTheDocument();
  });

  it('default effort is the middle level; the model default wins; the prop wins over both', () => {
    const r = renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    expect(effortChip()).toHaveTextContent('Medium');
    r.update({ reasoningEffort: 'low' });
    expect(effortChip()).toHaveTextContent('Low');
  });

  it('uses the model default effort when no effort is chosen', () => {
    renderComposer(
      { selectedModel: 'model-full' },
      { models: [{ ...MODEL_FULL, defaultReasoningEffort: 'high' }] },
    );
    expect(effortChip()).toHaveTextContent('High');
  });

  it('falls back to low/medium/high when the model lists no levels', () => {
    renderComposer({ selectedModel: 'model-full' }, { models: [{ ...MODEL_FULL, reasoningEfforts: [] }] });
    expect(effortChip()).toHaveTextContent('Medium');
  });

  it('picking an effort calls onReasoningEffortChange and closes the list', async () => {
    const user = userEvent.setup();
    const onReasoningEffortChange = vi.fn();
    renderComposer({ selectedModel: 'model-full', onReasoningEffortChange }, { models: [MODEL_FULL] });
    await user.click(effortChip()!);
    expect(screen.getByRole('option', { name: 'Medium' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'High' }));
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
    expect(screen.queryByRole('option', { name: 'High' })).not.toBeInTheDocument();
  });

  it('the tier chip shows the active tier limit', () => {
    const r = renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    expect(tierChip()).toHaveTextContent('200K');
    r.update({ contextTier: 'long_context' });
    expect(tierChip()).toHaveTextContent('1M');
  });

  it('the active tier shows the live limit when within 15 % of the catalog figure', () => {
    setStreamContextLimit('s1', 190_000);
    renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    expect(tierChip()).toHaveTextContent('190K');
  });

  it('a live limit 15 % or more away is ignored', () => {
    setStreamContextLimit('s1', 170_000);
    renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    expect(tierChip()).toHaveTextContent('200K');
  });

  it('is hidden unless both tiers exist with standard < long', () => {
    renderComposer(
      { selectedModel: 'model-full' },
      { models: [{ ...MODEL_FULL, longContext: { promptTokenLimit: 200_000 } }] },
    );
    expect(tierChip()).not.toBeInTheDocument();
    expect(effortChip()).toBeInTheDocument();
  });

  it('picking a tier calls onContextTierChange', async () => {
    const user = userEvent.setup();
    const onContextTierChange = vi.fn();
    renderComposer({ selectedModel: 'model-full', onContextTierChange }, { models: [MODEL_FULL] });
    await user.click(tierChip()!);
    await user.click(screen.getByRole('option', { name: /Long context/ }));
    expect(onContextTierChange).toHaveBeenCalledWith('long_context');
  });
});

describe('ChatInput — agent mode chip (09 §5.1; 03 §6.1 #22)', () => {
  it('"Agent mode: …" opens a listbox; choosing a mode reports it and closes', async () => {
    const user = userEvent.setup();
    const onAgentModeChange = vi.fn();
    renderComposer({ onAgentModeChange });
    expect(modeChip()).toHaveAccessibleName('Agent mode: Auto');
    expect(modeChip()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(modeChip()).toHaveAttribute('aria-expanded', 'false');
    await user.click(modeChip());
    const list = screen.getByRole('listbox', { name: 'Agent mode' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Auto/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: /Plan/ }));
    expect(onAgentModeChange).toHaveBeenCalledWith('plan');
    expect(screen.queryByRole('listbox', { name: 'Agent mode' })).not.toBeInTheDocument();
  });

  it('reflects the agentMode prop', () => {
    renderComposer({ agentMode: 'plan' });
    expect(modeChip()).toHaveAccessibleName('Agent mode: Plan');
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(modeChip());
    await user.click(document.body);
    expect(screen.queryByRole('listbox', { name: 'Agent mode' })).not.toBeInTheDocument();
  });

  it('closes on Escape, handled in the capture phase with stopPropagation', async () => {
    const user = userEvent.setup();
    const bubbled = vi.fn();
    window.addEventListener('keydown', bubbled);
    try {
      renderComposer();
      await user.click(modeChip());
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('listbox', { name: 'Agent mode' })).not.toBeInTheDocument();
      expect(bubbled).not.toHaveBeenCalled();
      // With no menu open, Escape propagates normally.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(bubbled).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', bubbled);
    }
  });

  it('is absent when showAgentModePicker is false', () => {
    renderComposer({ showAgentModePicker: false });
    expect(screen.queryByRole('button', { name: /^Agent mode: / })).not.toBeInTheDocument();
  });
});

describe('ChatInput — one per-turn menu at a time (03 §6.1 #18)', () => {
  it('opening the effort list closes the mode list, and vice versa', async () => {
    const user = userEvent.setup();
    renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    await user.click(modeChip());
    expect(screen.getByRole('listbox', { name: 'Agent mode' })).toBeInTheDocument();
    await user.click(effortChip()!);
    expect(screen.queryByRole('listbox', { name: 'Agent mode' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
    await user.click(tierChip()!);
    expect(screen.queryByRole('option', { name: 'High' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Long context/ })).toBeInTheDocument();
    await user.click(modeChip());
    expect(screen.queryByRole('option', { name: /Long context/ })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Agent mode' })).toBeInTheDocument();
  });

  it('Escape closes whichever per-turn menu is open', async () => {
    const user = userEvent.setup();
    renderComposer({ selectedModel: 'model-full' }, { models: [MODEL_FULL] });
    await user.click(effortChip()!);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: 'High' })).not.toBeInTheDocument();
  });
});

describe('ChatInput — toolbar collapse below 420 px (09 §5.1; 03 §6.1 #17)', () => {
  type RoCallback = (entries: Array<{ contentRect: { width: number } }>) => void;
  function stubResizeObserver(): { resize: (width: number) => void } {
    const callbacks: RoCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: RoCallback) {
          callbacks.push(cb);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    return {
      resize: (width) => act(() => callbacks.forEach((cb) => cb([{ contentRect: { width } }]))),
    };
  }

  it('folds effort + tier into "More options" under 420 px and back at 420 px', async () => {
    const user = userEvent.setup();
    const ro = stubResizeObserver();
    const onReasoningEffortChange = vi.fn();
    const onContextTierChange = vi.fn();
    renderComposer(
      { selectedModel: 'model-full', onReasoningEffortChange, onContextTierChange },
      { models: [MODEL_FULL] },
    );
    expect(effortChip()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();

    ro.resize(419);
    expect(effortChip()).not.toBeInTheDocument();
    expect(tierChip()).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More options' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(more);
    expect(screen.getByText('Reasoning effort')).toBeInTheDocument();
    expect(screen.getByText('Context window')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'High' }));
    await user.click(screen.getByRole('button', { name: /Long context/ }));
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
    expect(onContextTierChange).toHaveBeenCalledWith('long_context');

    ro.resize(420);
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
    expect(effortChip()).toBeInTheDocument();
  });

  it('shows no "More options" when the model has neither control', () => {
    const ro = stubResizeObserver();
    renderComposer({ selectedModel: 'model-plain' }, { models: [MODEL_PLAIN] });
    ro.resize(300);
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
  });
});

describe('ChatInput — bound agent chip (03 §6.1 #22)', () => {
  it('renders chat-agent-chip with the agent name, read-only', () => {
    renderComposer({ agentName: 'Reviewer' });
    const chip = screen.getByTestId('chat-agent-chip');
    expect(chip).toHaveTextContent('Reviewer');
    expect(chip).toHaveAttribute('title', 'Driven by the “Reviewer” agent');
    expect(chip.tagName).not.toBe('BUTTON');
  });

  it('is absent without an agent', () => {
    renderComposer();
    expect(screen.queryByTestId('chat-agent-chip')).not.toBeInTheDocument();
  });
});

describe('ChatInput — autogrow (09 §5.1)', () => {
  it('grows with its content up to 200 px', async () => {
    const user = userEvent.setup();
    renderComposer();
    let scrollHeight = 120;
    Object.defineProperty(textbox(), 'scrollHeight', { configurable: true, get: () => scrollHeight });
    await user.type(textbox(), 'a');
    expect(textbox().style.height).toBe('120px');
    scrollHeight = 480;
    await user.type(textbox(), 'b');
    expect(textbox().style.height).toBe('200px');
  });
});

describe('ChatInput — codebase row', () => {
  it('counts linked codebases and local folders and toggles the read-only panel', async () => {
    const user = userEvent.setup();
    renderComposer({
      codebaseIds: ['cb1'],
      gitRepositories: [{ url: '/repo/a', branch: 'main', alias: 'a' }, { url: ' ', branch: '', alias: '' }],
    });
    const toggle = screen.getByRole('button', { name: /2 Codebases/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No project linked')).toBeInTheDocument();
    expect(screen.getByText('/repo/a')).toBeInTheDocument();
  });
});
