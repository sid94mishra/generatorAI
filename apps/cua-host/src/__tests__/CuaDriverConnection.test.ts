// ────────────────────────────────────────────────────────────────
// CuaDriverConnection — first-ever test coverage for cua-host's real
// performAction()/captureScreen() (previously literal no-ops).
//
// A real `@trycua/cua-driver` connection needs actual OS-level accessibility
// grants unavailable in this sandbox, so this follows the SAME injectable-
// driver-module seam `packages/core/.../CuaDriverBridge.test.ts` already
// established: a fake driver module returns scripted tool results, and the
// tests assert on the REAL mapping logic — which driver tool name and args
// each `ComputerAction` produces, and how the frontmost window is resolved —
// exactly the logic that was entirely absent before this fix (the old code
// only `console.log`'d the action and returned).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComputerAction } from '@generatorai/shared';
import { CuaDriverConnection, type DriverModule, type DriverToolResult } from '../CuaDriverConnection.js';

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

const FRONTMOST_APP = { apps: [{ pid: 42, name: 'Notepad', active: true }, { pid: 7, name: 'Explorer', active: false }] };
const FRONTMOST_WINDOWS = {
  windows: [
    { window_id: 1, pid: 42, is_on_screen: true, z_index: 1 },
    { window_id: 2, pid: 42, is_on_screen: true, z_index: 5 }, // topmost — highest z
    { window_id: 3, pid: 42, is_on_screen: false, z_index: 9 }, // off-screen — must be ignored
  ],
};

function ok(structured: unknown): DriverToolResult {
  return { text: '', structuredJson: JSON.stringify(structured), isError: false };
}

function fail(message: string): DriverToolResult {
  return { text: message, isError: true };
}

/** Builds a fake driver module that answers list_apps/list_windows with the fixtures above, plus a custom handler for everything else. */
function makeFakeDriver(handler: (tool: string, args: Record<string, unknown>) => DriverToolResult): {
  driverModule: DriverModule;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client = {
    callTool: vi.fn(async (tool: string, argumentsJson: string) => {
      const args = JSON.parse(argumentsJson) as Record<string, unknown>;
      calls.push({ tool, args });
      if (tool === 'list_apps') return ok(FRONTMOST_APP);
      if (tool === 'list_windows') return ok(FRONTMOST_WINDOWS);
      return handler(tool, args);
    }),
  };
  return {
    calls,
    driverModule: {
      CuaDriver: {
        create: () => client,
        connect: () => client,
      },
    },
  };
}

describe('CuaDriverConnection.resolveFocusedWindow()', () => {
  it('picks the frontmost app and its topmost ON-SCREEN window (ignoring a higher-z off-screen one)', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    const target = await conn.resolveFocusedWindow();

    expect(target).toEqual({ pid: 42, windowId: 2 }); // z=5 on-screen, not z=9 off-screen
    expect(calls[0]).toMatchObject({ tool: 'list_apps' });
    expect(calls[1]).toMatchObject({ tool: 'list_windows', args: { pid: 42 } });
  });

  it('throws a clear error when no app is reported active', async () => {
    const client = { callTool: vi.fn(async () => ok({ apps: [{ pid: 1, active: false }] })) };
    const conn = new CuaDriverConnection({ CuaDriver: { create: () => client, connect: () => client } });
    await expect(conn.resolveFocusedWindow()).rejects.toThrow(/no frontmost application/);
  });
});

describe('CuaDriverConnection.performAction() — real driver tool mapping', () => {
  it('left_click maps to the driver\'s "click" tool at the given coordinate, scoped to the focused window', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    const action: ComputerAction = { type: 'left_click', coordinate: [100, 200] };
    await conn.performAction(action);

    const clickCall = calls.find((c) => c.tool === 'click');
    expect(clickCall).toMatchObject({ tool: 'click', args: { pid: 42, window_id: 2, x: 100, y: 200 } });
  });

  it('right_click and double_click map to their own distinct driver tools', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'right_click', coordinate: [1, 2] });
    await conn.performAction({ type: 'double_click', coordinate: [3, 4] });

    expect(calls.some((c) => c.tool === 'right_click' && c.args['x'] === 1)).toBe(true);
    expect(calls.some((c) => c.tool === 'double_click' && c.args['x'] === 3)).toBe(true);
  });

  it('type maps to type_text with the literal text', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'type', text: 'hello world' });

    expect(calls.find((c) => c.tool === 'type_text')).toMatchObject({ args: { text: 'hello world' } });
  });

  it('key with modifiers maps to hotkey; key alone maps to press_key', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'key', key: 'a', keys: ['ctrl', 'a'] });
    await conn.performAction({ type: 'key', key: 'Escape' });

    expect(calls.find((c) => c.tool === 'hotkey')).toMatchObject({ args: { keys: ['ctrl', 'a'] } });
    expect(calls.find((c) => c.tool === 'press_key')).toMatchObject({ args: { key: 'Escape' } });
  });

  it('scroll maps direction and amount through unchanged', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'scroll', direction: 'up', amount: 5 });

    expect(calls.find((c) => c.tool === 'scroll')).toMatchObject({ args: { direction: 'up', amount: 5 } });
  });

  it('left_click_drag maps from/to coordinates onto the drag tool', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'left_click_drag', start_coordinate: [10, 20], coordinate: [30, 40] });

    expect(calls.find((c) => c.tool === 'drag')).toMatchObject({
      args: { from_x: 10, from_y: 20, to_x: 30, to_y: 40 },
    });
  });

  it('screenshot/wait/cursor_position are no-ops — no driver call at all', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await conn.performAction({ type: 'screenshot' });
    await conn.performAction({ type: 'wait' });
    await conn.performAction({ type: 'cursor_position' });

    expect(calls.length).toBe(0);
  });

  it('an unsupported action type throws rather than silently doing nothing', async () => {
    const { driverModule } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await expect(conn.performAction({ type: 'middle_click', coordinate: [1, 1] })).rejects.toThrow(/unsupported/);
  });

  it('left_click without a coordinate throws a clear error instead of calling the driver with undefined x/y', async () => {
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);
    await expect(conn.performAction({ type: 'left_click' })).rejects.toThrow(/requires coordinate/);
    expect(calls.some((c) => c.tool === 'click')).toBe(false);
  });

  it('propagates a driver-side failure as a real error, not a swallowed success', async () => {
    const { driverModule } = makeFakeDriver(() => fail('UIA element not found'));
    const conn = new CuaDriverConnection(driverModule);
    await expect(conn.performAction({ type: 'left_click', coordinate: [1, 1] })).rejects.toThrow(/UIA element not found/);
  });
});

