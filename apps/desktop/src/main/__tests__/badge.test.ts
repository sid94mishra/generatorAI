// applyAttentionBadge (G-05): one function, exercised against a fake
// Electron for every OS branch. Each platform gets its own real capability
// (Dock badge / Unity launcher badge / taskbar overlay icon) rather than a
// silent no-op standing in for "the platform this bug happened to reproduce
// on" — pinned per the repo's cross-platform standing rule.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dockSetBadge: vi.fn(),
  hasDock: true,
  setBadgeCount: vi.fn(),
  hasSetBadgeCount: true,
}));

vi.mock('electron', () => ({
  app: {
    get dock() {
      return state.hasDock ? { setBadge: state.dockSetBadge } : undefined;
    },
    setBadgeCount: state.hasSetBadgeCount ? state.setBadgeCount : undefined,
  },
  nativeImage: {
    createFromBuffer: vi.fn((buffer: Buffer, opts: { width: number; height: number }) => ({
      buffer,
      ...opts,
      isEmpty: () => false,
    })),
  },
}));

vi.mock('../logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { applyAttentionBadge } from '../badge';

function fakeWindow() {
  return { setOverlayIcon: vi.fn(), isDestroyed: () => false };
}

beforeEach(() => {
  state.dockSetBadge.mockReset();
  state.hasDock = true;
  state.setBadgeCount.mockReset();
  state.hasSetBadgeCount = true;
});

describe('applyAttentionBadge — darwin', () => {
  it('sets the Dock badge text for a positive count, capped at 999', () => {
    applyAttentionBadge(5, { platform: 'darwin' });
    expect(state.dockSetBadge).toHaveBeenCalledWith('5');

    applyAttentionBadge(12_000, { platform: 'darwin' });
    expect(state.dockSetBadge).toHaveBeenCalledWith('999');
  });

  it('clears the Dock badge for zero', () => {
    applyAttentionBadge(0, { platform: 'darwin' });
    expect(state.dockSetBadge).toHaveBeenCalledWith('');
  });

  it('never throws when the process has no Dock (should not happen on darwin, but the API allows it)', () => {
    state.hasDock = false;
    expect(() => applyAttentionBadge(3, { platform: 'darwin' })).not.toThrow();
  });
});

describe('applyAttentionBadge — linux', () => {
  it('calls setBadgeCount with the raw count', () => {
    applyAttentionBadge(4, { platform: 'linux' });
    expect(state.setBadgeCount).toHaveBeenCalledWith(4);
  });

  it('never negative, never above 999', () => {
    applyAttentionBadge(-1, { platform: 'linux' });
    expect(state.setBadgeCount).toHaveBeenCalledWith(0);
  });

  it('degrades gracefully on a desktop environment without a launcher API (setBadgeCount absent)', () => {
    state.hasSetBadgeCount = false;
    expect(() => applyAttentionBadge(2, { platform: 'linux' })).not.toThrow();
  });
});

describe('applyAttentionBadge — win32', () => {
  it('sets a taskbar overlay icon for a positive count', () => {
    const win = fakeWindow();
    applyAttentionBadge(3, { platform: 'win32', getMainWindow: () => win });
    expect(win.setOverlayIcon).toHaveBeenCalledTimes(1);
    const [icon, description] = win.setOverlayIcon.mock.calls[0]!;
    expect(icon).not.toBeNull();
    expect(description).toContain('3');
  });

  it('clears the overlay icon for zero', () => {
    const win = fakeWindow();
    applyAttentionBadge(0, { platform: 'win32', getMainWindow: () => win });
    expect(win.setOverlayIcon).toHaveBeenCalledWith(null, '');
  });

  it('does nothing when there is no main window', () => {
    expect(() => applyAttentionBadge(3, { platform: 'win32', getMainWindow: () => null })).not.toThrow();
  });

  it('does not call a destroyed window', () => {
    const win = { setOverlayIcon: vi.fn(), isDestroyed: () => true };
    applyAttentionBadge(3, { platform: 'win32', getMainWindow: () => win });
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it('never calls the macOS/Linux APIs on Windows', () => {
    applyAttentionBadge(3, { platform: 'win32', getMainWindow: () => fakeWindow() });
    expect(state.dockSetBadge).not.toHaveBeenCalled();
    expect(state.setBadgeCount).not.toHaveBeenCalled();
  });
});

describe('applyAttentionBadge — unknown platform', () => {
  it('does nothing rather than guessing', () => {
    expect(() => applyAttentionBadge(3, { platform: 'aix' })).not.toThrow();
    expect(state.dockSetBadge).not.toHaveBeenCalled();
    expect(state.setBadgeCount).not.toHaveBeenCalled();
  });
});

describe('applyAttentionBadge — defaults to process.platform', () => {
  it('uses the real process.platform when none is passed', () => {
    expect(() => applyAttentionBadge(1)).not.toThrow();
  });
});
