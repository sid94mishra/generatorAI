// ────────────────────────────────────────────────────────────────
// CuaDriverBridge — the decisions it makes from driver responses.
//
// Every behaviour pinned here came from a live failure, and none of them was
// reachable by a test before `driverModule` existed:
//
//   • a session the driver retired behind our back used to fail forever
//   • a keystroke Chrome ignores used to dead-end instead of escalating
//   • a minimised window used to accept writes that were silently discarded
//
// The fake driver returns the driver's real message text, because that text is
// what the bridge actually branches on.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@generatorai/shared';
import { CuaDriverBridge, closestMenuItem, firstNonMenuCandidate, focusHolder, mainWindow, parseRunSteps, pickNewDocumentItem, splitLaunchArguments } from '../CuaDriverBridge.js';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

const logger: ILogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child: () => logger,
};

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

interface FakeOptions {
  /** Replies keyed by tool name; a function receives the call index. */
  reply: (tool: string, args: Record<string, unknown>, callIndex: number) => unknown;
}

function ok(structured: unknown, extra: Record<string, unknown> = {}) {
  return {
    text: '',
    structuredJson: JSON.stringify(structured),
    isError: false,
    degraded: false,
    action: { effect: 0, route: 0 },
    ...extra,
  };
}

function driverError(text: string) {
  return { text, isError: true, degraded: false, action: { effect: 4, route: 1 } };
}

/** One live, non-minimised window so `ensureLiveWindow` lets calls through. */
const WINDOWS = {
  windows: [
    { window_id: 7, pid: 42, title: 'Untitled - Notepad', minimized: false, focused: true, index: 0 },
  ],
};

function makeBridge(opts: FakeOptions, bridgeOptions: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const sessionStarts: string[] = [];
  const connectedTo: (string | undefined)[] = [];
  const spawned: { binaryPath: string }[] = [];
  let inProcessCreated = 0;
  let index = 0;

  const client = {
    startSession: async (input: { session: string }) => {
      sessionStarts.push(input.session);
      return {};
    },
    endSession: async () => ({}),
    metadata: async () => ({ driverVersion: '0.19.3', contractVersion: '1' }),
    callTool: async (tool: string, argumentsJson: string) => {
      const args = JSON.parse(argumentsJson) as Record<string, unknown>;
      calls.push({ tool, args });
      return opts.reply(tool, args, index++) as never;
    },
    shutdown: async () => undefined,
  };

  let stopped = 0;
  const bridge = new CuaDriverBridge({
    logger,
    maxSnapshotElements: 100,
    maxSnapshotDepth: 8,
    driverModule: {
      CuaDriver: {
        create: () => {
          inProcessCreated += 1;
          return client;
        },
        connect: (socketPath: string | undefined) => {
          connectedTo.push(socketPath);
          return client;
        },
      },
      EmbeddedCuaDriverHost: {
        withOptions: (options: { binaryPath: string }) => {
          spawned.push({ binaryPath: options.binaryPath });
          return {
            start: async () => ({
              socketPath: '/tmp/own.sock',
              pid: 4242,
              generation: 'g1',
              driverVersion: '0.19.3',
            }),
            stop: async () => {
              stopped += 1;
            },
          };
        },
      },
    } as never,
    // Give the bridge a spawnable daemon by default so these tests exercise
    // the BEHAVIOUR they are about (window selection, session recovery, key
    // escalation) rather than endpoint discovery.
    //
    // Without it they fell through to the in-process driver, which
    // `inProcessAllowed()` refuses on darwin by design — a driver created
    // inside the server process has no stable bundle identity, so macOS TCC
    // grants do not apply to it. That made 28 assertions pass on Windows and
    // Linux and fail on macOS for a reason that had nothing to do with what
    // they were testing. `EmbeddedCuaDriverHost` is already faked above, so
    // this resolves to the stub socket on every platform. Overridable: the
    // spread below still wins for tests that probe discovery itself.
    driverBinaryPath: '/opt/cua-driver',
    ...bridgeOptions,
  });

  return {
    bridge,
    calls,
    sessionStarts,
    connectedTo,
    spawned,
    stoppedCount: () => stopped,
    inProcessCreated: () => inProcessCreated,
  };
}

async function started(fake: ReturnType<typeof makeBridge>) {
  return fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });
}

const CLICK = {
  type: 'click' as const,
  snapshotId: 's1',
  elementIndex: 3,
  button: 'left' as const,
  clickCount: 1,
};

/** Seeds `snapshotScopes` so element-addressed calls can resolve pid/window. */
async function seedSnapshot(fake: ReturnType<typeof makeBridge>, handle: Awaited<ReturnType<typeof started>>) {
  await fake.bridge.snapshot(handle, {
    app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    window: { by: 'id', id: 7 },
  });
}

const SNAPSHOT_PAYLOAD = {
  snapshot_id: 's1',
  pid: 42,
  window_id: 7,
  elements: [{ element_index: 3, role: 'Button', label: 'Save', element_token: 's1:3' }],
};

