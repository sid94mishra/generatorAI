/**
 * W17 — CuaDriverConnection: cua-host's own connection to `@trycua/cua-driver`.
 *
 * Fixes the `performAction`/`captureScreen` no-ops in `CuaHostServer.ts` by
 * driving the SAME real driver `packages/core/src/infrastructure/computer/CuaDriverBridge.ts`
 * already wraps for the in-process `ComputerService` path — but through
 * cua-host's own, narrower IPC protocol (`ComputerAction`: raw screen
 * coordinates, no resolved app/window/blocklist model — see
 * `packages/shared/src/ipc/CuaHostIpc.ts`).
 *
 * `cua-host`'s `ComputerAction` carries no pid/window — it addresses the
 * screen the way Anthropic's own "computer" tool does (`left_click` at a
 * coordinate, `type`, `key`, `scroll`, `left_click_drag`, `screenshot`).
 * The driver's tools need a `{pid, window_id}` scope for every action
 * (`click`, `type_text`, `scroll`, `drag`, …) and for `get_window_state`
 * (the only way to capture a screenshot). This module resolves that scope
 * once per call by asking the driver which app is frontmost
 * (`list_apps` → `active`) and which of its windows is on top
 * (`list_windows` → highest `z_index` among on-screen windows) — the exact
 * same "frontmost" signal `driverPayloads.ts`'s `parseListApps`/
 * `parseListWindows` already derive for the full `IComputerBridge` path.
 *
 * NOT a full `IComputerBridge` implementation — deliberately. That interface
 * (snapshot/listApps/launchApp/verify/recording, all blocklist-aware) is far
 * richer than this narrow, coordinate-only protocol; building the rest of it
 * here would be a new feature, not a wiring fix. See the tracker entry for
 * this fix for the full reasoning.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ComputerAction } from '@generatorai/shared';

// ── Structural subset of the driver SDK this file uses (INV-1-style: no
// vendor types leak past this module) — mirrors CuaDriverBridge.ts's own
// local `DriverClient`/`DriverModule` declarations. ──

export interface DriverToolResult {
  text: string;
  structuredJson?: string;
  isError: boolean;
  errorCode?: string;
}

export interface DriverClient {
  callTool(name: string, argumentsJson: string): Promise<DriverToolResult>;
}

export interface DriverModule {
  CuaDriver: {
    create(options: undefined): DriverClient;
    connect(socketPath: string | undefined): DriverClient;
  };
}

interface WindowTarget {
  pid: number;
  windowId: number;
}

/** Loads the real `@trycua/cua-driver` package lazily — absent on platforms with no prebuild. */
async function loadDriverModule(): Promise<DriverModule> {
  const mod = await import('@trycua/cua-driver');
  return mod as unknown as DriverModule;
}

function parseJson(tool: string, raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error(`[CuaDriverConnection] ${tool}: driver returned no structured payload`);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`[CuaDriverConnection] ${tool}: driver returned unparseable JSON`);
  }
}

export class CuaDriverConnection {
  private client: DriverClient | null = null;
  private readonly driverModulePromise: Promise<DriverModule>;

  constructor(
    /** Injectable for tests — production omits this and loads the real SDK. */
    driverModule?: DriverModule,
  ) {
    this.driverModulePromise = driverModule ? Promise.resolve(driverModule) : loadDriverModule();
  }

  private async getClient(): Promise<DriverClient> {
    if (this.client) return this.client;
    const module = await this.driverModulePromise;
    // "attached" mode (an embedded host Electron/desktop main already
    // started) when a socket path is configured; otherwise cua-host owns
    // its own in-process driver connection — it IS its own dedicated
    // process already, so there is nothing to spawn.
    const socketPath = process.env['GENERATORAI_CUA_DRIVER_SOCKET'];
    this.client = socketPath ? module.CuaDriver.connect(socketPath) : module.CuaDriver.create(undefined);
    return this.client;
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<DriverToolResult> {
    const client = await this.getClient();
    const result = await client.callTool(tool, JSON.stringify(args));
    if (result.isError) {
      throw new Error(`[CuaDriverConnection] driver tool '${tool}' failed: ${result.text}`);
    }
    return result;
  }

  /**
   * Resolves the currently frontmost app + its topmost on-screen window —
   * the implicit target for every coordinate-addressed action this
   * protocol carries no pid/window for.
   */
  async resolveFocusedWindow(): Promise<WindowTarget> {
    const appsResult = await this.call('list_apps', {});
    const appsPayload = parseJson('list_apps', appsResult.structuredJson);
    const apps = appsPayload['apps'];
    if (!Array.isArray(apps)) throw new Error('[CuaDriverConnection] list_apps: unexpected payload shape');
    const active = apps.find((a): a is Record<string, unknown> => (
      typeof a === 'object' && a !== null && (a as Record<string, unknown>)['active'] === true
    ));
    if (!active || typeof active['pid'] !== 'number') {
      throw new Error('[CuaDriverConnection] no frontmost application reported by the driver');
    }
    const pid = active['pid'];

    const winResult = await this.call('list_windows', { pid, on_screen_only: false });
    const winPayload = parseJson('list_windows', winResult.structuredJson);
    const windows = winPayload['windows'];
    if (!Array.isArray(windows)) throw new Error('[CuaDriverConnection] list_windows: unexpected payload shape');

    let top: { windowId: number; z: number } | undefined;
    for (const entry of windows) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (e['is_on_screen'] !== true) continue;
      const windowId = e['window_id'];
      const z = e['z_index'];
      if (typeof windowId !== 'number' || typeof z !== 'number') continue;
      if (!top || z > top.z) top = { windowId, z };
    }
    if (!top) throw new Error('[CuaDriverConnection] frontmost app has no on-screen window');

    return { pid, windowId: top.windowId };
  }

