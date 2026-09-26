// ────────────────────────────────────────────────────────────────
// renderComposer — the ChatInput characterization harness (09-verification.md §5.1).
//
//   renderComposer(props, { slashCommands, fileIndex, models, … })
//
// wraps `renderWithProviders`. The data layer is doubled in `composerMocks.ts`
// (each test file hoists the `vi.mock` calls; see that file's header):
//   - `@/hooks/composerQueries`   useSlashCommands / useWorkspaceFileIndex
//   - `@/hooks/queries`           useSendPrompt / useHarnessConfig
//   - `@/hooks/harnessQueries`    useModels / useHarnessProviders
//   - `@/hooks/projectQueries`    useProjectCodebases
//   - `@/platform/surfaceCapabilities`  composerAffordances (mutable per test)
//   - `@/hooks/useSpeechToText`   a controllable fake (`speech`)
// `platform.getWorkspaceFileContent` is stubbed on the MockPlatformClient
// instance, and the stream store's `startPending` / `clearStream` actions are
// replaced with spies through the real store's `setState`.
//
// Toasts are observed by spying on sonner's `toast.error` / `toast.warning`
// (what `@/components/Toast` delegates to), so `@/components/Toast` itself
// is not mocked.
//
// The component is NOT imported here: each test file imports it in one marked
// line and hands it to `createComposerHarness`, so the P4 move only changes
// that line.
// ────────────────────────────────────────────────────────────────

import type { ComponentType } from 'react';
import { screen } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { HarnessCatalogModel, HarnessProvidersResponse } from '@generatorai/shared';
import { useStreamStore } from '@/stores/streamStore.js';
import { renderWithProviders } from '../../helpers/renderWithProviders.js';
import { MockPlatformClient } from '../../helpers/MockPlatformClient.js';
import {
  composerState,
  providersFor,
  resetComposerMocks,
  speech,
  type MentionFileFixture,
  type SlashCommandFixture,
} from './composerMocks.js';

export * from './composerMocks.js';

export interface ComposerFixtures {
  slashCommands?: SlashCommandFixture[];
  fileIndex?: MentionFileFixture[];
  fileIndexLoading?: boolean;
  /** The live catalog `useModels` returns. The provider catalog follows it unless `providers` is given. */
  models?: HarnessCatalogModel[];
  modelsPending?: boolean;
  modelsError?: Error;
  providers?: HarnessProvidersResponse;
  /** `useSendPrompt().isPending`. */
  sendPending?: boolean;
  attachments?: boolean;
  sendShortcut?: boolean;
  voiceSupported?: boolean;
  /** Replaces the default `getWorkspaceFileContent` stub (`{ content: 'content of <path>' }`). */
  getWorkspaceFileContent?: (...args: unknown[]) => Promise<{ content?: string }>;
}

export interface StreamSpies {
  startPending: Mock;
  clearStream: Mock;
}

export const streamSpies: StreamSpies = { startPending: vi.fn(), clearStream: vi.fn() };

export const toastSpies: { error: Mock; warning: Mock } = { error: vi.fn(), warning: vi.fn() };

/**
 * Register the per-test reset. Call once at the top level of every file that
 * uses the harness.
 */
