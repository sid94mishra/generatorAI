// ────────────────────────────────────────────────────────────────
// CuaDriverBridge — IComputerBridge over trycua's cua-driver.
//
// VERIFIED against cua-driver 0.19.3 / contract 0.6.0. Two runtimes:
//
//   in-process  — `CuaDriver.create()`. No daemon, no socket, no separate
//                 binary. Used on Windows and Linux.
//   attached    — `CuaDriver.connect(socketPath)` against an embedded host
//                 that Electron main started. REQUIRED on macOS.
//
// WHY MACOS IS DIFFERENT: macOS attributes Accessibility and Screen Recording
// to a *responsible app identity*. The driver must therefore sit in the signed
// desktop app's spawn chain, so this class refuses to run in-process there and
// waits for `setEndpoint()`. Windows needs no such grant at all — the driver's
// own `check_permissions` reports "UIA accessibility: available (no special
// permission needed)" — so an in-process runtime is both sufficient and the
// simplest thing that works.
//
// ELEMENT ADDRESSING IS THE DRIVER'S, NOT OURS. `get_window_state` returns a
// `snapshot_id` and per-element `element_index`, and `click` / `set_value` /
// `type_text` accept them directly. We pass them straight through rather than
// caching bounds and computing a centre point: the driver resolves the element
// through UIA on its side, which survives the window moving and cannot land on
// a neighbouring application the way a stale coordinate can.
//
// INPUT DOES NOT STEAL FOCUS. On Windows the driver delivers via PostMessage
// to the target window, so `type_text` and `press_key` work against a
// backgrounded window and never move the user's cursor. That is why these are
// not gated behind a focus check here — the driver reports the route it used
// and we surface it as `path`.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ComputerActionPath,
  ComputerActionResult,
  ComputerAppInfo,
  ComputerCapabilities,
  ComputerElement,
  ComputerRefusalCode,
  ComputerSnapshot,
  ILogger,
} from '@generatorai/shared';
import type {
  ActionRequest,
  ComputerAppIdentity,
  ComputerHandle,
  ComputerHostObserver,
  ComputerRefusal,
  ComputerRuntimeCheck,
  ComputerRuntimeStatus,
  ComputerStartOptions,
  IComputerBridge,
  ListAppsResult,
  ListWindowsResult,
  LaunchAppResult,
  RecordingRequest,
  RecordingState,
  SnapshotRequest,
  VerifyRequest,
  VerifyResult,
} from '../../domain/ports/IComputerBridge.js';
import { isElementAddressed } from '../../domain/ports/IComputerBridge.js';
import {
  UnrecognisedDriverPayloadError,
  parseListApps,
  parseListWindows,
  parseRecordingState,
  parseVerifyState,
  parseWindowState,
} from './driverPayloads.js';

/**
 * Structural subset of the SDK this adapter uses. Declared locally so the
 * driver's types never cross the port (INV-1) and so the module can be absent
 * at build time on platforms with no prebuild.
 */
interface DriverToolResult {
  text: string;
  structuredJson?: string;
  isError: boolean;
  errorCode?: string;
  degraded: boolean;
  action?: { effect: number; route: number };
}

interface DriverClient {
  startSession(input: { session: string; captureScope?: number }, opts?: { signal: AbortSignal }): Promise<unknown>;
  endSession(input: { session: string }, opts?: { signal: AbortSignal }): Promise<unknown>;
  callTool(name: string, argumentsJson: string, opts?: { signal: AbortSignal }): Promise<DriverToolResult>;
  metadata(opts?: { signal: AbortSignal }): Promise<{ driverVersion: string; contractVersion: string }>;
  shutdown?(opts?: { signal: AbortSignal }): Promise<void>;
}

interface EmbeddedHost {
  start(): Promise<{ socketPath: string; pid: number; generation: string; driverVersion: string }>;
  stop(): Promise<void>;
  waitForExit?(generation: string): Promise<{ generation: string; code?: number }>;
}

interface DriverModule {
  CuaDriver: {
    create(options: undefined): DriverClient;
    connect(socketPath: string | undefined): DriverClient;
  };
  EmbeddedCuaDriverHost?: {
    withOptions(options: {
      binaryPath: string;
      hostBundleId: string;
      permissionMode?: number;
      approveSessionPolicy: boolean;
      dangerouslyBypassApprovals: boolean;
      environment: unknown[];
      inheritStderr: boolean;
    }): EmbeddedHost;
  };
}

/** Mirrors `ActionRoute` in the driver contract. */
const ROUTE_ACCESSIBILITY = 0;
const ROUTE_SYNTHETIC_EVENTS = 1;
const ROUTE_GLOBAL_INPUT = 2;
const ROUTE_SYSTEM_API = 3;
const ROUTE_DOM = 4;
const ROUTE_TRUSTED_INPUT = 5;

/** Mirrors `ActionEffect`. */
const EFFECT_CONFIRMED = 0;
/** The driver believes the action changed nothing. Never a success. */
const EFFECT_SUSPECTED_NOOP = 3;
const EFFECT_REFUSED = 4;

/** Mirrors `CaptureScope.Window` — strict per-window perception. */
const CAPTURE_WINDOW = 1;

/**
 * How long the agent cursor stays visible while nothing moves.
 *
 * The driver's default is 20 s, which is shorter than the gaps between a
 * model's tool calls — so the pointer disappears mid-task and the run looks
 * abandoned. 60 s is the driver's ceiling: it silently clamps anything larger,
 * so asking for more would only misreport what the user will actually see.
 */
const AGENT_CURSOR_IDLE_HIDE_MS = 60_000;

/**
 * Driver error codes → our refusal vocabulary. Codes observed in the contract
 * and in live probes; anything unmapped becomes `provider_unavailable`, which
 * is the honest answer for an error we do not understand.
 */
const REFUSAL_BY_ERROR_CODE: Record<string, ComputerRefusalCode> = {
  background_unavailable: 'background_unavailable',
  background_occluded: 'background_occluded',
  occluded: 'background_occluded',
  // The driver names an exact remedy — restore the window, re-snapshot. Left
  // unmapped it became `provider_unavailable`, which reads as "the driver is
  // broken" and sends the agent looking for another route instead.
  window_minimized: 'background_occluded',
  window_minimised: 'background_occluded',
  uipi_blocked: 'background_uipi_blocked',
  integrity_blocked: 'background_uipi_blocked',
  not_focused: 'target_not_focused',
  target_not_focused: 'target_not_focused',
  focus_required: 'target_not_focused',
  window_not_found: 'target_lost',
  target_missing: 'target_lost',
  process_not_found: 'target_lost',
  stale_snapshot: 'stale_snapshot',
  snapshot_expired: 'stale_snapshot',
  element_not_found: 'stale_snapshot',
  // Means "re-snapshot", not "the accessibility route is dead". Mapped here so
  // the agent retries the element path instead of abandoning it for blind
  // coordinate clicking, which is both slower and unverifiable.
  stale_element_token: 'stale_snapshot',
  desktop_scope_disabled: 'provider_unavailable',
  permission_denied: 'provider_unavailable',
  accessibility_denied: 'provider_unavailable',
  timeout: 'capacity_exhausted',
};

export interface CuaDriverEndpoint {
  socketPath: string;
  driverVersion: string;
  pid: number;
  platform: string;
  displayServer?: string;
}

export interface CuaDriverBridgeOptions {
  logger: ILogger;
  maxSnapshotElements: number;
  maxSnapshotDepth: number;
  /** Screenshot directory, relative to the workspace root. */
  screenshotDir?: string;
  /**
   * Allow the in-process runtime. Ignored on darwin, where the TCC identity
   * requirement makes the Electron-hosted runtime mandatory.
   */
  allowInProcess?: boolean;
  /**
   * Path to the bundled `cua-driver` executable. When present the server can
   * run its own daemon, which is the only form that owns the agent-cursor
   * overlay and the only one that survives a driver crash.
   */
  driverBinaryPath?: string;
  /** Socket of a daemon somebody else manages — a Windows Scheduled Task, a systemd unit. */
  attachSocketPath?: string;
  /** Reverse-DNS label the driver echoes back in `check_permissions`. */
  hostBundleId?: string;
  /**
   * Agent-cursor theme to select for each session. Must already be installed
   * in the driver's theme store; an unknown id is refused and the session
   * keeps the driver default rather than failing to start.
   */
  cursorThemeId?: string;
  /**
   * Substitute for the real SDK. Exists because the behaviours that cost the
   * most to get wrong here — reopening a retired session, escalating to
   * foreground delivery, refusing a minimised window — are all decisions made
   * from driver responses, and none of them were reachable by a test.
   */
  driverModule?: DriverModule;
}

