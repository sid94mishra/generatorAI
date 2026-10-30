// ────────────────────────────────────────────────────────────────
// composerMocks — the data-layer doubles behind `renderComposer`.
//
// Kept apart from `renderComposer.tsx` on purpose: every ChatInput
// characterization file hoists `vi.mock(...)` calls whose factories
// `await import()` THIS module, so it must not import anything that is
// itself being mocked (or the app at all). It holds one mutable fixture
// object per test file (module state is per-file in Vitest) plus the module
// factories the test files hand to `vi.mock`.
//
// Usage in a test file (the factories spread the original module, so they
// use the async `importOriginal` form):
//
//   vi.mock('@/hooks/composerQueries.js', async (importOriginal) =>
//     (await import('./helpers/composerMocks.js')).composerQueriesModule(await importOriginal()));
//
// Only data-layer paths are mocked (09 §5): `@/hooks/*Queries`,
// `@/platform/surfaceCapabilities` and — because 09 §5.1 names it —
// `@/hooks/useSpeechToText`, replaced by a controllable fake.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { vi, type Mock } from 'vitest';
import type { HarnessCatalogModel, HarnessProvidersResponse } from '@generatorai/shared';

/** Structural copy of the composer's SlashCommand (kept local so the test does not import the component's internals). */
export interface SlashCommandFixture {
  id: string;
  name: string;
  description?: string;
  kind: 'prompt' | 'skill' | 'agent' | 'command';
  source: 'system' | 'project' | 'builtin';
  argHint?: string;
  takesInput: boolean;
  format: (input: string, template?: string) => string;
  loadTemplate?: () => Promise<string>;
}

/** Structural copy of the composer's MentionFile. */
export interface MentionFileFixture {
  path: string;
  source: 'workspace' | 'source' | 'artifacts' | 'worktree';
  worktreeAlias?: string;
  label: string;
}

export type SttStatusFixture = 'idle' | 'connecting' | 'listening' | 'paused' | 'transcribing' | 'error';

export interface SpeechOptionsFixture {
  onInterim?: (text: string) => void;
  onSegment?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface ComposerMockState {
  slashCommands: SlashCommandFixture[];
  fileIndex: { files: MentionFileFixture[]; isLoading: boolean };
  models: HarnessCatalogModel[];
  modelsPending: boolean;
  modelsError: Error | null;
  providers: HarnessProvidersResponse | undefined;
  sendPending: boolean;
  mutateAsync: Mock;
  /** Mutated in place: ChatInput reads `composerAffordances()` once at module load and keeps this object. */
  affordances: { attachments: boolean; sendShortcut: boolean };
}

export interface SpeechFake {
  /** The latest options ChatInput passed to `useSpeechToText`. Drive dictation through these callbacks. */
  options: SpeechOptionsFixture;
  isSupported: boolean;
  error: string | null;
  /** Set by the fake on every render; call inside `act`. */
  setStatus: (status: SttStatusFixture) => void;
  start: Mock;
  pause: Mock;
  resume: Mock;
  stop: Mock;
  cancel: Mock;
}

/** A provider catalog in which `models` belong to one ready provider. */
export function providersFor(
  models: HarnessCatalogModel[],
  overrides: Partial<HarnessProvidersResponse> = {},
): HarnessProvidersResponse {
  return {
    primary: 'copilot',
    stale: false,
    providers: [
      {
        type: 'copilot',
        label: 'Copilot',
        installed: true,
        connected: true,
        authenticated: true,
        ready: true,
        modelCount: models.length,
        models: models.map((m) => ({ ...m, provider: 'copilot' })),
        supportsLogin: false,
      },
    ],
    ...overrides,
  };
}

/** A model with reasoning levels and both context tiers (200K standard, 1M long). */
export const MODEL_FULL: HarnessCatalogModel = {
  id: 'model-full',
  name: 'Model Full',
  provider: 'copilot',
  supportsReasoning: true,
  reasoningEfforts: ['low', 'medium', 'high'],
  promptTokenLimit: 200_000,
  supportsLongContext: true,
  longContext: { promptTokenLimit: 1_000_000 },
};

/** A model with neither reasoning nor a long-context tier. */
export const MODEL_PLAIN: HarnessCatalogModel = {
  id: 'model-plain',
  name: 'Model Plain',
  provider: 'copilot',
  promptTokenLimit: 128_000,
};

function defaultState(): ComposerMockState {
  return {
    slashCommands: [],
    fileIndex: { files: [], isLoading: false },
    models: [MODEL_PLAIN],
    modelsPending: false,
    modelsError: null,
    providers: providersFor([MODEL_PLAIN]),
    sendPending: false,
    mutateAsync: vi.fn(async () => undefined),
    affordances: { attachments: true, sendShortcut: true },
  };
}

const AFFORDANCES = { attachments: true, sendShortcut: true };

export const composerState: ComposerMockState = { ...defaultState(), affordances: AFFORDANCES };

export const speech: SpeechFake = {
  options: {},
  isSupported: true,
  error: null,
  setStatus: () => {},
  start: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
};

/** Back to defaults. Called before every test by `setupComposerTest()`. */
export function resetComposerMocks(): void {
  const fresh = defaultState();
  Object.assign(composerState, { ...fresh, affordances: AFFORDANCES });
  AFFORDANCES.attachments = true;
  AFFORDANCES.sendShortcut = true;
  speech.options = {};
  speech.isSupported = true;
  speech.error = null;
  speech.setStatus = () => {};
  speech.start = vi.fn(async () => undefined);
  speech.pause = vi.fn();
  speech.resume = vi.fn();
  speech.stop = vi.fn();
  speech.cancel = vi.fn();
}

// ── Module factories for vi.mock ──────────────────────────────────

export function composerQueriesModule(original: Record<string, unknown> = {}) {
  return {
    ...original,
    useSlashCommands: () => composerState.slashCommands,
    useWorkspaceFileIndex: () => composerState.fileIndex,
  };
}

export function queriesModule(original: Record<string, unknown>) {
  return {
    ...original,
    useSendPrompt: () => ({ isPending: composerState.sendPending, mutateAsync: composerState.mutateAsync }),
    useHarnessConfig: () => ({ data: undefined }),
  };
}

export function harnessQueriesModule(original: Record<string, unknown>) {
  return {
    ...original,
    useModels: () => ({
      data: composerState.modelsPending ? undefined : composerState.models,
      isPending: composerState.modelsPending,
      error: composerState.modelsError,
    }),
    useHarnessProviders: () => ({
      data: composerState.providers,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
  };
}

export function projectQueriesModule(original: Record<string, unknown>) {
  return {
    ...original,
    useProjectCodebases: () => ({ data: [], isLoading: false }),
  };
}

export function surfaceCapabilitiesModule(original: Record<string, unknown>) {
  return {
    ...original,
    composerAffordances: () => AFFORDANCES,
  };
}

function useSpeechToTextFake(options: SpeechOptionsFixture) {
  const [status, setStatus] = useState<SttStatusFixture>('idle');
  speech.options = options;
  speech.setStatus = setStatus;
  return {
    isSupported: speech.isSupported,
    status,
    error: speech.error,
    amplitude: 0,
    start: speech.start,
    pause: speech.pause,
    resume: speech.resume,
    stop: speech.stop,
    cancel: speech.cancel,
  };
}

/** Not spread from the original: the real hook module pulls in the audio worklet asset and the socket transport. */
export function speechModule() {
  return { useSpeechToText: useSpeechToTextFake };
}