  /**
   * Maps one `ComputerAction` (Anthropic "computer" tool vocabulary — see
   * `packages/shared/src/ipc/CuaHostIpc.ts`) onto a driver tool call against
   * the currently focused window, and performs it. `screenshot` is handled
   * by `captureScreen()`, not here — the caller (`CuaHostServer`) already
   * branches on `captureAfter` for that.
   *
   * Supported: left_click, right_click, double_click, type, key (incl.
   * modifier chords via `keys`), scroll, left_click_drag — every tool name
   * used here is verified against `CuaDriverBridge.buildCall()`'s own,
   * already-proven mapping. `mouse_move`/`middle_click` throw "unsupported"
   * rather than guessing an unverified driver tool name — `buildCall()`
   * never uses either, so there's nothing to safely mirror them from.
   */
  async performAction(action: ComputerAction): Promise<void> {
    if (action.type === 'screenshot' || action.type === 'wait' || action.type === 'cursor_position') {
      // No-ops from the driver's perspective: `cursor_position`/`wait` need
      // no OS action, and `screenshot` is served by `captureAfter`/`capture`.
      return;
    }

    // △ Driver args are snake_case (`pid`, `window_id`) — `resolveFocusedWindow()`
    // returns camelCase for this module's own internal use. Spreading the raw
    // `WindowTarget` into a call's args would silently send `windowId` instead
    // of `window_id`, which the driver would not recognise. Found in review
    // before this shipped, not by a test failure — every driver-call site
    // below goes through `scope()` for exactly this reason.
    const target = await this.resolveFocusedWindow();
    const scope = { pid: target.pid, window_id: target.windowId };
    const [x, y] = action.coordinate ?? [];

    switch (action.type) {
      case 'left_click':
        if (x === undefined || y === undefined) throw new Error('[CuaDriverConnection] left_click requires coordinate');
        await this.call('click', { ...scope, x, y });
        return;
      case 'right_click':
        if (x === undefined || y === undefined) throw new Error('[CuaDriverConnection] right_click requires coordinate');
        await this.call('right_click', { ...scope, x, y });
        return;
      case 'double_click':
        if (x === undefined || y === undefined) throw new Error('[CuaDriverConnection] double_click requires coordinate');
        await this.call('double_click', { ...scope, x, y });
        return;
      case 'type':
        await this.call('type_text', { ...scope, text: action.text ?? '' });
        return;
      case 'key':
        if (action.keys && action.keys.length > 0) {
          await this.call('hotkey', { ...scope, keys: action.keys });
        } else {
          await this.call('press_key', { ...scope, key: action.key ?? '' });
        }
        return;
      case 'scroll': {
        const direction = action.direction ?? 'down';
        const amount = action.amount ?? 3;
        await this.call('scroll', { ...scope, direction, amount });
        return;
      }
      case 'left_click_drag': {
        const [fromX, fromY] = action.start_coordinate ?? [];
        if (fromX === undefined || fromY === undefined || x === undefined || y === undefined) {
          throw new Error('[CuaDriverConnection] left_click_drag requires start_coordinate and coordinate');
        }
        await this.call('drag', { ...scope, from_x: fromX, from_y: fromY, to_x: x, to_y: y });
        return;
      }
      default:
        throw new Error(`[CuaDriverConnection] unsupported action type: ${action.type}`);
    }
  }

  /**
   * Captures a real screenshot of the currently focused window.
   *
   * The driver writes screenshots to a FILE (`get_window_state`'s
   * `screenshot_out_file` arg — it does not return image bytes inline, per
   * `CuaDriverBridge.screenshotPath()`'s own convention), so this writes to
   * a temp path, reads it back, base64-encodes it, and cleans up.
   */
  async captureScreen(): Promise<string> {
    const target = await this.resolveFocusedWindow();
    const scope = { pid: target.pid, window_id: target.windowId };
    const outFile = path.join(os.tmpdir(), `cua-host-capture-${randomUUID()}.png`);
    try {
      await this.call('get_window_state', {
        ...scope,
        max_elements: 1,
        max_depth: 1,
        include_screenshot: true,
        screenshot_out_file: outFile,
      });
      const bytes = await fs.readFile(outFile);
      return bytes.toString('base64');
    } finally {
      await fs.unlink(outFile).catch(() => undefined);
    }
  }
}
