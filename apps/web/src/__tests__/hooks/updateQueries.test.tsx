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
      state.onChangeHandlers[0]!({ status: 'ready', currentVersion: '1.2.0', nextVersion: '1.3.0' });
    });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', currentVersion: '1.2.0', nextVersion: '1.3.0' }),
    );
  });
});

describe('restartToUpdate', () => {
  it('calls the bridge install action', async () => {
    restartToUpdate();
    await waitFor(() => expect(state.install).toHaveBeenCalled());
  });
});
