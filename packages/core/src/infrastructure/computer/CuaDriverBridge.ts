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
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
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
  ComputerWindowInfo,
  ILogger,
} from '@generatorai/shared';
import { CUA_DRIVER_PACING_ENVIRONMENT } from '@generatorai/shared';
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
import type { SaveAsRequest, SaveAsResult } from '../../domain/ports/IComputerBridge.js';
import { isElementAddressed } from '../../domain/ports/IComputerBridge.js';
import {
  UnrecognisedDriverPayloadError,
  parseListApps,
  parseListWindows,
  parseRecordingState,
  parseVerifyState,
  parseWindowState,
  unreadableWindow,
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
      approveCapabilityManifest: boolean;
      approveSessionPolicy: boolean;
      dangerouslyBypassApprovals: boolean;
      environment: unknown[];
      inheritStderr: boolean;
      noOverlay: boolean;
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
 * How long the agent cursor stays visible while nothing moves: 0 = never hides.
 *
 * The driver's default (15 s) is shorter than the gaps between a model's tool
 * calls, so the pointer vanished mid-task and the run looked abandoned. It
 * leaves with the session.
 */
const AGENT_CURSOR_IDLE_HIDE_MS = 0;

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
  /** macOS: activates an app by bundle id as a Dock click does (LaunchServices). Replaced in tests. */
  reopenApp?: (bundleId: string) => Promise<void>;
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
  /** Apps a read of an untitled window crashed: their untitled windows are not read again. */
  private readonly crashedOnRead = new Set<string>();
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
  /**
   * Apps this bridge launched, by pid, kept while the process lives. macOS can
   * leave a relaunched app out of its running-apps list: TextEdit, revived
   * under the identity of an instance the system had automatically
   * terminated, ran with its document open while `list_apps` called it
   * stopped — every later call then answered "no app matched".
   */
  private readonly launched = new Map<number, ComputerAppInfo>();
  private readonly snapshotScopes = new Map<
    string,
    { pid: number; windowId: number; tokens: Map<number, string>; roles: Map<number, string>; epoch: number }
  >();
  /**
   * Per window (`pid:windowId`): the driver's newest read of it and that
   * read's shape. The driver stales every token once it reads the window
   * again, and the read after each action (`observe`) is such a read — so an
   * element from the agent's snapshot is addressed with the newest snapshot id
   * while the rows keep their indices (`epoch` unchanged). A full read or a
   * re-index starts a new epoch, and older snapshots are no longer rewritten.
   */
  private readonly windowReads = new Map<
    string,
    { latest: string; epoch: number; query?: string; maxElements: number; maxDepth: number }
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
          // No manifest is shipped, so there is nothing to pre-approve.
          approveCapabilityManifest: false,
          approveSessionPolicy: false,
          // Never true — it disables the driver's own approval gate, the last
          // line of defence if our service-side gates are ever bypassed.
          dangerouslyBypassApprovals: false,
          // An allowlist, not the inherited environment: this process holds
          // provider tokens the driver has no business seeing.
          environment: daemonEnvironment(),
          inheritStderr: false,
          // The agent cursor overlay shows the person where the agent is acting.
          noOverlay: false,
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
      return (root.checks ?? []).map((c) =>
        embeddedIdentity({
          name: typeof c.name === 'string' ? c.name : 'unknown',
          status: c.status === 'pass' || c.status === 'fail' ? c.status : 'skip',
          message: typeof c.message === 'string' ? c.message : '',
        }),
      );
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

      const windowsByPid = parseListWindows(this.requireStructured(winResult));
      const apps = withWindowOwners(
        this.withLaunched(parseListApps(this.requireStructured(appsResult))),
        appsResult.structuredJson,
        winResult.structuredJson,
      );
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

      // Some apps crash when their template chooser or start screen is read
      // through accessibility (measured: every read, even a filtered one).
      // Once a read of an untitled window has taken an app down, that app's
      // untitled windows are not read again.
      const untitled = (await this.windowsFor(connection, req.app.pid)).find((w) => w.id === windowId)?.title === '';
      if (untitled && this.crashedOnRead.has(req.app.appId)) {
        return refuse({
          code: 'unsupported_action',
          message:
            'Reading an untitled window of this app crashed it earlier. If it is a template chooser or start screen, ' +
            'press_key Return accepts its default — or computer_launch_app { newDocument: true } does that for you.',
        });
      }

      const screenshotPath = req.includeScreenshot
        ? await this.screenshotPath(connection, handle.workspaceId)
        : undefined;

      const args = (maxElements: number, maxDepth: number) => ({
        pid: req.app.pid,
        window_id: windowId,
        max_elements: maxElements,
        max_depth: maxDepth,
        // The structured rows are what the fence checks; the Markdown rendering
        // is what the agent reads — compact, with read-only text (a display)
        // and menus folded.
        tree_format: 'both',
        // The driver captures a screenshot unless told not to — every read paid
        // for an image nobody asked for.
        include_screenshot: Boolean(screenshotPath),
        // Its default budget (1 s) cuts Numbers' and Xcode's trees short.
        timeout_ms: SNAPSHOT_WALK_MS,
        ...(req.query ? { query: req.query } : {}),
        ...(screenshotPath ? { screenshot_out_file: screenshotPath } : {}),
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
      if (untitled) {
        await new Promise((r) => setTimeout(r, CRASH_SETTLE_MS));
        if (!processAlive(req.app.pid)) {
          this.crashedOnRead.add(req.app.appId);
          return refuse({
            code: 'target_lost',
            message:
              'The app quit while this untitled window was being read — some apps crash when a template chooser or ' +
              'start screen is read. Relaunch it with computer_launch_app { newDocument: true }, which accepts such ' +
              'windows with Return without reading them.',
          });
        }
      }
      const refusal = this.refusalFor(result);
      if (refusal) return refuse(refusal);

      const structured = this.requireStructured(result);
      // The driver's deliberate empty read (it could not tie the window to its accessibility tree): say why, and
      // what it recommends, instead of reporting a payload this build "does not recognise".
      const unreadable = unreadableWindow(structured);
      if (unreadable) {
        // No tree, but the driver still captured the window ("the screenshot in
        // this response IS the requested window"). Asked for pixels, hand them
        // over: that is the fallback for exactly this case — Freeform's welcome
        // window, a custom-drawn dialog — and refusing left the agent with
        // neither a tree nor an image to click by.
        if (screenshotPath && existsSync(screenshotPath)) {
          const root = JSON.parse(structured) as Record<string, unknown>;
          const width = typeof root['screenshot_width'] === 'number' ? root['screenshot_width'] : 0;
          const height = typeof root['screenshot_height'] === 'number' ? root['screenshot_height'] : 0;
          return {
            ok: true,
            snapshot: {
              snapshotId: `pixels-${windowId}-${Date.now()}`,
              app: { id: req.app.appId, name: req.app.name, pid: req.app.pid },
              window: { id: windowId, title: '', index: 0, focused: false },
              elements: [],
              tree: '',
              truncated: null,
              capturedAt: Date.now(),
            },
            screenshot: {
              format: 'png',
              width,
              height,
              scale: 1,
              path: path.relative(connection.workspaceRoot, screenshotPath),
              engine: this.id,
            },
          };
        }
        return refuse(unreadable);
      }
      const state = parseWindowState(structured, req.query !== undefined);
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
        ...(state.tree ? { tree: state.tree } : {}),
        ...(() => {
          const others = windows.filter((w) => w.id !== state.windowId && !w.floating && !w.minimised);
          return others.length > 0 ? { otherWindows: others.map((w) => ({ id: w.id, title: w.title })) } : {};
        })(),
        ...(state.text.length > 0 ? { text: state.text } : {}),
        ...(req.query !== undefined ? { totalElements: state.total } : {}),
        // A laddered read answered a *smaller question* — the driver reports it
        // as complete because it returned everything within the reduced caps.
        // Without saying so, the agent takes a depth-3 chrome-only tree for the
        // whole window and hunts for controls that were never enumerated.
        truncated:
          state.truncated ?? (laddered ? { elements: laddered[0], depth: laddered[1] } : null),
        capturedAt: Date.now(),
      };
      const windowKey = `${state.pid}:${state.windowId}`;
      const epoch = (this.windowReads.get(windowKey)?.epoch ?? 0) + 1;
      this.windowReads.set(windowKey, {
        latest: state.snapshotId,
        epoch,
        ...(req.query ? { query: req.query } : {}),
        maxElements: laddered?.[0] ?? req.maxElements ?? this.options.maxSnapshotElements,
        maxDepth: laddered?.[1] ?? req.maxDepth ?? this.options.maxSnapshotDepth,
      });
      this.rememberScope(state.snapshotId, state.pid, state.windowId, state.elements, epoch);

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

  async act(
    handle: ComputerHandle,
    req: ActionRequest,
    signal?: AbortSignal,
    opts: { observe?: boolean } = {},
  ): Promise<ComputerActionResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return refuse(disconnected());
    const started = Date.now();

    try {
      const call = await this.buildCall(connection, req);
      if ('refusal' in call) return refuse(call.refusal);
      if (call.tool === 'invoke_menu' && typeof call.args['pid'] === 'number' && typeof call.args['window_id'] === 'number') {
        await this.closeStrayMenu(connection, call.args['pid'], call.args['window_id'], signal);
      }

      let result = await this.call(connection, call.tool, call.args, signal);
      let refusal = this.refusalFor(result);
      // Not an error, yet not delivered: a keystroke posted to a native macOS
      // window in the background comes back "unverifiable" with an escalation
      // saying delivery failed and naming foreground. Reported as success, the
      // agent believed ⌘⇧G had opened "Go to folder" and typed a path into
      // nothing. Same rule as a refusal: the driver's own advice, once.
      if (
        !refusal &&
        FOREGROUND_CAPABLE.has(call.tool) &&
        call.args['delivery_mode'] !== 'foreground' &&
        deliveryFailed(result)
      ) {
        result = await this.call(connection, call.tool, { ...call.args, delivery_mode: 'foreground' }, signal);
        refusal = this.refusalFor(result);
        if (refusal) return refuse(await this.explainForegroundFailure(connection, refusal));
      }
      if (refusal) {
        // Some window classes only accept real input — Chrome's
        // `Chrome_WidgetWin_1` ignores posted keystrokes entirely — and the
        // driver says so verbatim, naming `delivery_mode: "foreground"` as the
        // fix. It activates the target for the action and restores the previous
        // foreground afterwards, which is why this is safe to do automatically
        // for an action whose synthetic consent the user already granted.
        if (call.tool === 'invoke_menu') {
          const retried = await this.retryMenuPath(connection, call.args, result, signal);
          if (retried) {
            result = retried;
            refusal = this.refusalFor(result);
          }
          if (refusal) return refuse(refusal);
        } else if (!(wantsForegroundDelivery(result) || typedNowhere(refusal.message)) || !FOREGROUND_CAPABLE.has(call.tool)) {
          return refuse(refusal);
        }
      }
      if (refusal) {
        result = await this.call(connection, call.tool, { ...call.args, delivery_mode: 'foreground' }, signal);
        refusal = this.refusalFor(result);
      }
      // A sheet or dialog of the same app holds the keyboard — a Save sheet's
      // "Go to folder" panel, an export options sheet. Keys aimed at the
      // document window are refused, and the driver names the window that has
      // focus. That window is part of the same task; aim there, once.
      if (refusal && FOREGROUND_CAPABLE.has(call.tool)) {
        const holder = focusHolder(result, call.args['window_id']);
        if (holder !== undefined) {
          result = await this.call(
            connection,
            call.tool,
            { ...call.args, window_id: holder, delivery_mode: 'foreground' },
            signal,
          );
          refusal = this.refusalFor(result);
        }
      }
      if (refusal) return refuse(await this.explainForegroundFailure(connection, refusal));

      const at = this.actionWindow(req, call.args);
      const changes = opts.observe !== false && at ? await this.observe(connection, at.pid, at.windowId, signal) : undefined;
      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        ...(changes ? { changes } : {}),
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
      // The token is the whole address: it carries pid, window and snapshot,
      // and the driver refuses it once a newer read of the window supersedes
      // it. The driver takes nothing else for an element.
      const token = this.liveToken(cached, req.elementIndex);
      if (!token) {
        return { refusal: { code: 'stale_snapshot', message: 'That element has no handle in this snapshot. Take a new computer_snapshot.' } };
      }
      const addressed = { element_token: token };

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
      // The driver has no named-action call: its element click IS the
      // accessibility press, and nothing else an element advertises can be
      // sent. (Menus are `invokeMenu`, which needs no element at all.)
      const action = CLICK_ACTIONS.get(req.actionName);
      if (!action) {
        return {
          refusal: {
            code: 'unsupported_action',
            message:
              `The driver cannot send "${req.actionName}". It sends ${[...CLICK_ACTIONS.keys()].join(', ')}; ` +
              'a menu command goes to computer_perform_action as a path such as "File>New".',
          },
        };
      }
      return { tool: 'click', args: { ...addressed, ...(action === 'press' ? {} : { action }) } };
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
      case 'invokeMenu':
        return { tool: 'invoke_menu', args: { ...target, path: [...req.path] } };
      case 'clickNamed':
        return { tool: 'click', args: { ...target, ...named(req) } };
      case 'setValueNamed':
        return { tool: 'set_value', args: { ...target, ...named(req), value: req.value } };
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
        const elementToken = req.element && cached ? this.liveToken(cached, req.element.elementIndex) : undefined;
        if (req.element && !elementToken) {
          return { refusal: { code: 'stale_snapshot', message: 'That element has no handle in this snapshot. Take a new computer_snapshot.' } };
        }
        const addressed = elementToken ? { element_token: elementToken } : target;
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
          args: {
            ...target,
            from_x: req.from.x,
            from_y: req.from.y,
            to_x: req.to.x,
            to_y: req.to.y,
            // A macOS window that is not frontmost takes the mouse-down as
            // "activate me" and drops the rest of the gesture: a background
            // drag on a Freeform board reported success and moved nothing.
            // The driver fronts the window for this one gesture and restores
            // the user's foreground afterwards.
            ...(process.platform === 'darwin' ? { delivery_mode: 'foreground' } : {}),
          },
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
      const pasted = await this.call(
        connection,
        'hotkey',
        // Paste is ⌘V on macOS; Ctrl+V there is a different command or nothing at all.
        { pid: args['pid'], window_id: args['window_id'], keys: [toDriverKey(PRIMARY_MODIFIER), 'v'] },
        signal,
      );
      // The app reads the clipboard after the key arrives — Numbers parses a
      // table first. Restoring at once pasted the user's clipboard instead.
      await new Promise((r) => setTimeout(r, PASTE_SETTLE_MS));
      return pasted;
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
    return (windows.find((w) => w.focused) ?? largestOpenWindow(windows) ?? windows[0])?.id ?? null;
  }

  private async windowsFor(connection: Connection, pid: number): Promise<ComputerWindowInfo[]> {
    const result = await this.call(connection, 'list_windows', { pid, on_screen_only: false });
    if (result.isError || !result.structuredJson) return [];
    return parseListWindows(result.structuredJson).get(pid) ?? [];
  }

  /**
   * One corrected retry of a menu path the driver could not run.
   *
   * Not found: the driver lists the items at that level, and the label the
   * agent wrote is usually one of them spelled differently — "Save…" for
   * "Save", "Export to" for "Export To". Disabled: a popup menu the agent
   * pressed and never chose from is still open and greys out the menu bar;
   * Escape closes it. Measured: both cost a full extra round trip each.
   */
  private async retryMenuPath(
    connection: Connection,
    args: Json,
    failed: DriverToolResult,
    signal?: AbortSignal,
  ): Promise<DriverToolResult | null> {
    const path = Array.isArray(args['path']) ? (args['path'] as string[]) : [];
    const text = failed.text ?? '';
    // The app is in the background — with no main window the driver will not
    // guess which document a menu command is for, and macOS keeps
    // selection-dependent items (Table>Delete Column) disabled behind the
    // user's window: bring the window the command names in front, as a person
    // would click it, and run it once more.
    if (/window_not_key|not the confirmed document menu context|disabled while the app is in the background/i.test(text)) {
      await this.call(connection, 'bring_to_front', { pid: args['pid'], window_id: args['window_id'] }, signal).catch(() => undefined);
      // The app re-enables its menu items a moment after it comes to the front.
      let retried = await this.call(connection, 'invoke_menu', args, signal);
      for (let attempt = 0; attempt < 3 && /disabled|key and frontmost|window_not_key/i.test(this.refusalFor(retried)?.message ?? ''); attempt++) {
        await new Promise((r) => setTimeout(r, 600));
        // Measured on Preview: the window sometimes is not yet key on the first try.
        await this.call(connection, 'bring_to_front', { pid: args['pid'], window_id: args['window_id'] }, signal).catch(() => undefined);
        retried = await this.call(connection, 'invoke_menu', args, signal);
      }
      return retried;
    }
    // Two items share the label (Numbers' File menu has more than one "New").
    // Find them in the menu bar and press the enabled one under the right menu.
    if (/is ambiguous/i.test(text) && path.length >= 2) {
      const token = await this.menuItemToken(connection, Number(args['pid']), Number(args['window_id']), path, signal);
      if (token) return this.call(connection, 'click', { element_token: token }, signal);
      return null;
    }
    const disabled = /path segment (\d+) is disabled/i.exec(text);
    if (disabled) {
      await this.call(connection, 'press_key', { pid: args['pid'], window_id: args['window_id'], key: 'escape' }, signal).catch(
        () => undefined,
      );
      return this.call(connection, 'invoke_menu', args, signal);
    }
    const missing = /path segment (\d+)[^.]*?was not found[^.]*\.\s*Items there:\s*(.*)$/is.exec(text);
    if (!missing) return null;
    const at = Number(missing[1]);
    const items = [...missing[2]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const wanted = path[at];
    if (wanted === undefined) return null;
    const match = closestMenuItem(wanted, items);
    if (!match || match === wanted) return null;
    const corrected = path.map((segment, i) => (i === at ? match : segment));
    const retried = await this.call(connection, 'invoke_menu', { ...args, path: corrected }, signal);
    // "New" → "New…", which Numbers lists twice: then press it by token.
    if (this.refusalFor(retried) && /is ambiguous/i.test(retried.text ?? '')) {
      const token = await this.menuItemToken(connection, Number(args['pid']), Number(args['window_id']), corrected, signal);
      if (token) return this.call(connection, 'click', { element_token: token }, signal);
    }
    return retried;
  }

  /**
   * A plan in as few driver calls as possible: consecutive steps go to the
   * driver's own `run_steps` in one call (it validates every step first, stops
   * at the first failure, retries a stale token on the same role and label,
   * re-sends a background-refused step in front once, and shortens its waits
   * inside the batch); a menu command, which `run_steps` does not carry, is
   * its own call between segments. One diff read follows the last step.
   */
  async actBatch(handle: ComputerHandle, reqs: readonly ActionRequest[], signal?: AbortSignal): Promise<ComputerActionResult[]> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return [refuse(disconnected())];
    const results: ComputerActionResult[] = [];
    const started = Date.now();
    let lastWindow: { pid: number; windowId: number } | undefined;
    const done = (req: ActionRequest, tool: string, ok: boolean, message?: string): ComputerActionResult =>
      ok
        ? {
            ok: true,
            snapshot: null,
            screenshot: null,
            action: {
              path: SYNTHETIC_TOOLS.has(tool) ? 'synthetic' : 'accessibility',
              actionName: tool,
              verification: { state: 'unverified', reason: req.type === 'pasteText' ? 'clipboard_paste' : 'synthetic_input' },
              durationMs: Date.now() - started,
            },
          }
        : refuse({
            code: /stale|superseded|no longer/i.test(message ?? '') ? 'stale_snapshot' : 'provider_unavailable',
            message: message ?? `${tool} failed.`,
          });
    try {
      let i = 0;
      while (i < reqs.length) {
        const req = reqs[i]!;
        // Menus and paste are not batch steps: run them through `act`, which
        // already carries the menu-label correction and the clipboard restore.
        if (req.type === 'invokeMenu' || req.type === 'pasteText') {
          const single = await this.act(handle, req, signal, { observe: false });
          results.push(single);
          if (!single.ok) return results;
          if (req.target.window.by === 'id') lastWindow = { pid: req.target.app.pid, windowId: req.target.window.id };
          i += 1;
          continue;
        }
        const segment: Array<{ req: ActionRequest; call: { tool: string; args: Json } }> = [];
        while (i < reqs.length && reqs[i]!.type !== 'invokeMenu' && reqs[i]!.type !== 'pasteText') {
          const call = await this.buildCall(connection, withPointFocus(reqs[i]!, reqs[i - 1]));
          if ('refusal' in call) {
            // Run what came before, then report the step that could not be built.
            if (segment.length > 0) {
              const ran = await this.runSegment(connection, segment, signal, done);
              results.push(...ran);
              if (ran.some((r) => !r.ok)) return results;
            }
            results.push(refuse(call.refusal));
            return results;
          }
          segment.push({ req: reqs[i]!, call });
          i += 1;
        }
        const ran = await this.runSegment(connection, segment, signal, done);
        results.push(...ran);
        const tail = segment[Math.min(ran.length, segment.length) - 1];
        if (tail) lastWindow = this.actionWindow(tail.req, tail.call.args) ?? lastWindow;
        if (ran.some((r) => !r.ok)) return results;
      }
      const last = results.at(-1);
      if (last?.ok && lastWindow) {
        const changes = await this.observe(connection, lastWindow.pid, lastWindow.windowId, signal);
        if (changes) results[results.length - 1] = { ...last, changes };
      }
      return results;
    } catch (err) {
      results.push(refuse(this.errorRefusal(err)));
      return results;
    }
  }

  /** One `run_steps` call; one result per step that ran, the failing one last. */
  private async runSegment(
    connection: Connection,
    segment: ReadonlyArray<{ req: ActionRequest; call: { tool: string; args: Json } }>,
    signal: AbortSignal | undefined,
    done: (req: ActionRequest, tool: string, ok: boolean, message?: string) => ComputerActionResult,
    foreground = false,
  ): Promise<ComputerActionResult[]> {
    const result = await this.call(
      connection,
      'run_steps',
      {
        steps: segment.map(({ call }) => ({ tool: call.tool, args: stripDeliveryFor(call.tool, call.args) })),
        foreground_fallback: true,
      },
      signal,
    );
    const outcome = parseRunSteps(result, segment.length);
    const failedAt = outcome.findIndex((step) => !step.ok);
    // A label that also names a menu item ("1" on Calculator's keypad and in
    // its Edit menu) is ambiguous to the driver. The window's own control is
    // what a step means: pick the first candidate that is not a menu item and
    // run the rest of the segment from there, once.
    if (failedAt !== -1) {
      const nth = firstNonMenuCandidate(outcome[failedAt]!.message);
      const step = segment[failedAt];
      if (nth !== undefined && step && step.call.args['nth'] === undefined && typeof step.call.args['name'] === 'string') {
        const rest = [{ req: step.req, call: { tool: step.call.tool, args: { ...step.call.args, nth } } }, ...segment.slice(failedAt + 1)];
        const retried = await this.runSegment(connection, rest, signal, done);
        return [...outcome.slice(0, failedAt).map((s, n) => done(segment[n]!.req, segment[n]!.call.tool, s.ok, s.message)), ...retried];
      }
    }
    // Keys that found no text input in the background — a canvas label, a
    // table cell, a custom-drawn field only take focus from a real click —
    // are what the driver says to send in the foreground. Replay from the
    // click that focused the field, in front, once.
    if (failedAt !== -1 && !foreground && typedNowhere(outcome[failedAt]!.message)) {
      const from = lastFocusingStep(segment, failedAt);
      const rest = segment.slice(from).map(({ req, call }) => ({
        req,
        call: { tool: call.tool, args: FOREGROUND_CAPABLE.has(call.tool) ? { ...call.args, delivery_mode: 'foreground' } : call.args },
      }));
      const retried = await this.runSegment(connection, rest, signal, done, true);
      return [...outcome.slice(0, from).map((s, n) => done(segment[n]!.req, segment[n]!.call.tool, s.ok, s.message)), ...retried];
    }
    return outcome.map((step, n) => done(segment[n]!.req, segment[n]!.call.tool, step.ok, step.message));
  }

  /**
   * The first enabled menu item labelled like the path's last segment whose
   * top-level menu is the path's first, read from the window's menu bar.
   */
  private async menuItemToken(
    connection: Connection,
    pid: number,
    windowId: number,
    path: readonly string[],
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const norm = (label: unknown) => String(label ?? '').toLowerCase().replace(/…|\.{3}/g, '').trim();
    this.bumpEpoch(pid, windowId);
    const result = await this.call(
      connection,
      'get_window_state',
      { pid, window_id: windowId, query: path.at(-1), tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
      signal,
    );
    if (result.isError || !result.structuredJson) return undefined;
    const rows = ((JSON.parse(result.structuredJson) as { elements?: Array<Record<string, unknown>> }).elements ?? []);
    const byIndex = new Map(rows.map((r) => [r['element_index'], r]));
    const top = (row: Record<string, unknown>): string | undefined => {
      let current: Record<string, unknown> | undefined = row;
      for (let hops = 0; current && hops < 12; hops += 1) {
        if (current['role'] === 'AXMenuBarItem') return norm(current['label']);
        current = byIndex.get(current['parent_index']);
      }
      return undefined;
    };
    const match = rows.find(
      (r) =>
        r['role'] === 'AXMenuItem' &&
        norm(r['label']) === norm(path.at(-1)) &&
        r['enabled'] !== false &&
        top(r) === norm(path[0]) &&
        typeof r['element_token'] === 'string',
    );
    return match?.['element_token'] as string | undefined;
  }

  /** The element's token against the driver's newest read of its window, while the rows keep their indices. */
  private liveToken(scope: { pid: number; windowId: number; tokens: Map<number, string>; epoch: number }, index: number): string | undefined {
    const token = scope.tokens.get(index);
    if (!token) return undefined;
    const read = this.windowReads.get(`${scope.pid}:${scope.windowId}`);
    return read && read.epoch === scope.epoch ? `${read.latest}:${index}` : token;
  }

  /** The window an action landed in, when it is known. */
  private actionWindow(req: ActionRequest, args: Json): { pid: number; windowId: number } | undefined {
    const snapshotId = isElementAddressed(req)
      ? req.snapshotId
      : req.type === 'typeText' && req.element
        ? req.element.snapshotId
        : undefined;
    if (snapshotId) {
      const scope = this.snapshotScopes.get(snapshotId);
      return scope ? { pid: scope.pid, windowId: scope.windowId } : undefined;
    }
    const pid = args['pid'];
    const windowId = args['window_id'];
    return typeof pid === 'number' && typeof windowId === 'number' ? { pid, windowId } : undefined;
  }

  /**
   * Reads back what the action changed, against the window's last read: the
   * driver's diff (`since`) — changed, added and removed rows. One cheap read
   * here replaces the snapshot the agent would otherwise take to see the
   * result, which was most of its calls. Nothing to diff against (the window
   * was never read) means nothing is reported.
   */
  private async observe(
    connection: Connection,
    pid: number,
    windowId: number,
    signal?: AbortSignal,
  ): Promise<ComputerActionResult['changes']> {
    const key = `${pid}:${windowId}`;
    const read = this.windowReads.get(key);
    if (!read) return undefined;
    try {
      const result = await this.call(
        connection,
        'get_window_state',
        {
          pid,
          window_id: windowId,
          since: read.latest,
          max_elements: read.maxElements,
          max_depth: read.maxDepth,
          ...(read.query ? { query: read.query } : {}),
          include_screenshot: false,
          tree_format: 'markdown',
          timeout_ms: SNAPSHOT_WALK_MS,
        },
        signal,
      );
      if (result.isError || !result.structuredJson) return undefined;
      const root = JSON.parse(result.structuredJson) as Record<string, unknown>;
      const next = typeof root['snapshot_id'] === 'string' ? root['snapshot_id'] : undefined;
      const diff = typeof root['tree_diff'] === 'string' ? root['tree_diff'] : undefined;
      if (!next) return undefined;
      if (diff === undefined) {
        // The driver fell back to a full read (the window changed shape, or the
        // old read expired): its indices are new.
        this.windowReads.set(key, { ...read, latest: next, epoch: read.epoch + 1 });
        return { diff: 'The window changed too much to compare.', reindexed: true, unchanged: false };
      }
      const reindexed = /(^|\n)\s*reindexed:/i.test(diff);
      this.windowReads.set(key, { ...read, latest: next, epoch: reindexed ? read.epoch + 1 : read.epoch });
      const unchanged = root['since_status'] === 'no_change';
      // A menu the action opened lives in a window of its own the agent cannot
      // read, and it blocks the app until something is chosen: name its items.
      const menu = await this.openMenuNote(connection, pid, windowId, signal);
      if (menu) return { diff: unchanged ? menu : `${menu}\n${clipDiff(diff)}`, reindexed, unchanged: false };
      return { diff: unchanged ? '' : clipDiff(diff), reindexed, unchanged };
    } catch {
      return undefined;
    }
  }

  /** What an open popup or context menu offers, or undefined when none is open. */
  private async openMenuNote(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<string | undefined> {
    if (!(await this.windowsFor(connection, pid)).some((w) => w.menu)) return undefined;
    // Popovers and tooltips sit at the same level; a menu is what lists items.
    const items = await this.openMenuItems(connection, pid, windowId, signal);
    if (items.length === 0) return undefined;
    return (
      `A menu is open: ${items.map((i) => `"${i}"`).join(', ')}. Choose an item with a click step by its name, ` +
      'or press_key Escape — an open menu blocks the app until one or the other.'
    );
  }

  /** Items of menus open in the window — every menu item that is not under the menu bar. */
  private async openMenuItems(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<string[]> {
    const result = await this.call(
      connection,
      'get_window_state',
      { pid, window_id: windowId, tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
      signal,
    ).catch(() => undefined);
    if (!result?.structuredJson) return [];
    const rows = (JSON.parse(result.structuredJson) as { elements?: unknown }).elements;
    return openMenuLabels(Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []);
  }

  /**
   * Activates an app that has no window, the way a click on its Dock or
   * taskbar icon does: launching it again reopens it, and a document app then
   * shows a restored document, an Open panel or a start screen. A
   * `bring_to_front` needs a window to aim at and is refused here.
   */
  private async reopen(connection: Connection, app: ComputerAppIdentity, signal?: AbortSignal): Promise<void> {
    // Only macOS keeps document apps running with no window. The driver's
    // launch keeps the app in the background, which is no reopen at all:
    // LaunchServices (`open -b`) is the Dock click itself.
    if (process.platform === 'darwin' && /^[\w-]+(\.[\w-]+)+$/.test(app.appId)) {
      await (this.options.reopenApp ?? openBundle)(app.appId);
      return;
    }
    await this.call(connection, 'launch_app', { name: app.name }, signal).catch(() => undefined);
  }

  /**
   * A popup or context menu left open (an earlier press that chose nothing)
   * holds the app's input: menu commands, New and saves then do nothing.
   * Close it the way a person would — the window in front, Escape.
   */
  private async closeStrayMenu(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.windowsFor(connection, pid)).some((w) => w.menu)) return false;
    await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal).catch(() => undefined);
    await this.call(connection, 'press_key', { pid, window_id: windowId, key: 'escape', delivery_mode: 'foreground' }, signal).catch(() => undefined);
    return true;
  }

  /** Bounded so a long read-only session cannot grow this without limit. */
  private rememberScope(
    snapshotId: string,
    pid: number,
    windowId: number,
    elements: readonly ComputerElement[],
    epoch: number,
  ): void {
    const tokens = new Map<number, string>();
    const roles = new Map<number, string>();
    for (const element of elements) {
      if (element.token) tokens.set(element.index, element.token);
      roles.set(element.index, element.role);
    }
    this.snapshotScopes.set(snapshotId, { pid, windowId, tokens, roles, epoch });
    while (this.snapshotScopes.size > 32) {
      const oldest = this.snapshotScopes.keys().next().value;
      if (oldest === undefined) break;
      this.snapshotScopes.delete(oldest);
    }
  }

  /** The driver's running apps, plus any app this bridge launched that is still alive but missing from them. */
  private withLaunched(apps: ComputerAppInfo[]): ComputerAppInfo[] {
    const listed = new Set(apps.map((a) => a.pid));
    const extra: ComputerAppInfo[] = [];
    for (const [pid, app] of this.launched) {
      if (listed.has(pid)) continue;
      if (!processAlive(pid)) {
        this.launched.delete(pid);
        continue;
      }
      extra.push({ ...app, frontmost: false, windowCount: 0 });
    }
    return extra.length > 0 ? [...apps, ...extra] : apps;
  }

  /**
   * The app's own save dialog, driven the way it was measured to work on
   * macOS 26/27 with cua-driver 0.38, end to end, then the file checked on
   * disk. By hand the agent spent 8–40 calls here and sometimes saved into
   * the wrong folder (a path typed into the name field is taken as a name).
   *
   * macOS: menu → (an export's options sheet: Next…) → Go to folder (⌘⇧G,
   * aimed at the sheet's window, in front — the only route that reaches any
   * folder) → the folder path, committed with Return → the name → the format
   * popup → Save/Export → Replace if asked to → the file on disk.
   * Windows and Linux: the file-name field takes a full path, then Return.
   */
  async saveAs(
    handle: ComputerHandle,
    app: ComputerAppIdentity,
    documentWindowId: number,
    opts: SaveAsRequest,
    signal?: AbortSignal,
  ): Promise<SaveAsResult> {
    let windowId = documentWindowId;
    // The dialog this call opened: closed again when the call fails part-way,
    // so the agent is not left with a modal panel that blocks the app.
    let openDialog: number | undefined;
    const connection = this.connections.get(handle.workspaceId);
    const steps: string[] = [];
    const fail = (message: string, code: ComputerRefusalCode = 'provider_unavailable'): SaveAsResult => ({
      ok: false,
      steps,
      refusal: { code, message: `${message} Steps done: ${steps.join(' → ') || 'none'}.` },
    });
    if (!connection) return fail('The driver is not connected.');
    const target = path.join(opts.folder, opts.name);
    const pid = app.pid;
    // Reads below replace the window's snapshot: the agent's indices are new after this.
    this.bumpEpoch(pid, windowId);
    try {
      if (process.platform !== 'darwin') {
        if (opts.menu) await this.menuOrFail(connection, pid, windowId, opts.menu, signal);
        const field =
          (await this.waitForRow(connection, pid, windowId, 'File name', ['Edit', 'ComboBox', 'AXTextField'], 5_000, signal)) ??
          (await this.waitForRow(connection, pid, windowId, 'Name', ['Edit', 'ComboBox', 'AXTextField', 'text'], 2_000, signal));
        if (!field) return fail('No save dialog with a file-name field appeared.');
        await this.callOk(connection, 'set_value', { element_token: field, value: target }, signal);
        steps.push(`file name ${target}`);
        const formats = opts.format ? [opts.format] : formatNamesFor(opts.name);
        if (formats.length > 0) {
          const chosen = await this.chooseFormat(connection, pid, windowId, formats, signal);
          if (chosen) steps.push(`format ${chosen}`);
        }
        await this.callOk(connection, 'press_key', { pid, window_id: windowId, key: 'return' }, signal);
        steps.push('Return');
      } else {
        // 1. The dialog: a sheet on the document (TextEdit, iWork) or a
        // window of its own (Freeform's export) — look in every window.
        let panel = await this.findPanel(connection, pid, windowId, 600, signal);
        if (!panel) {
          const menu = opts.menu && opts.menu.length > 0 ? [...opts.menu] : ['File', 'Save…'];
          await this.menuOrFail(connection, pid, windowId, menu, signal);
          steps.push(`menu ${menu.join('>')}`);
          panel = await this.findPanel(connection, pid, windowId, 4_000, signal);
          if (!panel) {
            // Some apps put the dialog up only once they are in front.
            await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal).catch(() => undefined);
            panel = await this.findPanel(connection, pid, windowId, 3_000, signal);
          }
          if (!panel) {
            // An export's options sheet comes first ("Next…" exactly — not "Next Sheet").
            const next = await this.findLabelled(connection, pid, windowId, 'Next…', ['AXButton'], 2_000, signal);
            if (next) {
              await this.callOk(connection, 'click', { element_token: next }, signal);
              steps.push('Next…');
              panel = await this.findPanel(connection, pid, windowId, 4_000, signal);
            }
          }
        }
        if (!panel) return fail('The save dialog did not open.');
        windowId = panel;
        openDialog = panel;
        // 2. The folder, through Go to folder.
        const goTo = async () => {
          await this.keysToDialog(connection, pid, windowId, { tool: 'hotkey', args: { keys: ['cmd', 'shift', 'g'] } }, signal);
          return this.findRow(connection, pid, windowId, 'PathTextField', ['AXTextField'], 3_000, signal);
        };
        let pathField = await goTo();
        if (!pathField) {
          // The keys can land before the dialog takes focus: once more, with it in front.
          await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal).catch(() => undefined);
          pathField = await goTo();
        }
        if (!pathField) {
          await this.dismissDialog(connection, pid, openDialog, signal);
          return fail('Go to folder did not open in the save dialog.');
        }
        // A value equal to the current one is not an edit, and Return then goes nowhere: make it one.
        const folderValue = pathField.value === opts.folder ? `${opts.folder.replace(/\/+$/u, '')}/` : opts.folder;
        await this.callOk(connection, 'set_value', { element_token: pathField.token, value: folderValue }, signal);
        await this.keysToDialog(connection, pid, windowId, { tool: 'press_key', args: { key: 'return' } }, signal);
        steps.push(`folder ${opts.folder}`);
        // A dialog that is a window of its own can come back as a new window
        // once Go to folder closes (measured: a new id, ~3 s later): find it again.
        await new Promise((r) => setTimeout(r, 800));
        windowId = (await this.findPanel(connection, pid, windowId, 6_000, signal)) ?? windowId;
        const where = await this.rowValue(connection, pid, windowId, 'where popup', signal, 1_500);
        const folderName = path.basename(opts.folder);
        if (where !== undefined && where.replace(/[\u2068\u2069]/gu, '').trim() !== folderName) {
          await this.dismissDialog(connection, pid, windowId, signal);
          return fail(`The dialog shows the folder "${where}", not "${folderName}".`);
        }
        // 3. Name and format.
        const field = await this.waitForRow(connection, pid, windowId, 'saveAsNameTextField', ['AXTextField'], 2_000, signal);
        if (!field) {
          await this.dismissDialog(connection, pid, windowId, signal);
          return fail('The name field went away.');
        }
        await this.callOk(connection, 'set_value', { element_token: field, value: opts.name }, signal);
        steps.push(`name ${opts.name}`);
        // The format: the one asked for, else the one the name's extension
        // implies, chosen in whichever popup of the dialog lists it — "File
        // Format", "Format", "Save as type"… A dialog whose popup lists none
        // of them keeps its own format, and the file check below says so.
        const formats = opts.format ? [opts.format] : formatNamesFor(opts.name);
        if (formats.length > 0) {
          const chosen = await this.chooseFormat(connection, pid, windowId, formats, signal);
          steps.push(chosen ? `format ${chosen}` : 'format (none of the dialog\u2019s popups lists it)');
        }
        // 4. Save.
        const ok = await this.waitForRow(connection, pid, windowId, 'OKButton', ['AXButton'], 1_500, signal);
        if (ok) {
          await this.callOk(connection, 'click', { element_token: ok }, signal);
          steps.push('Save');
        } else {
          // A custom dialog ("Export", "Share") without the standard Save
          // button: Return presses its default button.
          await this.keysToDialog(connection, pid, windowId, { tool: 'press_key', args: { key: 'return' } }, signal);
          steps.push('default button (Return)');
        }
        const replaceButton = await this.waitForRow(connection, pid, windowId, 'Replace', ['AXButton'], 900, signal);
        if (replaceButton) {
          if (!opts.replace) {
            const cancel = await this.waitForRow(connection, pid, windowId, 'Cancel', ['AXButton'], 500, signal);
            if (cancel) await this.callOk(connection, 'click', { element_token: cancel }, signal).catch(() => undefined);
            return fail(`${target} already exists; pass replace: true to overwrite it.`);
          }
          await this.callOk(connection, 'click', { element_token: replaceButton }, signal);
          steps.push('Replace');
        }
      }
      // 5. The file on disk — the only proof that counts.
      for (let waited = 0; waited <= 6_000; waited += 300) {
        if (existsSync(target)) {
          const folder = exportedFolder(target);
          if (folder) {
            return fail(
              `${target} is a folder of ${folder.length} files (${folder.slice(0, 5).join(', ')}): the app exported one file per ` +
                'table, sheet or page. Remove what should not be there (an empty placeholder table, an extra sheet) and export again with replace: true.',
            );
          }
          return { ok: true, path: target, steps };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      const instead = savedInstead(opts.folder, opts.name);
      if (instead) {
        return fail(
          `The app saved ${instead} instead of ${opts.name}: the dialog kept its own format. Pass format as the dialog names it ` +
            '(take a computer_snapshot of the dialog to see its format popup), and delete the stray file if the task does not want it.',
        );
      }
      return fail(`The dialog closed but ${target} did not appear.`);
    } catch (err) {
      const refusal = this.errorRefusal(err);
      await this.dismissDialog(connection, pid, openDialog, signal);
      return fail(refusal.message, refusal.code);
    }
  }

  /** Closes a save dialog left open by a failed save_as (Escape, twice for a Go to folder sheet on top). */
  private async dismissDialog(connection: Connection, pid: number, windowId: number | undefined, signal?: AbortSignal): Promise<void> {
    if (windowId === undefined) return;
    for (let n = 0; n < 2; n += 1) {
      if (!(await this.windowsFor(connection, pid)).some((w) => w.id === windowId)) return;
      await this.keysToDialog(connection, pid, windowId, { tool: 'press_key', args: { key: 'escape' } }, signal).catch(() => undefined);
    }
  }

  /**
   * A new blank document, for any app on any platform: the app's own "New…"
   * command (its File menu, else the platform shortcut, ⌘N / Ctrl+N), then
   * whatever the app shows on the way — a template chooser or start screen is
   * accepted with Return (its default) and never read, since reading some of
   * them crashes the app — until a new titled window appears, or the same
   * window retitles itself (a tab). The agent used to fight these by hand and,
   * failing, typed into documents that were already open.
   */
  async newDocument(
    handle: ComputerHandle,
    app: ComputerAppIdentity,
    signal?: AbortSignal,
  ): Promise<{ window?: { id: number; title: string }; steps: string[]; refusal?: ComputerRefusal }> {
    const connection = this.connections.get(handle.workspaceId);
    const steps: string[] = [];
    if (!connection) return { steps, refusal: disconnected() };
    const pid = app.pid;
    const visible = async () => (await this.windowsFor(connection, pid)).filter((w) => !w.floating && !w.minimised);
    // Ready: a window to work from, or a start screen to answer. A window that
    // has just appeared reports no size for a moment.
    const ready = (ws: readonly ComputerWindowInfo[]) => ws.some(isIntermediateWindow) || mainWindow(ws) !== undefined;
    try {
      let existing = await visible();
      if (!ready(existing)) {
        // Windowless (a document app launched in the background): activation
        // brings up a restored document, an Open panel or a start screen.
        if (existing.length === 0) {
          await this.reopen(connection, app, signal);
          steps.push('activate');
        }
        for (let waited = 0; waited < 10_000 && !ready(existing); waited += 500) {
          await new Promise((r) => setTimeout(r, 500));
          existing = await visible();
        }
      }
      const handled = new Set<number>();
      // A start screen shown on activation is already the way to a new document.
      const shownChooser = existing.find(isIntermediateWindow);
      if (shownChooser) {
        handled.add(shownChooser.id);
        await this.keysToDialog(connection, pid, shownChooser.id, { tool: 'press_key', args: { key: 'return' } }, signal);
        steps.push('start screen default (Return)');
      }
      const before = new Map(existing.filter((w) => w !== shownChooser).map((w) => [w.id, w.title]));
      const anchor = mainWindow(existing.filter((w) => w !== shownChooser));
      if (!shownChooser) {
        if (!anchor) return { steps, refusal: { code: 'target_lost', message: 'The app shows no window to create a document from.' } };
        if (await this.closeStrayMenu(connection, pid, anchor.id, signal)) steps.push('closed an open menu (Escape)');
        steps.push(await this.runNewCommand(connection, pid, anchor.id, signal));
      }
      let pressedButton = false;
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        await new Promise((r) => setTimeout(r, 600));
        const windows = await visible();
        const fresh = windows.filter((w) => !before.has(w.id) && !handled.has(w.id));
        const chooser = fresh.find(isIntermediateWindow);
        if (chooser) {
          handled.add(chooser.id);
          await this.keysToDialog(connection, pid, chooser.id, { tool: 'press_key', args: { key: 'return' } }, signal);
          steps.push('template default (Return)');
          continue;
        }
        const doc = fresh.find((w) => w.title !== '');
        // A tabbed app opens the document in the window it already has.
        const tab = !doc && anchor ? windows.find((w) => w.id === anchor.id && w.title !== '' && w.title !== before.get(anchor.id)) : undefined;
        const made = doc ?? tab;
        if (made) {
          this.bumpEpoch(pid, made.id);
          return { window: { id: made.id, title: made.title }, steps };
        }
        // Nothing yet: the window in front may be a start screen or an Open
        // panel that ignores New and offers its own button instead.
        if (!pressedButton && Date.now() - started > 4_000) {
          pressedButton = true;
          for (const w of windows.filter((x) => x.title !== '').slice(0, 3)) {
            const button = await this.newDocumentButton(connection, pid, w.id, signal);
            if (!button) continue;
            await this.callOk(connection, 'click', { element_token: button.token }, signal);
            steps.push(button.label);
            break;
          }
        }
      }
      return { steps, refusal: { code: 'target_lost', message: `No new document window appeared. Steps done: ${steps.join(' → ') || 'none'}.` } };
    } catch (err) {
      return { steps, refusal: this.errorRefusal(err) };
    }
  }

  /** A start screen's or Open panel's own way to a blank document: "New Document", "Blank Document", "Create"… */
  private async newDocumentButton(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<{ token: string; label: string } | undefined> {
    const result = await this.call(
      connection,
      'get_window_state',
      { pid, window_id: windowId, tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
      signal,
    ).catch(() => undefined);
    if (!result?.structuredJson) return undefined;
    const rows = (JSON.parse(result.structuredJson) as { elements?: unknown }).elements;
    return pickNewDocumentButton(Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []);
  }

  /**
   * The app's own new-document command: the File-menu item that makes one
   * ("New", "New…", "New Board", "New Presentation"…), else the platform's
   * shortcut — an app without a File menu, a ribbon, a localised menu.
   */
  private async runNewCommand(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<string> {
    const item = await this.newDocumentItem(connection, pid, windowId, signal);
    if (item) {
      try {
        await this.menuOrFail(connection, pid, windowId, ['File', item], signal);
        return `File>${item}`;
      } catch {
        // Fall through to the shortcut every platform's document apps share.
      }
    }
    const keys = [toDriverKey(PRIMARY_MODIFIER), 'n'];
    let sent = await this.call(connection, 'hotkey', { pid, window_id: windowId, keys }, signal);
    if (this.refusalFor(sent)) {
      await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal).catch(() => undefined);
      sent = await this.call(connection, 'hotkey', { pid, window_id: windowId, keys }, signal);
    }
    const refusal = this.refusalFor(sent);
    if (refusal) throw new Error(refusal.message);
    return `${PRIMARY_MODIFIER}+N`;
  }

  /** The File-menu item that makes a new document, if the app's menu lists one. */
  private async newDocumentItem(connection: Connection, pid: number, windowId: number, signal?: AbortSignal): Promise<string | undefined> {
    const list = () => this.call(connection, 'invoke_menu', { pid, window_id: windowId, path: ['File', '__generatorai_list_items__'] }, signal);
    let probe = await list();
    if (!/Items there:/i.test(probe.text ?? '') && /window_not_key|background/i.test(probe.text ?? '')) {
      await this.call(connection, 'bring_to_front', { pid, window_id: windowId }, signal).catch(() => undefined);
      probe = await list();
    }
    const listed = /Items there:\s*(.*)$/is.exec(probe.text ?? '');
    const items = listed ? [...listed[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) : [];
    return pickNewDocumentItem(items);
  }

  /** Picks the first of `formats` that a popup of the dialog lists; the format-looking popups are tried first. */
  private async chooseFormat(connection: Connection, pid: number, windowId: number, formats: readonly string[], signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.call(
      connection,
      'get_window_state',
      { pid, window_id: windowId, tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
      signal,
    );
    const rows = result.structuredJson ? (JSON.parse(result.structuredJson) as { elements?: unknown }).elements : undefined;
    const popups = (Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [])
      .filter((r) => /PopUpButton$|ComboBox$/.test(String(r['role'] ?? '')) && typeof r['element_token'] === 'string')
      .filter((r) => !/where|location|folder|name/i.test(`${r['label'] ?? ''} ${r['identifier'] ?? ''}`))
      .sort((a, b) => Number(/format|type/i.test(String(b['label'] ?? ''))) - Number(/format|type/i.test(String(a['label'] ?? ''))));
    for (const popup of popups) {
      const current = String(popup['value'] ?? '').trim().toLowerCase();
      const already = formats.find((f) => current === f.toLowerCase());
      if (already) return already;
      for (const format of formats) {
        const set = await this.call(connection, 'set_value', { element_token: popup['element_token'], value: format }, signal);
        if (!this.refusalFor(set)) return format;
      }
    }
    return undefined;
  }

  /** The window holding a save panel's name field: the given one first, then the app's other windows. */
  private async findPanel(connection: Connection, pid: number, preferred: number, timeoutMs: number, signal?: AbortSignal): Promise<number | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const others = (await this.windowsFor(connection, pid)).filter((w) => w.id !== preferred && !w.floating).map((w) => w.id);
      for (const id of [preferred, ...others]) {
        if (await this.findRow(connection, pid, id, 'saveAsNameTextField', ['AXTextField'], 0, signal)) return id;
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** A row whose label is exactly `label` (ellipsis-insensitive). */
  private async findLabelled(
    connection: Connection,
    pid: number,
    windowId: number,
    label: string,
    roles: readonly string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const norm = (v: unknown) => String(v ?? '').replace(/…|\.{3}/g, '').trim().toLowerCase();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.call(
        connection,
        'get_window_state',
        { pid, window_id: windowId, query: label.replace(/…$/u, ''), tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
        signal,
      );
      if (!result.isError && result.structuredJson) {
        const rows = (JSON.parse(result.structuredJson) as { elements?: Array<Record<string, unknown>> }).elements ?? [];
        const row = rows.find((r) => roles.includes(String(r['role'])) && norm(r['label']) === norm(label));
        if (row && typeof row['element_token'] === 'string') return row['element_token'];
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** A menu path, with the label correction `act` applies; throws when it cannot run. */
  private async menuOrFail(connection: Connection, pid: number, windowId: number, menu: readonly string[], signal?: AbortSignal): Promise<void> {
    const args = { pid, window_id: windowId, path: [...menu] };
    let result = await this.call(connection, 'invoke_menu', args, signal);
    if (this.refusalFor(result)) {
      const retried = await this.retryMenuPath(connection, args, result, signal);
      if (retried) result = retried;
    }
    const refusal = this.refusalFor(result);
    if (refusal) throw new Error(refusal.message);
  }

  /** A driver call that must succeed; its refusal becomes an error. */
  private async callOk(connection: Connection, tool: string, args: Json, signal?: AbortSignal): Promise<DriverToolResult> {
    const result = await this.call(connection, tool, args, signal);
    const refusal = this.refusalFor(result);
    if (refusal) throw new Error(`${tool}: ${refusal.message}`);
    return result;
  }

  /**
   * Keys for a sheet: the sheet's own window holds focus, and the driver only
   * delivers there in front. Aimed at the document first; the refusal names
   * the window that has focus.
   */
  private async keysToDialog(
    connection: Connection,
    pid: number,
    windowId: number,
    key: { tool: 'hotkey' | 'press_key'; args: Json },
    signal?: AbortSignal,
  ): Promise<void> {
    const first = await this.call(connection, key.tool, { ...key.args, pid, window_id: windowId, delivery_mode: 'foreground' }, signal);
    if (!this.refusalFor(first)) return;
    const holder = focusHolder(first, windowId);
    if (holder === undefined) throw new Error(`${key.tool}: ${first.text}`);
    await this.callOk(connection, key.tool, { ...key.args, pid, window_id: holder, delivery_mode: 'foreground' }, signal);
  }

  /** Polls the window for a row matching `query` with one of `roles`; its token, or undefined after `timeoutMs`. */
  private async waitForRow(
    connection: Connection,
    pid: number,
    windowId: number,
    query: string,
    roles: readonly string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    return (await this.findRow(connection, pid, windowId, query, roles, timeoutMs, signal))?.token;
  }

  private async rowValue(
    connection: Connection,
    pid: number,
    windowId: number,
    query: string,
    signal?: AbortSignal,
    timeoutMs = 600,
  ): Promise<string | undefined> {
    return (await this.findRow(connection, pid, windowId, query, ['AXTextField', 'AXPopUpButton'], timeoutMs, signal))?.value;
  }

  private async findRow(
    connection: Connection,
    pid: number,
    windowId: number,
    query: string,
    roles: readonly string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ token: string; value?: string } | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.call(
        connection,
        'get_window_state',
        { pid, window_id: windowId, query, tree_format: 'elements', include_screenshot: false, timeout_ms: SNAPSHOT_WALK_MS },
        signal,
      );
      if (!result.isError && result.structuredJson) {
        const root = JSON.parse(result.structuredJson) as { elements?: Array<Record<string, unknown>> };
        // The match is the deepest row; the rest are its ancestors. Menu-bar rows match too, and are skipped.
        const rows = (root.elements ?? []).filter((e) => roles.includes(String(e['role'])));
        const row = rows.at(-1);
        if (row && typeof row['element_token'] === 'string') {
          return { token: row['element_token'], ...(typeof row['value'] === 'string' ? { value: row['value'] } : {}) };
        }
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** Reads outside the agent's own snapshot start a new epoch: its indices are not rewritten onto them. */
  private bumpEpoch(pid: number, windowId: number): void {
    const key = `${pid}:${windowId}`;
    const read = this.windowReads.get(key);
    if (read) this.windowReads.set(key, { ...read, epoch: read.epoch + 1 });
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
      const asksForSomething = Boolean(opts.url || opts.newInstance || (opts.args?.length ?? 0) > 0);
      try {
        const existing = await this.call(connection, 'list_apps', {});
        if (existing.structuredJson) {
          for (const app of parseListApps(existing.structuredJson)) {
            if (!matchesLaunchName(app, name)) continue;
            const windows = await this.windowsFor(connection, app.pid);
            for (const w of windows) before.add(w.id);
            // Already running with a window to work in, and asked for nothing
            // new: hand back that window. Launching again sends the app a
            // reopen, which a Chromium app (ChatGPT) answers with a dozen new
            // helper windows and a main window back on its splash screen —
            // the agent then read a blank logo for the rest of the run.
            const main = mainWindow(windows);
            if (!asksForSomething && main) {
              return {
                app: { appId: app.id, name: app.name, pid: app.pid },
                window: { id: main.id, title: main.title },
              };
            }
          }
        }
      } catch {
        // A failed pre-scan only costs us the ability to name the new window.
      }
      const { targets, argv } = splitLaunchArguments(opts.args ?? []);
      const urls = [...(opts.url ? [opts.url] : []), ...targets];
      const result = await this.call(
        connection,
        'launch_app',
        {
          name,
          ...(urls.length > 0 ? { urls } : {}),
          ...(argv.length > 0 ? { additional_arguments: argv.map(quoteArgument) } : {}),
          // Single-instance apps hand every caller the same window, so two
          // concurrent runs otherwise clobber each other's work.
          ...(opts.newInstance ? { creates_new_application_instance: true } : {}),
        },
        signal,
      );
      const refusal = this.refusalFor(result);
      if (refusal) return { refusal };
      const started = launchedIdentity(result.structuredJson, name);
      if (started) this.launched.set(started.pid, started);

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
      // A macOS document app launched in the background (TextEdit, Pages,
      // Numbers with iCloud on) starts with no window at all: AppKit makes the
      // untitled document, or shows its Open panel, only once the app is
      // activated. Measured: TextEdit ran windowless for the whole 30 s, and
      // with no window there is nothing a snapshot, a menu or a key can be
      // aimed at, so the agent was stuck. One activation, then ⌘N, is what a
      // person does by clicking the Dock icon.
      let windowless: { app: ComputerAppIdentity; since: number; nudges: number } | undefined;
      const nudgeWindowless = process.platform === 'darwin' && targets.length === 0;
      while (Date.now() < deadline) {
        const listed = await this.call(connection, 'list_apps', {});
        if (listed.structuredJson) {
          const apps = this.withLaunched(parseListApps(listed.structuredJson));
          const match =
            (started && apps.find((a: ComputerAppInfo) => a.pid === started.pid)) ??
            apps.find((a: ComputerAppInfo) => matchesLaunchName(a, name));
          if (match) {
            const windows = await this.windowsFor(connection, match.pid);
            if (windows.length === 0 && nudgeWindowless) {
              windowless ??= { app: { appId: match.id, name: match.name, pid: match.pid }, since: Date.now(), nudges: 0 };
              if (Date.now() - windowless.since >= WINDOWLESS_NUDGE_MS * (windowless.nudges + 1) && windowless.nudges < 2) {
                if (windowless.nudges === 0) await this.reopen(connection, windowless.app, signal);
                else await this.call(connection, 'hotkey', { pid: match.pid, keys: ['cmd', 'n'] }, signal).catch(() => undefined);
                windowless.nudges += 1;
              }
            }
            if (windows.length > 0) {
              // Deliberately NOT brought to front. The driver launches with
              // SW_SHOWNOACTIVATE precisely so the user keeps their screen, and
              // reading and clicking work on a background window; only a write
              // to a MINIMISED window is unsafe, and that path refuses on its own.
              const app = { appId: match.id, name: match.name, pid: match.pid };
              // Asked to open a file: its window is the one titled with it. TextEdit
              // restores yesterday's documents alongside, and the first new window
              // was one of those.
              const named = windows.find((w) => targets.some((t) => windowShowsFile(w.title, t)));
              if (named) return { app, window: { id: named.id, title: named.title } };
              const fresh = mainWindow(windows.filter((w) => !before.has(w.id)));
              if (fresh) return { app, window: { id: fresh.id, title: fresh.title } };
              const chosen = mainWindow(windows) ?? windows.find((w) => w.focused) ?? windows[0];
              fallback = { app, ...(chosen ? { window: { id: chosen.id, title: chosen.title } } : {}) };
              if (!wantsNewWindow || before.size === 0 || Date.now() >= freshDeadline) return fallback;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (fallback) return fallback;
      // Running without a window is still a launched app: say so instead of
      // refusing, so the agent can open a document in it rather than give up.
      if (windowless) return { app: windowless.app };
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
    windowId?: number,
  ): Promise<ComputerActionResult> {
    const connection = this.connections.get(handle.workspaceId);
    if (!connection) return refuse(disconnected());
    try {
      const windows = await this.windowsFor(connection, app.pid);
      if (windows.length === 0) {
        return refuse({ code: 'target_lost', message: 'That application has no windows.' });
      }
      if (windowId !== undefined && !windows.some((w) => w.id === windowId)) {
        return refuse({ code: 'target_lost', message: `Window ${windowId} is not open in ${app.name}.` });
      }
      // The window asked for, else the app's main window. "First not
      // minimised" raised a 30 px helper strip of a Chromium app (ChatGPT
      // lists a dozen of them ahead of its real window) and left the window
      // the agent was working in exactly where it was.
      const target =
        windows.find((w) => w.id === windowId) ?? largestOpenWindow(windows) ?? windows[0]!;
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
      // Distance-based timing (`fitts`): a hop to the next keypad button is
      // quick, a move across the screen still reads as a move. The default
      // floor of 600 ms per move made a thirteen-press sum crawl.
      const motion = await client.callTool(
        'set_agent_cursor_motion',
        JSON.stringify({
          session: sessionId,
          idle_hide_ms: AGENT_CURSOR_IDLE_HIDE_MS,
          style: 'signature_arc',
          timing: 'fitts',
          dwell_after_click_ms: 60,
          effects: { ripple: 'on', glow: 'on' },
        }),
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
  const env: Array<{ name: string; value: string }> = [...CUA_DRIVER_PACING_ENVIRONMENT];
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
      escalation?: { recommended?: unknown; target?: unknown; reason?: unknown };
    };
    // `recommended` on refusals; a delivered-but-failed input names `target`.
    const recommended = root.escalation?.recommended ?? root.escalation?.target;
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
/**
 * The window of the same app that holds focus, when the driver refused input
 * for another one: "window_id 4806 \"Save\" of the same app holds focus" or
 * "the app's focused window is Some(4806)".
 */
export function focusHolder(result: DriverToolResult, aimed: unknown): number | undefined {
  const text = `${result.text ?? ''} ${result.structuredJson ?? ''}`;
  const match = /window_id (\d+) "[^"]*" of the same app holds focus/.exec(text) ?? /focused window is Some\((\d+)\)/.exec(text);
  const id = match ? Number(match[1]) : undefined;
  return id !== undefined && id !== aimed ? id : undefined;
}

/** A result the driver accepted but says did not reach the target, with foreground as the fix. */
function deliveryFailed(result: DriverToolResult): boolean {
  if (result.isError || !result.structuredJson) return false;
  try {
    const root = JSON.parse(result.structuredJson) as { escalation?: { reason?: unknown; target?: unknown } };
    return root.escalation?.reason === 'delivery_failed' && root.escalation.target === 'foreground';
  } catch {
    return false;
  }
}

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
/**
 * On macOS a file or folder reaches an app as an open target (`urls`, what
 * `open <path>` sends), never on its command line: TextEdit given
 * `--args /path/draft.txt` started with no window at all. Elsewhere every
 * argument stays on the command line, which is how Windows and Linux apps take
 * a path.
 */
export function splitLaunchArguments(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { targets: string[]; argv: string[] } {
  if (platform !== 'darwin') return { targets: [], argv: [...args] };
  const targets: string[] = [];
  const argv: string[] = [];
  for (const arg of args) {
    const bare = arg.length > 1 && arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
    if (bare.startsWith('/') || bare.startsWith('~/') || bare.startsWith('file://')) {
      targets.push(bare.startsWith('~/') ? path.join(os.homedir(), bare.slice(2)) : bare);
    } else {
      argv.push(arg);
    }
  }
  return { targets, argv };
}

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

/** `launch_app`'s own answer: the process it started, identified as the driver lists apps. */
function launchedIdentity(structuredJson: string | undefined, requested: string): ComputerAppInfo | undefined {
  if (!structuredJson) return undefined;
  try {
    const root = JSON.parse(structuredJson) as Record<string, unknown>;
    const pid = typeof root['pid'] === 'number' ? root['pid'] : undefined;
    if (!pid || pid <= 0) return undefined;
    const name = typeof root['name'] === 'string' && root['name'] ? root['name'] : requested;
    const id = typeof root['bundle_id'] === 'string' && root['bundle_id'] ? root['bundle_id'] : name;
    return { id, name, pid, frontmost: false, windowCount: 0 };
  } catch {
    return undefined;
  }
}

/**
 * Adds a process that owns windows but is missing from `list_apps`, named by
 * the stopped entry `list_apps` keeps for the same app: the same macOS gap as
 * `launched`, for an app the user started rather than this bridge.
 */
function withWindowOwners(
  apps: ComputerAppInfo[],
  appsJson: string | undefined,
  windowsJson: string | undefined,
): ComputerAppInfo[] {
  if (!appsJson || !windowsJson) return apps;
  try {
    const listed = new Set(apps.map((a) => a.pid));
    const owners = new Map<number, string>();
    for (const w of ((JSON.parse(windowsJson) as { windows?: unknown[] }).windows ?? []) as Record<string, unknown>[]) {
      const pid = typeof w['pid'] === 'number' ? w['pid'] : undefined;
      const owner = typeof w['app_name'] === 'string' ? w['app_name'] : undefined;
      if (pid && owner && !listed.has(pid) && w['layer'] === 0) owners.set(pid, owner);
    }
    if (owners.size === 0) return apps;
    const stopped = ((JSON.parse(appsJson) as { apps?: unknown[] }).apps ?? []) as Record<string, unknown>[];
    const extra: ComputerAppInfo[] = [];
    for (const [pid, owner] of owners) {
      const entry = stopped.find((a) => a['running'] !== true && a['name'] === owner);
      const id = entry && typeof entry['bundle_id'] === 'string' ? entry['bundle_id'] : undefined;
      if (!id) continue;
      const launchPath = typeof entry?.['launch_path'] === 'string' ? entry['launch_path'] : undefined;
      extra.push({ id, name: owner, pid, frontmost: false, windowCount: 0, ...(launchPath ? { executablePath: launchPath } : {}) });
    }
    return extra.length > 0 ? [...apps, ...extra] : apps;
  } catch {
    return apps;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: alive, owned by someone else — not one of ours, but not gone either.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Advertised accessibility actions → the driver's `click` `action` (macOS AX names; Windows UIA "Invoke" is a press). */
const CLICK_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['AXPress', 'press'],
  ['Invoke', 'press'],
  ['AXShowMenu', 'show_menu'],
  ['AXPick', 'pick'],
  ['AXConfirm', 'confirm'],
  ['AXCancel', 'cancel'],
  ['AXOpen', 'open'],
  ['AXShowAlternateUI', 'show_alternate_ui'],
  ['AXShowDefaultUI', 'show_default_ui'],
]);

/** A window title naming the file at `target` ("draft.txt", "draft.txt — Edited", "draft"). */
function windowShowsFile(title: string, target: string): boolean {
  const base = path.basename(target.replace(/^file:\/\//, ''));
  const stem = base.replace(/\.[^.]+$/, '');
  const t = title.trim();
  return t === base || t.startsWith(`${base} `) || t === stem || t.startsWith(`${stem} —`);
}

/**
 * The driver's "several elements match" refusal lists candidates as
 * `nth K: [row] ROLE "label"`; the first that is not a menu item, or undefined.
 */
export function firstNonMenuCandidate(message: string | undefined): number | undefined {
  if (!message || !/elements match/i.test(message)) return undefined;
  for (const m of message.matchAll(/nth (\d+): \[\d+\] (\S+)/g)) {
    if (!/^AXMenu|^MenuItem$|^menu/i.test(m[2]!)) return Number(m[1]);
  }
  return undefined;
}

/** `open -b`: LaunchServices activates the app and sends it a reopen, as a Dock click does. */
function openBundle(bundleId: string): Promise<void> {
  return new Promise((resolve) => execFile('/usr/bin/open', ['-b', bundleId], { timeout: 10_000 }, () => resolve()));
}

/**
 * A typing step right after a pixel click types where that click landed:
 * custom-drawn fields (an equation editor, a canvas label) only take focus
 * from the point, and the driver otherwise refuses keys with no text input
 * focused.
 */
export function withPointFocus(req: ActionRequest, prev: ActionRequest | undefined): ActionRequest {
  if (req.type !== 'typeText' || req.element || req.focus || prev?.type !== 'clickPoint') return req;
  return { ...req, focus: { x: prev.x, y: prev.y } };
}

/** Labels of menu items that are not in the menu bar: the items of an open popup or context menu. */
export function openMenuLabels(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const row of rows) if (typeof row['element_index'] === 'number') byIndex.set(row['element_index'], row);
  const inMenuBar = (row: Record<string, unknown>): boolean => {
    for (let at: Record<string, unknown> | undefined = row, hops = 0; at && hops < 64; hops++) {
      if (/^AXMenuBar/.test(String(at['role'] ?? ''))) return true;
      at = typeof at['parent_index'] === 'number' ? byIndex.get(at['parent_index']) : undefined;
    }
    return false;
  };
  const labels: string[] = [];
  for (const row of rows) {
    const label = String(row['label'] ?? row['title'] ?? '').trim();
    if (!/MenuItem$/.test(String(row['role'] ?? '')) || !label || inMenuBar(row) || labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= 40) break;
  }
  return labels;
}

/**
 * The names save dialogs give the format a file extension stands for, most
 * common first. Generic file types, not any one app: tried against whatever
 * popups the dialog has.
 */
const FORMAT_NAMES: Readonly<Record<string, readonly string[]>> = {
  pdf: ['PDF'],
  jpg: ['JPEG', 'JPG'],
  jpeg: ['JPEG', 'JPG'],
  png: ['PNG'],
  tif: ['TIFF'],
  tiff: ['TIFF'],
  heic: ['HEIC'],
  gif: ['GIF'],
  bmp: ['BMP'],
  txt: ['Plain Text', 'Text', 'Text Documents', 'Unicode Text'],
  rtf: ['Rich Text Format', 'Rich Text Format (RTF)', 'RTF', 'Rich Text'],
  csv: ['CSV', 'CSV (Comma delimited)'],
  html: ['HTML', 'Web Page'],
  docx: ['Word Document', 'Word', 'Word Document (.docx)'],
  xlsx: ['Excel Workbook', 'Excel', 'Excel Workbook (.xlsx)'],
  pptx: ['PowerPoint Presentation', 'PowerPoint'],
  odt: ['ODF Text Document'],
  ods: ['ODF Spreadsheet'],
  applescript: ['Text'],
};

/** The format names a file name's extension implies, if any. */
export function formatNamesFor(name: string): readonly string[] {
  const ext = path.extname(name).slice(1).toLowerCase();
  return FORMAT_NAMES[ext] ?? [];
}

/** The files inside `target` when the export made it a folder (one file per table or page). */
function exportedFolder(target: string): string[] | undefined {
  try {
    return statSync(target).isDirectory() ? readdirSync(target) : undefined;
  } catch {
    return undefined;
  }
}

/** A file the dialog wrote under another name — the name plus the format's own extension ("sine.pdf.tiff"). */
function savedInstead(folder: string, name: string): string | undefined {
  try {
    const stray = readdirSync(folder).find((f) => f !== name && f.startsWith(`${name}.`));
    return stray ? path.join(folder, stray) : undefined;
  } catch {
    return undefined;
  }
}

/** The button a start screen or Open panel offers for a blank document, best first. */
export function pickNewDocumentButton(rows: ReadonlyArray<Record<string, unknown>>): { token: string; label: string } | undefined {
  const wanted = [/^new document$/i, /^blank( document)?$/i, /^create$/i, /^new$/i];
  const buttons = rows.filter((r) => /Button$/.test(String(r['role'] ?? '')) && typeof r['element_token'] === 'string' && r['enabled'] !== false);
  for (const pattern of wanted) {
    const hit = buttons.find((r) => pattern.test(String(r['label'] ?? r['title'] ?? '').replace(/…|\.{3}/g, '').trim()));
    if (hit) return { token: String(hit['element_token']), label: String(hit['label'] ?? hit['title']) };
  }
  return undefined;
}

/** The File-menu item that creates a new document, from the items the menu lists. */
export function pickNewDocumentItem(items: readonly string[]): string | undefined {
  const plain = items.find((i) => /^new(…|\.\.\.)?$/i.test(i.trim()));
  if (plain) return plain;
  return items.find(
    (i) => /^new\b/i.test(i) && !/\b(tab|window|folder|smart|from|playlist|tag|group|private)\b/i.test(i),
  );
}

/**
 * A template chooser or start screen: an untitled window the size of a
 * document browser. A small untitled window is an alert, which is never
 * answered blind.
 */
export function isIntermediateWindow(w: ComputerWindowInfo): boolean {
  return w.title === '' && (!w.bounds || (w.bounds.w >= 700 && w.bounds.h >= 450));
}

/** A target named by label rather than snapshot index, as `run_steps` takes it. */
function named(req: { name: string; role?: string; nth?: number }): Json {
  return { name: req.name, ...(req.role ? { role: req.role } : {}), ...(req.nth !== undefined ? { nth: req.nth } : {}) };
}

/** Driver tools whose input is real keyboard/mouse events rather than an accessibility action. */
const SYNTHETIC_TOOLS: ReadonlySet<string> = new Set(['type_text', 'press_key', 'hotkey', 'scroll', 'drag']);

/** A step's own delivery mode stays only where the tool takes one; set_value refuses it. */
/** A typing or key step the driver could not deliver to any text input in the background. */
export function typedNowhere(message: string | undefined): boolean {
  return /no_focused_text_input|delivered 0 of \d+ character|focused element in this window is not a text input/i.test(message ?? '');
}

/** The step that focused the field a failed key step was meant for: the nearest click before it, else the step itself. */
function lastFocusingStep(segment: ReadonlyArray<{ call: { tool: string } }>, failedAt: number): number {
  for (let n = failedAt - 1; n >= 0; n -= 1) {
    if (/click$/.test(segment[n]!.call.tool)) return n;
    if (!/^(type_text|press_key|hotkey)$/.test(segment[n]!.call.tool)) break;
  }
  return failedAt;
}

function stripDeliveryFor(tool: string, args: Json): Json {
  if (FOREGROUND_CAPABLE.has(tool) || args['delivery_mode'] === undefined) return args;
  const rest = { ...args };
  delete rest['delivery_mode'];
  return rest;
}

/**
 * `run_steps`' per-step outcome: `steps[].ok` and `failed_step`, per the
 * driver's workflow guide. A whole-call error with no step list fails the first
 * step; a success with no step list counts every step as run.
 */
export function parseRunSteps(result: DriverToolResult, count: number): Array<{ ok: boolean; message?: string }> {
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(result.structuredJson ?? '{}') as Record<string, unknown>;
  } catch {
    root = {};
  }
  const steps = Array.isArray(root['steps']) ? (root['steps'] as unknown[]) : undefined;
  if (!steps) {
    if (result.isError) return [{ ok: false, message: result.text || 'The batch was refused.' }];
    return Array.from({ length: count }, () => ({ ok: true }));
  }
  const out: Array<{ ok: boolean; message?: string }> = [];
  for (const raw of steps.slice(0, count)) {
    const step = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const ok = step['ok'] === true || step['status'] === 'ok';
    const message = [step['error'], step['message'], step['status']].find((v): v is string => typeof v === 'string' && v !== 'ok');
    out.push(ok ? { ok } : { ok, message: message ?? 'The step failed.' });
    if (!ok) break;
  }
  return out;
}

/** Driver tools that take `delivery_mode` (set_value and invoke_menu do not, and refuse it). */
const FOREGROUND_CAPABLE: ReadonlySet<string> = new Set([
  'click',
  'right_click',
  'double_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
]);

/** The menu item a label was meant to name: equal once case, ellipses and surrounding space are ignored. */
export function closestMenuItem(wanted: string, items: readonly string[]): string | undefined {
  const norm = (label: string) => label.toLowerCase().replace(/…|\.{3}/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(wanted);
  const exact = items.find((item) => norm(item) === target);
  if (exact) return exact;
  // "Undo" for "Undo Insert": an item whose title starts with the label, when exactly one does.
  const prefixed = items.filter((item) => norm(item).startsWith(`${target} `));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/** The most of a diff handed back with an action; a bigger change is better read with a snapshot. */
const MAX_DIFF_CHARS = 2_500;

function clipDiff(diff: string): string {
  // The driver's trailer repeats which snapshot id to use; the agent keeps its own.
  const body = diff.replace(/\n?Rows and indices are as before;[^\n]*$/u, '').trim();
  return body.length <= MAX_DIFF_CHARS
    ? body
    : `${body.slice(0, MAX_DIFF_CHARS)}\n… (${body.length - MAX_DIFF_CHARS} more characters changed — take a snapshot to read the window)`;
}

/** Budget for one accessibility-tree walk. */
const SNAPSHOT_WALK_MS = 4_000;
/** How long after reading an untitled window to check the app survived it (a crash lands within ~0.3 s). */
const CRASH_SETTLE_MS = 500;

/** How long a freshly launched macOS app may sit windowless before each nudge (activate, then ⌘N). */
const WINDOWLESS_NUDGE_MS = 4_000;

/** How long a paste keeps the agent's text on the clipboard before restoring the user's. */
const PASTE_SETTLE_MS = 600;

/** The modifier of the platform's command shortcuts (paste, new): ⌘ on macOS, Ctrl elsewhere. */
const PRIMARY_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

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

/**
 * On macOS the driver always runs embedded — spawned under GeneratorAI.app, whose identity macOS charges its
 * Accessibility and Screen Recording checks to — so its own "no CFBundleIdentifier" is expected and not a problem;
 * the grants that matter are the `tcc_*` checks. Reported as informational instead of turning the runtime
 * "degraded" with a warning nobody can act on (U-68).
 */
export function embeddedIdentity(check: ComputerRuntimeCheck, platform: NodeJS.Platform = process.platform): ComputerRuntimeCheck {
  if (platform !== 'darwin' || check.name !== 'bundle_identity' || check.status !== 'fail') return check;
  return { ...check, status: 'skip', message: 'Runs inside GeneratorAI.app, which holds its macOS permissions.' };
}

/**
 * With no stacking order, the app's real window is the biggest one that is not minimised. List order is not a
 * signal: measured on macOS Calculator without Screen Recording, every window reported off screen and the first
 * five were 30 px tab-bar strips the accessibility layer cannot resolve — reading one returned an empty tree.
 * Windows without bounds rank last, in list order.
 */
/**
 * Below this edge a window is a helper surface — a tab strip, a drag handle, a
 * status overlay — never the one a person works in. Chromium apps open several
 * 30 px strips; ChatGPT's launch reported one of them as "the new window".
 */
const MIN_WORK_WINDOW_EDGE = 100;

/**
 * The window a person would call the app's window: the largest open one that is
 * big enough to work in, among those on screen when the driver can tell (an
 * app keeps hidden full-size windows too: ChatGPT holds a 960×720 one off
 * screen). Windows without bounds count only when no window has bounds at all
 * (a driver that reports none), so a sized strip never beats them.
 */
export function mainWindow(windows: readonly ComputerWindowInfo[]): ComputerWindowInfo | undefined {
  // A palette (Numbers' Colours) is never the document: launching Numbers named it the new window.
  const documents = windows.some((w) => !w.floating) ? windows.filter((w) => !w.floating) : windows;
  const visible = documents.some((w) => w.onScreen) ? documents.filter((w) => w.onScreen) : documents;
  const sized = visible.filter((w) => w.bounds);
  if (sized.length === 0) return visible.find((w) => !w.minimised);
  return largestOpenWindow(
    sized.filter((w) => w.bounds!.w >= MIN_WORK_WINDOW_EDGE && w.bounds!.h >= MIN_WORK_WINDOW_EDGE),
  );
}

export function largestOpenWindow(windows: readonly ComputerWindowInfo[]): ComputerWindowInfo | undefined {
  let best: ComputerWindowInfo | undefined;
  let bestArea = -1;
  for (const w of windows) {
    if (w.minimised) continue;
    const area = w.bounds ? Math.max(0, w.bounds.w) * Math.max(0, w.bounds.h) : 0;
    if (area > bestArea) {
      best = w;
      bestArea = area;
    }
  }
  return best;
}
