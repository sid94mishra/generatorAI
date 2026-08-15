// ────────────────────────────────────────────────────────────────
// IComputerBridge — domain port for the Computer Use feature.
//
// The bridge abstracts "somewhere there's a process that can read a native
// app's accessibility tree and act on it". Implementations:
//
//   • CuaDriverBridge      — talks to a cua-driver host that Electron main
//                            spawned in embedded mode. Primary path.
//   • VisionFallbackBridge — screenshot + synthetic input, for apps with no
//                            usable accessibility surface. Tier 3 only.
//   • NullComputerBridge   — always available, always refuses. Used on the
//                            server, in CI, and whenever no desktop is
//                            attached, so "computer use off" is structurally
//                            enforced rather than a config check someone can
//                            forget.
//
// ComputerService is the only consumer. No vendor type (cua_driver, Electron,
// the platform a11y APIs) may appear in this file — INV-1.
//
// WHY THE DRIVER IS NOT SPAWNED HERE: macOS attributes Accessibility and
// Screen Recording grants to a *responsible app identity*. The driver must be
// launched by the signed desktop app so it inherits those grants. A bridge
// that spawned its own daemon — or an MCP server the harness SDK spawned —
// lands in the wrong responsibility chain and the grants silently do nothing.
// Adapters therefore resolve an endpoint that Electron main pushed to them.
//
// TWO SHAPES ARE LOAD-BEARING:
//
//   1. Apps reach the bridge only as a fully resolved `ComputerAppIdentity`.
//      A loose `{ appId?, appName?, pid? }` would let the blocklist/consent
//      decision key off one field while the adapter resolved another — a
//      confused deputy where the user approves Safari and the click lands in
//      1Password. Ambiguous `ComputerAppRef`s are resolved by
//      ComputerService, before the blocklist runs, and never reach here.
//
//   2. Every operation returns an envelope with a `refusal` channel. A refusal
//      is an expected, typed outcome the agent must reason about — not an
//      exception, and never an empty array that reads as "nothing is running".
//      Adapters throw only for genuine faults (transport dead, malformed
//      response).
// ────────────────────────────────────────────────────────────────

import type {
  ComputerActionResult,
  ComputerAppInfo,
  ComputerCapabilities,
  ComputerRefusalCode,
  ComputerWindowInfo,
} from '@generatorai/shared';

/** Opaque handle returned by `start()`; passed to every follow-up call. */
export interface ComputerHandle {
  workspaceId: string;
  /** Adapter id — 'cua-driver' | 'vision' | 'null'. */
  provider: string;
  providerVersion: string;
  /** Free-form host-owned identifier (session id, socket path, …). */
  hostRef: string;
  /**
   * False when the session exists but can never act (NullComputerBridge).
   * Separating "a session exists" from "a session can do something" stops the
   * service announcing `computer.session_started` for a dead end.
   */
  operational: boolean;
}

export interface ComputerStartOptions {
  workspaceId: string;
  workspaceRoot: string;
}

/**
 * How a caller *asks* for an app. Ambiguous by nature — a name is spoofable
 * and a pid is racy — so this type never reaches a bridge. ComputerService
 * resolves it against `listApps()` into exactly one `ComputerAppIdentity`,
 * then runs the blocklist on that.
 */
export type ComputerAppRef =
  | { by: 'appId'; appId: string }
  | { by: 'appName'; appName: string }
  | { by: 'pid'; pid: number };

/** A single, unambiguous app. Every field refers to the same process. */
export interface ComputerAppIdentity {
  appId: string;
  name: string;
  pid: number;
}

/** Which window of a resolved app to operate on. */
export type ComputerWindowSelector =
  | { by: 'id'; id: number }
  | { by: 'index'; index: number }
  | { by: 'focused' };

export interface ComputerWindowTarget {
  app: ComputerAppIdentity;
  window: ComputerWindowSelector;
}

