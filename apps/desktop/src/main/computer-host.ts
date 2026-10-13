// ────────────────────────────────────────────────────────────────
// computer-host — owns the cua-driver process for Computer Use.
//
// WHY THIS LIVES IN ELECTRON MAIN, AND NOWHERE ELSE:
// macOS attributes Accessibility and Screen Recording grants to a
// *responsible app identity* — the signed application at the head of the
// spawn chain. A driver started by the API server, by the harness SDK as an
// MCP server, or from a terminal lands under a different responsible process:
// the user's grant to GeneratorAI.app does not apply, and the calls fail
// silently or re-prompt forever. cua-driver documents the same constraint:
// "a gateway, terminal, or unrelated helper must not spawn the daemon on the
// app's behalf", and a raw `cua-driver serve` outside the app bundle "has no
// stable bundle identity for TCC attribution".
//
// So: the embedded host is started here, from the signed bundle, and only the
// resulting socket path is handed to the server over the loopback handshake.
//
// The SDK is imported lazily so a build for a platform with no prebuilt
// binary — or a user who never enables the feature — never loads it.
// ────────────────────────────────────────────────────────────────

import { app, desktopCapturer, shell, systemPreferences } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** Must match `appId` in `scripts/lib/build-config.mjs`. */
const HOST_BUNDLE_ID = 'ai.generatorai.desktop';

/** Mirrors `EmbeddedPermissionMode` in the driver SDK. */
const PERMISSION_MODE_STANDARD = 0;

export interface ComputerHostEndpoint {
  socketPath: string;
  driverVersion: string;
  pid: number;
  platform: string;
  displayServer?: string;
}

export interface MacPermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
}

export interface ComputerHostOptions {
  /** Absolute base URL of the local server, e.g. http://127.0.0.1:3100. */
  serverBaseUrl: string;
  /** The per-lifetime token shared with the server via GENERATORAI_ELECTRON_IPC_TOKEN. */
  ipcToken: string;
  log?: (message: string) => void;
}

interface EmbeddedHostLike {
  start(): Promise<{ socketPath: string; pid: number; generation: string; driverVersion: string }>;
  stop(): Promise<void>;
  waitForExit(generation: string): Promise<{ generation: string; code?: number; success: boolean }>;
}

interface DriverSdk {
  EmbeddedCuaDriverHost: {
    withOptions(options: Record<string, unknown>): EmbeddedHostLike;
  };
}

export class ComputerHost {
  private host: EmbeddedHostLike | null = null;
  private endpoint: ComputerHostEndpoint | null = null;
  private generation: string | null = null;
  private starting: Promise<ComputerHostEndpoint> | null = null;
  private readonly workspaces = new Set<string>();

  constructor(private readonly options: ComputerHostOptions) {}

  private log(message: string): void {
    this.options.log?.(`[ComputerHost] ${message}`);
  }

  /**
   * Accessibility + Screen Recording status, without prompting. Returns `null` off macOS, where neither grant
   * exists — callers must treat that as "not applicable", not as "denied".
   */
  async permissionStatus(): Promise<MacPermissionStatus | null> {
    return process.platform === 'darwin' ? macPermissionStatus() : null;
  }

  async openScreenRecordingSettings(): Promise<void> {
    await openScreenRecordingSettings();
  }

  /**
   * Starts the driver if needed and registers it for `workspaceId`.
   * Idempotent and race-safe: concurrent callers share one start.
   */
  async ensureStarted(workspaceId: string): Promise<ComputerHostEndpoint> {
    this.workspaces.add(workspaceId);
    if (this.endpoint) {
      await this.publish(workspaceId, this.endpoint);
      return this.endpoint;
    }
    this.starting ??= this.startHost().finally(() => {
      this.starting = null;
    });
    const endpoint = await this.starting;
    await this.publish(workspaceId, endpoint);
    return endpoint;
  }

  private async startHost(): Promise<ComputerHostEndpoint> {
    if (process.platform === 'darwin') {
      // Asked from here, the permission-owning app: the embedded driver never prompts, and the SDK's native helper
      // did not load in the packaged app — so GeneratorAI never asked, and never appeared under Privacy (U-67).
      const status = await requestMacPermissions();
      if (!status.accessibility || !status.screenRecording) {
        throw new Error(
          `macOS has not granted the permissions computer use requires (accessibility: ${status.accessibility}, screen recording: ${status.screenRecording}). Grant them in System Settings → Privacy & Security, then try again.`,
        );
      }
    }

    const sdk = await this.loadSdk();
    if (!sdk) throw new Error('The cua-driver SDK is not available in this build.');

    const binaryPath = resolveDriverBinary();
    if (!binaryPath) throw new Error('No cua-driver binary was found for this platform in the app bundle.');

    const host = sdk.EmbeddedCuaDriverHost.withOptions({
      binaryPath,
      hostBundleId: HOST_BUNDLE_ID,
      // `bounded` is the posture we want — it would restrict the driver to a
      // manifest of the tools we actually expose, enforcing at the driver what
      // ComputerService enforces at the service. It refuses to start without
      // `sessionPolicyPath` ("bounded mode requires session_policy_path"), and
      // we ship no manifest yet, so the daemon would never come up.
      //
      // `standard` still gates every destructive tool behind the driver's own
      // approval; `approveSessionPolicy` is rejected outside bounded mode.
      permissionMode: PERMISSION_MODE_STANDARD,
      approveSessionPolicy: false,
      // Never true. It disables the driver's own approval gate, which is the
      // last line of defence if our service-side gates are ever bypassed.
      dangerouslyBypassApprovals: false,
      // Empty rather than inherited: Electron main's environment holds
      // GENERATORAI_ELECTRON_IPC_TOKEN and the desktop admin token, and the
      // driver has no business seeing either.
      environment: [],
      inheritStderr: false,
    });

    const connection = await host.start();
    this.host = host;
    this.generation = connection.generation;
    this.endpoint = {
      socketPath: connection.socketPath,
      driverVersion: connection.driverVersion,
      pid: connection.pid,
      platform: process.platform,
      displayServer: detectDisplayServer(),
    };
    this.log(`driver ${connection.driverVersion} ready (pid ${connection.pid})`);

    // A driver that dies must not leave a live endpoint registered — the next
    // action would otherwise hang against a socket nobody is listening on.
    void host
      .waitForExit(connection.generation)
      .then((exit) => {
        if (this.generation !== exit.generation) return;
        this.log(`driver exited (code ${exit.code ?? 'unknown'})`);
        void this.handleExit();
      })
      .catch(() => undefined);

    return this.endpoint;
  }

