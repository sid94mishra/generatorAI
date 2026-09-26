// quitApp — the one bounded shutdown sequence every quit ends in (index.ts
// `before-quit`, which an update install's `app.quit()` also reaches). Pinned:
// it respects a declined `confirmDiscard`, stops the server only in standalone
// mode, never lets a hung step block the exit past its deadline, exits
// exactly once, and a second quit while one is running shares it
// (P1-review P2-R23) instead of prompting and shutting down twice. A failed
// prompt does not wedge later quits (P2-R38), and an update's exit hand-off
// runs after the whole shutdown, immediately before the exit (P2-R28).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  confirmDiscard: vi.fn(async () => true),
  setQuitting: vi.fn(),
  disposeComputerHost: vi.fn(async () => undefined),
  stopServer: vi.fn(async (): Promise<void> => undefined),
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

describe('quitApp failure edges (P2-R38)', () => {
  it('a throwing unsaved-work prompt does not wedge quitting: the next quit runs', async () => {
    const { quitApp, isQuitting } = await load();
    const exit = vi.fn();
    state.confirmDiscard.mockRejectedValueOnce(new Error('dialog failed'));
    expect(await quitApp('standalone', exit)).toBe(false);
    expect(isQuitting()).toBe(false);
    expect(exit).not.toHaveBeenCalled();

    expect(await quitApp('standalone', exit)).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('exit hand-off (the Windows/Linux update install, P2-R28)', () => {
  function handoff(order: string[]) {
    return {
      onCommitted: vi.fn(() => void order.push('committed')),
      onDeclined: vi.fn(() => void order.push('declined')),
      run: vi.fn(async () => void order.push('installer')),
    };
  }

  it('runs after the whole shutdown and immediately before exit', async () => {
    const { quitApp, setExitHandoff } = await load();
    const order: string[] = [];
    const exit = vi.fn(() => void order.push('exit'));
    state.stopServer.mockImplementation(async () => void order.push('server'));
    state.destroyTray.mockImplementation(() => void order.push('tray'));
    const h = handoff(order);
    setExitHandoff(h);

    expect(await quitApp('standalone', exit)).toBe(true);
    expect(order).toEqual(['committed', 'server', 'tray', 'installer', 'exit']);
    expect(h.onDeclined).not.toHaveBeenCalled();
  });

  it('a declined quit tells the hand-off and runs nothing; a later quit does not reuse it', async () => {
    const { quitApp, setExitHandoff } = await load();
    const order: string[] = [];
    const exit = vi.fn();
    const h = handoff(order);
    setExitHandoff(h);
    state.confirmDiscard.mockResolvedValueOnce(false);

    expect(await quitApp('standalone', exit)).toBe(false);
    expect(order).toEqual(['declined']);
    expect(state.stopServer).not.toHaveBeenCalled();

    await quitApp('standalone', exit);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('a hand-off registered while the shutdown is running still runs', async () => {
    const { quitApp, setExitHandoff } = await load();
    const order: string[] = [];
    let release!: () => void;
    state.stopServer.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const run = quitApp('standalone', vi.fn());
    await vi.waitFor(() => expect(state.stopServer).toHaveBeenCalled());
    const h = handoff(order);
    setExitHandoff(h);
    release();
    await run;
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('a hand-off that hangs or throws does not stop the exit', async () => {
    const { quitApp, setExitHandoff, HANDOFF_DEADLINE_MS } = await load();
    const exit = vi.fn();
    vi.useFakeTimers();
    setExitHandoff({ onCommitted: vi.fn(), onDeclined: vi.fn(), run: () => new Promise<void>(() => undefined) });
    const pending = quitApp('standalone', exit);
    await vi.advanceTimersByTimeAsync(HANDOFF_DEADLINE_MS);
    expect(await pending).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();

    const again = await load();
    const exit2 = vi.fn();
    again.setExitHandoff({ onCommitted: vi.fn(), onDeclined: vi.fn(), run: () => Promise.reject(new Error('boom')) });
    expect(await again.quitApp('standalone', exit2)).toBe(true);
    expect(exit2).toHaveBeenCalledWith(0);
  });
});