describe('CuaDriverBridge window selection', () => {
  // The driver's contract: "higher values are closer to the front... To select
  // a frontmost candidate, take the maximum integer z_index." Measured on a
  // live desktop, the backmost window ("Program Manager") is 0. Reading 0 as
  // topmost sent every unqualified call to the OLDEST window of the app — so a
  // freshly created workbook was ignored and the writes landed in the one the
  // user already had open.
  const TWO_WINDOWS = {
    windows: [
      { window_id: 11, pid: 42, title: 'Book1', minimized: false, is_on_screen: true, z_index: 0 },
      { window_id: 22, pid: 42, title: 'Book2', minimized: false, is_on_screen: true, z_index: 5 },
    ],
  };

  it('targets the highest z_index, not the lowest', async () => {
    const snapshots: Record<string, unknown>[] = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(TWO_WINDOWS);
        if (tool === 'get_window_state') {
          snapshots.push(args);
          return ok({ ...SNAPSHOT_PAYLOAD, window_id: args['window_id'] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    await fake.bridge.snapshot(handle, {
      app: { appId: 'excel', name: 'Excel', pid: 42 },
      window: { by: 'focused' },
    });

    expect(snapshots[0]?.['window_id']).toBe(22);
  });

  it('falls back explicitly when the driver reports no stacking order', async () => {
    // A null z_index means "unavailable"; the contract says callers must not
    // infer one, so the fallback is the first window that is not minimised.
    const snapshots: Record<string, unknown>[] = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') {
          return ok({
            windows: [
              { window_id: 11, pid: 42, title: 'Book1', minimized: true, is_on_screen: false, z_index: null },
              { window_id: 22, pid: 42, title: 'Book2', minimized: false, is_on_screen: true, z_index: null },
            ],
          });
        }
        if (tool === 'get_window_state') {
          snapshots.push(args);
          return ok({ ...SNAPSHOT_PAYLOAD, window_id: args['window_id'] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    await fake.bridge.snapshot(handle, {
      app: { appId: 'excel', name: 'Excel', pid: 42 },
      window: { by: 'focused' },
    });

    expect(snapshots[0]?.['window_id']).toBe(22);
  });

  it('takes the largest window when none is frontmost, not the first in the list', async () => {
    // Measured on macOS Calculator without Screen Recording: every window off screen, the first ones 30 px strips.
    const snapshots: Record<string, unknown>[] = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') {
          return ok({
            windows: [
              { window_id: 1704, pid: 42, title: '', is_on_screen: false, bounds: { x: -570, y: -1080, width: 1920, height: 30 } },
              { window_id: 745, pid: 42, title: '', is_on_screen: false, bounds: { x: 0, y: 0, width: 1280, height: 30 } },
              { window_id: 120, pid: 42, title: '', is_on_screen: false, bounds: { x: 830, y: 392, width: 230, height: 408 } },
            ],
          });
        }
        if (tool === 'get_window_state') {
          snapshots.push(args);
          return ok({ ...SNAPSHOT_PAYLOAD, window_id: args['window_id'] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    await fake.bridge.snapshot(handle, { app: { appId: 'calculator', name: 'Calculator', pid: 42 }, window: { by: 'focused' } });

    expect(snapshots[0]?.['window_id']).toBe(120);
  });

  it("reports the driver's deliberate empty read as a refusal with its advice", async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') {
          return ok({
            degraded: true,
            degraded_reason:
              'ax_window_unresolved: window_id 7 exists and is owned by pid 42, but none of the AXWindow elements reports it. The tree is returned EMPTY on purpose.',
            elements: [],
            elements_complete: false,
            escalation: { reason: 'observation-only', recommended: 'foreground' },
            pid: 42,
            window_id: 7,
            tree_markdown: '',
          });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.snapshot(handle, { app: { appId: 'notepad', name: 'Notepad', pid: 42 }, window: { by: 'focused' } });

    expect(result.ok).toBe(false);
    expect(result.refusal?.code).toBe('background_unavailable');
    expect(result.refusal?.message).toMatch(/ax_window_unresolved/);
    expect(result.refusal?.message).toMatch(/foreground/);
    expect(result.refusal?.message).not.toMatch(/does not recognise/);
  });
});

describe('CuaDriverBridge session recovery', () => {
  it('reopens a session the driver retired, then retries the same call once', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    let clickCount = 0;
    const bridgeAny = fake.bridge as unknown as { connections: Map<string, { client: { callTool: unknown } }> };
    const connection = bridgeAny.connections.get('ws')!;
    const original = connection.client.callTool as (t: string, a: string) => Promise<unknown>;
    connection.client.callTool = async (tool: string, args: string) => {
      if (tool === 'click') {
        clickCount += 1;
        if (clickCount === 1) {
          return driverError('this session has ended; call start_session explicitly to reuse its label');
        }
        return ok({});
      }
      return original(tool, args);
    };

    const result = await fake.bridge.act(handle, {
      ...CLICK,
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    } as never);

    expect(result.ok).toBe(true);
    expect(clickCount).toBe(2);
    // start_session twice: once at start(), once for the reopen.
    expect(fake.sessionStarts).toHaveLength(2);
  });

  it('does not reopen for an ordinary refusal', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        return driverError('the target window is covered by another window');
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    const result = await fake.bridge.act(handle, {
      ...CLICK,
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    } as never);

    expect(result.ok).toBe(false);
    expect(fake.sessionStarts).toHaveLength(1);
  });
});

describe('CuaDriverBridge foreground escalation', () => {
  it('retries with foreground delivery when the driver asks for it', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        return ok({});
      },
    });
    const handle = await started(fake);

    const bridgeAny = fake.bridge as unknown as { connections: Map<string, { client: { callTool: unknown } }> };
    const connection = bridgeAny.connections.get('ws')!;
    const original = connection.client.callTool as (t: string, a: string) => Promise<unknown>;
    const pressCalls: Record<string, unknown>[] = [];
    connection.client.callTool = async (tool: string, args: string) => {
      if (tool === 'press_key') {
        const parsed = JSON.parse(args) as Record<string, unknown>;
        pressCalls.push(parsed);
        if (pressCalls.length === 1) {
          return driverError(
            "Background delivery is not available for target window class 'Chrome_WidgetWin_1' on this " +
              'event kind (keystroke). Retry this action with delivery_mode:"foreground"; Cua Driver will ' +
              'activate the target for the action and restore the previous foreground afterward.',
          );
        }
        return ok({}, { action: { effect: 0, route: 1 } });
      }
      return original(tool, args);
    };

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'Return',
      target: { app: { appId: 'chrome', name: 'Chrome', pid: 42 }, window: { by: 'id', id: 7 } },
    } as never);

    expect(result.ok).toBe(true);
    expect(pressCalls).toHaveLength(2);
    expect(pressCalls[0]?.['delivery_mode']).toBeUndefined();
    expect(pressCalls[1]?.['delivery_mode']).toBe('foreground');
  });

  it('retries in the foreground when a background keystroke was accepted but not delivered', async () => {
    // Measured on TextEdit's save sheet: ⌘⇧G came back "unverifiable" with
    // escalation {reason: delivery_failed, target: foreground} — no error — and
    // was reported as done.
    const hotkeys: Record<string, unknown>[] = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'hotkey') {
          hotkeys.push(args);
          return args['delivery_mode'] === 'foreground'
            ? ok({ effect: 'unverifiable', delivery: { mode: 'foreground' } })
            : ok({ effect: 'unverifiable', escalation: { reason: 'delivery_failed', target: 'foreground' } });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'g',
      modifiers: ['Meta', 'Shift'],
      target: { app: { appId: 'textedit', name: 'TextEdit', pid: 42 }, window: { by: 'id', id: 7 } },
    });

    expect(result.ok).toBe(true);
    expect(hotkeys.map((h) => h['delivery_mode'])).toEqual([undefined, 'foreground']);
  });

  it('never escalates for a refusal that did not name foreground delivery', async () => {
    const attempts: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'press_key') {
          attempts.push(tool);
          return driverError('the target window is not focused');
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'Return',
      target: { app: { appId: 'chrome', name: 'Chrome', pid: 42 }, window: { by: 'id', id: 7 } },
    } as never);

    expect(result.ok).toBe(false);
    expect(attempts).toHaveLength(1);
  });
});