interface Connection {
  client: DriverClient;
  sessionId: string;
  workspaceRoot: string;
  driverVersion: string;
  inProcess: boolean;
}

export class CuaDriverBridge implements IComputerBridge {
  readonly id = 'cua-driver';

  private readonly endpoints = new Map<string, CuaDriverEndpoint>();
  private readonly connections = new Map<string, Connection>();
  private readonly observers = new Map<string, ComputerHostObserver>();
  /**
   * snapshotId → the window it was taken from, plus each element's opaque
   * handle.
   *
   * The driver owns snapshot identity, but its action tools still require the
   * owning `pid` and `window_id` alongside the id — an element reference sent
   * without them is rejected with "Missing required integer field: pid".
   *
   * `tokens` is preferred on dispatch: a superseded handle comes back as an
   * explicit `stale_element_token` refusal instead of acting on whatever now
   * sits at that index.
   */
  private readonly snapshotScopes = new Map<
    string,
    { pid: number; windowId: number; tokens: Map<number, string>; roles: Map<number, string> }
  >();
  private modulePromise: Promise<DriverModule | null> | null = null;
  /**
   * One daemon per machine, not per workspace — it drives one physical screen,
   * and a second would fight the first for the same keyboard.
   */
  private ownHost: { host: EmbeddedHost; endpoint: CuaDriverEndpoint } | null = null;
  private ownHostPromise: Promise<CuaDriverEndpoint | null> | null = null;

  constructor(private readonly options: CuaDriverBridgeOptions) {}

  /** Electron main pushes the embedded host's socket here; `null` clears it. */
  setEndpoint(workspaceId: string, endpoint: CuaDriverEndpoint | null): void {
    if (endpoint === null) {
      this.endpoints.delete(workspaceId);
      const connection = this.connections.get(workspaceId);
      this.connections.delete(workspaceId);
      if (connection && !connection.inProcess) {
        this.observers.get(workspaceId)?.onCrash?.(
          {
            workspaceId,
            provider: this.id,
            providerVersion: connection.driverVersion,
            hostRef: 'detached',
            operational: true,
          },
          'The desktop app stopped the computer-use driver.',
        );
      }
      return;
    }
    this.endpoints.set(workspaceId, endpoint);
  }

  private inProcessAllowed(): boolean {
    // Never on darwin: a driver created inside the server process has no
    // stable bundle identity, so the user's TCC grants do not apply to it and
    // every call would fail silently.
    return process.platform !== 'darwin' && this.options.allowInProcess !== false;
  }

  /**
   * Where the driver lives, in decreasing order of who owns it:
   *
   *   1. an endpoint the desktop shell pushed — it spawned the daemon inside
   *      its own signed bundle, which is the only form macOS TCC respects;
   *   2. a socket somebody else manages — a Windows Scheduled Task in the
   *      interactive session, a systemd user unit. The only route that works
   *      when this process sits in Session 0 and cannot see the desktop;
   *   3. our own daemon, spawned from the bundled executable;
   *   4. nothing — the caller falls back to the in-process runtime, which
   *      works but cannot own the agent-cursor overlay.
   */
  private async resolveEndpoint(
    workspaceId: string,
    module: DriverModule,
  ): Promise<CuaDriverEndpoint | undefined> {
    const pushed = this.endpoints.get(workspaceId);
    if (pushed) return pushed;

    const attach = this.options.attachSocketPath;
    if (attach) {
      return { socketPath: attach, driverVersion: '0', pid: 0, platform: process.platform };
    }

    return (await this.startOwnHost(module)) ?? undefined;
  }

  /** Idempotent and concurrency-safe: one daemon serves every workspace. */
  private async startOwnHost(module: DriverModule): Promise<CuaDriverEndpoint | null> {
    if (this.ownHost) return this.ownHost.endpoint;
    const binaryPath = this.options.driverBinaryPath;
    if (!binaryPath || !module.EmbeddedCuaDriverHost) return null;

    this.ownHostPromise ??= (async () => {
      try {
        const host = module.EmbeddedCuaDriverHost!.withOptions({
          binaryPath,
          hostBundleId: this.options.hostBundleId ?? 'com.generatorai.app',
          // `bounded` refuses to start without a capability manifest, which we
          // do not ship yet. `standard` still gates destructive tools behind
          // the driver's own approval.
          permissionMode: 0,
          approveSessionPolicy: false,
          // Never true — it disables the driver's own approval gate, the last
          // line of defence if our service-side gates are ever bypassed.
          dangerouslyBypassApprovals: false,
          // An allowlist, not the inherited environment: this process holds
          // provider tokens the driver has no business seeing.
          environment: daemonEnvironment(),
          inheritStderr: false,
        });
        const connection = await host.start();
        const endpoint: CuaDriverEndpoint = {
          socketPath: connection.socketPath,
          driverVersion: connection.driverVersion,
          pid: connection.pid,
          platform: process.platform,
        };
        this.ownHost = { host, endpoint };
        this.options.logger.info?.(
          `[CuaDriverBridge] started own driver daemon ${connection.driverVersion} (pid ${connection.pid})`,
        );

        // A daemon that dies leaves every cached connection pointing at a
        // socket nobody is listening on; drop them so the next call reopens.
        void host
          .waitForExit?.(connection.generation)
          .then(() => {
            if (this.ownHost?.host !== host) return;
            this.options.logger.warn?.('[CuaDriverBridge] driver daemon exited');
            this.ownHost = null;
            this.ownHostPromise = null;
            this.connections.clear();
            this.snapshotScopes.clear();
          })
          .catch(() => {
            // Exit reporting is diagnostic; failing to observe it is not fatal.
          });

        return endpoint;
      } catch (err) {
        this.options.logger.warn?.(
          `[CuaDriverBridge] could not start the driver daemon: ${(err as Error).message}`,
        );
        this.ownHostPromise = null;
        return null;
      }
    })();

    return this.ownHostPromise;
  }

  /** Stops the daemon this bridge owns. Endpoints owned elsewhere are left alone. */
  async dispose(): Promise<void> {
    const owned = this.ownHost;
    this.ownHost = null;
    this.ownHostPromise = null;
    if (!owned) return;
    try {
      await owned.host.stop();
    } catch (err) {
      this.options.logger.warn?.(
        `[CuaDriverBridge] driver daemon did not stop cleanly: ${(err as Error).message}`,
      );
    }
  }

  async isAvailable(workspaceId: string): Promise<boolean> {
    const reachable =
      this.endpoints.has(workspaceId) ||
      this.options.attachSocketPath !== undefined ||
      this.options.driverBinaryPath !== undefined ||
      this.inProcessAllowed();
    if (!reachable) return false;
    return (await this.loadModule()) !== null;
  }

  /**
   * Read-only by contract: it reports on a connection that already exists and
   * never opens one, so polling this from Settings cannot hand out desktop
   * control as a side effect.
   */
  async runtime(workspaceId?: string): Promise<ComputerRuntimeStatus> {
    const module = await this.loadModule();
    if (!module) {
      return {
        provider: this.id,
        host: 'none',
        state: 'unavailable',
        detail:
          'The cua-driver SDK is not installed for this platform, so there is nothing to start.',
      };
    }

    const endpoint = workspaceId ? this.endpoints.get(workspaceId) : undefined;
    const canSpawn = this.options.driverBinaryPath !== undefined;
    const host =
      endpoint || this.options.attachSocketPath || this.ownHost
        ? 'attached'
        : canSpawn
          ? 'attached'
          : this.inProcessAllowed()
            ? 'in-process'
            : 'none';
    if (host === 'none') {
      return {
        provider: this.id,
        host,
        state: 'unavailable',
        detail:
          'No driver endpoint is registered, no driver executable is bundled, and the in-process runtime is not permitted here.',
      };
    }

    const connection = workspaceId ? this.connections.get(workspaceId) : undefined;
    if (!connection) {
      return {
        provider: this.id,
        providerVersion: endpoint?.driverVersion,
        host,
        state: 'stopped',
        detail: 'The driver is installed but no session is open. Starting one is safe and reversible.',
      };
    }

    const checks = await this.healthChecks(connection);
    const failed = checks.filter((c) => c.status === 'fail');
    return {
      provider: this.id,
      providerVersion: connection.driverVersion,
      host,
      state: failed.length > 0 ? 'degraded' : 'ready',
      ...(failed.length > 0 ? { detail: failed.map((c) => c.message).join(' ') } : {}),
      checks,
    };
  }

