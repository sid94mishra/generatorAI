// runQuitShutdown — the one bounded shutdown sequence shared by the normal
// quit path (index.ts `before-quit`) and the update install path
// (updater.ts `installUpdate`, 06-desktop-and-shell.md §11 risk R5). Pinned:
// it runs exactly once, respects a declined `confirmDiscard`, stops the
// server only in standalone mode, and never lets a hung step block the
// caller's own exit past the deadline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  confirmDiscard: vi.fn(async () => true),
  setQuitting: vi.fn(),
  disposeComputerHost: vi.fn(async () => undefined),
  stopServer: vi.fn(async () => undefined),
  destroyTray: vi.fn(),
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({ confirmDiscard: state.confirmDiscard, setQuitting: state.setQuitting }),
}));
vi.mock('../server-manager', () => ({ getServerManager: () => ({ stop: state.stopServer }) }));
vi.mock('../computer-host-registry', () => ({ disposeComputerHost: state.disposeComputerHost }));
vi.mock('../tray', () => ({ destroyTray: state.destroyTray }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { __resetQuitStateForTests, isQuitHandled, isQuitting, markQuitting, runQuitShutdown } from '../quit-coordinator';

beforeEach(() => {
  __resetQuitStateForTests();
  state.confirmDiscard.mockReset().mockResolvedValue(true);
  state.setQuitting.mockReset();
  state.disposeComputerHost.mockReset().mockResolvedValue(undefined);
  state.stopServer.mockReset().mockResolvedValue(undefined);
  state.destroyTray.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runQuitShutdown', () => {
  it('runs the full sequence and marks the quit handled', async () => {
    expect(isQuitHandled()).toBe(false);
    const proceeded = await runQuitShutdown('standalone');
    expect(proceeded).toBe(true);
    expect(state.confirmDiscard).toHaveBeenCalled();
    expect(state.setQuitting).toHaveBeenCalledWith(true);
    expect(state.disposeComputerHost).toHaveBeenCalled();
    expect(state.stopServer).toHaveBeenCalled();
    expect(state.destroyTray).toHaveBeenCalled();
    expect(isQuitHandled()).toBe(true);
    expect(isQuitting()).toBe(true);
  });

  it('does not stop the embedded server in dev mode (an external dev server is not ours to manage)', async () => {
    await runQuitShutdown('dev');
    expect(state.disposeComputerHost).toHaveBeenCalled();
    expect(state.stopServer).not.toHaveBeenCalled();
  });

  it('declines when confirmDiscard returns false, and runs nothing else', async () => {
    state.confirmDiscard.mockResolvedValue(false);
    const proceeded = await runQuitShutdown('standalone');
    expect(proceeded).toBe(false);
    expect(state.setQuitting).not.toHaveBeenCalled();
    expect(state.disposeComputerHost).not.toHaveBeenCalled();
    expect(isQuitHandled()).toBe(false);
  });

  it('runs only once — a second call is a no-op that returns false', async () => {
    await runQuitShutdown('standalone');
    state.disposeComputerHost.mockClear();
    state.destroyTray.mockClear();

    const proceeded = await runQuitShutdown('standalone');
    expect(proceeded).toBe(false);
    expect(state.disposeComputerHost).not.toHaveBeenCalled();
    expect(state.destroyTray).not.toHaveBeenCalled();
  });

  it('still destroys the tray when stopping the server throws', async () => {
    state.stopServer.mockRejectedValue(new Error('boom'));
    const proceeded = await runQuitShutdown('standalone');
    expect(proceeded).toBe(true);
    expect(state.destroyTray).toHaveBeenCalled();
  });

  it('gives up on a hung shutdown step after its deadline and still proceeds', async () => {
    vi.useFakeTimers();
    state.disposeComputerHost.mockImplementation(() => new Promise(() => undefined)); // never resolves

    const run = runQuitShutdown('standalone');
    await vi.advanceTimersByTimeAsync(20_000);
    const proceeded = await run;

    expect(proceeded).toBe(true);
    expect(state.destroyTray).toHaveBeenCalled();
  });
});

describe('markQuitting', () => {
  it('sets isQuitting without running the full shutdown sequence', () => {
    expect(isQuitting()).toBe(false);
    markQuitting(true);
    expect(isQuitting()).toBe(true);
    expect(isQuitHandled()).toBe(false);
  });
});