describe('CuaDriverBridge minimised-window guard', () => {
  const MINIMISED = {
    windows: [
      { window_id: 7, pid: 42, title: 'Untitled - Notepad', minimized: true, focused: false, index: 0 },
    ],
  };
  const RESTORED = {
    windows: [
      { window_id: 7, pid: 42, title: 'Untitled - Notepad', minimized: false, focused: true, index: 0 },
    ],
  };

  it('restores the window itself rather than spending a round trip asking', async () => {
    // The refusal this replaces named `computer_bring_to_front` as the fix, so
    // the agent always took exactly this action next — at the cost of a refused
    // call, a restore and a re-snapshot each time.
    const dispatched: string[] = [];
    let restored = false;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(restored ? RESTORED : MINIMISED);
        if (tool === 'bring_to_front') {
          restored = true;
          return ok({});
        }
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    dispatched.length = 0;

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'a',
      target: { app: { appId: 'notepad', name: 'Notepad', pid: 42 }, window: { by: 'id', id: 7 } },
    } as never);

    expect(result.ok).toBe(true);
    expect(restored).toBe(true);
    expect(dispatched).toContain('press_key');
  });

  it('refuses synthetic input when the window will not restore', async () => {
    const dispatched: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(MINIMISED);
        if (tool === 'bring_to_front') return ok({});
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    // Session start enables the agent cursor; only the act() matters here.
    dispatched.length = 0;

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'a',
      target: { app: { appId: 'notepad', name: 'Notepad', pid: 42 }, window: { by: 'id', id: 7 } },
    } as never);

    expect(result.ok).toBe(false);
    expect(result.refusal?.code).toBe('background_occluded');
    expect(dispatched).toHaveLength(0);
  });

  it('still refuses set_value when the window will not restore — that write vanishes', async () => {
    const dispatched: string[] = [];
    // Live while the snapshot is taken, minimised by the time the write lands:
    // a snapshot of a minimised window is refused outright now, so seeding one
    // any other way would test a state the agent can no longer reach.
    let live = true;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(live ? RESTORED : MINIMISED);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        if (tool === 'bring_to_front') return ok({});
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    live = false;

    const result = await fake.bridge.act(handle, {
      type: 'setValue',
      snapshotId: 's1',
      elementIndex: 3,
      value: 'x',
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    } as never);

    expect(result.ok).toBe(false);
    expect(result.refusal?.code).toBe('background_occluded');
    expect(dispatched).not.toContain('set_value');
  });

  it('reports a laddered read as truncated, not as the whole window', async () => {
    // The ladder answers a smaller question when the provider stalls, and the
    // driver calls that result complete because it returned everything within
    // the reduced caps. Measured on File Explorer: reads of 1, 2, 3 and 35
    // elements arrived looking exactly like a healthy 632-element read, and the
    // agent hunted for controls that were never enumerated.
    let attempt = 0;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(RESTORED);
        if (tool !== 'get_window_state') return ok({});
        attempt += 1;
        return attempt === 1
          ? { ...driverError('UIA provider unresponsive; retry with a depth-limited scan'), errorCode: 'timeout' }
          : ok(SNAPSHOT_PAYLOAD);
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
    } as never);

    expect(result.ok).toBe(true);
    expect(result.snapshot?.truncated).toEqual({ elements: 200, depth: 8 });
  });

  it('leaves a healthy read untruncated', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(RESTORED);
        return ok(SNAPSHOT_PAYLOAD);
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
    } as never);

    expect(result.snapshot?.truncated).toBeNull();
  });

  it('restores a minimised window before reading its tree', async () => {    // A minimised window exposes only chrome: measured on File Explorer as 5
    // elements (TitleBar/System/Restore/Maximize/Close) against 114 restored,
    // with the Address Bar only in the second. Reading it minimised hands the
    // agent an empty-looking success and it guesses for the rest of the run —
    // one measured run burned 31 actions and 12 minutes that way.
    let restored = false;
    const order: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        order.push(tool);
        if (tool === 'list_windows') return ok(restored ? RESTORED : MINIMISED);
        if (tool === 'bring_to_front') {
          restored = true;
          return ok({});
        }
        return ok(SNAPSHOT_PAYLOAD);
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
    } as never);

    expect(result.ok).toBe(true);
    expect(order.indexOf('bring_to_front')).toBeLessThan(order.lastIndexOf('get_window_state'));
  });

  it('refuses a snapshot of a window that will not restore', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(MINIMISED);
        if (tool === 'bring_to_front') return ok({});
        return ok(SNAPSHOT_PAYLOAD);
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
    } as never);

    expect(result.ok).toBe(false);
    expect(result.refusal?.code).toBe('background_occluded');
  });

  it('ALLOWS a background click — refusing it only forced needless foreground steals', async () => {
    const dispatched: string[] = [];
    let live = true;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(live ? RESTORED : MINIMISED);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    live = false;

    const result = await fake.bridge.act(handle, {
      ...CLICK,
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    } as never);

    expect(result.ok).toBe(true);
    expect(dispatched).toContain('click');
  });
});

describe('CuaDriverBridge phantom value writes', () => {
  // Measured on Excel: set_value on a DataItem returns `effect: unverifiable`,
  // the next get_window_state echoes the value back, and the screenshot shows
  // an empty cell. Read-back cannot catch it — it asks the provider that
  // accepted the write — so the only honest move is to refuse before dispatch.
  const GRID_SNAPSHOT = {
    snapshot_id: 's1',
    pid: 42,
    window_id: 7,
    elements: [
      { element_index: 3, role: 'DataItem', label: 'A1', element_token: 's1:3' },
      { element_index: 4, role: 'Edit', label: 'Name Box', element_token: 's1:4' },
    ],
  };

  async function gridBridge() {
    const dispatched: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(GRID_SNAPSHOT);
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    dispatched.length = 0;
    return { fake, handle, dispatched };
  }

  it('refuses a value write to a grid cell and names the route that works', async () => {
    const { fake, handle, dispatched } = await gridBridge();

    const result = await fake.bridge.act(handle, {
      type: 'setValue',
      snapshotId: 's1',
      elementIndex: 3,
      value: 'Scenario 1 OK',
      app: { appId: 'excel', name: 'Excel', pid: 42 },
    } as never);

    expect(result.ok).toBe(false);
    expect(result.refusal?.code).toBe('background_unavailable');
    expect(result.refusal?.message).toMatch(/computer_type_text/);
    expect(dispatched).not.toContain('set_value');
  });

  it('still allows a value write to an ordinary field', async () => {
    const { fake, handle, dispatched } = await gridBridge();

    const result = await fake.bridge.act(handle, {
      type: 'setValue',
      snapshotId: 's1',
      elementIndex: 4,
      value: 'A1',
      app: { appId: 'excel', name: 'Excel', pid: 42 },
    } as never);

    expect(result.ok).toBe(true);
    expect(dispatched).toContain('set_value');
  });
});

describe('CuaDriverBridge element addressing', () => {
  const TOKENED = {
    snapshot_id: 's1',
    pid: 42,
    window_id: 7,
    elements: [{ element_index: 3, role: 'Button', label: 'Save', element_token: 's1:3' }],
  };

  it('sends the driver its own element handle, not just an index', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(TOKENED);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    await fake.bridge.act(handle, CLICK as never);

    const click = fake.calls.find((c) => c.tool === 'click');
    // The token is the whole address: the driver's schema takes nothing else for an element.
    expect(click?.args).toEqual({ element_token: 's1:3', session: 'generatorai-ws' });
  });

  it('asks for a fresh read when an element came without a handle', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok({ ...SNAPSHOT_PAYLOAD, elements: [{ element_index: 3, role: 'Button', label: 'Save' }] });
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    const result = await fake.bridge.act(handle, CLICK as never);

    expect(result.refusal?.code).toBe('stale_snapshot');
    expect(fake.calls.some((c) => c.tool === 'click')).toBe(false);
  });

  it('reads a retired handle as "re-snapshot", not as a dead route', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(TOKENED);
        return { ...driverError('element_token is stale'), errorCode: 'stale_element_token' };
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    const result = await fake.bridge.act(handle, CLICK as never);
    expect(result.refusal?.code).toBe('stale_snapshot');
  });

  it('names a minimised window as occluded rather than "provider unavailable"', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(TOKENED);
        return { ...driverError('window is minimized'), errorCode: 'window_minimized' };
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    const result = await fake.bridge.act(handle, CLICK as never);
    expect(result.refusal?.code).toBe('background_occluded');
  });
});