export interface SnapshotRequest extends ComputerWindowTarget {
  /** Cap on returned elements. The service clamps this to config. */
  maxElements?: number;
  maxDepth?: number;
  /** Capture a per-window PNG alongside the tree. Never full-screen. */
  includeScreenshot?: boolean;
  /**
   * Case-insensitive substring over role, label and value, applied by the
   * driver before it builds the payload. Matching rows keep their ancestors
   * and their original `element_index`, so a projected snapshot stays
   * actionable. Measured on a live Excel grid: 118,557 B → 3,992 B.
   */
  query?: string;
}

/**
 * One predicate about a window's contents. Modelled on the driver's own
 * vocabulary, deliberately narrow: absence cannot be proven on every platform,
 * so `exists` is assert-present only.
 */
export interface VerifyPredicate {
  /** Match by accessibility role and/or a substring of the label. */
  selector: { role?: string; labelContains?: string };
  /** Exact expected value of the matched element. */
  valueEquals?: string;
  exists?: true;
  enabled?: boolean;
  selected?: boolean;
}

export interface VerifyRequest extends ComputerWindowTarget {
  /** 1–8 predicates, combined with AND. */
  expect: VerifyPredicate[];
  /** Repeat sampling to ride out a UI still settling. */
  stableSamples?: number;
  timeoutMs?: number;
}

/** One diagnostic line from the driver's own health model. */
export interface ComputerRuntimeCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
}

/**
 * Whether a driver is reachable, and how — asked before any session exists so
 * Settings can tell "not installed" apart from "installed but not started".
 */
export interface ComputerRuntimeStatus {
  provider: string;
  providerVersion?: string;
  /**
   * `in-process` runs inside this process and cannot own the agent-cursor
   * overlay; `attached` is an external driver reached over its endpoint.
   */
  host: 'in-process' | 'attached' | 'none';
  /** `stopped` means startable; `unavailable` means nothing here can fix it. */
  state: 'ready' | 'stopped' | 'degraded' | 'unavailable';
  detail?: string;
  checks?: ComputerRuntimeCheck[];
}

export interface VerifyResult {
  /**
   * `unknown` is not a failure to answer — it is the answer. It means the
   * observation could not prove the predicate either way, and callers must
   * never round it up to success.
   */
  outcome: 'satisfied' | 'unsatisfied' | 'unknown';
  /** Per-predicate detail, same order as `expect`. */
  results: Array<{
    outcome: 'satisfied' | 'unsatisfied' | 'unknown';
    detail?: string;
    /** How many elements the selector matched — the reason behind `multi_match`. */
    matches?: number;
  }>;
  refusal?: ComputerRefusal;
}

/** Modifier vocabulary, closed so platform spellings cannot cross the port. */
export type ComputerModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

/**
 * Element-addressed variants carry `snapshotId` — required, not optional, so a
 * caller cannot act on an unfenced index. The bridge rejects a superseded id
 * with `stale_snapshot` rather than acting on whatever now sits at that
 * position.
 *
 * `performAction.actionName` MUST be a member of the target element's
 * `actions` array in that snapshot. The service rejects anything else, so an
 * adapter may not accept arbitrary provider action names.
 *
 * There is no `hotkey` variant: a chord is `pressKey` with `modifiers`.
 * `ComputerCapabilities.supports.hotkey` reports whether the provider can
 * deliver chorded presses at all.
 */
export type ActionRequest =
  | { type: 'click'; snapshotId: string; elementIndex: number; button?: 'left' | 'right'; clickCount?: number }
  | { type: 'setValue'; snapshotId: string; elementIndex: number; value: string }
  | { type: 'performAction'; snapshotId: string; elementIndex: number; actionName: string }
  | { type: 'clickPoint'; target: ComputerWindowTarget; x: number; y: number; button?: 'left' | 'right' }
  | { type: 'typeText'; target: ComputerWindowTarget; text: string }
  | { type: 'pressKey'; target: ComputerWindowTarget; key: string; modifiers?: readonly ComputerModifier[] }
  | { type: 'pasteText'; target: ComputerWindowTarget; text: string }
  | { type: 'scroll'; target: ComputerWindowTarget; deltaX: number; deltaY: number; x?: number; y?: number }
  | {
      type: 'drag';
      target: ComputerWindowTarget;
      from: { x: number; y: number };
      to: { x: number; y: number };
    };