describe('CuaDriverConnection.captureScreen()', () => {
  it('calls get_window_state with include_screenshot + a screenshot_out_file, then reads that file back as base64', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cua-host-capture-'));
    const fakePngBytes = Buffer.from('fake-png-bytes-for-test');

    const { driverModule, calls } = makeFakeDriver((tool, args) => {
      if (tool === 'get_window_state') {
        const outFile = args['screenshot_out_file'] as string;
        // Simulate the driver actually writing the screenshot file.
        writeFileSync(outFile, fakePngBytes);
        return ok({});
      }
      return fail(`unexpected tool ${tool}`);
    });

    const conn = new CuaDriverConnection(driverModule);
    const base64 = await conn.captureScreen();

    expect(Buffer.from(base64, 'base64')).toEqual(fakePngBytes);
    const call = calls.find((c) => c.tool === 'get_window_state');
    expect(call).toMatchObject({ args: { pid: 42, window_id: 2, include_screenshot: true } });
    expect(typeof call!.args['screenshot_out_file']).toBe('string');

    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up the temp screenshot file even when the driver call fails after writing it', async () => {
    const { driverModule } = makeFakeDriver(() => fail('window closed mid-capture'));
    const conn = new CuaDriverConnection(driverModule);
    await expect(conn.captureScreen()).rejects.toThrow(/window closed mid-capture/);
    // No assertion needed beyond "did not throw during cleanup" — the
    // `finally` block's unlink failure is swallowed by design (file may
    // never have been created).
  });
});

// ────────────────────────────────────────────────────────────────
// W17 — the number the fusion has to move, and the addressing defect that
// blocks wiring. Neither is fixed; both are pinned so the claim is checkable.
// ────────────────────────────────────────────────────────────────

describe('W17 — un-fused round trips (NOT yet implemented)', () => {
  it('costs SIX driver round trips for one click with capture, where the acceptance criterion is ONE', async () => {
    const { driverModule, calls } = makeFakeDriver((tool, args) => {
      if (tool === 'get_window_state') {
        writeFileSync(args['screenshot_out_file'] as string, Buffer.from('png'));
        return ok({});
      }
      return ok({});
    });
    const conn = new CuaDriverConnection(driverModule);

    // Exactly what `CuaHostServer` does for `perform_action` with
    // `captureAfter: true`.
    await conn.performAction({ type: 'left_click', coordinate: [10, 20] });
    await conn.captureScreen();

    // list_apps, list_windows, click, list_apps, list_windows, get_window_state
    expect(calls.map((c) => c.tool)).toEqual([
      'list_apps', 'list_windows', 'click',
      'list_apps', 'list_windows', 'get_window_state',
    ]);
    // W17's acceptance is "one click = one driver round trip". This assertion
    // is expected to FAIL the day the fused path lands — at which point the
    // right change is to make it `toHaveLength(1)`, not to delete it.
    expect(calls).toHaveLength(6);
  });

  it('resolves the target from whatever is frontmost, carrying no approved app or window identity', async () => {
    // The security defect recorded on `ComputerAction` in
    // `packages/shared/src/ipc/CuaHostIpc.ts`. The action below names no app,
    // so the click is scoped to whichever app `list_apps` reports as active at
    // the moment it runs — not to whatever the user approved. This is why the
    // host is not wired into `ComputerService`.
    const { driverModule, calls } = makeFakeDriver(() => ok({}));
    const conn = new CuaDriverConnection(driverModule);

    const action: ComputerAction = { type: 'left_click', coordinate: [5, 5] };
    expect(Object.keys(action)).not.toContain('pid');
    expect(Object.keys(action)).not.toContain('windowId');
    expect(Object.keys(action)).not.toContain('appName');

    await conn.performAction(action);
    // The pid came from `list_apps`'s `active` flag, not from the caller.
    expect(calls.find((c) => c.tool === 'click')).toMatchObject({ args: { pid: 42, window_id: 2 } });
  });
});