describe('CuaDriverBridge snapshot projection', () => {
  it('passes the query to the driver so it filters before building the payload', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        return ok({});
      },
    });
    const handle = await started(fake);
    await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
      query: 'Save',
    });

    expect(fake.calls.find((c) => c.tool === 'get_window_state')?.args['query']).toBe('Save');
  });

  it('omits the query entirely when none was asked for', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        return ok({});
      },
    });
    const handle = await started(fake);
    await fake.bridge.snapshot(handle, {
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
      window: { by: 'id', id: 7 },
    });

    const call = fake.calls.find((c) => c.tool === 'get_window_state');
    expect(Object.keys(call?.args ?? {})).not.toContain('query');
  });

  // The driver reports `elements_complete: false` for any projection, so a
  // filtered snapshot used to claim hundreds of elements were truncated. An
  // agent that believes that re-reads the whole window and loses the saving.
  const PROJECTED = {
    snapshot_id: 's1',
    pid: 42,
    window_id: 7,
    elements: [{ element_index: 3, role: 'DataItem', label: 'A1' }],
    total_element_count: 431,
    elements_complete: false,
  };

  it('does not call a filtered snapshot truncated', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(PROJECTED);
        return ok({});
      },
    });
    const handle = await started(fake);
    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'excel', name: 'Excel', pid: 42 },
      window: { by: 'id', id: 7 },
      query: 'A1',
    });

    expect(result.snapshot?.truncated).toBeNull();
  });

  it('still reports real truncation when nothing was filtered', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(PROJECTED);
        return ok({});
      },
    });
    const handle = await started(fake);
    const result = await fake.bridge.snapshot(handle, {
      app: { appId: 'excel', name: 'Excel', pid: 42 },
      window: { by: 'id', id: 7 },
    });

    expect(result.snapshot?.truncated).toEqual({ elements: 430, depth: 0 });
  });
});

describe('CuaDriverBridge app launching', () => {
  // Measured on macOS ChatGPT (a Chromium app): a dozen 30 px helper strips
  // and a hidden 960×720 window around the one real window, on a monitor above
  // the main display. Launching it again while it ran answered with fresh
  // strips, the bridge named a strip "the new window", and the main window sat
  // on its splash logo for every read that followed.
  const CHATGPT = {
    windows: [
      { window_id: 1715, pid: 694, title: '', minimized: false, is_on_screen: false, bounds: { x: -570, y: -1080, width: 1920, height: 30 } },
      { window_id: 288, pid: 694, title: '', minimized: false, is_on_screen: false, bounds: { x: 0, y: 0, width: 960, height: 720 } },
      { window_id: 246, pid: 694, title: 'ChatGPT', minimized: false, is_on_screen: true, bounds: { x: -493, y: -1050, width: 1909, height: 1050 } },
      { window_id: 2459, pid: 694, title: 'Window', minimized: false, is_on_screen: true, bounds: { x: -480, y: -1038, width: 66, height: 20 } },
    ],
  };
  const CHATGPT_APP = { apps: [{ name: 'ChatGPT', pid: 694, running: true, bundle_id: 'com.openai.codex' }] };

  it('hands back the main window of an app that is already running, without relaunching it', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(CHATGPT);
        if (tool === 'list_apps') return ok(CHATGPT_APP);
        return ok({});
      },
    });
    const handle = await started(fake);

    const launched = await fake.bridge.launchApp(handle, 'ChatGPT');

    expect(fake.calls.filter((c) => c.tool === 'launch_app')).toHaveLength(0);
    expect(launched.window).toEqual({ id: 246, title: 'ChatGPT' });
  });

  it('names the real window a launch opened, not a helper strip that came with it', async () => {
    let launched = false;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'launch_app') {
          launched = true;
          return ok({});
        }
        if (tool === 'list_apps') return ok(launched ? CHATGPT_APP : { apps: [] });
        if (tool === 'list_windows') return ok(launched ? CHATGPT : { windows: [] });
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.launchApp(handle, 'ChatGPT');

    expect(result.window?.id).toBe(246);
  });
  it('asks for a separate instance only when the caller wants one', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'list_apps') {
          return ok({ apps: [{ name: 'Notepad', pid: 42, running: true, bundle_id: 'notepad.exe' }] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    // Running with a window and asked for nothing new: found, not launched again.
    await fake.bridge.launchApp(handle, 'Notepad');
    expect(fake.calls.filter((c) => c.tool === 'launch_app')).toHaveLength(0);

    await fake.bridge.launchApp(handle, 'Notepad', { newInstance: true });
    const launches = fake.calls.filter((c) => c.tool === 'launch_app');
    expect(launches.at(-1)?.args['creates_new_application_instance']).toBe(true);
  });

  // The driver joins `additional_arguments` into one ShellExecuteEx parameter
  // string. Measured with VS Code: an unquoted `…\New folder (2)\t3code` was
  // split into three bogus relative paths, so an EMPTY window opened and the
  // fragments were resolved against the driver's own working directory.
  it('quotes a launch argument containing spaces', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'list_apps') {
          return ok({ apps: [{ name: 'Code', pid: 42, running: true, bundle_id: 'code.exe' }] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    await fake.bridge.launchApp(handle, 'Code', {
      args: ['--new-window', 'C:\\Users\\me\\New folder (2)\\t3code'],
    });

    expect(fake.calls.find((c) => c.tool === 'launch_app')?.args['additional_arguments'])
      .toEqual(['--new-window', '"C:\\Users\\me\\New folder (2)\\t3code"']);
  }, 20_000);

  it('leaves an argument without spaces alone', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'list_apps') {
          return ok({ apps: [{ name: 'Code', pid: 42, running: true, bundle_id: 'code.exe' }] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    await fake.bridge.launchApp(handle, 'Code', { args: ['C:\\src\\repo', '--new-window'] });

    expect(fake.calls.find((c) => c.tool === 'launch_app')?.args['additional_arguments'])
      .toEqual(['C:\\src\\repo', '--new-window']);
  }, 20_000);
});

// ────────────────────────────────────────────────────────────────
// Endpoint acquisition. The order is a safety property, not a preference:
// a socket somebody else manages may be the only one in a session with a
// desktop attached, and a daemon we spawn there would silently see nothing.
// ────────────────────────────────────────────────────────────────
describe('CuaDriverBridge endpoint resolution', () => {
  const quiet = { reply: () => ok({}) };

  it('spawns its own daemon when a binary is bundled', async () => {
    const fake = makeBridge(quiet, { driverBinaryPath: '/opt/cua-driver', allowInProcess: false });
    const handle = await fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });

    expect(fake.spawned).toEqual([{ binaryPath: '/opt/cua-driver' }]);
    expect(fake.connectedTo).toEqual(['/tmp/own.sock']);
    expect(handle.hostRef).toBe('/tmp/own.sock');
    expect(fake.inProcessCreated()).toBe(0);
  });

  it('prefers an externally managed socket over spawning its own', async () => {
    const fake = makeBridge(quiet, {
      driverBinaryPath: '/opt/cua-driver',
      attachSocketPath: '\\\\.\\pipe\\managed',
    });
    await fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });

    expect(fake.spawned).toEqual([]);
    expect(fake.connectedTo).toEqual(['\\\\.\\pipe\\managed']);
  });

  it('prefers an endpoint the desktop shell pushed over everything else', async () => {
    const fake = makeBridge(quiet, {
      driverBinaryPath: '/opt/cua-driver',
      attachSocketPath: '\\\\.\\pipe\\managed',
    });
    fake.bridge.setEndpoint('ws', {
      socketPath: '/tmp/pushed.sock',
      driverVersion: '0.19.3',
      pid: 1,
      platform: 'win32',
    });
    await fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });

    expect(fake.spawned).toEqual([]);
    expect(fake.connectedTo).toEqual(['/tmp/pushed.sock']);
  });

  // The in-process driver is deliberately unavailable on darwin: it has no
  // stable bundle identity, so the user's TCC grants never apply to it and
  // every call would fail silently. The fallback is therefore a per-platform
  // contract, and the test asserts the rule rather than one platform's half
  // of it — otherwise it green-lights Windows/Linux and fails on macOS for a
  // behaviour that is working as designed.
  it('falls back in-process when nothing else is reachable, except on darwin', async () => {
    const fake = makeBridge(quiet, { driverBinaryPath: undefined });

    if (process.platform === 'darwin') {
      await expect(
        fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() }),
      ).rejects.toThrow(/No driver endpoint available/);
      expect(fake.inProcessCreated()).toBe(0);
      return;
    }

    const handle = await fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });
    expect(fake.spawned).toEqual([]);
    expect(fake.inProcessCreated()).toBe(1);
    expect(handle.hostRef).toBe('in-process');
  });

  it('runs one daemon for every workspace, not one each', async () => {
    const fake = makeBridge(quiet, { driverBinaryPath: '/opt/cua-driver' });
    await fake.bridge.start({ workspaceId: 'a', workspaceRoot: process.cwd() });
    await fake.bridge.start({ workspaceId: 'b', workspaceRoot: process.cwd() });

    expect(fake.spawned).toHaveLength(1);
  });

  it('stops the daemon it owns, and only on dispose', async () => {
    const fake = makeBridge(quiet, { driverBinaryPath: '/opt/cua-driver' });
    const handle = await fake.bridge.start({ workspaceId: 'ws', workspaceRoot: process.cwd() });

    await fake.bridge.stop(handle);
    expect(fake.stoppedCount()).toBe(0);

    await fake.bridge.dispose();
    expect(fake.stoppedCount()).toBe(1);
  });
});

