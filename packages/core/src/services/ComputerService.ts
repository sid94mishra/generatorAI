// ────────────────────────────────────────────────────────────────
// ComputerService — Computer Use lifecycle, safety gates, and events.
//
// One instance manages every workspace's computer-use session. It chooses a
// bridge, resolves app references, enforces the blocklist and consent, caps
// concurrency, persists screenshots, and emits `computer.*` events. Mirrors
// `BrowserService` (INV-2 per-workspace FIFO emit queue, INV-3 artifact write
// before emit) because computer use has the same structural problems.
//
// THE EXECUTION ORDER IS THE SECURITY DESIGN. Every operation runs these
// gates, in this order, and an early gate never depends on a later one:
//
//   1. Feature gate       — env kill switch, then config.enabled
//   2. Bridge resolution  — first bridge whose isAvailable() is true
//   3. App resolution     — ambiguous ref → exactly one identity
//   4. Blocklist          — on the resolved identity + its window titles
//   5. Tier gate          — synthetic input requires an explicit opt-in
//   6. Consent            — stored grant of sufficient scope, else prompt
//   7. Concurrency permit — the desktop is a singleton resource
//   ── everything below runs INSIDE the permit ──
//   8. Re-resolve         — the app may have exited during the prompt
//   9. Snapshot fence     — reject a superseded or foreign snapshotId
//  10. Dispatch           — bridge.act(), cancellable
//  11. Invalidate         — the UI moved; every snapshot for the app is stale
//  12. Artifact write     — screenshot → repository            [INV-3]
//  13. Audit              — success AND refusal
//  14. Event emit         — per-workspace FIFO queue           [INV-2]
//
// Steps 8-11 are inside the permit on purpose. Checking the fence outside it
// lets two concurrent calls carrying the same snapshotId both pass, then
// serialise — the second acting on a UI the first just moved, which is the
// exact "index 12 meant something else" bug the fence exists to prevent.
// ────────────────────────────────────────────────────────────────

import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  AgentEvent,
  AppConfig,
  ComputerActionResult,
  ComputerAppInfo,
  ComputerCapabilities,
  ComputerConsentDecision,
  ComputerRefusalCode,
  ComputerWindowInfo,
  ILogger,
  WorkspaceArtifactRecord,
} from '@generatorai/shared';
import {
  COMPUTER_USE_DISABLE_TOKENS,
  COMPUTER_USE_KILL_SWITCH_ENV,
  buildBlocklist,
  evaluateBlocklist,
  type ComputerUseBlocklist,
} from '@generatorai/shared';
import type {
  ActionRequest,
  ComputerAppIdentity,
  ComputerAppRef,
  ComputerHandle,
  ComputerRefusal,
  ComputerRuntimeStatus,
  ComputerWindowTarget,
  IComputerBridge,
  RecordingRequest,
  RecordingState,
  VerifyPredicate,
  VerifyResult,
} from '../domain/ports/IComputerBridge.js';
import { readBoundedInt } from '@generatorai/shared';
import { isElementAddressed } from '../domain/ports/IComputerBridge.js';
import type { IWorkspaceArtifactRepository } from '../domain/ports/IWorkspaceArtifactRepository.js';
import type { EventBus } from '../events/EventBus.js';
import { transcodeScreenshot, validateFrameBytes } from '../infrastructure/computer/screenshotCodec.js';
import { Semaphore } from '../utils/Semaphore.js';
import { resolveWithinBase } from '../utils/safePath.js';

export type ComputerUseConfig = AppConfig['computerUse'];

/**
 * Privilege tiers a consent grant can cover, in increasing order.
 *
 * A grant carries its scope so approving a prompt that read "snapshot in
 * Slack" cannot silently authorise every future click and keystroke in Slack.
 * Widening requires a fresh prompt.
 */
export type ComputerConsentScope = 'read' | 'mutate' | 'synthetic';

const SCOPE_RANK: Record<ComputerConsentScope, number> = { read: 0, mutate: 1, synthetic: 2 };

export interface ComputerStoredGrant {
  decision: 'always_allow' | 'deny';
  scope: ComputerConsentScope;
}

/** Persistence + prompting seam. Backed by SQLite + the UI in Phase 5. */
export interface IComputerConsentStore {
  find(workspaceId: string, appIdentity: string): Promise<ComputerStoredGrant | null>;
  save(
    workspaceId: string,
    appIdentity: string,
    appLabel: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ): Promise<void>;
  /** Ask the user. The service enforces its own deadline on top of this. */
  prompt(request: ComputerConsentPrompt): Promise<ComputerConsentDecision>;
}

export interface ComputerConsentPrompt {
  requestId: string;
  workspaceId: string;
  chatId?: string;
  app: ComputerAppIdentity;
  action: string;
  summary: string;
  scope: ComputerConsentScope;
  /** The exact element this approval covers, when the action is fenced. */
  target?: { snapshotId: string; elementIndex: number; elementLabel: string };
  expiresAt: number;
}

export interface ComputerAuditEntry {
  workspaceId: string;
  chatId?: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  target?: string;
  path?: string;
  verified: boolean;
  refusalCode?: ComputerRefusalCode;
  /** Which blocklist field matched, when the refusal was `app_blocked`. */
  blockedOn?: string;
  artifactPath?: string;
  createdAt: Date;
}

export interface IComputerAuditSink {
  record(entry: ComputerAuditEntry): Promise<void>;
}

export interface ComputerCallContext {
  workspaceId: string;
  workspaceRoot: string;
  chatId?: string;
}

interface SnapshotEntry {
  snapshotId: string;
  app: ComputerAppIdentity;
  windowKey: string;
  /** Advertised actions per element index — the allowlist for performAction. */
  actions: Map<number, readonly string[]>;
  labels: Map<number, string>;
}

interface SessionRecord {
  workspaceId: string;
  /** Captured at start. Per-call roots are never trusted to widen containment. */
  workspaceRoot: string;
  handle: ComputerHandle;
  bridge: IComputerBridge;
  emitQueue: Promise<unknown>;
  lastActivityAt: number;
  /** Newest snapshot per window, keyed `${pid}:${windowId}`. Insertion-ordered LRU. */
  snapshots: Map<string, SnapshotEntry>;
  snapshotIndex: Map<string, string>;
  /**
   * Window the agent last looked at. Kept apart from `snapshots`, which is
   * emptied after every action to invalidate element indices — the preview
   * still needs to know what it is showing between those.
   */
  lastTarget?: { app: ComputerAppIdentity; windowId: number };
  /**
   * Consecutive synthetic actions the driver could not confirm.
   *
   * When accessibility goes down the driver keeps accepting input, it just
   * cannot see what the input did. The agent then has no feedback and improvises
   * — measured once as twenty straight unconfirmed clicks and chords, one of
   * which landed a stray character in a user's source file.
   */
  blindStreak: number;
  /**
   * Source pixels per pixel of the most recent screenshot handed to the model.
   * 1 when the capture was not resized.
   *
   * The tool schema tells the model to read coordinates off the screenshot
   * ("Window-local screenshot-pixel X"), so once we downscale that screenshot
   * the numbers it sends back are in the SMALLER space and the driver clicks in
   * the larger one. Every pixel-addressed action has to be scaled back up by
   * this before dispatch (X-14). Element-index actions are unaffected.
   */
  captureDownscale: number;
  /**
   * P1-29: Per-session action semaphore (1 permit).
   *
   * Previously a single global semaphore serialised ALL CUA actions for ALL
   * workspaces process-wide: one stuck action (e.g. a 30 s timeout in one chat)
   * blocked every other chat from driving their desktop. Each session now owns
   * its own 1-permit semaphore so a slow session only stalls ITSELF.
   *
   * A global cap (ComputerService.globalActionCap) still limits the total number
   * of concurrently executing actions across all sessions.
   */
  semaphore: Semaphore;
  /**
   * X-16: the last frame that produced an artifact, and the hash of the
   * CANONICAL capture it came from — the bytes the driver wrote, before any
   * resize or re-encode.
   *
   * Hashing post-transcode output would answer the wrong question: two
   * different screens can encode to the same bytes only by coincidence, but the
   * same screen re-encoded at a different `screenshotMaxEdge` (a config change,
   * a display swap) produces different bytes for an identical frame. The plan
   * says "hash the canonical full frame before cropping" for exactly this
   * reason.
   *
   * The artifact is retained so a duplicate frame can point the caller at the
   * frame it duplicates instead of at nothing — the image is genuinely still
   * available, so the model asking to see it must not be told there is none.
   */
  lastFrame: {
    hash: string;
    artifact: WorkspaceArtifactRecord;
    /** Post-transcode geometry, so a duplicate describes the file it points at. */
    encoded: { format: 'png' | 'jpeg' | 'webp'; width: number; height: number; downscale: number };
  } | null;
  // NOTE: the X-15 integrity latch deliberately does NOT live here. It used
  // to, as `inlineFramesOk`, and that made it not a latch at all: `stop()`,
  // the idle sweeper, `handleCrash` and `restartRuntime` all drop the record,
  // and the next action builds a fresh one with the latch open again. See
  // `ComputerService.inlineLatchClosed`.
}

export interface ComputerServiceConfig {
  eventBusScopeSessionId?: string;
  /** Cap on retained per-window snapshots. Bounds memory for read-only loops. */
  maxRetainedSnapshots?: number;
  /** Cap on retained screenshot artifacts per workspace. Bounds disk. */
  maxRetainedScreenshots?: number;
}

const REFUSAL_MESSAGES: Record<ComputerRefusalCode, string> = {
  background_unavailable: 'This app cannot be driven without taking over the screen.',
  background_occluded: 'The target window is covered by another window.',
  background_uipi_blocked: 'Windows blocked the interaction (the target runs at a higher integrity level).',
  app_blocked: 'This application is blocked from automation for security reasons.',
  consent_denied: 'The user did not approve this action.',
  target_not_focused: 'The target window is not focused, and this action requires focus.',
  provider_unavailable: 'Computer use is not available in this environment.',
  stale_snapshot: 'That snapshot is out of date. Take a new computer_snapshot and retry.',
  unsupported_action: 'That element does not expose the action you asked for.',
  capacity_exhausted: 'Too many computer-use actions are in flight.',
  target_lost: 'No available application matched that reference.',
};

