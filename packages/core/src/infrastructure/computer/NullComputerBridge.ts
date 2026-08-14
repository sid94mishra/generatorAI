// ────────────────────────────────────────────────────────────────
// NullComputerBridge — always available, always refuses.
//
// This exists so "computer use is off" is a structural property rather than a
// config check somebody can forget. It is the last entry in the bridge chain,
// so on the server, in CI, and whenever no desktop is attached, every call
// resolves to a typed `provider_unavailable` refusal instead of throwing,
// hanging, or — worst case — silently reaching a real driver.
//
// It is also the contract fixture: any change to `IComputerBridge` must be
// satisfiable here without pulling in a platform dependency.
// ────────────────────────────────────────────────────────────────

import type {
  ComputerActionResult,
  ComputerCapabilities,
} from '@generatorai/shared';
import type {
  ActionRequest,
  ComputerAppIdentity,
  ComputerHandle,
  ComputerRefusal,
  ComputerRuntimeStatus,
  ComputerStartOptions,
  IComputerBridge,
  LaunchAppResult,
  ListAppsResult,
  ListWindowsResult,
  SnapshotRequest,
  VerifyRequest,
  VerifyResult,
} from '../../domain/ports/IComputerBridge.js';

const NO_SUPPORT: ComputerCapabilities['supports'] = {
  listApps: false,
  listWindows: false,
  snapshot: false,
  screenshot: false,
  elementBounds: false,
  backgroundClick: false,
  backgroundType: false,
  setValue: false,
  performAction: false,
  scroll: false,
  drag: false,
  hotkey: false,
  pasteText: false,
};

export interface NullComputerBridgeOptions {
  /**
   * Why the feature is unavailable, surfaced verbatim to the agent. Callers
   * should be specific — "no desktop app is attached" is actionable, "not
   * supported" is not.
   */
  reason?: string;
}

export class NullComputerBridge implements IComputerBridge {
  readonly id = 'null';

  private readonly reason: string;

  constructor(options: NullComputerBridgeOptions = {}) {
    this.reason =
      options.reason ??
      'Computer use is not available in this environment. It requires the GeneratorAI desktop app running on the machine you want to control.';
  }

  async isAvailable(_workspaceId: string): Promise<boolean> {
    // Deliberately true: this bridge's whole job is to terminate the chain
    // with a clear refusal rather than let resolution fall off the end.
    return true;
  }

  async runtime(_workspaceId?: string): Promise<ComputerRuntimeStatus> {
    return { provider: this.id, host: 'none', state: 'unavailable', detail: this.reason };
  }

  async capabilities(_workspaceId?: string): Promise<ComputerCapabilities> {
    return {
      // Not `process.platform`: on the server that reports the platform of the
      // machine running the API, not the desktop the agent wants to drive, and
      // the model will condition on it (`darwin` ⇒ "try Cmd+S").
      platform: 'unknown',
      provider: this.id,
      providerVersion: '0',
      supports: { ...NO_SUPPORT },
      limitations: [this.reason],
    };
  }

  async start(opts: ComputerStartOptions): Promise<ComputerHandle> {
    return {
      workspaceId: opts.workspaceId,
      provider: this.id,
      providerVersion: '0',
      hostRef: 'null',
      operational: false,
    };
  }

  async stop(_handle: ComputerHandle): Promise<void> {
    // Nothing was ever started.
  }

  async listApps(_handle: ComputerHandle): Promise<ListAppsResult> {
    // An empty array alone would read as "the machine is idle"; the refusal is
    // what tells the agent to stop planning around a desktop it cannot reach.
    return { apps: [], refusal: this.refusal() };
  }

  async listWindows(_handle: ComputerHandle, _app: ComputerAppIdentity): Promise<ListWindowsResult> {
    return { windows: [], refusal: this.refusal() };
  }

  async launchApp(
    _handle: ComputerHandle,
    _name: string,
    _opts?: { url?: string; newInstance?: boolean },
  ): Promise<LaunchAppResult> {
    return { refusal: this.refusal() };
  }

  async bringToFront(_handle: ComputerHandle, _app: ComputerAppIdentity): Promise<ComputerActionResult> {
    return this.refuse();
  }

  async snapshot(_handle: ComputerHandle, _req: SnapshotRequest, _signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.refuse();
  }

  async act(_handle: ComputerHandle, _req: ActionRequest, _signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.refuse();
  }

  async verify(
    _handle: ComputerHandle,
    _req: VerifyRequest,
    _signal?: AbortSignal,
  ): Promise<VerifyResult> {
    // `unknown`, not `unsatisfied`: with no provider we observed nothing, and
    // claiming a predicate is false is as wrong as claiming it is true.
    return { outcome: 'unknown', results: [], refusal: this.refusal() };
  }

  private refusal(): ComputerRefusal {
    return { code: 'provider_unavailable', message: this.reason };
  }

  private refuse(): ComputerActionResult {
    return {
      ok: false,
      snapshot: null,
      screenshot: null,
      refusal: this.refusal(),
    };
  }
}