describe('CuaDriverBridge bring to front', () => {
  const WINDOWS_WITH_STRIP = {
    windows: [
      { window_id: 5, pid: 42, title: '', minimized: false, is_on_screen: true, bounds: { x: 0, y: 0, width: 1280, height: 30 } },
      { window_id: 9, pid: 42, title: 'Main', minimized: false, is_on_screen: true, bounds: { x: 0, y: 40, width: 1200, height: 800 } },
      { window_id: 12, pid: 42, title: 'Other', minimized: false, is_on_screen: true, bounds: { x: 0, y: 40, width: 600, height: 400 } },
    ],
  };
  const raised = (fake: ReturnType<typeof makeBridge>) =>
    fake.calls.filter((c) => c.tool === 'bring_to_front').map((c) => c.args['window_id']);
  const app = { appId: 'app', name: 'App', pid: 42 };

  it('raises the window asked for', async () => {
    const fake = makeBridge({ reply: (tool) => (tool === 'list_windows' ? ok(WINDOWS_WITH_STRIP) : ok({})) });
    const handle = await started(fake);
    await fake.bridge.bringToFront(handle, app, undefined, 12);
    expect(raised(fake)).toEqual([12]);
  });

  it('raises the main window, not the first helper strip, when none is named', async () => {
    const fake = makeBridge({ reply: (tool) => (tool === 'list_windows' ? ok(WINDOWS_WITH_STRIP) : ok({})) });
    const handle = await started(fake);
    await fake.bridge.bringToFront(handle, app);
    expect(raised(fake)).toEqual([9]);
  });

  it('refuses a window the app does not have', async () => {
    const fake = makeBridge({ reply: (tool) => (tool === 'list_windows' ? ok(WINDOWS_WITH_STRIP) : ok({})) });
    const handle = await started(fake);
    const result = await fake.bridge.bringToFront(handle, app, undefined, 77);
    expect(result.refusal?.code).toBe('target_lost');
    expect(raised(fake)).toEqual([]);
  });
});

describe('CuaDriverBridge menus and element actions', () => {
  const TOKENED = {
    snapshot_id: 's1',
    pid: 42,
    window_id: 7,
    elements: [{ element_index: 3, role: 'AXButton', label: 'Save', element_token: 's1:3', actions: ['AXPress'] }],
  };
  const replies = (tool: string) => {
    if (tool === 'list_windows') return ok(WINDOWS);
    if (tool === 'get_window_state') return ok(TOKENED);
    return ok({});
  };

  it('invokes a menu path on the app\u2019s window, with no snapshot', async () => {
    const fake = makeBridge({ reply: replies });
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, {
      type: 'invokeMenu',
      path: ['File', 'New'],
      target: { app: { appId: 'notepad', name: 'Notepad', pid: 42 }, window: { by: 'focused' } },
    });

    expect(result.ok).toBe(true);
    expect(fake.calls.find((c) => c.tool === 'invoke_menu')?.args).toMatchObject({ pid: 42, window_id: 7, path: ['File', 'New'] });
  });

  it('presses an element for an advertised press action — the driver has no call by action name', async () => {
    const fake = makeBridge({ reply: replies });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    await fake.bridge.act(handle, { type: 'performAction', snapshotId: 's1', elementIndex: 3, actionName: 'AXPress' });

    expect(fake.calls.find((c) => c.tool === 'click')?.args['element_token']).toBe('s1:3');
    expect(fake.calls.some((c) => c.tool === 'invoke_menu')).toBe(false);
  });

  it('refuses an action it cannot send instead of sending it as a menu', async () => {
    const fake = makeBridge({ reply: replies });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    const result = await fake.bridge.act(handle, { type: 'performAction', snapshotId: 's1', elementIndex: 3, actionName: 'AXIncrement' });

    expect(result.refusal?.code).toBe('unsupported_action');
    expect(fake.calls.some((c) => c.tool === 'invoke_menu' || c.tool === 'click')).toBe(false);
  });
});

describe('splitLaunchArguments', () => {
  it('hands macOS paths to the app as open targets and keeps flags on the command line', () => {
    expect(splitLaunchArguments(['/Users/me/draft.txt', '--fresh', '"/tmp/a b.txt"'], 'darwin')).toEqual({
      targets: ['/Users/me/draft.txt', '/tmp/a b.txt'],
      argv: ['--fresh'],
    });
  });

  it('keeps every argument on the command line elsewhere', () => {
    expect(splitLaunchArguments(['C:\\src\\repo', '/home/me/notes.txt'], 'win32')).toEqual({
      targets: [],
      argv: ['C:\\src\\repo', '/home/me/notes.txt'],
    });
    expect(splitLaunchArguments(['/home/me/notes.txt'], 'linux').targets).toEqual([]);
  });
});