  private async handleExit(): Promise<void> {
    this.host = null;
    this.endpoint = null;
    this.generation = null;
    await Promise.all([...this.workspaces].map((id) => this.publish(id, null)));
  }

  async stop(): Promise<void> {
    const host = this.host;
    this.host = null;
    this.generation = null;
    this.endpoint = null;
    await Promise.all([...this.workspaces].map((id) => this.publish(id, null)));
    this.workspaces.clear();
    if (!host) return;
    try {
      await host.stop();
    } catch (err) {
      this.log(`stop failed: ${(err as Error).message}`);
    }
  }

  /** Pushes (or clears) the endpoint over the loopback handshake. */
  private async publish(workspaceId: string, endpoint: ComputerHostEndpoint | null): Promise<void> {
    try {
      const response = await fetch(`${this.options.serverBaseUrl}/internal/computer/endpoint`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.ipcToken}`,
        },
        body: JSON.stringify({ workspaceId, endpoint }),
      });
      if (!response.ok) this.log(`endpoint publish failed: HTTP ${response.status}`);
    } catch (err) {
      this.log(`endpoint publish failed: ${(err as Error).message}`);
    }
  }

  private async loadSdk(): Promise<DriverSdk | null> {
    try {
      return (await import('@trycua/cua-driver/embedded')) as unknown as DriverSdk;
    } catch (err) {
      this.log(`cua-driver SDK unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * Locates the driver binary inside the packaged app.
 *
 * It must be unpacked from the asar: the OS cannot exec a file inside an
 * archive, and on macOS a binary outside the signed bundle would break the TCC
 * responsibility chain this whole module exists to preserve.
 *
 * `GENERATORAI_CUA_DRIVER_PATH` is honoured ONLY in an unpackaged dev build.
 * In a signed app it would be a TCC-laundering primitive: anything able to
 * influence the app's environment (`launchctl setenv`, a LaunchAgent plist, a
 * poisoned shell profile) could have an arbitrary executable spawned as a
 * child of the signed bundle, inheriting the user's Accessibility and Screen
 * Recording grants.
 */
export function resolveDriverBinary(): string | null {
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const packaged = app?.isPackaged ?? true;
  const target = `${process.platform}-${process.arch}`;
  const candidates = [
    packaged ? undefined : process.env['GENERATORAI_CUA_DRIVER_PATH'],
    path.join(process.resourcesPath ?? '', 'cua-driver', exe),
    // Dev and CI run from the checkout, where `scripts/fetch-cua-driver.mjs`
    // stages per target rather than flattening into one folder.
    packaged
      ? undefined
      : path.resolve(app?.getAppPath?.() ?? process.cwd(), 'resources', 'cua-driver', target, exe),
    packaged
      ? undefined
      : path.resolve(process.cwd(), 'apps', 'desktop', 'resources', 'cua-driver', target, exe),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return null;
}

/** Linux only; determines which capabilities the driver can offer. */
export function detectDisplayServer(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  if (process.env['WAYLAND_DISPLAY'] === undefined) return 'x11';
  const desktop = (process.env['XDG_CURRENT_DESKTOP'] ?? '').toLowerCase();
  if (desktop.includes('sway')) return 'wayland-sway';
  if (desktop.includes('gnome')) return 'wayland-gnome';
  if (desktop.includes('kde')) return 'wayland-kde';
  return 'wayland-unknown';
}

const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/** Both grants, read without prompting (macOS only). */
export function macPermissionStatus(): MacPermissionStatus {
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted',
  };
}

export async function openScreenRecordingSettings(): Promise<void> {
  await shell.openExternal(SCREEN_RECORDING_SETTINGS);
}

/**
 * Asks macOS for both grants and reports them. Each request also lists GeneratorAI under its Privacy & Security
 * pane (macOS lists only apps that have asked): Accessibility through the trusted-client check with its prompt,
 * Screen Recording through a capture-source query, which raises the system's own prompt the first time.
 */
export async function requestMacPermissions(): Promise<MacPermissionStatus> {
  const accessibility = systemPreferences.isTrustedAccessibilityClient(true);
  let screenRecording = systemPreferences.getMediaAccessStatus('screen') === 'granted';
  if (!screenRecording) {
    await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
    screenRecording = systemPreferences.getMediaAccessStatus('screen') === 'granted';
  }
  return { accessibility, screenRecording };
}