export function setupComposerTest(): void {
  let originals: { startPending: unknown; clearStream: unknown; streams: unknown } | null = null;
  beforeEach(() => {
    resetComposerMocks();
    const state = useStreamStore.getState();
    originals = { startPending: state.startPending, clearStream: state.clearStream, streams: state.streams };
    streamSpies.startPending = vi.fn();
    streamSpies.clearStream = vi.fn();
    useStreamStore.setState({
      startPending: streamSpies.startPending,
      clearStream: streamSpies.clearStream,
      streams: {},
    } as never);
    toastSpies.error = vi.spyOn(sonnerToast, 'error').mockReturnValue('toast') as unknown as Mock;
    toastSpies.warning = vi.spyOn(sonnerToast, 'warning').mockReturnValue('toast') as unknown as Mock;
  });
  afterEach(() => {
    if (originals) useStreamStore.setState(originals as never);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

/** Put a context-usage snapshot on the session's stream (what the tier chip agrees with). */
export function setStreamContextLimit(sessionId: string, promptTokenLimit: number): void {
  useStreamStore.setState({
    streams: { [sessionId]: { contextUsage: { promptTokenLimit } } },
  } as never);
}

// ── Fixtures ──────────────────────────────────────────────────────

export function slashCommand(name: string, overrides: Partial<SlashCommandFixture> = {}): SlashCommandFixture {
  return {
    id: `system:${name}`,
    name,
    description: `The ${name} command`,
    kind: 'prompt',
    source: 'system',
    argHint: `Arguments for ${name}…`,
    takesInput: true,
    format: (input, template) => `[${name}]${template ? `{${template}}` : ''} ${input}`.trim(),
    ...overrides,
  };
}

/** Shaped like the real `/browser` builtin (source 'builtin'). */
export function builtinCommand(name: string, overrides: Partial<SlashCommandFixture> = {}): SlashCommandFixture {
  return slashCommand(name, {
    id: `builtin:${name}`,
    kind: 'command',
    source: 'builtin',
    format: (input) => `Use the integrated ${name}.\n\nTask: ${input.trim()}`,
    ...overrides,
  });
}

export function mentionFile(path: string, overrides: Partial<MentionFileFixture> = {}): MentionFileFixture {
  return { path, source: 'workspace', label: path.split('/').pop() ?? path, ...overrides };
}

export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Harness ───────────────────────────────────────────────────────

interface BaseProps {
  sessionId: string;
  disabled: boolean;
  placeholder: string;
}

function applyFixtures(f: ComposerFixtures): void {
  if (f.slashCommands) composerState.slashCommands = f.slashCommands;
  if (f.fileIndex || f.fileIndexLoading !== undefined) {
    composerState.fileIndex = { files: f.fileIndex ?? [], isLoading: f.fileIndexLoading ?? false };
  }
  if (f.models) {
    composerState.models = f.models;
    composerState.providers = providersFor(f.models);
  }
  if (f.providers) composerState.providers = f.providers;
  if (f.modelsPending !== undefined) composerState.modelsPending = f.modelsPending;
  if (f.modelsError) composerState.modelsError = f.modelsError;
  if (f.sendPending !== undefined) composerState.sendPending = f.sendPending;
  if (f.attachments !== undefined) composerState.affordances.attachments = f.attachments;
  if (f.sendShortcut !== undefined) composerState.affordances.sendShortcut = f.sendShortcut;
  if (f.voiceSupported !== undefined) speech.isSupported = f.voiceSupported;
}

export function createComposerHarness<P extends BaseProps>(Component: ComponentType<P>) {
  return function renderComposer(props: Partial<P> = {}, fixtures: ComposerFixtures = {}) {
    applyFixtures(fixtures);
    const platform = new MockPlatformClient();
    const getWorkspaceFileContent = vi.fn(
      fixtures.getWorkspaceFileContent ??
        (async (_ws: unknown, path: unknown) => ({ content: `content of ${String(path)}` })),
    );
    Object.assign(platform, { getWorkspaceFileContent });
    let current = { sessionId: 's1', disabled: false, placeholder: 'Ask anything', ...props } as P;
    const utils = renderWithProviders(<Component {...current} />, { platform });
    return {
      ...utils,
      getWorkspaceFileContent,
      /** Re-render with props merged over the current ones. */
      update(next: Partial<P>) {
        current = { ...current, ...next };
        utils.rerender(<Component {...current} />);
      },
    };
  };
}

// ── Selectors (09 §5.1: these names are the contract) ─────────────

export const textbox = (): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
export const sendButton = (): HTMLElement => screen.getByRole('button', { name: 'Send message' });
export const chips = (): HTMLElement[] => screen.queryAllByTestId('composer-attachment');

/** The `/` or `@` menu's rows (their accessible names start with the row title). */
export function menuRows(prefix: string | RegExp): HTMLElement[] {
  const re = typeof prefix === 'string' ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`) : prefix;
  return screen.queryAllByRole('button', { name: re });
}