describe('CuaDriverBridge windowless launch on macOS', () => {
  const platform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    vi.useRealTimers();
  });

  it('activates a document app that started without a window, then asks it for a new document', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.useFakeTimers();
    let launched = false;
    let newDocument = false;
    const TEXTEDIT = { apps: [{ name: 'TextEdit', pid: 60, running: true, bundle_id: 'com.apple.TextEdit' }] };
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'launch_app') {
          launched = true;
          return ok({});
        }
        if (tool === 'hotkey' && JSON.stringify(args['keys']) === '["cmd","n"]') newDocument = true;
        if (tool === 'list_apps') return ok(launched ? TEXTEDIT : { apps: [] });
        if (tool === 'list_windows') {
          return ok(newDocument ? { windows: [{ window_id: 9, pid: 60, title: 'Untitled', minimized: false, focused: true, index: 0 }] } : { windows: [] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const pending = fake.bridge.launchApp(handle, 'TextEdit');
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(fake.calls.map((c) => c.tool).filter((t) => t === 'bring_to_front' || t === 'hotkey')).toEqual(['bring_to_front', 'hotkey']);
    expect(result.window).toEqual({ id: 9, title: 'Untitled' });
  });
});

describe('CuaDriverBridge apps macOS leaves out of its running list', () => {
  it('finds a launched app by the pid launch_app reported, and keeps listing it while it lives', async () => {
    // Measured: TextEdit revived under an automatically terminated instance's
    // identity ran with its document open while list_apps called it stopped.
    const pid = process.pid; // any live process stands in for it
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'launch_app') return ok({ pid, bundle_id: 'com.apple.TextEdit', name: 'TextEdit', launch_state: { process_running: true } });
        if (tool === 'list_apps') return ok({ apps: [{ name: 'TextEdit', pid: 0, running: false, bundle_id: 'com.apple.TextEdit' }] });
        if (tool === 'list_windows') {
          const draft = { window_id: 31, pid, title: 'draft.txt', minimized: false, is_on_screen: true, z_index: 5 };
          return ok({ windows: args['pid'] === undefined || args['pid'] === pid ? [draft] : [] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const launched = await fake.bridge.launchApp(handle, 'TextEdit', { args: ['/tmp/draft.txt'] });
    expect(launched.app).toMatchObject({ appId: 'com.apple.TextEdit', pid });
    expect(launched.window).toEqual({ id: 31, title: 'draft.txt' });

    const listed = await fake.bridge.listApps(handle);
    expect(listed.apps.find((a) => a.id === 'com.apple.TextEdit')).toMatchObject({ pid, windowCount: 1 });
  }, 20_000);

  it('lists an app the user started that owns windows but list_apps calls stopped', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_apps') {
          return ok({ apps: [
            { name: 'Numbers', pid: 0, running: false, bundle_id: 'com.apple.iWork.Numbers', launch_path: '/Applications/Numbers.app' },
            { name: 'Notes', pid: 0, running: false, bundle_id: 'com.apple.Notes' },
          ] });
        }
        if (tool === 'list_windows') {
          return ok({ windows: [
            { window_id: 40, pid: 4740, app_name: 'Numbers', title: 'Choose a Template', layer: 0, is_on_screen: true },
            { window_id: 41, pid: 999, app_name: 'Dock', title: '', layer: 20, is_on_screen: true },
          ] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const listed = await fake.bridge.listApps(handle);

    expect(listed.apps).toEqual([
      expect.objectContaining({ id: 'com.apple.iWork.Numbers', name: 'Numbers', pid: 4740, windowCount: 1 }),
    ]);
  });
});

describe('CuaDriverBridge menu path correction', () => {
  it('matches a label spelled differently from the menu', () => {
    expect(closestMenuItem('Save…', ['New', 'Save', 'Save As…'])).toBe('Save');
    expect(closestMenuItem('export to', ['Export To', 'Print…'])).toBe('Export To');
    expect(closestMenuItem('Quit', ['New', 'Save'])).toBeUndefined();
    expect(closestMenuItem('Undo', ['Undo Insert', 'Redo', 'Cut'])).toBe('Undo Insert');
  });

  const menuBridge = (onMenu: (path: string[]) => unknown) =>
    makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'invoke_menu') return onMenu(args['path'] as string[]);
        return ok({});
      },
    });
  const menu = (path: string[]) => ({
    type: 'invokeMenu' as const,
    path,
    target: { app: { appId: 'textedit', name: 'TextEdit', pid: 42 }, window: { by: 'id' as const, id: 7 } },
  });

  it('retries once with the item the driver listed', async () => {
    const paths: string[][] = [];
    const fake = menuBridge((path) => {
      paths.push(path);
      return path[1] === 'Save'
        ? ok({})
        : driverError('invoke_menu: path segment 1 "Save…" was not found under "File". Items there: "New", "Open…", "Save", "Save As…"');
    });
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, menu(['File', 'Save…']));

    expect(result.ok).toBe(true);
    expect(paths).toEqual([['File', 'Save…'], ['File', 'Save']]);
  });

  it('closes a stray popup and retries when an item is disabled', async () => {
    let attempts = 0;
    const fake = menuBridge(() => (++attempts === 1 ? driverError('invoke_menu: path segment 1 is disabled') : ok({})));
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, menu(['Format', 'List…']));

    expect(result.ok).toBe(true);
    expect(fake.calls.filter((c) => c.tool === 'press_key').map((c) => c.args['key'])).toEqual(['escape']);
    expect(fake.calls.filter((c) => c.tool === 'invoke_menu').every((c) => c.args['delivery_mode'] === undefined)).toBe(true);
  });

  it('hands back the window showing the file it was asked to open', async () => {
    let launched = false;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'launch_app') {
          launched = true;
          return ok({ pid: 60, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' });
        }
        if (tool === 'list_apps') return ok({ apps: launched ? [{ name: 'TextEdit', pid: 60, running: true, bundle_id: 'com.apple.TextEdit' }] : [] });
        if (tool === 'list_windows') {
          return ok({ windows: launched ? [
            { window_id: 3, pid: 60, title: 'Untitled.rtf', is_on_screen: true, z_index: 9 },
            { window_id: 4, pid: 60, title: 'draft.txt', is_on_screen: true, z_index: 8 },
          ] : [] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.launchApp(handle, 'TextEdit', { args: ['/tmp/notes/draft.txt'] });

    expect(result.window).toEqual({ id: 4, title: 'draft.txt' });
  }, 20_000);
});

describe('CuaDriverBridge keys for a sheet that holds focus', () => {
  it('reads the window the driver names as holding focus', () => {
    const fg = { text: 'hotkey failed: exact target window did not become focused for foreground HID delivery: window_id 4806 "Save" of the same app holds focus (an open dialog or panel); act on that window_id, or close it first', isError: true, degraded: false };
    const bg = { text: "Background input refused (window_not_key): window 4785 could not be confirmed as the app's key window (the app's focused window is Some(4806), its focused element is in window None)", isError: true, degraded: false };
    expect(focusHolder(fg, 4785)).toBe(4806);
    expect(focusHolder(bg, 4785)).toBe(4806);
    expect(focusHolder(fg, 4806)).toBeUndefined();
  });

  it('sends the keys to the sheet when the document window is refused', async () => {
    const sent: Record<string, unknown>[] = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'hotkey') {
          sent.push(args);
          if (args['window_id'] === 4806) return ok({ effect: 'unverifiable' });
          return args['delivery_mode'] === 'foreground'
            ? driverError('hotkey failed: exact target window did not become focused for foreground HID delivery: window_id 4806 "Save" of the same app holds focus (an open dialog or panel); act on that window_id, or close it first')
            : driverError('Background input refused (window_not_key): retry with delivery_mode:"foreground"');
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.act(handle, {
      type: 'pressKey',
      key: 'g',
      modifiers: ['Meta', 'Shift'],
      target: { app: { appId: 'numbers', name: 'Numbers', pid: 42 }, window: { by: 'id', id: 7 } },
    });

    expect(result.ok).toBe(true);
    expect(sent.map((a) => [a['window_id'], a['delivery_mode']])).toEqual([[7, undefined], [7, 'foreground'], [4806, 'foreground']]);
  });
});

describe('CuaDriverBridge batches through the driver\u2019s run_steps', () => {
  const target = { app: { appId: 'calc', name: 'Calculator', pid: 42 }, window: { by: 'id' as const, id: 7 } };

  it('reads per-step outcomes', () => {
    const ok = { text: '', isError: false, degraded: false, structuredJson: JSON.stringify({ steps: [{ ok: true }, { ok: true }] }) };
    const failed = {
      text: '',
      isError: false,
      degraded: false,
      structuredJson: JSON.stringify({ steps: [{ ok: true }, { ok: false, error: 'element_token is stale' }], failed_step: 1 }),
    };
    expect(parseRunSteps(ok, 2)).toEqual([{ ok: true }, { ok: true }]);
    expect(parseRunSteps(failed, 3)).toEqual([{ ok: true }, { ok: false, message: 'element_token is stale' }]);
    expect(parseRunSteps({ text: 'refused', isError: true, degraded: false }, 2)).toEqual([{ ok: false, message: 'refused' }]);
  });

  it('sends named clicks as one run_steps call, splits at a menu, and diffs once at the end', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'run_steps') return ok({ steps: [{ ok: true }, { ok: true }] });
        return ok({});
      },
    });
    const handle = await started(fake);

    const results = await fake.bridge.actBatch!(handle, [
      { type: 'clickNamed', target, name: '1', role: 'button' },
      { type: 'clickNamed', target, name: 'Equals' },
      { type: 'invokeMenu', target, path: ['Edit', 'Copy'] },
      { type: 'pressKey', target, key: 'Escape' },
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, true, true, true]);
    const tools = fake.calls.map((c) => c.tool).filter((t) => ['run_steps', 'invoke_menu', 'click', 'press_key'].includes(t));
    expect(tools).toEqual(['run_steps', 'invoke_menu', 'run_steps']);
    const first = fake.calls.find((c) => c.tool === 'run_steps')!.args as { steps: Array<{ tool: string; args: Record<string, unknown> }> };
    expect(first.steps.map((s) => [s.tool, s.args['name'], s.args['role']])).toEqual([['click', '1', 'button'], ['click', 'Equals', undefined]]);
  });

  it('stops at the failing step and names it stale when the driver says so', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'run_steps') return ok({ steps: [{ ok: true }, { ok: false, error: 'element_token is stale' }], failed_step: 1 });
        return ok({});
      },
    });
    const handle = await started(fake);

    const results = await fake.bridge.actBatch!(handle, [
      { type: 'clickNamed', target, name: '1' },
      { type: 'clickNamed', target, name: '2' },
      { type: 'clickNamed', target, name: '3' },
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(results[1]!.refusal?.code).toBe('stale_snapshot');
  });
});