/**
 * Rescale every pixel coordinate on a request from the screenshot the model
 * looked at into the driver's native window space (X-14).
 *
 * Every tool that takes a coordinate documents it as "window-local
 * screenshot-pixel" and tells the model to read it off the snapshot image. Once
 * `screenshotMaxEdge` downscales that image, those two spaces stop being the
 * same one: a click at the centre of a 3840px window arrives as 640 against a
 * 1280px capture, and unscaled it lands at 640 — a sixth of the way across.
 * This is why the downscale must be ours and must be recorded; a provider that
 * resizes the image server-side gives us no factor to undo.
 *
 * Deltas are scaled too (a scroll of 100 downscaled pixels is 300 real ones).
 * `elementIndex` actions carry no pixels and pass through untouched.
 *
 * Exported for test: the failure is silent and looks like a flaky click.
 */
export function scalePointsToDriverSpace(
  req: ActionRequest,
  factor: number,
): ActionRequest {
  if (!Number.isFinite(factor) || factor === 1 || factor <= 0) return req;
  const s = (v: number | undefined): number | undefined =>
    v === undefined ? undefined : Math.round(v * factor);
  const focus = (
    f: { x: number; y: number } | undefined,
  ): { x: number; y: number } | undefined =>
    f === undefined ? undefined : { x: Math.round(f.x * factor), y: Math.round(f.y * factor) };

  switch (req.type) {
    case 'clickPoint':
      return { ...req, x: Math.round(req.x * factor), y: Math.round(req.y * factor) };
    case 'scroll':
      return {
        ...req,
        deltaX: Math.round(req.deltaX * factor),
        deltaY: Math.round(req.deltaY * factor),
        ...(req.x === undefined ? {} : { x: s(req.x) }),
        ...(req.y === undefined ? {} : { y: s(req.y) }),
      };
    case 'drag':
      return {
        ...req,
        from: { x: Math.round(req.from.x * factor), y: Math.round(req.from.y * factor) },
        to: { x: Math.round(req.to.x * factor), y: Math.round(req.to.y * factor) },
      };
    case 'typeText':
    case 'pressKey': {
      const scaled = focus(req.focus);
      return scaled === undefined ? req : { ...req, focus: scaled };
    }
    default:
      return req;
  }
}

/**
 * Actions delivered as OS-level input. They take over the user's pointer and
 * keyboard and can never be verified by read-back.
 *
 * `pasteText` is here despite the `clipboard` delivery path: getting the paste
 * to happen still means synthesising a chord into a focused window, and it
 * clobbers the user's clipboard on the way.
 */
const SYNTHETIC_ACTIONS: ReadonlySet<ActionRequest['type']> = new Set([
  'clickPoint',
  'typeText',
  'pressKey',
  'pasteText',
  'scroll',
  'drag',
]);

/**
 * Unconfirmed synthetic actions tolerated in a row before refusing more.
 *
 * Some individual actions are legitimately unverifiable, so this cannot be 1.
 * It is small enough that a genuinely blind session stops before it can do much,
 * and any confirmed action resets it.
 */
const BLIND_INPUT_LIMIT = 5;

/** Cold-starting a large desktop app routinely outlives the per-action budget. */
const LAUNCH_TIMEOUT_MS = 90_000;

/** Ceiling on a "this run" consent answer, in case no session close clears it. */
const RUN_GRANT_TTL_MS = 60 * 60 * 1000;

/**
 * Stand-in identity for an audit row written before any app was resolved.
 *
 * The header's invariant is "every action including every refusal produces
 * exactly one audit record", and a refusal that fires at the feature gate has
 * no app to name — but "we refused before we ever looked" is precisely the
 * thing an auditor needs to be able to see, so the row is written anyway with
 * an identity that cannot be confused with a real bundle id.
 */
const UNRESOLVED_APP = '(unresolved)';

/** Best available naming for an app the caller asked for but we never resolved. */
function describeRef(ref: ComputerAppRef): { identity: string; label: string } {
  if (ref.by === 'appId') return { identity: ref.appId, label: ref.appId };
  if (ref.by === 'appName') return { identity: ref.appName, label: ref.appName };
  return { identity: `pid:${ref.pid}`, label: `pid:${ref.pid}` };
}

/** Refusal returned to the AGENT for a blocked app. */
function opaqueBlockRefusal(): ComputerRefusal {
  // Deliberately identical to "no such app". Returning `app_blocked` would let
  // the agent probe by name and learn that a password manager is running,
  // which is the disclosure `listApps` filtering exists to prevent. The real
  // code and the matched blocklist entry go to the audit row and the UI event.
  return { code: 'target_lost', message: REFUSAL_MESSAGES.target_lost };
}

