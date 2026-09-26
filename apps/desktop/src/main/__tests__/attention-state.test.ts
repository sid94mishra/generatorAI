// attention-state.ts (G-05; P1-review P2-R8): a push repaints the tray and the
// badge; clearing (window closed, renderer gone, repointed) drops both.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionCounts } from '@generatorai/shared';

const state = vi.hoisted(() => ({
  refreshTrayMenu: vi.fn(),
  applyAttentionBadge: vi.fn(),
  mainWindow: { id: 'win' } as unknown,
}));

vi.mock('../tray', () => ({ refreshTrayMenu: state.refreshTrayMenu }));
vi.mock('../badge', () => ({ applyAttentionBadge: state.applyAttentionBadge }));
vi.mock('../window-manager', () => ({ getWindowManager: () => ({ getMainWindow: () => state.mainWindow }) }));

import { clearAttention, getAttention, setAttention } from '../attention-state';

const counts: AttentionCounts = {
  needsYou: 3,
  running: 1,
  byEntity: {
    chat: { needsYou: 3, running: 1 },
    workflow_run: { needsYou: 0, running: 0 },
    automation_execution: { needsYou: 0, running: 0 },
  },
};

beforeEach(() => {
  state.refreshTrayMenu.mockReset();
  state.applyAttentionBadge.mockReset();
});

describe('attention-state', () => {
  it('stores a push and repaints the tray and the badge', () => {
    setAttention(counts);
    expect(getAttention()).toBe(counts);
    expect(state.refreshTrayMenu).toHaveBeenCalledTimes(1);
    expect(state.applyAttentionBadge).toHaveBeenCalledWith(3, expect.objectContaining({ getMainWindow: expect.any(Function) }));
    const deps = state.applyAttentionBadge.mock.calls[0]![1] as { getMainWindow: () => unknown };
    expect(deps.getMainWindow()).toBe(state.mainWindow);
  });

  it('clearAttention forgets the counts, repaints the tray and clears the badge on every OS', () => {
    setAttention(counts);
    state.refreshTrayMenu.mockReset();
    state.applyAttentionBadge.mockReset();
    clearAttention();
    expect(getAttention()).toBeNull();
    expect(state.refreshTrayMenu).toHaveBeenCalledTimes(1);
    expect(state.applyAttentionBadge).toHaveBeenCalledWith(0, expect.anything());
  });
});