describe('CuaDriverBridge saveAs on macOS', () => {
  const platform = process.platform;
  afterEach(() => Object.defineProperty(process, 'platform', { value: platform }));

  it('opens the dialog, goes to the folder, names the file, saves and finds it on disk', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const folder = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'gai-saveas-'));
    let dialog = false;
    let goTo = false;
    let where = 'Documents';
    let name = 'Untitled.csv';
    const row = (role: string, label: string, value?: string) => [{ role, label, element_token: `s1:${label}`, ...(value !== undefined ? { value } : {}) }];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'invoke_menu') { dialog = true; return ok({}); }
        if (tool === 'hotkey') { goTo = true; return ok({}); }
        if (tool === 'press_key' && args['key'] === 'return') { goTo = false; return ok({}); }
        if (tool === 'set_value') {
          if (args['element_token'] === 's1:PathTextField') where = nodePath.basename(String(args['value']).replace(/\/$/, ''));
          if (args['element_token'] === 's1:saveAsNameTextField') name = String(args['value']);
          return ok({});
        }
        if (tool === 'click' && args['element_token'] === 's1:OKButton') {
          nodeFs.writeFileSync(nodePath.join(folder, name), 'a,b');
          dialog = false;
          return ok({});
        }
        if (tool === 'get_window_state') {
          const q = String(args['query']);
          if (!dialog) return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: [] });
          if (q === 'saveAsNameTextField') return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: row('AXTextField', 'saveAsNameTextField', name) });
          if (q === 'PathTextField' && goTo) return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: row('AXTextField', 'PathTextField', '/tmp') });
          if (q === 'where popup') return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: row('AXPopUpButton', 'where popup', where) });
          if (q === 'OKButton') return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: row('AXButton', 'OKButton') });
          return ok({ snapshot_id: 's1', pid: 42, window_id: 7, elements: [] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const result = await fake.bridge.saveAs!(handle, { appId: 'numbers', name: 'Numbers', pid: 42 }, 7, {
      folder,
      name: 'budget.csv',
      menu: ['File', 'Export To', 'CSV…'],
    });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(nodePath.join(folder, 'budget.csv'));
    expect(fake.calls.find((c) => c.tool === 'hotkey')?.args).toMatchObject({ keys: ['cmd', 'shift', 'g'], delivery_mode: 'foreground' });
    nodeFs.rmSync(folder, { recursive: true, force: true });
  }, 30_000);
});

describe('CuaDriverBridge named steps that also name a menu item', () => {
  it('picks the window control over the menu item', () => {
    const message = '2 elements match element "1" in window 4946; add `nth` or a more exact name: nth 0: [122] AXMenuItem "1"; nth 1: [13] AXButton "1"';
    expect(firstNonMenuCandidate(message)).toBe(1);
    expect(firstNonMenuCandidate('element_token is stale')).toBeUndefined();
  });

  it('re-runs the rest of the batch from the ambiguous step with that choice', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'run_steps') {
          const steps = (args['steps'] as Array<{ args: Record<string, unknown> }>).map((s) => s.args);
          batches.push(steps);
          if (steps[0]!['nth'] === undefined && steps[0]!['name'] === '1') {
            return ok({ steps: [{ ok: false, error: '2 elements match element "1" in window 7; add `nth` or a more exact name: nth 0: [13] AXButton "1"; nth 1: [122] AXMenuItem "1"' }], failed_step: 0 });
          }
          return ok({ steps: steps.map(() => ({ ok: true })) });
        }
        return ok({});
      },
    });
    const handle = await started(fake);
    const target = { app: { appId: 'calc', name: 'Calculator', pid: 42 }, window: { by: 'id' as const, id: 7 } };

    const results = await fake.bridge.actBatch!(handle, [
      { type: 'clickNamed', target, name: '1' },
      { type: 'clickNamed', target, name: 'Equals' },
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(batches[1]!.map((s) => [s['name'], s['nth']])).toEqual([['1', 0], ['Equals', undefined]]);
  });
});

