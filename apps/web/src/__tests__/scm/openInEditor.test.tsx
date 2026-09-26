// ────────────────────────────────────────────────────────────────
// "Open in editor" — the target store and the editor actions.
//
// Page headers (ChatHeader, RunHeader) know nothing about chats, runs,
// projects or codebases beyond their own: each page publishes its path into
// `editorTargetStore`, and `useEditorActions` (blocks/editor) turns whatever
// is there into the header's actions. What that buys — and what these tests
// pin — is that a header never has to guess: no target, no action; and a
// route change hands over cleanly instead of one page's unmount wiping the
// next page's target.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useEditorTargetStore, useEditorTarget } from '@/stores/editorTargetStore.js';
import { resolveDefaultEditor, useEditorActions } from '@/blocks/editor/useEditorActions.js';
import type { EditorInfo, IPlatformClient } from '@generatorai/shared';

const EDITORS: EditorInfo[] = [
  { id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' },
  { id: 'cursor', name: 'Cursor', available: false, scheme: 'cursor' },
];

function makePlatform(overrides: Record<string, unknown> = {}) {
  return {
    listEditors: vi.fn().mockResolvedValue(EDITORS),
    openInEditor: vi.fn().mockResolvedValue({ ok: true, editor: 'vscode' }),
    getSourceControlSettings: vi.fn().mockResolvedValue({
      settings: {
        accounts: [],
        defaultAccountId: null,
        generation: { provider: null, model: null },
        editor: { defaultEditor: 'vscode' },
        defaultBase: null,
      },
      providers: [],
      editors: EDITORS,
    }),
    ...overrides,
  };
}

function renderActions(platform: ReturnType<typeof makePlatform>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(() => useEditorActions(), { wrapper }).result;
}

beforeEach(() => {
  useEditorTargetStore.setState({ target: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('editorTargetStore', () => {
  it('publishes a page target and clears it on unmount', () => {
    const { unmount } = renderHook(() => useEditorTarget('/w/repo', 'Chat'));
    expect(useEditorTargetStore.getState().target).toEqual({ path: '/w/repo', label: 'Chat' });
    unmount();
    expect(useEditorTargetStore.getState().target).toBeNull();
  });

  it('publishes nothing while the page has not resolved a path yet', () => {
    renderHook(() => useEditorTarget(undefined, 'Chat'));
    expect(useEditorTargetStore.getState().target).toBeNull();
  });

  it('does not let a leaving page wipe the incoming page\'s target', () => {
    const first = renderHook(() => useEditorTarget('/w/one', 'One'));
    // React mounts the next route's effect before the previous one's cleanup.
    useEditorTargetStore.getState().setEditorTarget({ path: '/w/two', label: 'Two' });
    first.unmount();
    expect(useEditorTargetStore.getState().target).toEqual({ path: '/w/two', label: 'Two' });
  });
});

describe('resolveDefaultEditor', () => {
  it('prefers the configured editor', () => {
    expect(resolveDefaultEditor(EDITORS, 'cursor')?.id).toBe('cursor');
  });

  it('falls back to the first one the server host can actually launch', () => {
    expect(resolveDefaultEditor(EDITORS, null)?.id).toBe('vscode');
  });

  it('still offers an uninstalled editor when nothing is installed — its URL scheme is the browser fallback', () => {
    const none: EditorInfo[] = [
      { id: 'cursor', name: 'Cursor', available: false, scheme: 'cursor' },
    ];
    expect(resolveDefaultEditor(none, null)?.id).toBe('cursor');
  });

  it('resolves to nothing when the server reports no editors at all', () => {
    expect(resolveDefaultEditor([], null)).toBeUndefined();
  });
});

describe('useEditorActions', () => {
  it('offers nothing when no page has published a target', () => {
    const platform = makePlatform();
    const result = renderActions(platform);
    expect(result.current.target).toBeNull();
    act(() => result.current.open('vscode'));
    expect(platform.openInEditor).not.toHaveBeenCalled();
  });

  it('names the default editor and opens the published path', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const platform = makePlatform();
    const result = renderActions(platform);

    await waitFor(() => expect(result.current.label).toBe('Open in VS Code'));
    act(() => result.current.open(result.current.preferred?.id));
    await waitFor(() => expect(platform.openInEditor).toHaveBeenCalledWith({ path: '/w/repo', editor: 'vscode' }));
  });

  it('falls back to the URL scheme when the server host could not launch anything', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const platform = makePlatform({
      openInEditor: vi.fn().mockResolvedValue({ ok: false, fallbackUrl: 'vscode://file//w/repo', error: 'no CLI' }),
    });
    const result = renderActions(platform);

    act(() => result.current.open('vscode'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('vscode://file//w/repo', '_blank', 'noopener'));
  });

  it('lists every editor the server knows about and opens the one picked, not the default', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const platform = makePlatform();
    const result = renderActions(platform);

    await waitFor(() => expect(result.current.editors.map((e) => e.id)).toEqual(['vscode', 'cursor']));
    act(() => result.current.open('cursor'));
    await waitFor(() => expect(platform.openInEditor).toHaveBeenCalledWith({ path: '/w/repo', editor: 'cursor' }));
  });
});