  /** The driver owns the health model; a probe failure is reported, not thrown. */
  private async healthChecks(connection: Connection): Promise<ComputerRuntimeCheck[]> {
    const probe = async (): Promise<ComputerRuntimeCheck[]> => {
      const result = await connection.client.callTool(
        'health_report',
        JSON.stringify({ session: connection.sessionId }),
      );
      const root = JSON.parse(result.structuredJson ?? '{}') as {
        checks?: Array<{ name?: unknown; status?: unknown; message?: unknown }>;
      };
      return (root.checks ?? []).map((c) => ({
        name: typeof c.name === 'string' ? c.name : 'unknown',
        status: c.status === 'pass' || c.status === 'fail' ? c.status : 'skip',
        message: typeof c.message === 'string' ? c.message : '',
      }));
    };

    try {
      return [...(await probe()), ...(await this.lockCheck(connection))];
    } catch (err) {      // A session can wedge without being retired: every tool then raises
      // `DriverError.Tool` and the agent gets `provider_unavailable` for the
      // rest of the run, while a re-open clears it. Only the read-only probe is
      // retried — replaying an action here could deliver a keystroke twice.
      this.options.logger.warn?.(
        `[CuaDriverBridge] health probe failed (${String(err)}); reopening session ${connection.sessionId}`,
      );
      try {
        this.snapshotScopes.clear();
        await connection.client.startSession({ session: connection.sessionId, captureScope: CAPTURE_WINDOW });
        await this.applyAgentCursor(connection.client, connection.sessionId);
        return await probe();
      } catch (retryErr) {
        return [
          { name: 'health_report', status: 'fail', message: `Health probe failed: ${String(retryErr)}` },
        ];
      }
    }
  }

  async capabilities(workspaceId: string): Promise<ComputerCapabilities> {
    const endpoint = this.endpoints.get(workspaceId);
    const connection = this.connections.get(workspaceId);
    const platform = endpoint?.platform ?? process.platform;
    const limitations: string[] = [];

    const kde = endpoint?.displayServer === 'wayland-kde';
    if (kde) limitations.push('KDE Wayland: window geometry is unavailable, so element targeting is disabled.');
    if (endpoint?.displayServer === 'wayland-gnome') {
      limitations.push('GNOME Wayland: window geometry requires the WinRects helper extension.');
    }
    if (platform === 'win32') {
      limitations.push(
        'Windows: input is delivered by PostMessage, so actions work on background windows without stealing focus.',
      );
    }

    return {
      platform,
      provider: this.id,
      providerVersion: connection?.driverVersion ?? endpoint?.driverVersion ?? '0',
      displayServer: endpoint?.displayServer,
      supports: {
        listApps: true,
        listWindows: true,
        snapshot: true,
        screenshot: true,
        elementBounds: !kde,
        backgroundClick: !kde,
        backgroundType: true,
        setValue: true,
        performAction: true,
        scroll: true,
        drag: !kde,
        hotkey: true,
        pasteText: true,
      },
      limitations,
    };
  }

  async start(opts: ComputerStartOptions, observer?: ComputerHostObserver): Promise<ComputerHandle> {
    const module = await this.loadModule();
    if (!module) throw new Error('[CuaDriverBridge] The cua-driver SDK is not installed for this platform');

    const endpoint = await this.resolveEndpoint(opts.workspaceId, module);
    if (!endpoint && !this.inProcessAllowed()) {
      throw new Error('[CuaDriverBridge] No driver endpoint available for this workspace');
    }

    const client = endpoint
      ? module.CuaDriver.connect(endpoint.socketPath)
      : module.CuaDriver.create(undefined);

    const sessionId = `generatorai-${opts.workspaceId}`;
    // Window scope, never desktop. Escalating is irreversible for the session
    // and would put every unrelated window on screen into the model's context.
    await client.startSession({ session: sessionId, captureScope: CAPTURE_WINDOW });

    // The session-owned agent cursor: a second, virtual pointer that shows the
    // user what the agent is doing without the agent ever moving the real one.
    // It only renders on a daemon-backed connection — the same-process runtime
    // does not own the overlay — so this is a no-op in-process by design.
    await this.applyAgentCursor(client, sessionId);

    let driverVersion = endpoint?.driverVersion ?? '0';
    try {
      driverVersion = (await client.metadata()).driverVersion;
    } catch {
      // Version is diagnostic only; a probe failure must not block the session.
    }

    this.connections.set(opts.workspaceId, {
      client,
      sessionId,
      workspaceRoot: opts.workspaceRoot,
      driverVersion,
      inProcess: !endpoint,
    });
    if (observer) this.observers.set(opts.workspaceId, observer);

    return {
      workspaceId: opts.workspaceId,
      provider: this.id,
      providerVersion: driverVersion,
      hostRef: endpoint?.socketPath ?? 'in-process',
      operational: true,
    };
  }

  async stop(handle: ComputerHandle): Promise<void> {
    const connection = this.connections.get(handle.workspaceId);
    this.connections.delete(handle.workspaceId);
    this.observers.delete(handle.workspaceId);
    if (!connection) return;
    try {
      await connection.client.endSession({ session: connection.sessionId });
      if (connection.inProcess) await connection.client.shutdown?.();
    } catch (err) {
      this.options.logger.warn?.(`[CuaDriverBridge] session teardown failed: ${(err as Error).message}`);
    }
  }