describe('CuaDriverBridge menus a background app will not run', () => {
  const menu = { type: 'invokeMenu' as const, path: ['File', 'New'], target: { app: { appId: 'te', name: 'TextEdit', pid: 42 }, window: { by: 'id' as const, id: 7 } } };

  it('brings the window in front and runs the command once more when the driver will not pick a document', async () => {
    let attempts = 0;
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'invoke_menu') {
          attempts += 1;
          return attempts === 1 ? driverError('Background input refused (window_not_key): invoke_menu: requested window 7 is not the confirmed document menu context (focused=None, main=None)') : ok({});
        }
        return ok({});
      },
    });
    const handle = await started(fake);
    expect((await fake.bridge.act(handle, menu)).ok).toBe(true);
    expect(fake.calls.map((c) => c.tool).filter((t) => t === 'bring_to_front' || t === 'invoke_menu')).toEqual(['invoke_menu', 'bring_to_front', 'invoke_menu']);
  });

  it('presses the enabled item under the right menu when two share the label', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'invoke_menu') return driverError('invoke_menu: path segment 1 is ambiguous');
        if (tool === 'get_window_state') {
          return ok({ snapshot_id: 's9', pid: 42, window_id: 7, elements: [
            { element_index: 1, role: 'AXMenuBarItem', label: 'File', element_token: 's9:1' },
            { element_index: 2, role: 'AXMenu', parent_index: 1, element_token: 's9:2' },
            { element_index: 3, role: 'AXMenuItem', label: 'New', parent_index: 2, enabled: false, element_token: 's9:3' },
            { element_index: 4, role: 'AXMenuItem', label: 'New', parent_index: 2, element_token: 's9:4' },
            { element_index: 5, role: 'AXMenuBarItem', label: 'Edit', element_token: 's9:5' },
            { element_index: 6, role: 'AXMenuItem', label: 'New', parent_index: 5, element_token: 's9:6' },
          ] });
        }
        return ok({});
      },
    });
    const handle = await started(fake);
    expect((await fake.bridge.act(handle, menu)).ok).toBe(true);
    expect(fake.calls.find((c) => c.tool === 'click')?.args['element_token']).toBe('s9:4');
  });

  it('never picks a palette as the main window', () => {
    const doc = { id: 1, title: 'Untitled', index: 0, focused: false, minimised: false, onScreen: true, bounds: { x: 0, y: 0, w: 900, h: 700 } };
    const palette = { id: 2, title: 'Colours', index: 1, focused: true, minimised: false, onScreen: true, floating: true, bounds: { x: 0, y: 0, w: 1200, h: 900 } };
    expect(mainWindow([palette, doc])?.id).toBe(1);
  });
});

describe('CuaDriverBridge pixels for a window with no tree', () => {
  it('returns the captured image when one was asked for, so the agent can click by coordinates', async () => {
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') {
          if (typeof args['screenshot_out_file'] === 'string') nodeFs.writeFileSync(args['screenshot_out_file'], 'png');
          return ok({
            degraded: true,
            degraded_reason: 'ax_window_unresolved: window_id 7 exists and is owned by pid 42, but none of the AXWindow elements reports this CGWindowID.',
            elements: [],
            screenshot_width: 800,
            screenshot_height: 600,
            escalation: { recommended: 'foreground' },
          });
        }
        return ok({});
      },
    });
    const handle = await started(fake);

    const withImage = await fake.bridge.snapshot(handle, { app: { appId: 'ff', name: 'Freeform', pid: 42 }, window: { by: 'id', id: 7 }, includeScreenshot: true });
    expect(withImage.ok).toBe(true);
    expect(withImage.snapshot?.elements).toEqual([]);
    expect(withImage.screenshot).toMatchObject({ width: 800, height: 600 });

    const treeOnly = await fake.bridge.snapshot(handle, { app: { appId: 'ff', name: 'Freeform', pid: 42 }, window: { by: 'id', id: 7 } });
    expect(treeOnly.refusal?.code).toBe('background_unavailable');
  });
});

describe('CuaDriverBridge new blank document', () => {
  it('makes a Numbers document: File>New (listed twice) by token, the chooser answered with Return, never read', async () => {
    let stage: 'doc' | 'chooser' | 'new' = 'doc';
    const reads: string[] = [];
    const base = [{ window_id: 10, pid: 42, title: 'Fruit Count.numbers', is_on_screen: true, layer: 0, z_index: 5, bounds: { x: 0, y: 0, width: 900, height: 700 } }];
    const fake = makeBridge({
      reply: (tool, args) => {
        if (tool === 'list_windows') {
          const extra = stage === 'chooser'
            ? [{ window_id: 11, pid: 42, title: '', is_on_screen: true, layer: 0, z_index: 9, bounds: { x: 0, y: 0, width: 1070, height: 740 } }]
            : stage === 'new'
              ? [{ window_id: 12, pid: 42, title: 'Untitled', is_on_screen: true, layer: 0, z_index: 9, bounds: { x: 0, y: 0, width: 1260, height: 870 } }]
              : [];
          return ok({ windows: [...base, ...extra] });
        }
        if (tool === 'invoke_menu') {
          const path = args['path'] as string[];
          return path[1] === 'New'
            ? driverError('invoke_menu: path segment 1 "New" was not found under "File". Items there: "New…", "New…", "Open…"')
            : driverError('invoke_menu: path segment 1 is ambiguous');
        }
        if (tool === 'get_window_state') {
          reads.push(String(args['window_id']));
          return ok({ snapshot_id: 's5', pid: 42, window_id: 10, elements: [
            { element_index: 1, role: 'AXMenuBarItem', label: 'File', element_token: 's5:1' },
            { element_index: 2, role: 'AXMenu', parent_index: 1, element_token: 's5:2' },
            { element_index: 3, role: 'AXMenuItem', label: 'New…', parent_index: 2, element_token: 's5:3' },
          ] });
        }
        if (tool === 'click' && args['element_token'] === 's5:3') { stage = 'chooser'; return ok({}); }
        if (tool === 'press_key' && args['key'] === 'return') { stage = 'new'; return ok({}); }
        return ok({});
      },
    });
    const handle = await started(fake);

    const made = await fake.bridge.newDocument!(handle, { appId: 'com.apple.iWork.Numbers', name: 'Numbers', pid: 42 });

    expect(made.window).toEqual({ id: 12, title: 'Untitled' });
    expect(made.steps).toEqual(['File>New', 'Blank template (Return)']);
    expect(reads).not.toContain('11');
    expect(fake.calls.find((c) => c.tool === 'press_key')?.args).toMatchObject({ window_id: 11, key: 'return', delivery_mode: 'foreground' });
  }, 30_000);
});

describe('pickNewDocumentItem', () => {
  it('takes New or New… first, else the app\'s own New item, never a tab or window', () => {
    expect(pickNewDocumentItem(['New…', 'New…', 'Open…'])).toBe('New…');
    expect(pickNewDocumentItem(['New Board', 'New Tab', 'New Window', 'Close'])).toBe('New Board');
    expect(pickNewDocumentItem(['New Tab', 'New Window'])).toBeUndefined();
  });
});
