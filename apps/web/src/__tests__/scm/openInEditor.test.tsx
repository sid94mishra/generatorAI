// ────────────────────────────────────────────────────────────────
// "Open in editor" — the store and the top-bar button.
//
// The button lives in the Header, which knows nothing about chats, runs,
// projects or codebases: each page publishes its own path into
// `editorTargetStore` and the Header renders whatever is there. What that
// buys — and what these tests pin — is that the Header never has to guess:
// no target, no button; and a route change hands over cleanly instead of
// one page's unmount wiping the next page's target.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import {
  useEditorTargetStore,
  useEditorTarget,
} from '@/stores/editorTargetStore.js';
import {
  OpenInEditorButton,
  resolveDefaultEditor,
} from '@/components/shared/OpenInEditorButton.js';
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

function renderButton(platform: ReturnType<typeof makePlatform>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
          <MemoryRouter>
            <OpenInEditorButton />
          </MemoryRouter>
        </PlatformContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
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

describe('OpenInEditorButton', () => {
  it('renders nothing when no page has published a target', () => {
    renderButton(makePlatform());
    expect(screen.queryByTestId('open-in-editor')).toBeNull();
  });

  it('names the default editor and opens the published path', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const platform = makePlatform();
    renderButton(platform);

    const primary = await screen.findByTestId('open-in-editor-primary');
    await waitFor(() => expect(primary).toHaveTextContent('Open in VS Code'));

    fireEvent.click(primary);
    await waitFor(() =>
      expect(platform.openInEditor).toHaveBeenCalledWith({ path: '/w/repo', editor: 'vscode' }),
    );
  });

  it('falls back to the URL scheme when the server host could not launch anything', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const platform = makePlatform({
      openInEditor: vi
        .fn()
        .mockResolvedValue({ ok: false, fallbackUrl: 'vscode://file//w/repo', error: 'no CLI' }),
    });
    renderButton(platform);

    fireEvent.click(await screen.findByTestId('open-in-editor-primary'));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('vscode://file//w/repo', '_blank', 'noopener'),
    );
  });

  it('lists every editor the server knows about in the caret menu', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const platform = makePlatform();
    renderButton(platform);

    // Radix opens its menu on pointerdown / keyboard, not a synthetic click.
    const caret = await screen.findByTestId('open-in-editor-menu');
    await act(async () => {
      fireEvent.keyDown(caret, { key: 'Enter' });
    });

    expect(await screen.findByRole('menuitem', { name: /VS Code/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Cursor/ })).toHaveTextContent('not installed');
    expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeInTheDocument();
  });

  it('opens the editor the user picked from the menu, not the default', async () => {
    useEditorTargetStore.setState({ target: { path: '/w/repo', label: 'Chat' } });
    const platform = makePlatform();
    renderButton(platform);

    // Radix opens its menu on pointerdown / keyboard, not a synthetic click.
    const caret = await screen.findByTestId('open-in-editor-menu');
    await act(async () => {
      fireEvent.keyDown(caret, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /Cursor/ }));
    });

    await waitFor(() =>
      expect(platform.openInEditor).toHaveBeenCalledWith({ path: '/w/repo', editor: 'cursor' }),
    );
  });
});