  async listApps(handle: ComputerHandle): Promise<ListAppsResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { apps: [], refusal: disconnected() };
    try {
      const appsResult = await this.call(connection, 'list_apps', {});
      const appsRefusal = this.refusalFor(appsResult);
      if (appsRefusal) return { apps: [], refusal: appsRefusal };

      const winResult = await this.call(connection, 'list_windows', { on_screen_only: false });
      const winRefusal = this.refusalFor(winResult);
      if (winRefusal) return { apps: [], refusal: winRefusal };

      const apps = parseListApps(this.requireStructured(appsResult));
      const windowsByPid = parseListWindows(this.requireStructured(winResult));
      // `list_apps` reports `windows: []` for every entry, so the real count
      // comes from the window enumeration.
      for (const app of apps) app.windowCount = windowsByPid.get(app.pid)?.length ?? 0;
      return { apps, windowsByPid };
    } catch (err) {
      return { apps: [], refusal: this.errorRefusal(err) };
    }
  }

  async listWindows(handle: ComputerHandle, app: ComputerAppIdentity): Promise<ListWindowsResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { windows: [], refusal: disconnected() };
    try {
      const result = await this.call(connection, 'list_windows', { pid: app.pid, on_screen_only: false });
      const refusal = this.refusalFor(result);
      if (refusal) return { windows: [], refusal };
      const byPid = parseListWindows(this.requireStructured(result));
      return { windows: byPid.get(app.pid) ?? [] };
    } catch (err) {
      return { windows: [], refusal: this.errorRefusal(err) };
    }
  }

  async snapshot(
    handle: ComputerHandle,
    req: SnapshotRequest,
    signal?: AbortSignal,
  ): Promise<ComputerActionResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return refuse(disconnected());

    try {
      const windowId = await this.resolveWindowId(connection, req.app.pid, req.window);
      if (windowId === null) {
        return refuse({ code: 'target_lost', message: 'That window is no longer open.' });
      }

      // A minimised window has no rendered client area, so UIA exposes only its
      // chrome. Measured on File Explorer: 5 elements minimised (TitleBar,
      // System, Restore, Maximize, Close) against 114 restored, with the
      // Address Bar only present in the second. The agent cannot tell those
      // apart — it reads a successful snapshot with nothing in it and spends
      // the rest of the run guessing, so restore first and read something real.
      const dead = await this.ensureLiveWindow(connection, req.app.pid, windowId, signal);
      if (dead) return refuse(dead);

      const screenshotPath = req.includeScreenshot
        ? await this.screenshotPath(connection, handle.workspaceId)
        : undefined;

      const args = (maxElements: number, maxDepth: number) => ({
        pid: req.app.pid,
        window_id: windowId,
        max_elements: maxElements,
        max_depth: maxDepth,
        ...(req.query ? { query: req.query } : {}),
        ...(screenshotPath ? { include_screenshot: true, screenshot_out_file: screenshotPath } : {}),
      });

      let result = await this.call(
        connection,
        'get_window_state',
        args(
          req.maxElements ?? this.options.maxSnapshotElements,
          req.maxDepth ?? this.options.maxSnapshotDepth,
        ),
        signal,
      );
      // Some providers cannot enumerate a large tree in the time the driver
      // allows — Excel's grid is the reference case. Step down rather than
      // dropping straight to the floor: a busy app that would have answered a
      // medium scan should not be reduced to a title bar and three buttons.
      let laddered: (typeof SCAN_LADDER)[number] | null = null;
      for (const rung of SCAN_LADDER) {
        if (!wantsShallowScan(result)) break;
        const [maxElements, maxDepth] = rung;
        this.options.logger.info?.(
          `[CuaDriverBridge] provider could not walk the tree; retrying at ${maxElements}/${maxDepth}`,
        );
        result = await this.call(connection, 'get_window_state', args(maxElements, maxDepth), signal);
        laddered = rung;
      }
      const refusal = this.refusalFor(result);
      if (refusal) return refuse(refusal);

      const state = parseWindowState(this.requireStructured(result), req.query !== undefined);
      const windows = await this.windowsFor(connection, req.app.pid);
      const window = windows.find((w) => w.id === state.windowId);

      const snapshot: ComputerSnapshot = {
        // The driver's own snapshot id, passed back verbatim to every action.
        snapshotId: state.snapshotId,
        app: { id: req.app.appId, name: req.app.name, pid: state.pid },
        window: {
          id: state.windowId,
          title: window?.title ?? '',
          index: window?.index ?? 0,
          focused: window?.focused ?? false,
        },
        elements: state.elements,
        // A laddered read answered a *smaller question* — the driver reports it
        // as complete because it returned everything within the reduced caps.
        // Without saying so, the agent takes a depth-3 chrome-only tree for the
        // whole window and hunts for controls that were never enumerated.
        truncated:
          state.truncated ?? (laddered ? { elements: laddered[0], depth: laddered[1] } : null),
        capturedAt: Date.now(),
      };
      this.rememberScope(state.snapshotId, state.pid, state.windowId, state.elements);

      return {
        ok: true,
        snapshot,
        screenshot: screenshotPath
          ? {
              format: 'png',
              width: state.screenshot?.width ?? 0,
              height: state.screenshot?.height ?? 0,
              scale: 1,
              path: path.relative(connection.workspaceRoot, screenshotPath),
              engine: this.id,
            }
          : null,
      };
    } catch (err) {
      return refuse(this.errorRefusal(err));
    }
  }

  /**
   * Deterministic verification, delegated to the driver's `verify_state`.
   *
   * The driver evaluates the predicate against live window state and reports
   * satisfied / unsatisfied / unknown. That third value is the reason this
   * exists: every UIA write comes back `unverifiable`, and re-reading the value
   * asks the same provider that may have discarded it. This asks a different
   * question of a different code path.
   */
  async verify(handle: ComputerHandle, req: VerifyRequest, signal?: AbortSignal): Promise<VerifyResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { outcome: 'unknown', results: [], refusal: disconnected() };

    try {
      const windowId = await this.resolveWindowId(connection, req.app.pid, req.window);
      if (windowId === null) {
        return {
          outcome: 'unknown',
          results: [],
          refusal: { code: 'target_lost', message: 'That window is no longer open.' },
        };
      }

      const result = await this.call(
        connection,
        'verify_state',
        {
          pid: req.app.pid,
          window_id: windowId,
          expect: req.expect.map((p) => ({
            element: {
              selector: {
                ...(p.selector.role ? { role: p.selector.role } : {}),
                ...(p.selector.labelContains ? { label_contains: p.selector.labelContains } : {}),
              },
              ...(p.valueEquals !== undefined ? { value_equals: p.valueEquals } : {}),
              ...(p.exists ? { exists: true } : {}),
              ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
              ...(p.selected !== undefined ? { selected: p.selected } : {}),
            },
          })),
          ...(req.stableSamples ? { stable_samples: req.stableSamples } : {}),
          ...(req.timeoutMs ? { timeout_ms: req.timeoutMs } : {}),
        },
        signal,
      );

      const refusal = this.refusalFor(result);
      if (refusal) return { outcome: 'unknown', results: [], refusal };
      return parseVerifyState(this.requireStructured(result));
    } catch (err) {
      return { outcome: 'unknown', results: [], refusal: this.errorRefusal(err) };
    }
  }

  // ── Trajectory recording ─────────────────────────────────────
  //
  // The recorder lives in the daemon and is global to it, not scoped to our
  // session: it captures every action tool call that reaches the daemon while
  // enabled, and `stop_recording` stops whatever is running. That is the
  // driver's contract, not a simplification here.

  async startRecording(handle: ComputerHandle, req: RecordingRequest): Promise<RecordingState> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { recording: false, refusal: disconnected() };

    try {
      const result = await this.call(connection, 'start_recording', {
        output_dir: req.outputDir,
        ...(req.video ? { record_video: true } : {}),
      });
      const refusal = this.refusalFor(result);
      if (refusal) return { recording: false, refusal };
      return { ...parseRecordingState(this.structuredOrNull(result)), outputDir: req.outputDir };
    } catch (err) {
      return { recording: false, refusal: this.errorRefusal(err) };
    }
  }

  async stopRecording(handle: ComputerHandle): Promise<RecordingState> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { recording: false, refusal: disconnected() };

    try {
      const result = await this.call(connection, 'stop_recording', {});
      const refusal = this.refusalFor(result);
      if (refusal) return { recording: false, refusal };
      return parseRecordingState(this.structuredOrNull(result));
    } catch (err) {
      return { recording: false, refusal: this.errorRefusal(err) };
    }
  }

  /**
   * Names the lock screen when it is the reason a foreground swap failed.
   *
   * A locked workstation owns the foreground, so `SetForegroundWindow` can
   * never succeed and every Electron/Chromium action is refused. The driver
   * reports only the HWND that won, which reads like a driver fault — measured
   * as a whole run of `foreground_unavailable` refusals that were really just
   * a locked screen.
   */
  private async explainForegroundFailure(
    connection: Connection,
    refusal: ComputerRefusal,
  ): Promise<ComputerRefusal> {
    try {
      const result = await this.call(connection, 'list_windows', {});
      const structured = this.structuredOrNull(result);
      if (!structured) return refusal;
      const byPid = parseListWindows(structured);
      const locked = [...byPid.values()].some((list) =>
        list.some((w) => /lock ?screen/i.test(w.title)),
      );
      if (!locked) return refusal;
      return {
        code: refusal.code,
        message:
          'The workstation is locked, so Windows will not let any window come to the foreground. ' +
          'Actions that need real input cannot run until it is unlocked. Background actions — ' +
          'reading windows, element clicks, menus — still work. Tell the user to unlock and stop.',
      };
    } catch {
      return refusal;
    }
  }

  /**
   * Reports a locked workstation as a health check of its own.
   *
   * The driver has no lock signal, and the failure it does surface names only
   * the HWND that held the foreground. Measured while locked, that HWND is the
   * lock screen: background work (reading, element clicks, menus) keeps working,
   * while anything Chromium/Electron is refused for the whole run. Saying so up
   * front is the difference between one clear line and a page of refusals.
   */
  private async lockCheck(connection: Connection): Promise<ComputerRuntimeCheck[]> {
    try {
      const result = await this.call(connection, 'list_windows', {});
      const structured = this.structuredOrNull(result);
      if (!structured) return [];
      const locked = [...parseListWindows(structured).values()].some((list) =>
        list.some((w) => /lock ?screen/i.test(w.title)),
      );
      return locked
        ? [
            {
              name: 'workstation_unlocked',
              status: 'fail',
              message:
                'The workstation is locked. Reading windows and element actions still work; anything needing real keyboard or mouse input does not, because Windows will not bring a window to the foreground.',
            },
          ]
        : [];
    } catch {
      return [];
    }
  }

  /** Main display in physical pixels, or null when the driver cannot say. */
  async screenSize(handle: ComputerHandle): Promise<{ width: number; height: number } | null> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) {
      this.options.logger.warn?.('[CuaDriverBridge] screenSize: no connection');
      return null;
    }
    try {
      const result = await this.call(connection, 'get_screen_size', {});
      const structured = this.structuredOrNull(result) ?? result.text ?? null;
      if (!structured) {
        this.options.logger.warn?.('[CuaDriverBridge] screenSize: driver returned no payload');
        return null;
      }
      const root = JSON.parse(structured) as { width?: unknown; height?: unknown };
      const width = Number(root.width);
      const height = Number(root.height);
      if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
        this.options.logger.warn?.(`[CuaDriverBridge] screenSize: unusable payload ${structured}`);
        return null;
      }
      return { width, height };
    } catch (err) {
      this.options.logger.warn?.(`[CuaDriverBridge] screenSize failed: ${String(err)}`);
      return null;
    }
  }

  async recordingState(handle: ComputerHandle): Promise<RecordingState> {    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { recording: false, refusal: disconnected() };

    try {
      const result = await this.call(connection, 'get_recording_state', {});
      const refusal = this.refusalFor(result);
      if (refusal) return { recording: false, refusal };
      return parseRecordingState(this.structuredOrNull(result));
    } catch (err) {
      return { recording: false, refusal: this.errorRefusal(err) };
    }
  }

  async act(handle: ComputerHandle, req: ActionRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return refuse(disconnected());
    const started = Date.now();

    try {
      const call = await this.buildCall(connection, req);
      if ('refusal' in call) return refuse(call.refusal);

      let result = await this.call(connection, call.tool, call.args, signal);
      let refusal = this.refusalFor(result);
      if (refusal) {
        // Some window classes only accept real input — Chrome's
        // `Chrome_WidgetWin_1` ignores posted keystrokes entirely — and the
        // driver says so verbatim, naming `delivery_mode: "foreground"` as the
        // fix. It activates the target for the action and restores the previous
        // foreground afterwards, which is why this is safe to do automatically
        // for an action whose synthetic consent the user already granted.
        if (!wantsForegroundDelivery(result)) return refuse(refusal);
        result = await this.call(connection, call.tool, { ...call.args, delivery_mode: 'foreground' }, signal);
        refusal = this.refusalFor(result);
        if (refusal) return refuse(await this.explainForegroundFailure(connection, refusal));
      }

      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: {
          path: mapRoute(result.action?.route),
          actionName: call.tool,
          verification:
            result.action?.effect === EFFECT_CONFIRMED
              ? { state: 'verified', property: req.type === 'setValue' ? 'value' : undefined }
              : { state: 'unverified', reason: req.type === 'pasteText' ? 'clipboard_paste' : 'synthetic_input' },
          durationMs: Date.now() - started,
          // Only carried when the driver volunteered one, and only for rungs we
          // did not already take on the agent's behalf.
          ...(() => {
            const next = nextStepFrom(result);
            return next && next.rung !== 'foreground' ? { nextStep: next } : {};
          })(),
        },
      };
    } catch (err) {
      return refuse(this.errorRefusal(err));
    }
  }

  // ── Request translation ──────────────────────────────────────

  private async buildCall(
    connection: Connection,
    req: ActionRequest,
  ): Promise<{ tool: string; args: Json } | { refusal: ComputerRefusal }> {
    // Element-addressed: hand the driver its own snapshot id and index. It
    // re-resolves the element through UIA, so a window that moved since the
    // snapshot still gets the right control rather than a stale coordinate.
    //
    // `pid` and `window_id` travel with it: the driver scopes snapshots per
    // window and rejects an element reference that arrives without the owning
    // process ("Missing required integer field: pid").
    if (isElementAddressed(req)) {
      const cached = this.snapshotScopes.get(req.snapshotId);
      if (!cached) {
        return {
          refusal: { code: 'stale_snapshot', message: 'That snapshot is no longer held by the driver client.' },
        };
      }
      // Only `set_value` is fenced here. The driver's contract is explicit
      // that UIA dispatch works on a minimised window, and refusing every
      // element-addressed call made the agent activate windows it never needed
      // to — the foreground steal the tier ladder exists to avoid. The fence
      // stays on the one operation where the failure was observed: 24 writes
      // to a minimised Excel grid reported success, read back correctly, and
      // vanished on restore.
      if (req.type === 'setValue') {
        const phantom = phantomValueWrite(cached.roles.get(req.elementIndex));
        if (phantom) return { refusal: phantom };
        const dead = await this.ensureLiveWindow(connection, cached.pid, cached.windowId);
        if (dead) return { refusal: dead };
      }
      const scope = { pid: cached.pid, window_id: cached.windowId, snapshot_id: req.snapshotId };
      // The token carries (index, snapshot, window) in one handle the driver
      // can invalidate on its own terms. Index is kept alongside it as the
      // compatibility path for a provider that minted no token.
      const token = cached.tokens.get(req.elementIndex);
      const addressed = token
        ? { ...scope, element_token: token, element_index: req.elementIndex }
        : { ...scope, element_index: req.elementIndex };

      if (req.type === 'click') {
        return {
          tool: req.button === 'right' ? 'right_click' : req.clickCount === 2 ? 'double_click' : 'click',
          args: addressed,
        };
      }
      if (req.type === 'setValue') {
        return {
          tool: 'set_value',
          args: { ...addressed, value: req.value },
        };
      }
      // The driver exposes menus, not arbitrary named accessibility actions.
      return {
        tool: 'invoke_menu',
        args: { ...scope, path: req.actionName.split('>').map((s) => s.trim()) },
      };
    }

    const pid = req.target.app.pid;
    const windowId = await this.resolveWindowId(connection, pid, req.target.window);
    if (windowId === null) {
      return { refusal: { code: 'target_lost', message: 'That window is no longer open.' } };
    }
    // Coordinates of a minimised window describe nothing on screen, and every
    // action below this line is synthetic input aimed at the real display.
    const dead = await this.ensureLiveWindow(connection, pid, windowId);
    if (dead) return { refusal: dead };
    const target = { pid, window_id: windowId };

    switch (req.type) {
      case 'clickPoint':
        return {
          tool: req.button === 'right' ? 'right_click' : 'click',
          args: { ...target, x: req.x, y: req.y },
        };
      case 'typeText': {
        // XAML/WinUI hosts drop WM_CHAR, so the driver needs the element to
        // write through ValuePattern instead. It rejects the pair unless the
        // window agrees, so the cached scope wins over the resolved window.
        const cached = req.element ? this.snapshotScopes.get(req.element.snapshotId) : undefined;
        if (req.element && !cached) {
          return {
            refusal: { code: 'stale_snapshot', message: 'That snapshot is no longer held by the driver client.' },
          };
        }
        const addressed =
          req.element && cached
            ? {
                pid: cached.pid,
                window_id: cached.windowId,
                snapshot_id: req.element.snapshotId,
                element_index: req.element.elementIndex,
                ...(cached.tokens.get(req.element.elementIndex)
                  ? { element_token: cached.tokens.get(req.element.elementIndex) }
                  : {}),
              }
            : target;
        return {
          tool: 'type_text',
          args: { ...addressed, text: req.text, ...(req.focus ? { x: req.focus.x, y: req.focus.y } : {}) },
        };
      }
      case 'pressKey': {
        const focus = req.focus ? { x: req.focus.x, y: req.focus.y } : {};
        return req.modifiers && req.modifiers.length > 0
          ? {
              tool: 'hotkey',
              args: { ...target, keys: [...req.modifiers.map(toDriverKey), req.key.toLowerCase()], ...focus },
            }
          : { tool: 'press_key', args: { ...target, key: req.key, ...focus } };
      }
      case 'pasteText':
        return { tool: 'paste', args: { ...target, text: req.text } };
      case 'scroll': {
        const vertical = Math.abs(req.deltaY) >= Math.abs(req.deltaX);
        const delta = vertical ? req.deltaY : req.deltaX;
        return {
          tool: 'scroll',
          args: {
            ...target,
            direction: vertical ? (delta < 0 ? 'up' : 'down') : delta < 0 ? 'left' : 'right',
            amount: Math.max(1, Math.round(Math.abs(delta) / 120)),
          },
        };
      }
      case 'drag':
        return {
          tool: 'drag',
          args: { ...target, from_x: req.from.x, from_y: req.from.y, to_x: req.to.x, to_y: req.to.y },
        };
    }
  }

  /**
   * Clipboard paste with save/restore.
   *
   * Leaving the agent's text on the clipboard would mean the user's next
   * paste — into anything — silently emits it.
   */
  private async paste(connection: Connection, args: Json, signal?: AbortSignal): Promise<DriverToolResult> {
    let previous: string | undefined;
    try {
      const read = await this.call(connection, 'clipboard_read', { include_text: true }, signal);
      if (!read.isError) previous = read.text;
    } catch {
      // Unreadable clipboard only means the restore below is best-effort.
    }
    try {
      const write = await this.call(connection, 'clipboard_write', { text: args['text'] }, signal);
      if (write.isError) return write;
      return await this.call(
        connection,
        'hotkey',
        { pid: args['pid'], window_id: args['window_id'], keys: ['ctrl', 'v'] },
        signal,
      );
    } finally {
      if (previous !== undefined) {
        await this.call(connection, 'clipboard_write', { text: previous }).catch(() => undefined);
      }
    }
  }

  /**
   * Makes a window safe to write to, restoring it if that is what it takes.
   *
   * A minimised window still exposes a UIA tree, and reading it is fine — the
   * driver's contract says so explicitly. Writing to it is not: a `set_value`
   * reports success, reads back the value it just wrote, and is discarded the
   * moment the window renders. Verified against Excel, where 24 "successful"
   * writes vanished on restore.
   *
   * Restoring here rather than refusing is not a new privilege. The refusal
   * this replaces named `computer_bring_to_front` as the fix, so the agent
   * always took exactly this action next — it just cost a refused call, a
   * restore call and a re-snapshot to get there, three times over in a single
   * Excel run. Same end state, same consent, three fewer round trips.
   */
  private async ensureLiveWindow(
    connection: Connection,
    pid: number,
    windowId: number,
    signal?: AbortSignal,
  ): Promise<ComputerRefusal | null> {
    const windows = await this.windowsFor(connection, pid);
    const window = windows.find((w) => w.id === windowId);
    if (!window) return { code: 'target_lost', message: 'That window is no longer open.' };
    if (!window.minimised) return null;

    this.options.logger.info?.(`[CuaDriverBridge] restoring minimised window ${windowId} before writing`);
    await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal);

    // Judged by observation, not by the driver's error flag: Windows refuses
    // foreground activation to a background process, so the driver reports
    // failure even when it restored the window — and restoring is the part
    // that matters, since it is what un-virtualises the accessibility tree.
    const after = await this.windowsFor(connection, pid);
    const restored = after.find((w) => w.id === windowId);
    if (!restored) return { code: 'target_lost', message: 'That window is no longer open.' };
    if (restored.minimised) {
      return {
        code: 'background_occluded',
        message:
          'That window is minimised and could not be restored, so a write to it would be silently discarded.',
      };
    }
    return null;
  }

  private async resolveWindowId(
    connection: Connection,
    pid: number,
    selector: SnapshotRequest['window'],
  ): Promise<number | null> {
    if (selector.by === 'id') return selector.id;
    const windows = await this.windowsFor(connection, pid);
    if (windows.length === 0) return null;
    if (selector.by === 'index') return windows[selector.index]?.id ?? null;
    // `focused` is the frontmost on-screen window by the driver's stacking
    // order. Falling back past it matters: a newly created window that has not
    // been raised yet is still addressable, because input does not need focus.
    return (windows.find((w) => w.focused) ?? windows.find((w) => !w.minimised) ?? windows[0])?.id ?? null;
  }

  private async windowsFor(connection: Connection, pid: number) {
    const result = await this.call(connection, 'list_windows', { pid, on_screen_only: false });
    if (result.isError || !result.structuredJson) return [];
    return parseListWindows(result.structuredJson).get(pid) ?? [];
  }

  /** Bounded so a long read-only session cannot grow this without limit. */
  private rememberScope(
    snapshotId: string,
    pid: number,
    windowId: number,
    elements: readonly ComputerElement[],
  ): void {
    const tokens = new Map<number, string>();
    const roles = new Map<number, string>();
    for (const element of elements) {
      if (element.token) tokens.set(element.index, element.token);
      roles.set(element.index, element.role);
    }
    this.snapshotScopes.set(snapshotId, { pid, windowId, tokens, roles });
    while (this.snapshotScopes.size > 32) {
      const oldest = this.snapshotScopes.keys().next().value;
      if (oldest === undefined) break;
      this.snapshotScopes.delete(oldest);
    }
  }

  async launchApp(
    handle: ComputerHandle,
    name: string,
    opts: { url?: string; newInstance?: boolean; args?: readonly string[] } = {},
    signal?: AbortSignal,
  ): Promise<LaunchAppResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return { refusal: disconnected() };
    try {
      // Windows already on screen for this executable, so the one the launch
      // adds can be told apart from the user's existing windows.
      const before = new Set<number>();
      try {
        const existing = await this.call(connection, 'list_apps', {});
        if (existing.structuredJson) {
          for (const app of parseListApps(existing.structuredJson)) {
            if (!matchesLaunchName(app, name)) continue;
            for (const w of await this.windowsFor(connection, app.pid)) before.add(w.id);
          }
        }
      } catch {
        // A failed pre-scan only costs us the ability to name the new window.
      }
      const result = await this.call(
        connection,
        'launch_app',
        {
          name,
          ...(opts.url ? { urls: [opts.url] } : {}),
          ...(opts.args && opts.args.length > 0
            ? { additional_arguments: opts.args.map(quoteArgument) }
            : {}),
          // Single-instance apps hand every caller the same window, so two
          // concurrent runs otherwise clobber each other's work.
          ...(opts.newInstance ? { creates_new_application_instance: true } : {}),
        },
        signal,
      );
      const refusal = this.refusalFor(result);
      if (refusal) return { refusal };

      // The driver returns once the process is spawned, which is well before
      // the window exists. Poll rather than sleep a fixed amount: Office cold
      // start varies by an order of magnitude between first and later runs.
      const deadline = Date.now() + 30_000;
      // A single-instance app hands the request to a process that is already
      // running, so the window it opens for us appears a few seconds later
      // among the ones it already had. Only worth waiting for when we actually
      // asked it to open something.
      const wantsNewWindow = (opts.args?.length ?? 0) > 0;
      const freshDeadline = Date.now() + 5_000;
      let fallback: LaunchAppResult | undefined;
      while (Date.now() < deadline) {
        const listed = await this.call(connection, 'list_apps', {});
        if (listed.structuredJson) {
          const apps = parseListApps(listed.structuredJson);
          const match = apps.find((a: ComputerAppInfo) => matchesLaunchName(a, name));
          if (match) {
            const windows = await this.windowsFor(connection, match.pid);
            if (windows.length > 0) {
              // Deliberately NOT brought to front. The driver launches with
              // SW_SHOWNOACTIVATE precisely so the user keeps their screen, and
              // reading and clicking work on a background window; only a write
              // to a MINIMISED window is unsafe, and that path refuses on its own.
              const app = { appId: match.id, name: match.name, pid: match.pid };
              const fresh = windows.find((w) => !before.has(w.id));
              if (fresh) return { app, window: { id: fresh.id, title: fresh.title } };
              const chosen = windows.find((w) => w.focused) ?? windows[0];
              fallback = { app, ...(chosen ? { window: { id: chosen.id, title: chosen.title } } : {}) };
              if (!wantsNewWindow || before.size === 0 || Date.now() >= freshDeadline) return fallback;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (fallback) return fallback;
      return {
        refusal: {
          code: 'target_lost',
          message: `${name} was launched but did not open a window within 30 seconds.`,
        },
      };
    } catch (err) {
      return { refusal: this.errorRefusal(err) };
    }
  }

  async bringToFront(
    handle: ComputerHandle,
    app: ComputerAppIdentity,
    signal?: AbortSignal,
  ): Promise<ComputerActionResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return refuse(disconnected());
    try {
      const windows = await this.windowsFor(connection, app.pid);
      if (windows.length === 0) {
        return refuse({ code: 'target_lost', message: 'That application has no windows.' });
      }
      // Prefer a window the user would consider "the" window: the last one
      // restored wins, so pick the largest non-minimised, else the first.
      const target = windows.find((w) => !w.minimised) ?? windows[0]!;
      const result = await this.call(
        connection,
        'bring_to_front',
        { pid: app.pid, window_id: target.id },
        signal,
      );

      // Judged by observation, not by the driver's error flag. Windows refuses
      // foreground activation to a background process, so the driver reports
      // "foreground activation failed" even when it successfully restored and
      // raised the window — and restoring is the part that matters here, since
      // it is what un-virtualises the accessibility tree.
      const after = await this.windowsFor(connection, app.pid);
      const restored = after.find((w) => w.id === target.id);
      if (!restored) return refuse({ code: 'target_lost', message: 'That window is no longer open.' });
      if (restored.minimised) {
        return refuse({
          code: 'background_occluded',
          message: result.text || 'The window could not be restored.',
        });
      }

      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: {
          path: 'accessibility',
          actionName: 'bring_to_front',
          verification: restored.focused
            ? { state: 'verified', property: 'focusedText' }
            : { state: 'unverified', reason: 'window_changed' },
        },
      };
    } catch (err) {
      return refuse(this.errorRefusal(err));
    }
  }

  // ── Internals ────────────────────────────────────────────────

  private async call(
    connection: Connection,
    tool: string,
    args: Json,
    signal?: AbortSignal,
  ): Promise<DriverToolResult> {
    if (tool === 'paste') return this.paste(connection, args, signal);
    const invoke = () => {
      const payload = JSON.stringify({ session: connection.sessionId, ...args });
      return connection.client.callTool(tool, payload, signal ? { signal } : undefined);
    };

    const result = await invoke();
    if (!isSessionEnded(result)) return result;

    // The driver retires sessions on its own — idle expiry, an external
    // shutdown, a host restart. Nothing above this layer can tell: the cached
    // connection still looks live, so every later call failed forever with
    // `provider_unavailable` and the agent dead-ended mid-task. Re-open the
    // same label and retry once.
    this.options.logger.info?.(
      `[CuaDriverBridge] session ${connection.sessionId} was retired by the driver; reopening`,
    );
    // Element indices were minted by the dead session and mean nothing now.
    this.snapshotScopes.clear();
    await connection.client.startSession({ session: connection.sessionId, captureScope: CAPTURE_WINDOW });
    await this.applyAgentCursor(connection.client, connection.sessionId);
    return invoke();
  }

  /**
   * Turns the agent cursor on and, when configured, gives it our colour.
   *
   * Both are cosmetic and neither may block a session: a driver that refuses
   * the overlay still drives the desktop correctly, it just does so invisibly.
   */
  private async applyAgentCursor(client: DriverClient, sessionId: string): Promise<void> {
    try {
      const cursor = await client.callTool(
        'set_agent_cursor_enabled',
        JSON.stringify({ session: sessionId, enabled: true }),
      );
      if (cursor.isError) {
        this.options.logger.debug?.(`[CuaDriverBridge] agent cursor refused: ${cursor.errorCode ?? cursor.text}`);
        return;
      }
      if (!this.options.cursorThemeId) return;

      // A distinct colour is the whole point: the user has to be able to tell
      // the agent's pointer from their own at a glance.
      const theme = await client.callTool(
        'set_agent_cursor_theme',
        JSON.stringify({ session: sessionId, theme_id: this.options.cursorThemeId }),
      );
      if (theme.isError) {
        this.options.logger.warn?.(
          `[CuaDriverBridge] cursor theme '${this.options.cursorThemeId}' refused: ${theme.errorCode ?? theme.text}`,
        );
      }

      // The driver hides the cursor after 20 s of stillness, which is most of a
      // run: the agent spends far longer reading trees and waiting on the model
      // than moving. The user then sees the pointer vanish and reads it as the
      // agent having stopped. Keep it on screen for the life of the session.
      const motion = await client.callTool(
        'set_agent_cursor_motion',
        JSON.stringify({ session: sessionId, idle_hide_ms: AGENT_CURSOR_IDLE_HIDE_MS }),
      );
      if (motion.isError) {
        this.options.logger.debug?.(
          `[CuaDriverBridge] agent cursor motion refused: ${motion.errorCode ?? motion.text}`,
        );
      }
    } catch (error) {
      this.options.logger.debug?.(`[CuaDriverBridge] agent cursor unavailable: ${String(error)}`);
    }
  }

  private async loadModule(): Promise<DriverModule | null> {
    if (this.options.driverModule) return this.options.driverModule;
    this.modulePromise ??= import('@trycua/cua-driver')
      .then((mod) => mod as unknown as DriverModule)
      .catch((err: Error) => {
        this.options.logger.info?.(
          `[CuaDriverBridge] cua-driver SDK unavailable on this platform: ${err.message}`,
        );
        return null;
      });
    return this.modulePromise;
  }

  private async screenshotPath(connection: Connection, workspaceId: string): Promise<string> {
    // Absolute: the driver's working directory is not the workspace, so a
    // relative path would write outside it and the artifact write would then
    // silently drop the file.
    const dir = path.join(connection.workspaceRoot, this.options.screenshotDir ?? 'computer');
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, `${workspaceId}-${Date.now()}.png`);
  }

  private requireStructured(result: DriverToolResult): string {
    if (!result.structuredJson) throw new UnrecognisedDriverPayloadError('response', []);
    return result.structuredJson;
  }

  /** For payloads whose absence is informational rather than a fault. */
  private structuredOrNull(result: DriverToolResult): string | null {
    return result.structuredJson ?? null;
  }

  private refusalFor(result: DriverToolResult): ComputerRefusal | null {
    if (result.action?.effect === EFFECT_REFUSED || result.isError) {
      return {
        code: REFUSAL_BY_ERROR_CODE[result.errorCode ?? ''] ?? 'provider_unavailable',
        message: result.text || `The driver reported an error (${result.errorCode ?? 'unknown'}).`,
      };
    }    if (result.action?.effect === EFFECT_SUSPECTED_NOOP) {
      // Reporting this as success is how a write that changed nothing ends up
      // in the audit trail as a completed mutation.
      return {
        code: 'target_lost',
        message: result.text || 'The driver believes that action changed nothing.',
      };
    }    return null;
  }

  private errorRefusal(err: unknown): ComputerRefusal {
    if (err instanceof UnrecognisedDriverPayloadError) {
      this.options.logger.error?.(`[CuaDriverBridge] ${err.message}`);
      return { code: 'provider_unavailable', message: err.message };
    }
    const error = err as Error & { name?: string };
    if (error?.name === 'AbortError') {
      return { code: 'capacity_exhausted', message: 'The action was cancelled after exceeding its time budget.' };
    }
    this.options.logger.warn?.(`[CuaDriverBridge] driver call failed: ${error?.message ?? String(err)}`);
    return { code: 'provider_unavailable', message: error?.message ?? 'The computer-use driver is unreachable.' };
  }
}

