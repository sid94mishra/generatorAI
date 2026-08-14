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

import { describe, expect, it } from 'vitest';
import type { ILogger } from '@generatorai/shared';
import { CuaDriverBridge } from '../CuaDriverBridge.js';

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

/** One live, non-minimised window so `requireLiveWindow` lets calls through. */
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
  elements: [{ element_index: 3, role: 'Button', label: 'Save' }],
};

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

  it('refuses synthetic input before dispatch — those coordinates are off-screen', async () => {
    const dispatched: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(MINIMISED);
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
    expect(result.refusal?.message).toMatch(/bring_to_front/);
    expect(dispatched).toHaveLength(0);
  });

  it('still refuses set_value — the one write proven to vanish on restore', async () => {
    const dispatched: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(MINIMISED);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

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

  it('ALLOWS a background click — refusing it only forced needless foreground steals', async () => {
    const dispatched: string[] = [];
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(MINIMISED);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        dispatched.push(tool);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);

    const result = await fake.bridge.act(handle, {
      ...CLICK,
      app: { appId: 'notepad', name: 'Notepad', pid: 42 },
    } as never);

    expect(result.ok).toBe(true);
    expect(dispatched).toContain('click');
  });
});

describe('CuaDriverBridge element addressing', () => {
  const TOKENED = {
    snapshot_id: 's1',
    pid: 42,
    window_id: 7,
    elements: [{ element_index: 3, role: 'Button', label: 'Save', element_token: 's00000001:3' }],
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
    expect(click?.args['element_token']).toBe('s00000001:3');
    // Index rides along for a provider that minted no token.
    expect(click?.args['element_index']).toBe(3);
  });

  it('falls back to the index when the provider minted no token', async () => {
    const fake = makeBridge({
      reply: (tool) => {
        if (tool === 'list_windows') return ok(WINDOWS);
        if (tool === 'get_window_state') return ok(SNAPSHOT_PAYLOAD);
        return ok({});
      },
    });
    const handle = await started(fake);
    await seedSnapshot(fake, handle);
    await fake.bridge.act(handle, CLICK as never);

    const click = fake.calls.find((c) => c.tool === 'click');
    expect(click?.args['element_token']).toBeUndefined();
    expect(click?.args['element_index']).toBe(3);
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

describe('CuaDriverBridge app launching', () => {  it('asks for a separate instance only when the caller wants one', async () => {
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

    await fake.bridge.launchApp(handle, 'Notepad');
    expect(fake.calls.find((c) => c.tool === 'launch_app')?.args)
      .not.toHaveProperty('creates_new_application_instance');

    await fake.bridge.launchApp(handle, 'Notepad', { newInstance: true });
    const launches = fake.calls.filter((c) => c.tool === 'launch_app');
    expect(launches.at(-1)?.args['creates_new_application_instance']).toBe(true);
  });
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

  it('falls back in-process when nothing else is reachable', async () => {
    const fake = makeBridge(quiet);
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
