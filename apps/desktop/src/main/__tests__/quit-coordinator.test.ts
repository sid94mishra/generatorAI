// quitApp — the one bounded shutdown sequence every quit ends in (index.ts
// `before-quit`, which an update install's `app.quit()` also reaches). Pinned:
// it respects a declined `confirmDiscard`, stops the server only in standalone
// mode, never lets a hung step block the exit past its deadline, exits
// exactly once, and a second quit while one is running shares it
// (P1-review P2-R23) instead of prompting and shutting down twice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  confirmDiscard: vi.fn(async () => true),
  setQuitting: vi.fn(),
  disposeComputerHost: vi.fn(async () => undefined),
  stopServer: vi.fn(async () => undefined),
  destroyTray: vi.fn(),
}));

vi.mock('electron', () => ({ app: { exit: vi.fn() } }));
vi.mock('../window-manager', () => ({
  getWindowManager: () => ({ confirmDiscard: state.confirmDiscard, setQuitting: state.setQuitting }),
}));
vi.mock('../server-manager', () => ({ getServerManager: () => ({ stop: state.stopServer }) }));
vi.mock('../computer-host-registry', () => ({ disposeComputerHost: state.disposeComputerHost }));
vi.mock('../tray', () => ({ destroyTray: state.destroyTray }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

async function load() {
  vi.resetModules();
  return import('../quit-coordinator');
}

beforeEach(() => {
  state.confirmDiscard.mockReset().mockResolvedValue(true);
  state.setQuitting.mockReset();
  state.disposeComputerHost.mockReset().mockResolvedValue(undefined);
  state.stopServer.mockReset().mockResolvedValue(undefined);
  state.destroyTray.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('quitApp', () => {
  it('runs the full sequence, then exits with code 0', async () => {
    const { quitApp, isQuitting } = await load();
    const exit = vi.fn();
    const order: string[] = [];
    state.disposeComputerHost.mockImplementation(async () => void order.push('computer-host'));
    state.stopServer.mockImplementation(async () => void order.push('server'));
    state.destroyTray.mockImplementation(() => void order.push('tray'));
    exit.mockImplementation(() => void order.push('exit'));

    expect(await quitApp('standalone', exit)).toBe(true);
    expect(state.confirmDiscard).toHaveBeenCalled();
    expect(state.setQuitting).toHaveBeenCalledWith(true);
    expect(order).toEqual(['computer-host', 'server', 'tray', 'exit']);
    expect(exit).toHaveBeenCalledWith(0);
    expect(isQuitting()).toBe(true);
  });

  it('does not stop the embedded server in dev mode (an external dev server is not ours to manage)', async () => {
    const { quitApp } = await load();
    await quitApp('dev', vi.fn());
    expect(state.disposeComputerHost).toHaveBeenCalled();
    expect(state.stopServer).not.toHaveBeenCalled();
  });

  it('declines when confirmDiscard returns false, runs nothing else, and lets a later quit ask again', async () => {
    const { quitApp, isQuitting } = await load();
    const exit = vi.fn();
    state.confirmDiscard.mockResolvedValueOnce(false);
    expect(await quitApp('standalone', exit)).toBe(false);
    expect(state.setQuitting).not.toHaveBeenCalled();
    expect(state.disposeComputerHost).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(isQuitting()).toBe(false);

    expect(await quitApp('standalone', exit)).toBe(true);
    expect(state.confirmDiscard).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight quit: a second call while the discard prompt is open neither prompts nor exits twice', async () => {
    const { quitApp } = await load();
    const exit = vi.fn();
    let answer!: (v: boolean) => void;
    state.confirmDiscard.mockImplementation(() => new Promise<boolean>((r) => (answer = r)));

    const first = quitApp('standalone', exit);
    const second = quitApp('standalone', exit);
    expect(second).toBe(first);
    answer(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(state.confirmDiscard).toHaveBeenCalledTimes(1);
    expect(state.stopServer).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('a quit after a completed one does not run the shutdown again', async () => {
    const { quitApp } = await load();
    const exit = vi.fn();
    await quitApp('standalone', exit);
    await quitApp('standalone', exit);
    expect(state.stopServer).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('still destroys the tray and exits when stopping the server throws', async () => {
    const { quitApp } = await load();
    const exit = vi.fn();
    state.stopServer.mockRejectedValue(new Error('boom'));
    expect(await quitApp('standalone', exit)).toBe(true);
    expect(state.destroyTray).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('gives up on a hung shutdown step after its deadline and still exits', async () => {
    const { quitApp } = await load();
    const exit = vi.fn();
    vi.useFakeTimers();
    state.disposeComputerHost.mockImplementation(() => new Promise(() => undefined)); // never resolves

    const run = quitApp('standalone', exit);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await run).toBe(true);
    expect(state.destroyTray).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('markQuitting', () => {
  it('sets isQuitting without running the shutdown sequence', async () => {
    const { isQuitting, markQuitting } = await load();
    expect(isQuitting()).toBe(false);
    markQuitting(true);
    expect(isQuitting()).toBe(true);
    expect(state.disposeComputerHost).not.toHaveBeenCalled();
  });
});