type Json = Record<string, unknown>;

function refuse(refusal: ComputerRefusal): ComputerActionResult {
  return { ok: false, snapshot: null, screenshot: null, refusal };
}

function disconnected(): ComputerRefusal {
  return { code: 'provider_unavailable', message: 'No computer-use session is connected for this workspace.' };
}

/**
 * Grid cells accept a UIA `ValuePattern` write, report success, and echo the
 * value back on every later read — while the cell stays empty on screen.
 *
 * Measured on Excel: `set_value` on D9 returned `effect: unverifiable`, the
 * next `get_window_state` reported `D9 = "PHANTOM-CHECK"`, and the screenshot
 * showed an empty cell. Read-back cannot catch this because it goes through the
 * provider that accepted the write, so the only honest move is to refuse before
 * dispatch and name the route that does work.
 *
 * `DataItem` is the role every grid cell reports — spreadsheet cells and
 * Explorer list rows alike. Neither is writable this way.
 */
function phantomValueWrite(role: string | undefined): ComputerRefusal | null {
  if (role?.toLowerCase() !== 'dataitem') return null;
  return {
    code: 'background_unavailable',
    message:
      'Grid cells silently discard value writes — the provider reports success and echoes the value back while ' +
      'the cell stays empty. Select the cell and type instead: computer_click it, computer_type_text the value, ' +
      'then computer_press_key Enter to commit.',
  };
}