export type ActionRequestType = ActionRequest['type'];

/**
 * The single source of truth for which variants are snapshot-fenced.
 *
 * Discriminating on the tag rather than `'snapshotId' in req`: the `in` check
 * is true for a property that is present-but-undefined, and would silently
 * start returning `true` for any future variant that made the fence optional —
 * the exact failure the fence exists to prevent.
 */
const ELEMENT_ADDRESSED_TYPES: ReadonlySet<ActionRequestType> = new Set([
  'click',
  'setValue',
  'performAction',
]);

export type ElementAddressedRequest = Extract<ActionRequest, { snapshotId: string }>;

export function isElementAddressed(req: ActionRequest): req is ElementAddressedRequest {
  return ELEMENT_ADDRESSED_TYPES.has(req.type);
}

/** Shared envelope so no operation can report unavailability as emptiness. */
export interface ComputerRefusal {
  code: ComputerRefusalCode;
  message: string;
}

export interface ListAppsResult {
  apps: ComputerAppInfo[];
  /**
   * Windows per pid, when the provider can supply them from the same
   * observation. Populating this is strongly preferred: the blocklist scans
   * every window title of every app, so without it a single `listApps` costs
   * one full accessibility walk per running application.
   */
  windowsByPid?: Map<number, ComputerWindowInfo[]>;
  refusal?: ComputerRefusal;
}

export interface ListWindowsResult {
  windows: ComputerWindowInfo[];
  refusal?: ComputerRefusal;
}

export interface LaunchAppResult {
  app?: ComputerAppIdentity;
  refusal?: ComputerRefusal;
}

export interface RecordingRequest {
  /** Absolute directory for the turn folders and, when enabled, the video. */
  outputDir: string;
  /**
   * Also capture the screen to `<outputDir>/recording.mp4`. Off by default —
   * on Windows and Linux it needs ffmpeg on PATH, and when ffmpeg is missing
   * the per-turn capture still runs while the video silently does not.
   */
  video?: boolean;
}

export interface RecordingState {
  recording: boolean;
  outputDir?: string;
  /** 1-based index of the next turn folder the recorder will write. */
  nextTurn?: number;
  /** Set by `stopRecording` when video was on and the mp4 was finalised. */
  videoPath?: string;
  /** Recorder-reported problem — a missing ffmpeg, most often. */
  detail?: string;
  refusal?: ComputerRefusal;
}

/**
 * Fired by the host on out-of-band events so ComputerService can emit
 * `computer.*` events and drive restart policy. Never called synchronously
 * from `start()` — the service subscribes after start resolves.
 */
export interface ComputerHostObserver {
  /** Host process died (driver crash, socket closed, desktop app quit). */
  onCrash?: (handle: ComputerHandle, error: string) => void;
  /** The OS revoked or has not yet granted a required permission. */
  onPermissionChanged?: (handle: ComputerHandle, granted: boolean, detail: string) => void;
}

/**
 * The port. Implementations are stateful — one instance manages many
 * concurrent handles keyed by workspaceId.
 */
export interface IComputerBridge {
  readonly id: string;

  /**
   * True if this bridge can accept `start()` for this workspace right now.
   * `CuaDriverBridge` returns false until Electron main has pushed an endpoint
   * for it, so the service falls through to the next bridge in the chain.
   *
   * Takes the workspace id because availability is per-workspace: one desktop
   * having a driver must not make every other workspace look ready.
   */
  isAvailable(workspaceId: string): Promise<boolean>;
  /**
   * Read-only. Must never start a driver or open a session — Settings polls
   * this, and a GET that acquires desktop control is a gate nobody asked for.
   */
  runtime(workspaceId?: string): Promise<ComputerRuntimeStatus>;