export class ComputerService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly pendingStarts = new Map<string, Promise<SessionRecord>>();
  /**
   * Live-preview requests, kept per workspace rather than per session.
   *
   * Recording is a property of the driver session, and sessions come and go
   * underneath the operator: the idle sweeper closes them, a crash restarts
   * them, and the next action opens a fresh one. Holding the request here lets
   * `startSession` re-arm it, so "watch this run" survives a sweep instead of
   * going quiet with the panel still showing a live badge.
   */
  private readonly recordingRequests = new Map<string, RecordingRequest>();
  /**
   * X-15 — the integrity latch. Workspaces whose INLINE screenshot path has
   * been closed by a frame that failed validation.
   *
   * One-way and per WORKSPACE, not per session. It was per session
   * (`SessionRecord.inlineFramesOk`) and that made it not a latch: `stop()`,
   * the idle sweeper, `handleCrash()` and `restartRuntime()` all delete the
   * record, and the very next action rebuilds one with the latch open. The
   * worst case was `restartRuntime()` — the Computer panel's "restart the
   * desktop driver", which is the remedy the service's own refusal text tells
   * the model to suggest. A latch the recommended remedy clears protects
   * nothing.
   *
   * Held here so it outlives every one of those, and only ever added to:
   * there is no code path that removes an entry. A driver that produced one
   * truncated capture has demonstrated the capture path is unreliable, and the
   * failure mode is silent — the model cannot tell a grey half-frame from a
   * real one, so "it looked fine this time" is not evidence.
   *
   * Only the INLINE path is closed; frames are still stored for the operator's
   * panel, where a human can see that they are broken. Scoped per workspace so
   * one bad driver does not blind an unrelated workspace, and unbounded only
   * in the sense that it gains at most one short string per workspace that has
   * ever produced a corrupt frame.
   *
   * BOUNDARY, stated honestly: this is process-lifetime, not persisted. A full
   * server restart clears it. Surviving that needs a durable row, which is a
   * schema change this fix does not make.
   */
  private readonly inlineLatchClosed = new Set<string>();
  /**
   * "Allow for this run" answers, per workspace.
   *
   * Deliberately not persisted and deliberately not per-app: the point is to
   * stop a long task stalling on a prompt every few actions, which is what
   * silently killed runs — an unanswered prompt expires as a denial and the
   * agent gives up. Dropped when the desktop session ends, so it cannot outlive
   * the work it was granted for, and pinned to the chat that asked.
   */
  private readonly runGrants = new Map<string, { chatId?: string; expiresAt: number }>();
  private readonly bridges: IComputerBridge[];
  private readonly blocklist: ComputerUseBlocklist;
  /**
   * P1-29: Global action cap — limits total concurrent CUA actions across ALL
   * sessions. Was the only semaphore before; now a second line of defense behind
   * the per-session semaphores stored in each SessionRecord.
   * Env: GENERATORAI_MAX_COMPUTER_ACTIONS (default from computerConfig.maxConcurrentSessions).
   */
  private readonly globalActionCap: Semaphore;
  private readonly maxRetainedSnapshots: number;
  private readonly maxRetainedScreenshots: number;
  private readonly eventScope: string;
  private idleSweeper: ReturnType<typeof setInterval> | null = null;
  /** User preference from Settings. Seeded from config, flipped live by the API. */
  private userEnabled: boolean;
  /** Whether synthetic OS input (the only tier that can take the screen) is permitted. */
  private syntheticAllowed: boolean;

  constructor(
    private readonly artifactRepo: IWorkspaceArtifactRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    private readonly consent: IComputerConsentStore,
    private readonly audit: IComputerAuditSink,
    private readonly computerConfig: ComputerUseConfig,
    bridges: IComputerBridge[],
    config?: ComputerServiceConfig,
  ) {
    if (bridges.length === 0) {
      throw new Error('[ComputerService] Requires at least one IComputerBridge implementation');
    }
    this.bridges = bridges;
    this.blocklist = buildBlocklist({
      bundleIds: computerConfig.extraBlockedBundleIds,
      nameFragments: computerConfig.extraBlockedNameFragments,
      executables: computerConfig.extraBlockedExecutables,
    });
    // P1-29: Global cap now guards the TOTAL concurrent CUA actions across
    // all sessions. Per-session serialisation is enforced by SessionRecord.semaphore.
    //
    // Read through `readBoundedInt` rather than a bare `Number()`: a typo'd
    // env value produced `NaN`, which `Semaphore` accepted (`NaN <= 0` is
    // false) and then never granted a permit for (`NaN > 0` is also false) —
    // every computer action hung forever with no error and no log.
    const configuredMax = Math.trunc(Number(computerConfig.maxConcurrentSessions));
    const globalMax = readBoundedInt('GENERATORAI_MAX_COMPUTER_ACTIONS', {
      defaultValue: Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 4,
      min: 1,
      max: 64,
      onWarn: (msg) => this.logger?.warn?.(msg),
    });
    this.globalActionCap = new Semaphore(globalMax);
    this.userEnabled = computerConfig.enabled;
    this.syntheticAllowed = computerConfig.allowSyntheticFallback;
    this.maxRetainedSnapshots = config?.maxRetainedSnapshots ?? 16;
    // Floored at 1: X-16 points a duplicate frame at the artifact it duplicates,
    // which only holds if the newest frame is never pruned. A configured 0 would
    // delete the frame the very next capture is about to reference.
    this.maxRetainedScreenshots = Math.max(1, config?.maxRetainedScreenshots ?? 40);
    this.eventScope = config?.eventBusScopeSessionId ?? 'computer';
    this.startIdleSweeper();
  }

  // ── Feature gate ─────────────────────────────────────────────

  /**
   * The env switch is checked first and independently of config so an operator
   * can disable the feature without a config deploy, and so a hostile config
   * write cannot re-enable it.
   */
  isEnabled(): boolean {
    const raw = process.env[COMPUTER_USE_KILL_SWITCH_ENV];
    if (raw !== undefined && COMPUTER_USE_DISABLE_TOKENS.includes(raw.trim().toLowerCase())) {
      return false;
    }
    return this.userEnabled;
  }

  /**
   * Applies the Settings toggle without a restart. Turning it off also tears
   * down any live session: leaving a driver attached to the user's desktop
   * after they revoked the capability would make the toggle a lie.
   */
  setEnabled(enabled: boolean): void {
    if (this.userEnabled === enabled) return;
    this.userEnabled = enabled;
    if (enabled) return;
    for (const workspaceId of [...this.sessions.keys()]) {
      void this.stop(workspaceId, 'disabled-by-user').catch(() => undefined);
    }
  }

  /** Whether synthetic OS input is currently permitted. */
  isSyntheticAllowed(): boolean {
    return this.syntheticAllowed;
  }

  setSyntheticAllowed(allowed: boolean): void {
    this.syntheticAllowed = allowed;
  }

  async capabilities(ctx: ComputerCallContext): Promise<ComputerCapabilities> {
    if (!this.isEnabled()) return DISABLED_CAPABILITIES;
    // Deliberately does NOT create a session: this tool is ungated, and an
    // ungated tool must not start a driver or emit a session_started event.
    const bridge = await this.selectBridge(ctx.workspaceId);
    return bridge.capabilities(ctx.workspaceId);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /**
   * Driver health for Settings. Never starts anything: the caller is asking
   * whether it *could* start, and a status read that grabs the desktop would
   * be a gate nobody agreed to.
   */
  async runtimeStatus(
    workspaceId?: string,
  ): Promise<ComputerRuntimeStatus & { enabled: boolean; sessionActive: boolean }> {
    const enabled = this.isEnabled();
    const sessionActive = workspaceId ? this.sessions.has(workspaceId) : false;
    if (!enabled) {
      return {
        provider: 'none',
        host: 'none',
        state: 'unavailable',
        detail: 'Computer Use is turned off in Settings.',
        enabled,
        sessionActive,
      };
    }
    const bridge = await this.selectBridge(workspaceId ?? '');
    const status = await bridge.runtime(workspaceId);
    return { ...status, enabled, sessionActive };
  }

  /**
   * Opens a driver session on request rather than on first tool call, so the
   * user finds out here — with a reason — instead of mid-task.
   */
  async startRuntime(
    ctx: ComputerCallContext,
  ): Promise<ComputerRuntimeStatus & { enabled: boolean; sessionActive: boolean }> {
    const gate = this.featureGate();
    if (gate) {
      return {
        provider: 'none',
        host: 'none',
        state: 'unavailable',
        detail: gate.message,
        enabled: this.isEnabled(),
        sessionActive: false,
      };
    }
    await this.ensureSession(ctx);
    return this.runtimeStatus(ctx.workspaceId);
  }

  /** Stop and reopen. The driver retires sessions on its own; this is the manual path. */
  async restartRuntime(
    ctx: ComputerCallContext,
  ): Promise<ComputerRuntimeStatus & { enabled: boolean; sessionActive: boolean }> {
    await this.stop(ctx.workspaceId, 'restart-requested');
    return this.startRuntime(ctx);
  }

  // ── Trajectory recording ─────────────────────────────────────
  //
  // Operator-facing, not agent-facing. Recording writes a screen video and a
  // full before/after trace of every action, which is a surveillance surface —
  // an agent must not be able to switch it on for itself.

  async startRecording(
    ctx: ComputerCallContext,
    req: RecordingRequest,
  ): Promise<RecordingState> {
    const gate = this.featureGate();
    if (gate) return { recording: false, refusal: gate };
    const session = await this.ensureSession(ctx);
    if (!session.bridge.startRecording) {
      return { recording: false, refusal: this.refusal('provider_unavailable', 'This driver cannot record.') };
    }
    const state = await session.bridge.startRecording(session.handle, req);
    if (!state.refusal) {
      this.recordingRequests.set(ctx.workspaceId, req);
      this.logger.info?.(`[ComputerService] recording started for ${ctx.workspaceId} → ${state.outputDir}`);
    }
    return state;
  }

  async stopRecording(workspaceId: string): Promise<RecordingState> {
    // Cleared first, so a stop still disarms the preview when the session has
    // already gone away and there is nothing left to tell the driver.
    this.recordingRequests.delete(workspaceId);
    const session = this.sessions.get(workspaceId);
    if (!session?.bridge.stopRecording) return { recording: false };
    return session.bridge.stopRecording(session.handle);
  }

  /** Main display in physical pixels, for sizing a screen capture. */
  async screenSize(workspaceId: string): Promise<{ width: number; height: number } | null> {
    const session = this.sessions.get(workspaceId);
    if (!session?.bridge.screenSize) return null;
    return session.bridge.screenSize(session.handle);
  }

  async recordingState(workspaceId: string): Promise<RecordingState> {
    const session = this.sessions.get(workspaceId);
    if (!session?.bridge.recordingState) {
      // No session means no desktop activity to capture, so an armed preview
      // has missed nothing and will resume the moment one opens.
      return { recording: this.recordingRequests.has(workspaceId) };
    }
    return session.bridge.recordingState(session.handle);
  }

  private async ensureSession(ctx: ComputerCallContext): Promise<SessionRecord> {
    const existing = this.sessions.get(ctx.workspaceId);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return existing;
    }
    const pending = this.pendingStarts.get(ctx.workspaceId);
    if (pending) return pending;

    const promise = this.startSession(ctx).finally(() => {
      this.pendingStarts.delete(ctx.workspaceId);
    });
    this.pendingStarts.set(ctx.workspaceId, promise);
    return promise;
  }

  private async startSession(ctx: ComputerCallContext): Promise<SessionRecord> {
    const bridge = await this.selectBridge(ctx.workspaceId);
    const handle = await bridge.start(
      { workspaceId: ctx.workspaceId, workspaceRoot: ctx.workspaceRoot },
      {
        onCrash: (h, error) => void this.handleCrash(h, error),
        onPermissionChanged: (h, granted, detail) => {
          if (granted) return;
          void this.emit(h.workspaceId, {
            kind: 'computer.error',
            data: { workspaceId: h.workspaceId, error: detail, kind: 'unknown' },
          });
        },
      },
    );
    const record: SessionRecord = {
      workspaceId: ctx.workspaceId,
      workspaceRoot: ctx.workspaceRoot,
      handle,
      bridge,
      emitQueue: Promise.resolve(),
      lastActivityAt: Date.now(),
      snapshots: new Map(),
      snapshotIndex: new Map(),
      blindStreak: 0,
      captureDownscale: 1,
      // P1-29: Per-session semaphore (1 permit) so only one CUA action per
      // session runs at a time while still allowing other sessions to proceed.
      semaphore: new Semaphore(1),
      // X-16: no previous frame on session start, so the first capture is
      // always new.
      lastFrame: null,
      // X-15 is deliberately absent: a new session must NOT reopen the latch.
    };
    this.sessions.set(ctx.workspaceId, record);

    // Re-arm a preview the operator turned on under an earlier session.
    const wanted = this.recordingRequests.get(ctx.workspaceId);
    if (wanted && bridge.startRecording && handle.operational) {
      try {
        const resumed = await bridge.startRecording(handle, wanted);
        if (resumed.refusal) {
          this.recordingRequests.delete(ctx.workspaceId);
          this.logger.warn?.(
            `[ComputerService] could not resume recording for ${ctx.workspaceId}: ${resumed.refusal.message}`,
          );
        }
      } catch (err) {
        this.recordingRequests.delete(ctx.workspaceId);
        this.logger.warn?.(
          `[ComputerService] could not resume recording for ${ctx.workspaceId}: ${(err as Error).message}`,
        );
      }
    }

    // A non-operational handle (NullComputerBridge) is a dead end, not a
    // session — announcing one would put a "computer connected" affordance in
    // the UI for something that refuses every call.
    if (handle.operational) {
      const caps = await bridge.capabilities(ctx.workspaceId);
      await this.emit(ctx.workspaceId, {
        kind: 'computer.session_started',
        data: {
          workspaceId: ctx.workspaceId,
          provider: handle.provider,
          providerVersion: handle.providerVersion,
          platform: caps.platform,
        },
      });
    }
    return record;
  }

  private async selectBridge(workspaceId: string): Promise<IComputerBridge> {
    for (const bridge of this.bridges) {
      try {
        if (await bridge.isAvailable(workspaceId)) return bridge;
      } catch (err) {
        this.logger.warn?.(
          `[ComputerService] bridge ${bridge.id} availability probe failed: ${(err as Error).message}`,
        );
      }
    }
    // The chain is expected to end in NullComputerBridge, which is always
    // available. Reaching here means composition wired it wrong.
    throw new Error('[ComputerService] No available IComputerBridge; the chain must end in NullComputerBridge');
  }

  async stop(workspaceId: string, reason?: string): Promise<void> {
    // A run answer is scoped to the desktop session it was given during.
    this.runGrants.delete(workspaceId);
    const record = this.sessions.get(workspaceId);
    if (!record) return;
    // The queue is captured before the record is dropped so the terminal event
    // still lands behind everything already queued for this workspace (INV-2).
    const queue = record.emitQueue;
    this.sessions.delete(workspaceId);
    try {
      await record.bridge.stop(record.handle);
    } catch (err) {
      this.logger.warn?.(`[ComputerService] stop failed for ${workspaceId}: ${(err as Error).message}`);
    }
    if (record.handle.operational) {
      await this.emitAfter(queue, workspaceId, {
        kind: 'computer.session_stopped',
        data: { workspaceId, reason },
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.idleSweeper) clearInterval(this.idleSweeper);
    this.idleSweeper = null;
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id, 'shutdown')));
    // Sessions close first: a bridge that spawned its own driver process kills
    // it here, and ending the sessions afterwards would talk to a dead socket.
    await Promise.all(
      this.bridges.map((bridge) =>
        bridge.dispose?.().catch((err: Error) =>
          this.logger.warn?.(`[ComputerService] ${bridge.id} dispose failed: ${err.message}`),
        ),
      ),
    );
  }

  private startIdleSweeper(): void {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [workspaceId, record] of this.sessions) {
        if (now - record.lastActivityAt < this.computerConfig.idleTimeoutMs) continue;
        void this.stop(workspaceId, 'idle-timeout').catch(() => undefined);
      }
    }, 60_000);
    interval.unref?.();
    this.idleSweeper = interval;
  }

  private async handleCrash(handle: ComputerHandle, error: string): Promise<void> {
    const record = this.sessions.get(handle.workspaceId);
    const queue = record?.emitQueue ?? Promise.resolve();
    this.sessions.delete(handle.workspaceId);
    await this.emitAfter(queue, handle.workspaceId, {
      kind: 'computer.error',
      data: { workspaceId: handle.workspaceId, error, kind: 'crash' },
    });
  }

  // ── Public operations ────────────────────────────────────────

  /**
   * Running applications with every blocked app removed.
   *
   * Filtering here rather than in the adapter means the agent never learns
   * that a password manager is running at all — the app list is itself a
   * disclosure.
   */
  async listApps(ctx: ComputerCallContext): Promise<{ apps: ComputerAppInfo[]; refusal?: ComputerRefusal }> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'list_apps', gate);
      return { apps: [], refusal: gate };
    }

    const session = await this.ensureSession(ctx);
    const result = await session.bridge.listApps(session.handle);
    if (result.refusal) {
      await this.auditGateRefusal(ctx, 'list_apps', result.refusal);
      return { apps: [], refusal: result.refusal };
    }

    const visible: ComputerAppInfo[] = [];
    for (const app of result.apps) {
      const titles = await this.windowTitles(session, app, result.windowsByPid);
      // A null means enumeration failed, so the window-title dimension of the
      // blocklist could not run. Omitting the app is the only fail-closed
      // answer — including it would silently drop the control.
      if (titles === null) continue;
      if (!this.evaluate(app, titles).blocked) visible.push(app);
    }
    // Enumerating what is running is itself a disclosure, so it belongs in the
    // trail alongside the refusals — otherwise "exactly one record per action"
    // holds only for the calls that failed, and an auditor cannot tell a
    // successful read from a call that never happened.
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: UNRESOLVED_APP,
      appLabel: UNRESOLVED_APP,
      action: 'list_apps',
      target: `${visible.length} apps`,
      verified: true,
      createdAt: new Date(),
    });
    return { apps: visible };
  }

  /**
   * Launches an application by name.
   *
   * The blocklist runs TWICE: once on the requested name, because there is no
   * process to inspect yet, and again on the resolved identity after the
   * window appears — a name check alone would let "excel" start something that
   * turns out to be a password manager.
   */
  async launchApp(
    ctx: ComputerCallContext,
    name: string,
    url?: string,
    newInstance?: boolean,
    args?: readonly string[],
  ): Promise<{
    app?: ComputerAppIdentity;
    window?: { id: number; title: string };
    refusal?: ComputerRefusal;
  }> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'launch_app', gate, { identity: name, label: name });
      return { refusal: gate };
    }

    const requested = evaluateBlocklist(
      { name, executablePath: name },
      { blocklist: this.blocklist, allowlist: this.computerConfig.alwaysAllowedApps },
    );
    if (requested.blocked) {
      await this.writeAudit({
        workspaceId: ctx.workspaceId,
        chatId: ctx.chatId,
        appIdentity: name,
        appLabel: name,
        action: 'launch_app',
        verified: false,
        refusalCode: 'app_blocked',
        blockedOn: requested.matchedOn ? `${requested.matchedOn}:${requested.matchedValue}` : undefined,
        createdAt: new Date(),
      });
      return { refusal: opaqueBlockRefusal() };
    }

    const session = await this.ensureSession(ctx);
    const identity: ComputerAppIdentity = { appId: name, name, pid: 0 };
    const denied = await this.checkConsent(ctx, identity, 'launch_app', 'mutate');
    if (denied) {
      await this.recordRefusal(ctx, identity, 'launch_app', denied);
      return { refusal: denied };
    }

    const result = await this.withPermit(
      session,
      (signal) =>
        session.bridge
          .launchApp(
            session.handle,
            name,
            { ...(url ? { url } : {}), ...(newInstance ? { newInstance } : {}), ...(args && args.length > 0 ? { args } : {}) },
            signal,
          )
          .then((r) => ({
            ok: !r.refusal,
            snapshot: null,
            screenshot: null,
            refusal: r.refusal,
            launched: r.app,
            launchedWindow: r.window,
          })),
      // A cold start is not an "action": measured, launching VS Code blew the
      // 30 s action budget and came back `capacity_exhausted` even though the
      // window had opened — so the agent went hunting for a window it already
      // had.
      LAUNCH_TIMEOUT_MS,
    );
    const launched = (result as { launched?: ComputerAppIdentity }).launched;
    const launchedWindow = (result as { launchedWindow?: { id: number; title: string } }).launchedWindow;

    if (result.refusal || !launched) {
      const refusal = result.refusal ?? this.refusal('target_lost');
      await this.recordRefusal(ctx, identity, 'launch_app', refusal);
      return { refusal };
    }

    const after = await this.reResolve(session, launched);
    if (!after) {
      await this.recordRefusal(ctx, launched, 'launch_app', this.refusal('app_blocked'));
      return { refusal: opaqueBlockRefusal() };
    }

    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: after.appId,
      appLabel: after.name,
      action: 'launch_app',
      verified: true,
      createdAt: new Date(),
    });
    return { app: after, ...(launchedWindow ? { window: launchedWindow } : {}) };
  }

  /**
   * Answers "did that actually work?" without trusting the layer that did it.
   *
   * Gated as a READ: it observes, it never changes anything. Deliberately not
   * folded into `act()` — a caller must be able to check state it did not
   * itself produce, and the answer has to be able to come back `unknown`.
   */
  async verify(
    ctx: ComputerCallContext,
    ref: ComputerAppRef,
    expect: VerifyPredicate[],
    opts: { windowId?: number; stableSamples?: number; timeoutMs?: number } = {},
  ): Promise<VerifyResult> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'verify', gate, describeRef(ref));
      return { outcome: 'unknown', results: [], refusal: gate };
    }

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'verify');
    if ('refusal' in resolved) return { outcome: 'unknown', results: [], refusal: resolved.refusal };

    const denied = await this.checkConsent(ctx, resolved.app, 'verify', 'read');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'verify', denied);
      return { outcome: 'unknown', results: [], refusal: denied };
    }

    const result = await this.withPermitFor(
      session,
      (signal) =>
        session.bridge.verify(
          session.handle,
          {
            app: resolved.app,
            window: opts.windowId !== undefined ? { by: 'id', id: opts.windowId } : { by: 'focused' },
            expect,
            ...(opts.stableSamples ? { stableSamples: opts.stableSamples } : {}),
            ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
          },
          signal,
        ),
      (refusal) => ({ outcome: 'unknown' as const, results: [], refusal }),
    );
    session.lastActivityAt = Date.now();

    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: resolved.app.appId,
      appLabel: resolved.app.name,
      action: 'verify',
      target: result.outcome,
      verified: result.outcome === 'satisfied',
      ...(result.refusal ? { refusalCode: result.refusal.code } : {}),
      createdAt: new Date(),
    });
    return result;
  }

  /** Restores and foregrounds an app's window so it can actually be driven. */
  async bringToFront(ctx: ComputerCallContext, ref: ComputerAppRef): Promise<ComputerActionResult> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'bring_to_front', gate, describeRef(ref));
      return refusalResult(gate);
    }

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'bring_to_front');
    if ('refusal' in resolved) return refusalResult(resolved.refusal);

    const denied = await this.checkConsent(ctx, resolved.app, 'bring_to_front', 'mutate');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'bring_to_front', denied);
      return refusalResult(denied);
    }

    const result = await this.withPermit(session, (signal) =>
      session.bridge.bringToFront(session.handle, resolved.app, signal),
    );
    if (result.refusal) {
      await this.recordRefusal(ctx, resolved.app, 'bring_to_front', result.refusal);
      return result;
    }
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: resolved.app.appId,
      appLabel: resolved.app.name,
      action: 'bring_to_front',
      path: result.action?.path,
      verified: true,
      createdAt: new Date(),
    });
    return result;
  }

  async listWindows(
    ctx: ComputerCallContext,
    ref: ComputerAppRef,
  ): Promise<{ windows: ComputerWindowInfo[]; refusal?: ComputerRefusal }> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'list_windows', gate, describeRef(ref));
      return { windows: [], refusal: gate };
    }

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'list_windows');
    if ('refusal' in resolved) return { windows: [], refusal: resolved.refusal };

    // Window titles are screen content — document names, ticket ids, recipient
    // names — so enumerating them is gated at the same `read` tier as a
    // snapshot rather than being free.
    const denied = await this.checkConsent(ctx, resolved.app, 'list_windows', 'read');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'list_windows', denied);
      return { windows: [], refusal: denied };
    }

    const result = await session.bridge.listWindows(session.handle, resolved.app);
    // Audited on both outcomes: a window enumeration that came back refused is
    // still an attempt to read screen content, and the trail is the only place
    // that distinction survives.
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: resolved.app.appId,
      appLabel: resolved.app.name,
      action: 'list_windows',
      verified: !result.refusal,
      ...(result.refusal ? { refusalCode: result.refusal.code } : {}),
      createdAt: new Date(),
    });
    return { windows: result.windows, refusal: result.refusal };
  }

  async snapshot(
    ctx: ComputerCallContext,
    ref: ComputerAppRef,
    opts: {
      windowId?: number;
      windowIndex?: number;
      includeScreenshot?: boolean;
      query?: string;
    } = {},
  ): Promise<ComputerActionResult> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, 'snapshot', gate, describeRef(ref));
      return refusalResult(gate);
    }

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'snapshot');
    if ('refusal' in resolved) return refusalResult(resolved.refusal);

    // Reading a window is not a mutation, but it does exfiltrate the contents
    // of somebody's screen into a model context, so it is consent-gated too.
    const denied = await this.checkConsent(ctx, resolved.app, 'snapshot', 'read');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'snapshot', denied);
      return refusalResult(denied);
    }

    const result = await this.withPermit(session, async (signal) => {
      const fresh = await this.reResolve(session, resolved.app);
      if (!fresh) return refusalResult(this.refusal('target_lost'));

      const target: ComputerWindowTarget = {
        app: fresh,
        window:
          opts.windowId !== undefined
            ? { by: 'id', id: opts.windowId }
            : opts.windowIndex !== undefined
              ? { by: 'index', index: opts.windowIndex }
              : { by: 'focused' },
      };
      const outcome = await session.bridge.snapshot(
        session.handle,
        {
          ...target,
          maxElements: this.computerConfig.maxSnapshotElements,
          maxDepth: this.computerConfig.maxSnapshotDepth,
          includeScreenshot: opts.includeScreenshot ?? this.computerConfig.screenshotEveryAction,
          ...(opts.query ? { query: opts.query } : {}),
        },
        signal,
      );
      if (outcome.snapshot) this.rememberSnapshot(session, fresh, outcome);
      return outcome;
    });

    session.lastActivityAt = Date.now();
    const artifact = await this.persistScreenshot(session, result);

    if (result.refusal) {
      await this.recordRefusal(ctx, resolved.app, 'snapshot', result.refusal);
      return result;
    }

    // A readable tree for a FOCUSED window is positive evidence that the
    // accessibility layer is up and that synthetic keystrokes are reaching the
    // window we think they are. Without this reset the blind-input tripwire is
    // unescapable on Chromium/Electron hosts (VS Code, Chrome), which never
    // confirm synthetic input: measured, the 5th keystroke always aborted the
    // run with "the accessibility layer is down" while snapshots kept working.
    if (result.snapshot?.window.focused) session.blindStreak = 0;

    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: resolved.app.appId,
      appLabel: resolved.app.name,
      action: 'snapshot',
      verified: true,
      artifactPath: artifact?.relativePath,
      createdAt: new Date(),
    });
    await this.emit(ctx.workspaceId, {
      kind: 'computer.snapshot',
      data: {
        workspaceId: ctx.workspaceId,
        appIdentity: resolved.app.appId,
        appLabel: resolved.app.name,
        windowTitle: result.snapshot?.window.title ?? '',
        snapshotId: result.snapshot?.snapshotId ?? '',
        elementCount: result.snapshot?.elements.length ?? 0,
        truncated: Boolean(result.snapshot?.truncated),
        artifactId: artifact?.id,
      },
    });
    return result;
  }

  /**
   * Dispatch one action. `ref` is required even for element-addressed requests:
   * consent and the blocklist are decided on the app the CALLER named, and the
   * snapshot fence then proves that app owns the element.
   */
  async act(ctx: ComputerCallContext, ref: ComputerAppRef, req: ActionRequest): Promise<ComputerActionResult> {
    const gate = this.featureGate();
    if (gate) {
      await this.auditGateRefusal(ctx, req.type, gate, describeRef(ref));
      return refusalResult(gate);
    }

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, req.type);
    if ('refusal' in resolved) return refusalResult(resolved.refusal);
    const app = resolved.app;

    const synthetic = SYNTHETIC_ACTIONS.has(req.type);
    if (synthetic && !this.syntheticAllowed) {
      const refusal = this.refusal(
        'background_unavailable',
        'Synthetic input is turned off in Settings → Computer Use, so no action may take over the screen. Use computer_set_value or computer_click with an element index from a snapshot, or tell the user this step needs that setting enabled.',
      );
      await this.recordRefusal(ctx, app, req.type, refusal);
      return refusalResult(refusal);
    }

    if (synthetic && session.blindStreak >= BLIND_INPUT_LIMIT) {
      const refusal = this.refusal(
        'provider_unavailable',
        `The last ${session.blindStreak} keystrokes and clicks were delivered but could not be confirmed, ` +
          'and no snapshot since then has found this window focused — so they may be landing in ' +
          'another window. Stop sending input. Take a computer_snapshot of the target window: if it ' +
          'comes back focused, the run can continue. If it does not, bring the window to the front ' +
          'first, and if that also fails tell the user to restart the desktop driver from the ' +
          'Computer panel.',
      );
      await this.recordRefusal(ctx, app, req.type, refusal);
      return refusalResult(refusal);
    }

    // The label is read before the permit because dispatch invalidates the
    // snapshot it lives in; afterwards the lookup always misses.
    const targetLabel = this.describeTarget(session, req);
    const scope: ComputerConsentScope = synthetic ? 'synthetic' : 'mutate';
    const denied = await this.checkConsent(ctx, app, req.type, scope, this.consentTarget(req, targetLabel));
    if (denied) {
      await this.recordRefusal(ctx, app, req.type, denied);
      return refusalResult(denied);
    }

    const started = Date.now();
    const result = await this.withPermit(session, async (signal) => {
      const fresh = await this.reResolve(session, app);
      if (!fresh) return refusalResult(this.refusal('target_lost'));

      const fence = this.checkFence(session, fresh, req);
      if (fence) return refusalResult(fence);

      const outcome = await session.bridge.act(
        session.handle,
        scalePointsToDriverSpace(this.withResolvedApp(req, fresh), session.captureDownscale),
        signal,
      );
      // Any action can move the UI, so every snapshot for this app is now
      // suspect. Invalidating wholesale is cheap and cannot under-invalidate.
      this.invalidateSnapshots(session, fresh);
      if (outcome.snapshot) this.rememberSnapshot(session, fresh, outcome);
      return outcome;
    });

    session.lastActivityAt = Date.now();
    const artifact = await this.persistScreenshot(session, result);

    if (result.refusal) {
      await this.recordRefusal(ctx, app, req.type, result.refusal);
      return result;
    }

    const verified = result.action?.verification?.state === 'verified';
    // Only synthetic input is dangerous when unconfirmed: it goes to whatever
    // has focus, so a blind run edits whatever the user happened to leave open.
    // A verified accessibility action does NOT clear the streak — reads and
    // focus changes can keep succeeding while every keystroke misses, which is
    // exactly the pattern seen when Windows refuses the foreground swap.
    if (result.action?.path === 'synthetic') {
      session.blindStreak = verified ? 0 : session.blindStreak + 1;
    }
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: app.appId,
      appLabel: app.name,
      action: req.type,
      target: targetLabel,
      path: result.action?.path,
      verified,
      artifactPath: artifact?.relativePath,
      createdAt: new Date(),
    });
    await this.emit(ctx.workspaceId, {
      kind: 'computer.action',
      data: {
        workspaceId: ctx.workspaceId,
        chatId: ctx.chatId,
        appIdentity: app.appId,
        appLabel: app.name,
        action: req.type,
        target: targetLabel,
        path: result.action?.path ?? 'accessibility',
        verified,
        artifactId: artifact?.id,
        durationMs: result.action?.durationMs ?? Date.now() - started,
      },
    });
    return result;
  }

  // ── Gates ────────────────────────────────────────────────────

  private featureGate(): ComputerRefusal | null {
    if (this.isEnabled()) return null;
    return this.refusal('provider_unavailable');
  }

  private evaluate(app: ComputerAppInfo, windowTitles: readonly string[]) {
    return evaluateBlocklist(
      { id: app.id, name: app.name, executablePath: app.executablePath, windowTitles },
      { blocklist: this.blocklist, allowlist: this.computerConfig.alwaysAllowedApps },
    );
  }

  /**
   * Turns an ambiguous ref into exactly one identity, then blocklists it.
   *
   * Resolution reads the UNFILTERED app list on purpose: filtering first would
   * make a blocked app look like "no such app" internally too, losing the
   * `app_blocked` audit row that proves the control fired. The agent still
   * sees an indistinguishable refusal.
   */
  private async resolveApp(
    ctx: ComputerCallContext,
    session: SessionRecord,
    ref: ComputerAppRef,
    action: string,
  ): Promise<{ app: ComputerAppIdentity } | { refusal: ComputerRefusal }> {
    // Every exit below writes exactly one audit row, and every caller returns
    // straight out on a refusal — so resolution failures are recorded here and
    // nowhere else. Before this, three of the four ways resolution could fail
    // left no trace at all, which made "the agent named an app that does not
    // exist" and "the agent never called" indistinguishable in the trail.
    const listed = await session.bridge.listApps(session.handle);
    if (listed.refusal) {
      await this.auditGateRefusal(ctx, action, listed.refusal, describeRef(ref));
      return { refusal: listed.refusal };
    }

    const match = listed.apps.find((app) => matchesRef(app, ref));
    if (!match) {
      const refusal = this.refusal('target_lost');
      await this.auditGateRefusal(ctx, action, refusal, describeRef(ref));
      return { refusal };
    }

    const titles = await this.windowTitles(session, match, listed.windowsByPid);
    if (titles === null) {
      // Enumeration failed, so the window-title dimension could not run. Fail
      // closed: a vault popup under a trusted host is exactly the case that
      // dimension exists for.
      const refusal = this.refusal('target_lost');
      await this.auditGateRefusal(ctx, action, refusal, { identity: match.id, label: match.name });
      return { refusal };
    }

    const verdict = this.evaluate(match, titles);
    if (verdict.blocked) {
      await this.writeAudit({
        workspaceId: ctx.workspaceId,
        chatId: ctx.chatId,
        appIdentity: match.id,
        appLabel: match.name,
        action,
        verified: false,
        refusalCode: 'app_blocked',
        blockedOn: verdict.matchedOn ? `${verdict.matchedOn}:${verdict.matchedValue}` : undefined,
        createdAt: new Date(),
      });
      // The UI event carries the real reason so the user can see the control
      // fired; the value returned to the agent does not.
      await this.emit(ctx.workspaceId, {
        kind: 'computer.refusal',
        data: {
          workspaceId: ctx.workspaceId,
          chatId: ctx.chatId,
          appIdentity: match.id,
          appLabel: match.name,
          action,
          code: 'app_blocked',
          message: REFUSAL_MESSAGES.app_blocked,
        },
      });
      return { refusal: opaqueBlockRefusal() };
    }

    return { app: { appId: match.id, name: match.name, pid: match.pid } };
  }

  /**
   * Confirms the identity still exists and is still allowed, immediately
   * before dispatch. The consent prompt can take arbitrarily long, and a pid
   * can be recycled onto a completely different process in that window.
   */
  private async reResolve(session: SessionRecord, app: ComputerAppIdentity): Promise<ComputerAppIdentity | null> {
    const listed = await session.bridge.listApps(session.handle);
    if (listed.refusal) return null;
    const match = listed.apps.find((a) => a.pid === app.pid && a.id === app.appId);
    if (!match) return null;
    const titles = await this.windowTitles(session, match, listed.windowsByPid);
    if (titles === null || this.evaluate(match, titles).blocked) return null;
    return { appId: match.id, name: match.name, pid: match.pid };
  }

  /** `null` means enumeration failed — callers must treat that as blocked. */
  private async windowTitles(
    session: SessionRecord,
    app: ComputerAppInfo,
    batched?: Map<number, ComputerWindowInfo[]>,
  ): Promise<string[] | null> {
    // The batched map comes from the same observation as `listApps`. Without
    // it every app needs its own full accessibility walk just to read titles.
    const fromBatch = batched?.get(app.pid);
    if (fromBatch) return fromBatch.map((w) => w.title);
    try {
      const result = await session.bridge.listWindows(session.handle, {
        appId: app.id,
        name: app.name,
        pid: app.pid,
      });
      if (result.refusal) return null;
      return result.windows.map((w) => w.title);
    } catch {
      return null;
    }
  }

  private consentTarget(
    req: ActionRequest,
    label: string | undefined,
  ): ComputerConsentPrompt['target'] {
    if (!isElementAddressed(req)) return undefined;
    return { snapshotId: req.snapshotId, elementIndex: req.elementIndex, elementLabel: label ?? '' };
  }

  private async checkConsent(
    ctx: ComputerCallContext,
    app: ComputerAppIdentity,
    action: string,
    scope: ComputerConsentScope,
    target?: ComputerConsentPrompt['target'],
  ): Promise<ComputerRefusal | null> {
    const stored = await this.consent.find(ctx.workspaceId, app.appId);
    if (stored?.decision === 'deny') return this.refusal('consent_denied');

    // A run grant covers synthetic input too — that is the whole reason it
    // exists — so it is checked before the stored grant, which never can.
    const run = this.runGrants.get(ctx.workspaceId);
    if (run && run.expiresAt > Date.now() && (run.chatId === undefined || run.chatId === ctx.chatId)) {
      return null;
    }
    if (run) this.runGrants.delete(ctx.workspaceId);

    // A stored grant never covers synthetic input: it takes over the user's
    // pointer and keyboard, so it re-asks every time.
    if (
      stored?.decision === 'always_allow' &&
      scope !== 'synthetic' &&
      SCOPE_RANK[stored.scope] >= SCOPE_RANK[scope]
    ) {
      return null;
    }

    const requestId = randomUUID();
    const expiresAt = Date.now() + this.computerConfig.consentTtlSeconds * 1000;
    const decision = await this.promptWithDeadline({
      requestId,
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      app,
      action,
      summary: `${action} in ${app.name}`,
      scope,
      target,
      expiresAt,
    });

    await this.emit(ctx.workspaceId, {
      kind: 'computer.consent_resolved',
      data: { workspaceId: ctx.workspaceId, requestId, decision },
    });

    if (decision === 'deny') {
      await this.consent.save(ctx.workspaceId, app.appId, app.name, 'deny', scope);
      return this.refusal('consent_denied');
    }
    if (decision === 'allow_run') {
      this.runGrants.set(ctx.workspaceId, {
        ...(ctx.chatId ? { chatId: ctx.chatId } : {}),
        expiresAt: Date.now() + RUN_GRANT_TTL_MS,
      });
    }
    if (decision === 'always_allow' && scope !== 'synthetic') {
      await this.consent.save(ctx.workspaceId, app.appId, app.name, 'always_allow', scope);
    }
    // Allowlist, not denylist: a store that returns undefined, '', or a value
    // that failed to deserialise must not be read as approval.
    if (decision !== 'allow_once' && decision !== 'allow_run' && decision !== 'always_allow') {
      return this.refusal('consent_denied');
    }
    return null;
  }

  /**
   * The store's own contract says a timeout resolves `deny`, but the store is
   * an injected seam that talks to a UI — a hung prompt would otherwise hang
   * `act()` forever, holding nothing but blocking the caller indefinitely.
   */
  private async promptWithDeadline(
    request: ComputerConsentPrompt,
  ): Promise<ComputerConsentDecision | 'expired'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), Math.max(0, request.expiresAt - Date.now()));
    });
    try {
      const decision = await Promise.race([this.consent.prompt(request), deadline]);
      return decision === 'expired' ? 'expired' : decision;
    } catch (err) {
      this.logger.warn?.(`[ComputerService] consent prompt failed: ${(err as Error).message}`);
      return 'expired';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Validates the snapshot fence: the id must be the newest for its window,
   * must belong to the app consent was granted for, and `performAction` must
   * name an action that element actually advertised.
   */
  private checkFence(
    session: SessionRecord,
    app: ComputerAppIdentity,
    req: ActionRequest,
  ): ComputerRefusal | null {
    if (!isElementAddressed(req)) return null;

    const windowKey = session.snapshotIndex.get(req.snapshotId);
    const entry = windowKey ? session.snapshots.get(windowKey) : undefined;
    if (!entry || entry.snapshotId !== req.snapshotId) {
      return this.refusal('stale_snapshot');
    }
    if (entry.app.pid !== app.pid || entry.app.appId !== app.appId) {
      return this.refusal(
        'stale_snapshot',
        'That snapshot belongs to a different application than the one named in this call.',
      );
    }
    // Membership, not range. A `query`ed snapshot returns a PROJECTION whose
    // elements keep their original driver indices, so element 140 of 872 can
    // legitimately arrive from a 13-element view. Comparing against the view's
    // length rejected every element the projection was built to reach, and the
    // agent's only recovery was to abandon `query` and re-read whole windows.
    if (!Number.isInteger(req.elementIndex) || !entry.actions.has(req.elementIndex)) {
      return this.refusal('stale_snapshot', `Element ${req.elementIndex} is not in snapshot ${req.snapshotId}.`);
    }
    if (req.type === 'performAction') {
      const advertised = entry.actions.get(req.elementIndex) ?? [];
      if (!advertised.includes(req.actionName)) {
        // NOT a stale snapshot: the snapshot is current and the element is in
        // it. Reporting staleness sent the model off to re-snapshot, which
        // returns the same element with the same actions, forever.
        return this.refusal(
          'unsupported_action',
          `Element ${req.elementIndex} does not expose the action "${req.actionName}". ` +
            (advertised.length > 0
              ? `It exposes: ${advertised.join(', ')}. Use one of those, or computer_click it instead.`
              : 'It exposes no named actions at all — use computer_click on it instead.'),
        );
      }
    }
    return null;
  }

  // ── Concurrency ──────────────────────────────────────────────

  /**
   * Runs `work` holding one permit, with an abort signal wired to the action
   * timeout.
   *
   * The permit is held until the underlying promise SETTLES, not until the
   * timeout fires. Releasing on the race would let a second action start while
   * the first is still in flight against the singleton desktop, and would
   * write a "did not happen" audit row for a keystroke that did.
   *
   * P1-29: Now acquires TWO semaphores in order:
   *   1. session.semaphore  — serialises actions within this session only.
   *   2. this.globalActionCap — global concurrency ceiling across all sessions.
   * A slow session no longer blocks other sessions' permits.
   */
  private async withPermit(
    session: SessionRecord,
    work: (signal: AbortSignal) => Promise<ComputerActionResult>,
    timeoutMs?: number,
  ): Promise<ComputerActionResult> {
    return this.withPermitFor(session, work, (refusal) => refusalResult(refusal), timeoutMs);
  }

  /** Same budget and cancellation as `withPermit`, for calls with their own result shape. */
  private async withPermitFor<T>(
    session: SessionRecord,
    work: (signal: AbortSignal) => Promise<T>,
    onFailure: (refusal: ComputerRefusal) => T,
    timeoutMs?: number,
  ): Promise<T> {
    // P1-29: Acquire per-session permit first, then the global cap.
    // Order is always session → global to prevent inversion deadlocks.
    await session.semaphore.acquire();
    await this.globalActionCap.acquire();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.computerConfig.actionTimeoutMs,
    );
    timer.unref?.();
    try {
      return await work(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        return onFailure(this.refusal('capacity_exhausted', 'The action timed out.'));
      }
      this.logger.warn?.(`[ComputerService] bridge call failed: ${(err as Error).message}`);
      return onFailure(this.refusal('target_lost', (err as Error).message));
    } finally {
      clearTimeout(timer);
      this.globalActionCap.release();
      session.semaphore.release();
    }
  }

  // ── Snapshot bookkeeping ─────────────────────────────────────

  private rememberSnapshot(session: SessionRecord, app: ComputerAppIdentity, result: ComputerActionResult): void {
    const snapshot = result.snapshot;
    if (!snapshot) return;
    const windowKey = `${app.pid}:${snapshot.window.id}`;
    session.lastTarget = { app, windowId: snapshot.window.id };
    const previous = session.snapshots.get(windowKey);
    if (previous) {
      session.snapshotIndex.delete(previous.snapshotId);
      session.snapshots.delete(windowKey);
    }

    const actions = new Map<number, readonly string[]>();
    const labels = new Map<number, string>();
    for (const element of snapshot.elements) {
      actions.set(element.index, element.actions);
      labels.set(element.index, element.label ?? element.title ?? element.role);
    }
    session.snapshots.set(windowKey, {
      snapshotId: snapshot.snapshotId,
      app,
      windowKey,
      actions,
      labels,
    });
    session.snapshotIndex.set(snapshot.snapshotId, windowKey);

    // Map iteration is insertion-ordered, so the first key is the oldest. An
    // agent that snapshots many windows without acting would otherwise retain
    // every element tree for the whole idle timeout.
    while (session.snapshots.size > this.maxRetainedSnapshots) {
      const oldestKey = session.snapshots.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = session.snapshots.get(oldestKey);
      if (oldest) session.snapshotIndex.delete(oldest.snapshotId);
      session.snapshots.delete(oldestKey);
    }
  }

  private invalidateSnapshots(session: SessionRecord, app: ComputerAppIdentity): void {
    for (const [key, entry] of session.snapshots) {
      if (entry.app.pid !== app.pid || entry.app.appId !== app.appId) continue;
      session.snapshots.delete(key);
      session.snapshotIndex.delete(entry.snapshotId);
    }
  }

  private describeTarget(session: SessionRecord, req: ActionRequest): string | undefined {
    if (!isElementAddressed(req)) return undefined;
    const windowKey = session.snapshotIndex.get(req.snapshotId);
    const entry = windowKey ? session.snapshots.get(windowKey) : undefined;
    // Element label only — never the typed value, which may be a credential.
    return entry?.labels.get(req.elementIndex);
  }

  private withResolvedApp(req: ActionRequest, app: ComputerAppIdentity): ActionRequest {
    // Element-addressed variants carry no app of their own; the fence has
    // already proved the snapshot belongs to `app`. Every other variant carries
    // a caller-supplied target, which is overwritten so a caller cannot name
    // app A for consent and deliver the input to app B.
    if (isElementAddressed(req)) return req;
    return { ...req, target: { ...req.target, app } };
  }

  // ── Artifacts, audit, events ─────────────────────────────────

  /**
   * X-15 — close the integrity latch for a workspace. The ONLY writer.
   *
   * There is deliberately no `openInlineLatch`. "One-way" is enforced by there
   * being no code that can undo this, rather than by a comment saying it must
   * not be undone — which is exactly what the per-session flag had, and what
   * every session-recreating path silently violated.
   */
  private closeInlineLatch(workspaceId: string, reason: string): void {
    if (!this.inlineLatchClosed.has(workspaceId)) {
      this.logger.warn?.(
        `[ComputerService] X-15 latch closed for ${workspaceId}: ${reason}. ` +
          'No further frames go inline for this workspace; restarting the driver does not reopen it.',
      );
    }
    this.inlineLatchClosed.add(workspaceId);
  }

  /**
   * Whether the X-15 latch has closed for a workspace. Read-only; exposed so
   * the runtime status and tests can observe it without reaching into a Set.
   */
  inlineFramesBlocked(workspaceId: string): boolean {
    return this.inlineLatchClosed.has(workspaceId);
  }

  /**
   * A captured frame as base64, for handing to a multimodal model.
   *
   * Separate from `persistScreenshot` on purpose: every snapshot writes a frame
   * for the Computer panel, but only a caller that explicitly asked to see the
   * image should pay a megabyte of context for it.
   *
   * This is the INLINE path X-15's latch governs: the bytes returned here go
   * straight into a tool result the model reads as ground truth, so it is the
   * one place where handing over a truncated frame is unrecoverable.
   */
  async readScreenshot(
    workspaceId: string,
    artifactId: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    // X-15 latch, checked BEFORE the session lookup: a closed latch is a fact
    // about the workspace, not about whichever session happens to be open, and
    // restarting the driver must not be a way to ask again.
    if (this.inlineLatchClosed.has(workspaceId)) return null;
    const session = this.sessions.get(workspaceId);
    if (!session) return null;
    try {
      // P1-31: Direct lookup by id instead of loading every workspace artifact.
      const artifact = await this.artifactRepo.findById(artifactId);
      if (!artifact || artifact.artifactType !== 'computer_screenshot') return null;
      // Tenancy. `findById` is keyed by id alone, so without this a caller who
      // learns an artifact id from another workspace reads that workspace's
      // screen through this session — and `resolveWithinBase` would not stop
      // it, because it only proves the path stays under a root, not that the
      // ROW belongs here.
      if (artifact.workspaceId !== workspaceId) {
        this.logger.warn?.(
          `[ComputerService] refusing cross-workspace screenshot read: ${artifactId} belongs to ${artifact.workspaceId}`,
        );
        return null;
      }
      // The row's recorded size is checked BEFORE the read, so an oversized
      // frame is never loaded into memory only to be discarded. The read-back
      // check below still stands: the row is metadata and the file is the
      // truth, and they can disagree if the file was replaced.
      const cap = this.computerConfig.screenshotMaxBytes;
      if (artifact.fileSize !== undefined && artifact.fileSize > cap) return null;
      // Same containment rule as the write path: the stored path is relative,
      // and resolving it through the session root keeps a tampered row from
      // reading a file outside the workspace.
      const absolute = await resolveWithinBase(session.workspaceRoot, artifact.relativePath);
      if (!absolute) return null;
      const bytes = await fs.readFile(absolute);
      if (bytes.byteLength > cap) return null;
      const integrity = validateFrameBytes(bytes);
      if (!integrity.ok) {
        this.closeInlineLatch(
          workspaceId,
          `screenshot ${artifactId} failed integrity (${integrity.reason})`,
        );
        return null;
      }
      return { base64: bytes.toString('base64'), mimeType: artifact.mimeType ?? 'image/png' };
    } catch (err) {
      this.logger.warn?.(`[ComputerService] could not read screenshot ${artifactId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Screen bounds of the window the preview is showing.
   *
   * The recorder writes cursor positions in SCREEN coordinates and captures
   * frames of a WINDOW, so the two only line up once the window's origin is
   * known. Reads through `list_windows`, which — unlike `get_window_state` —
   * does not replace the driver's element index map, so polling it cannot
   * break the agent's snapshot fence.
   */
  async previewWindow(
    workspaceId: string,
  ): Promise<{ x: number; y: number; w: number; h: number; title: string } | null> {
    const session = this.sessions.get(workspaceId);
    const target = session?.lastTarget;
    if (!session || !target) return null;

    try {
      const result = await session.bridge.listWindows(session.handle, target.app);
      const window = result.windows.find((w) => w.id === target.windowId) ?? result.windows[0];
      if (!window?.bounds) return null;
      return { ...window.bounds, title: window.title };
    } catch {
      return null;
    }
  }

  private async persistScreenshot(
    session: SessionRecord,
    result: ComputerActionResult,
  ): Promise<WorkspaceArtifactRecord | null> {
    const artifact = await this.writeScreenshotArtifact(session, result);
    // Stamped back onto the result, not just the event. Without this the tool
    // payload reported `screenshotArtifactId: undefined` on every single call
    // while the PNG sat on disk, so a caller asked to verify visually had
    // nothing to reference and no way to know why.
    if (artifact && result.screenshot) result.screenshot.artifactId = artifact.id;
    return artifact;
  }

  /**
   * Takes ownership of one captured file and turns it into an artifact row.
   *
   * P0-f — ORDERING IS THE FIX HERE. Every gate that can reject a capture now
   * runs against the file the driver wrote, BEFORE `transcodeScreenshot`
   * replaces it with a new file and deletes the source. The previous order ran
   * the integrity and dedup gates after that swap and then returned early, so
   * the transcoded file existed on disk with no artifact row pointing at it —
   * and `pruneScreenshots` is row-driven, so nothing could ever reclaim it.
   * `shot.path` was left naming the deleted source on top of that.
   *
   * The invariant this method now holds, on every path: when it returns without
   * an artifact, the capture file is gone and `shot.path` names nothing.
   */
  private async writeScreenshotArtifact(
    session: SessionRecord,
    result: ComputerActionResult,
  ): Promise<WorkspaceArtifactRecord | null> {
    const shot = result.screenshot;
    if (!shot?.path || shot.dataOmitted) return null;

    // Containment is measured against the root captured at session start, not
    // a per-call one — otherwise a caller could widen the boundary itself.
    // `resolveWithinBase` realpaths both sides, so a planted symlink or
    // junction inside the workspace cannot escape.
    const absolute = await resolveWithinBase(session.workspaceRoot, shot.path);
    if (!absolute) {
      this.logger.warn?.(`[ComputerService] rejecting screenshot outside workspace: ${shot.path}`);
      // Not deleted: a path that failed containment is not ours to unlink.
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }

    // The canonical capture — what the driver actually wrote, before any resize
    // or re-encode. Both X-15 and X-16 are questions about THIS, not about
    // whatever the codec later produces from it.
    let sourceBytes: Buffer;
    try {
      sourceBytes = await fs.readFile(absolute);
    } catch (err) {
      this.logger.warn?.(
        `[ComputerService] capture file unreadable (${(err as Error).message}); dropping the frame`,
      );
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }

    // X-15 — terminator and byte-length validation on the canonical frame. A
    // truncated capture (driver crash mid-write, a full disk, a half-copied
    // temp file) carries a perfectly valid header and renders to the model as a
    // grey half-frame it cannot tell apart from the real screen.
    const integrity = validateFrameBytes(sourceBytes);
    if (!integrity.ok) {
      // One-way latch, per plan. A capture path that has produced one
      // unverifiable frame has stopped being trustworthy, and the model has no
      // way to notice — so the latch outlives this session rather than being
      // reset by the next stop, sweep, crash or driver restart.
      this.closeInlineLatch(
        session.workspaceId,
        `corrupt capture (${integrity.format}, ${sourceBytes.byteLength}B): ${integrity.reason}`,
      );
      await this.discard(absolute);
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }

    // X-16 — duplicate suppression, keyed on the canonical frame.
    const frameHash = createHash('sha1').update(sourceBytes).digest('hex');
    const previous = session.lastFrame;
    if (previous && previous.hash === frameHash) {
      // The duplicate file is redundant with a frame already on disk, so it is
      // deleted rather than stored — this is the leak P0-f describes, and the
      // only correct owner of the file is whoever decided not to keep it.
      await this.discard(absolute);
      // Point the result at the frame this one duplicates. Returning "no
      // screenshot" instead would be a lie: the image exists, it is just the
      // same one, and a caller that asked to SEE the screen must still be able
      // to. The geometry is by definition identical, so `captureDownscale`
      // stays whatever the original capture set it to — but the DESCRIPTOR has
      // to be the stored file's, not the driver's raw PNG's, or the result
      // claims a png at capture resolution while `path` names a downscaled webp.
      shot.path = previous.artifact.relativePath;
      shot.format = previous.encoded.format;
      shot.width = previous.encoded.width;
      shot.height = previous.encoded.height;
      shot.downscale = previous.encoded.downscale;
      shot.unchanged = true;
      return previous.artifact;
    }

    // X-14 — re-encode BEFORE the byte cap is applied. The config comment has
    // always promised "downscaled, then dropped if still over"; until now only
    // the dropping existed, so a 4K capture was discarded rather than resized
    // and the panel simply lost the frame. Transcoding never throws: a capture
    // it cannot shrink comes back untouched and is judged on its own size.
    const encoded = await transcodeScreenshot({
      sourcePath: absolute,
      format: this.computerConfig.screenshotFormat,
      maxEdge: this.computerConfig.screenshotMaxEdge,
      quality: this.computerConfig.screenshotQuality,
      logger: this.logger,
    });
    // From here on `stored` is the ONLY file that exists for this capture: the
    // codec deleted the source if it wrote somewhere else. Every early return
    // below therefore has to remove it.
    const stored = encoded.path;
    // Set here, not after the byte cap: this is the factor for whatever image
    // the model is about to be shown, and a stale value left over from an
    // earlier capture would scale the next click by the wrong amount.
    session.captureDownscale = encoded.downscale;

    // Size from `stat` rather than a second full read — the bytes were already
    // read once above, and the only thing still needed from the encoded file is
    // how big it is.
    let fileSize: number;
    try {
      fileSize = encoded.transcoded ? (await fs.stat(stored)).size : sourceBytes.byteLength;
    } catch {
      await this.discard(stored);
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }

    // `screenshotMaxBytes` was configurable and enforced nowhere, which only
    // stayed harmless while capture was accidentally disabled. Now that every
    // snapshot writes a frame, an oversized one is dropped rather than kept:
    // the preview panel losing a frame is a far smaller problem than a session
    // on a 4K display filling the workspace.
    if (fileSize > this.computerConfig.screenshotMaxBytes) {
      this.logger.warn?.(
        `[ComputerService] dropping ${fileSize}B screenshot (cap ${this.computerConfig.screenshotMaxBytes}B)`,
      );
      await this.discard(stored);
      // The file is gone, so the result must stop advertising it — otherwise
      // `result.screenshot.path` points at nothing and the panel renders a
      // broken frame instead of showing that the capture was dropped.
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }

    // The result is what the tool payload and the preview panel read, so the
    // post-transcode geometry has to land back on it. `downscale` is what
    // `scalePointsToDriverSpace` undoes on the next pixel-addressed action.
    if (encoded.transcoded) {
      shot.format = encoded.format;
      shot.width = encoded.width;
      shot.height = encoded.height;
      shot.downscale = encoded.downscale;
    }
    shot.path = path.relative(session.workspaceRoot, stored);

    const artifact: WorkspaceArtifactRecord = {
      id: randomUUID(),
      workspaceId: session.workspaceId,
      artifactType: 'computer_screenshot',
      relativePath: path.relative(session.workspaceRoot, stored),
      fileSize,
      mimeType: encoded.mimeType,
      metadata: {
        width: shot.width,
        height: shot.height,
        scale: shot.scale,
        downscale: encoded.downscale,
        engine: shot.engine,
      },
      createdAt: new Date(),
    };
    // Artifact write happens BEFORE the event that references it (INV-3).
    try {
      await this.artifactRepo.create(artifact);
    } catch (err) {
      // A row that failed to write leaves a file nothing can ever reclaim,
      // because pruning walks rows. Same ownership rule as every gate above.
      this.logger.warn?.(
        `[ComputerService] artifact row failed (${(err as Error).message}); discarding the capture file`,
      );
      await this.discard(stored);
      shot.path = undefined;
      shot.dataOmitted = true;
      return null;
    }
    // Recorded only once the row exists, so a frame we failed to store can
    // never be the baseline a later capture is deduplicated against.
    session.lastFrame = {
      hash: frameHash,
      artifact,
      encoded: {
        format: shot.format,
        width: shot.width,
        height: shot.height,
        downscale: encoded.downscale,
      },
    };
    void this.pruneScreenshots(session).catch(() => undefined);
    return artifact;
  }

  /** Removes a capture file this service has decided not to keep. */
  private async discard(absolutePath: string): Promise<void> {
    await fs.rm(absolutePath, { force: true }).catch((err: Error) => {
      this.logger.warn?.(`[ComputerService] could not remove ${absolutePath}: ${err.message}`);
    });
  }

  /**
   * Keeps only the newest `maxRetainedScreenshots` frames for a workspace.
   *
   * The preview panel only ever renders the latest, and the audit trail keeps
   * the relative path of every action regardless, so older frames buy nothing
   * and grow without bound across a long session.
   */
  private async pruneScreenshots(session: SessionRecord): Promise<void> {
    const all = await this.artifactRepo.findByWorkspace(session.workspaceId);
    const frames = all
      .filter((a) => a.artifactType === 'computer_screenshot')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const stale of frames.slice(this.maxRetainedScreenshots)) {
      const absolute = path.resolve(session.workspaceRoot, stale.relativePath);
      await fs.rm(absolute, { force: true }).catch(() => undefined);
      await this.artifactRepo.delete(stale.id);
    }
  }

  /**
   * Audit row for a refusal that fired before an app identity existed.
   *
   * Deliberately audit-only, with no `computer.refusal` event: these are gate
   * and resolution failures the CALLER already learns about from the returned
   * refusal, and emitting for them would put "computer use is off" banners in a
   * transcript for a feature the user turned off on purpose. The audit trail is
   * what has to be complete — that is what the header's invariant is about.
   */
  private async auditGateRefusal(
    ctx: ComputerCallContext,
    action: string,
    refusal: ComputerRefusal,
    subject?: { identity: string; label: string },
  ): Promise<void> {
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: subject?.identity ?? UNRESOLVED_APP,
      appLabel: subject?.label ?? UNRESOLVED_APP,
      action,
      verified: false,
      refusalCode: refusal.code,
      createdAt: new Date(),
    });
  }

  private async recordRefusal(
    ctx: ComputerCallContext,
    app: ComputerAppIdentity,
    action: string,
    refusal: ComputerRefusal,
  ): Promise<void> {
    await this.writeAudit({
      workspaceId: ctx.workspaceId,
      chatId: ctx.chatId,
      appIdentity: app.appId,
      appLabel: app.name,
      action,
      verified: false,
      refusalCode: refusal.code,
      createdAt: new Date(),
    });
    await this.emit(ctx.workspaceId, {
      kind: 'computer.refusal',
      data: {
        workspaceId: ctx.workspaceId,
        chatId: ctx.chatId,
        appIdentity: app.appId,
        appLabel: app.name,
        action,
        code: refusal.code,
        message: refusal.message,
      },
    });
  }

  /** Sequential per-workspace emit queue → INV-2. */
  private async emit(workspaceId: string, event: AgentEvent): Promise<void> {
    const record = this.sessions.get(workspaceId);
    const next = this.chain(record?.emitQueue ?? Promise.resolve(), workspaceId, event);
    if (record) record.emitQueue = next;
    await next;
  }

  /** Emits behind an explicitly captured queue, for terminal events. */
  private async emitAfter(queue: Promise<unknown>, workspaceId: string, event: AgentEvent): Promise<void> {
    await this.chain(queue, workspaceId, event);
  }

  private chain(queue: Promise<unknown>, workspaceId: string, event: AgentEvent): Promise<void> {
    return queue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.eventBus.emit(`${this.eventScope}:${workspaceId}`, event);
        } catch (err) {
          this.logger.warn?.(
            `[ComputerService] emit failed for workspace ${workspaceId}: ${(err as Error).message}`,
          );
        }
      });
  }

  private refusal(code: ComputerRefusalCode, message?: string): ComputerRefusal {
    return { code, message: message ?? REFUSAL_MESSAGES[code] };
  }

  /**
   * A failed audit write must never throw out of a tool call: by the time it
   * runs the desktop has already changed, and turning that into a thrown error
   * would hide a real mutation behind what looks like a failed one.
   */
  private async writeAudit(entry: ComputerAuditEntry): Promise<void> {
    try {
      await this.audit.record(entry);
    } catch (err) {
      this.logger.error?.(`[ComputerService] audit write failed: ${(err as Error).message}`);
    }
  }
}

function matchesRef(app: ComputerAppInfo, ref: ComputerAppRef): boolean {
  if (ref.by === 'appId') return app.id.toLowerCase() === ref.appId.toLowerCase();
  if (ref.by === 'pid') return app.pid === ref.pid;
  return app.name.toLowerCase() === ref.appName.toLowerCase();
}

function refusalResult(refusal: ComputerRefusal): ComputerActionResult {
  return { ok: false, snapshot: null, screenshot: null, refusal };
}

const DISABLED_CAPABILITIES: ComputerCapabilities = {
  platform: 'unknown',
  provider: 'disabled',
  providerVersion: '0',
  supports: {
    listApps: false, listWindows: false, snapshot: false, screenshot: false,
    elementBounds: false, backgroundClick: false, backgroundType: false,
    setValue: false, performAction: false, scroll: false, drag: false,
    hotkey: false, pasteText: false,
  },
  limitations: ['Computer use is disabled for this deployment.'],
};