/**
 * What the daemon is allowed to inherit.
 *
 * An allowlist rather than the whole environment, because this process holds
 * provider tokens. But not empty either: the driver keeps its per-user state
 * (installed cursor themes, config) under these paths, and without them it
 * silently falls back to built-in defaults. `PATH` is here because trajectory
 * video shells out to ffmpeg.
 *
 * The driver enforces its own allowlist on top of this and refuses to start at
 * all when a name is not on it — `USERPROFILE` is rejected, which is why the
 * home directory is only used to derive the two paths below.
 */
const DAEMON_ENV_ALLOWLIST =
  process.platform === 'win32'
    ? ['PATH', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'SystemRoot']
    : ['PATH', 'HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY'];

/**
 * Directory of an ffmpeg the daemon would otherwise miss, or null.
 *
 * `start_recording { record_video: true }` shells out to ffmpeg and needs it on
 * PATH. A dev server launched from a shell that predates the install inherits a
 * PATH without it, and the driver then records turn screenshots but no video,
 * reporting the reason only in `last_error`. The driver's own `install_ffmpeg`
 * runs winget, which is blocked outright on managed machines.
 */
function findFfmpegDir(): string | null {
  if (process.platform !== 'win32') return null;
  const onPath = (process.env['PATH'] ?? '').split(path.delimiter);
  for (const dir of onPath) {
    if (dir && existsSync(path.join(dir, 'ffmpeg.exe'))) return null;
  }
  const local = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  for (const root of [path.join(local, 'ffmpeg'), path.join(local, 'Microsoft', 'WinGet', 'Packages')]) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const bin = path.join(root, entry, 'bin');
      if (existsSync(path.join(bin, 'ffmpeg.exe'))) return bin;
    }
  }
  return null;
}