  /**
   * Feature probe. Callable without a handle so the service can advertise
   * capabilities (and known limitations, e.g. "KDE: no window rects") to the
   * agent before a session exists.
   */
  capabilities(workspaceId: string): Promise<ComputerCapabilities>;

  start(opts: ComputerStartOptions, observer?: ComputerHostObserver): Promise<ComputerHandle>;

  /** Gracefully release the session; safe to call twice. */
  stop(handle: ComputerHandle): Promise<void>;

  /**
   * Release process-level resources — a driver this bridge spawned, say. Not
   * per-session: `stop` already covers that.
   */
  dispose?(): Promise<void>;

  /**
   * Running applications, UNFILTERED.
   *
   * Implementations must not apply the blocklist — ComputerService owns that
   * decision so a single code path enforces it and every refusal is audited.
   * The consequence is that this result transiently holds the names and pids
   * of security-sensitive apps, so it must never be logged, cached, persisted,
   * or emitted. ComputerService filters it before ANY other use — including
   * before using it to resolve a `ComputerAppRef`, not merely before returning
   * it to the agent.
   */
  listApps(handle: ComputerHandle): Promise<ListAppsResult>;

  /**
   * Starts an application that is not yet running, and returns its identity
   * once it has a window.
   *
   * Separate from `act()` because there is no running process to resolve or
   * blocklist beforehand — the caller can only name it. ComputerService
   * therefore blocklists the NAME first, and re-blocklists the resolved
   * identity after launch, before anything may drive it.
   */
  launchApp(
    handle: ComputerHandle,
    name: string,
    opts?: { url?: string; newInstance?: boolean },
    signal?: AbortSignal,
  ): Promise<LaunchAppResult>;

  /**
   * Restores and foregrounds a window.
   *
   * Needed because a minimised window's accessibility tree is virtualised:
   * edits against it report success and are then discarded. Without this the
   * agent can launch an app it is then unable to drive.
   */
  bringToFront(handle: ComputerHandle, app: ComputerAppIdentity, signal?: AbortSignal): Promise<ComputerActionResult>;

  listWindows(handle: ComputerHandle, app: ComputerAppIdentity): Promise<ListWindowsResult>;

  /**
   * `signal` aborts an in-flight call. It is not optional politeness: without
   * cancellation a timed-out action still lands, after the service has already
   * recorded it as refused and released its concurrency permit.
   */
  snapshot(handle: ComputerHandle, req: SnapshotRequest, signal?: AbortSignal): Promise<ComputerActionResult>;

  act(handle: ComputerHandle, req: ActionRequest, signal?: AbortSignal): Promise<ComputerActionResult>;

  /**
   * Checks predicates against a window and answers definitively.
   *
   * Exists because "did that work?" has no answer anywhere else: UIA writes
   * come back `unverifiable`, and reading the value back goes through the same
   * provider that may have discarded it. `unknown` is a first-class result and
   * never means success.
   */
  verify(
    handle: ComputerHandle,
    req: VerifyRequest,
    signal?: AbortSignal,
  ): Promise<VerifyResult>;

  /**
   * Trajectory recording: per-action before/after state, screenshots and
   * arguments, plus an optional screen video.
   *
   * Optional because only a daemon-backed adapter can do it — the recorder
   * lives in the daemon, so the in-process runtime and the null bridge have
   * nothing to turn on. It is also daemon-global rather than per-session: the
   * driver records every action that reaches it while enabled, and stopping
   * stops whatever is running.
   */
  startRecording?(handle: ComputerHandle, req: RecordingRequest): Promise<RecordingState>;
  stopRecording?(handle: ComputerHandle): Promise<RecordingState>;
  recordingState?(handle: ComputerHandle): Promise<RecordingState>;
}
