// ────────────────────────────────────────────────────────────────
// useUpdateState / restartToUpdate — the G-04 web hooks.
//
// Pinned: null on plain web; an initial read plus every live push on
// desktop; `restartToUpdate` delegates to the bridge's `install()`.
// ────────────────────────────────────────────────────────────────

import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isDesktop: false,
  getState: vi.fn(async () => ({ status: 'idle' as const, currentVersion: '1.0.0' })),
  install: vi.fn(async () => undefined),
  onChangeHandlers: [] as Array<(s: unknown) => void>,
}));

vi.mock('@/lib/desktop.js', () => ({
  get isDesktop() {
    return state.isDesktop;
  },
  desktopUpdates: {
    isAvailable: () => true,
    getState: state.getState,
    install: state.install,
    onChange: (cb: (s: unknown) => void) => {
      state.onChangeHandlers.push(cb);
      return () => {
        state.onChangeHandlers = state.onChangeHandlers.filter((h) => h !== cb);
      };
    },
    restartToUpdate: async () => {
      await state.install();
    },
  },
}));

import { restartToUpdate, useUpdateState } from '@/hooks/updateQueries.js';

beforeEach(() => {
  state.isDesktop = false;
  state.onChangeHandlers = [];
  state.getState.mockReset().mockResolvedValue({ status: 'idle', currentVersion: '1.0.0' });
  state.install.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateState', () => {
  it('stays null on plain web', async () => {
    state.isDesktop = false;
    const { result } = renderHook(() => useUpdateState());
    expect(result.current).toBeNull();
    expect(state.getState).not.toHaveBeenCalled();
  });

  it('reads the initial state and follows live pushes on desktop', async () => {
    state.isDesktop = true;
    state.getState.mockResolvedValue({ status: 'idle', currentVersion: '1.2.0' });
    const { result } = renderHook(() => useUpdateState());

    await waitFor(() => expect(result.current).toEqual({ status: 'idle', currentVersion: '1.2.0' }));

    act(() => {
      state.onChangeHandlers[0]!({ status: 'downloading', currentVersion: '1.2.0', nextVersion: '1.3.0', percent: 40 });
    });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'downloading', currentVersion: '1.2.0', nextVersion: '1.3.0', percent: 40 }),
    );

    act(() => {
      state.onChangeHandlers[0]!({ status: 'ready', currentVersion: '1.2.0', nextVersion: '1.3.0', downloadedVersion: '1.3.0' });
    });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', currentVersion: '1.2.0', nextVersion: '1.3.0', downloadedVersion: '1.3.0' }),
    );
  });

  it('stays unknown (null) when the first read fails, until main pushes (R23)', async () => {
    state.isDesktop = true;
    state.getState.mockRejectedValue(new Error('ipc failed'));
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(state.getState).toHaveBeenCalled());
    expect(result.current).toBeNull();

    act(() => {
      state.onChangeHandlers[0]!({ status: 'checking', currentVersion: '1.2.0' });
    });
    await waitFor(() => expect(result.current).toEqual({ status: 'checking', currentVersion: '1.2.0' }));
  });

  it('a push that lands before the first read is not overwritten by the older read', async () => {
    state.isDesktop = true;
    let resolveRead!: (s: unknown) => void;
    state.getState.mockImplementation(() => new Promise((r) => (resolveRead = r)) as never);
    const { result } = renderHook(() => useUpdateState());
    act(() => {
      state.onChangeHandlers[0]!({ status: 'downloading', currentVersion: '1.2.0', percent: 5 });
    });
    await act(async () => {
      resolveRead({ status: 'idle', currentVersion: '1.2.0' });
    });
    expect(result.current).toEqual({ status: 'downloading', currentVersion: '1.2.0', percent: 5 });
  });
});

describe('restartToUpdate', () => {
  it('calls the bridge install action', async () => {
    await restartToUpdate();
    expect(state.install).toHaveBeenCalled();
  });
});