function daemonEnvironment(): Array<{ name: string; value: string }> {
  const env: Array<{ name: string; value: string }> = [];
  for (const name of DAEMON_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value) env.push({ name, value });
  }
  const ffmpegDir = findFfmpegDir();
  if (ffmpegDir) {
    const entry = env.find((e) => e.name === 'PATH');
    if (entry) entry.value = `${ffmpegDir}${path.delimiter}${entry.value}`;
    else env.push({ name: 'PATH', value: ffmpegDir });
  }
  // Task runners and service managers routinely drop these. The driver then
  // reports "LOCALAPPDATA is unavailable" and loses its theme store, so derive
  // them from the home directory rather than letting that happen silently.
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? os.homedir();
  if (!home) return env;
  if (process.platform === 'win32') {
    if (!process.env['LOCALAPPDATA']) env.push({ name: 'LOCALAPPDATA', value: path.join(home, 'AppData', 'Local') });
    if (!process.env['APPDATA']) env.push({ name: 'APPDATA', value: path.join(home, 'AppData', 'Roaming') });
  } else if (!process.env['HOME']) {
    env.push({ name: 'HOME', value: home });
  }
  return env;
}

/**
 * The driver has no error code for "your session label is gone", so the text
 * is the only signal. Matched narrowly: treating any error as session loss
 * would turn every genuine refusal into a silent reconnect.
 */
function isSessionEnded(result: DriverToolResult): boolean {
  if (!result.isError) return false;
  return /session has ended|unknown session|no such session|session not found/i.test(result.text ?? '');
}

/** The driver's `escalation.recommended`, in this API's vocabulary. */
function nextStepFrom(
  result: DriverToolResult,
): { rung: 'coordinate' | 'foreground' | 'browser'; reason: string } | null {
  if (!result.structuredJson) return null;
  try {
    const root = JSON.parse(result.structuredJson) as {
      escalation?: { recommended?: unknown; reason?: unknown };
    };
    const recommended = root.escalation?.recommended;
    const reason = typeof root.escalation?.reason === 'string' ? root.escalation.reason : '';
    if (recommended === 'px') return { rung: 'coordinate', reason };
    if (recommended === 'foreground') return { rung: 'foreground', reason };
    if (recommended === 'page') return { rung: 'browser', reason };
    return null;
  } catch {
    return null;
  }
}

/**
 * The driver tells us when background delivery cannot work for a window class.
 *
 * Prefer its structured `escalation.recommended`, which is the contract; fall
 * back to the refusal prose, which is all some refusals carry. Keyed off the
 * driver's own instruction either way, so we never escalate to foreground for
 * a refusal the driver did not say foreground would fix.
 */
function wantsForegroundDelivery(result: DriverToolResult): boolean {
  if (nextStepFrom(result)?.rung === 'foreground') return true;
  return /delivery_mode\s*[:=]\s*"?foreground/i.test(result.text ?? '');
}

/**
 * Fallback caps, tried in order, when the provider cannot finish a tree walk.
 * Excel's grid answers the last rung in about a second after timing out above
 * it; the middle rung exists so a merely-busy app is not stripped to nothing.
 */
const SCAN_LADDER: ReadonlyArray<readonly [number, number]> = [
  [200, 8],
  [50, 3],
];

/**
 * A tree walk the provider could not finish in time. The driver's own advice is
 * to retry depth-limited, so this matches its wording rather than a code — the
 * timeout arrives as a generic error.
 */
function wantsShallowScan(result: DriverToolResult): boolean {
  if (!result.isError) return false;
  const text = result.text ?? '';
  return /UIA provider unresponsive/i.test(text) || /depth-limited scan/i.test(text);
}

/**
 * Quotes one launch argument for the driver.
 *
 * `additional_arguments` are joined into a single ShellExecuteEx parameter
 * string, so an unquoted path containing spaces arrives at the target as
 * several arguments. Measured against VS Code: passing
 * `C:\Users\me\Desktop\New folder (2)\proj` opened an empty "New" window and
 * resolved the fragments `folder` and `(2)\proj` relative to the DRIVER's
 * working directory, creating stray folders there — while the run carried on
 * against whatever window it found.
 */
function quoteArgument(arg: string): string {
  if (arg.startsWith('"') && arg.endsWith('"') && arg.length > 1) return arg;
  if (!/[\s"]/u.test(arg)) return arg;
  // Windows command lines escape an embedded quote, and any run of backslashes
  // immediately before one, with a backslash.
  const escaped = arg.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1');
  return `"${escaped}"`;
}

/**
 * Matches a freshly launched process against the name the caller asked for.
 *
 * The driver reports Office as "EXCEL.EXE" while users and models say "Excel",
 * so an exact comparison would never find the window we just opened.
 */
function matchesLaunchName(
  app: { id: string; name: string; executablePath?: string },
  requested: string,
): boolean {
  const needle = requested.trim().toLowerCase().replace(/\.exe$/u, '');
  if (!needle) return false;
  return [app.name, app.id, app.executablePath ?? '']
    .map((v) => v.toLowerCase())
    .some((h) => h.length > 0 && h.includes(needle));
}

/** Our closed modifier union → the driver's lower-case key names. */
function toDriverKey(modifier: string): string {
  switch (modifier) {
    case 'Control':
      return 'ctrl';
    case 'Meta':
      return process.platform === 'darwin' ? 'cmd' : 'win';
    default:
      return modifier.toLowerCase();
  }
}

function mapRoute(route: number | undefined): ComputerActionPath {
  switch (route) {
    case ROUTE_ACCESSIBILITY:
      return 'accessibility';
    case ROUTE_SYSTEM_API:
    case ROUTE_DOM:
    case ROUTE_TRUSTED_INPUT:
      return 'hit-tested';
    case ROUTE_SYNTHETIC_EVENTS:
    case ROUTE_GLOBAL_INPUT:
      return 'synthetic';
    default:
      // An unreported route is treated as the least trustworthy tier, so an
      // unverifiable action is never presented as a semantic one.
      return 'synthetic';
  }
}
