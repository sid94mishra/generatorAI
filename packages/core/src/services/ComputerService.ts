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

import { randomUUID } from 'node:crypto';
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
import { isElementAddressed } from '../domain/ports/IComputerBridge.js';
import type { IWorkspaceArtifactRepository } from '../domain/ports/IWorkspaceArtifactRepository.js';
import type { EventBus } from '../events/EventBus.js';
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
  private readonly semaphore: Semaphore;
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
    this.semaphore = new Semaphore(computerConfig.maxConcurrentSessions);
    this.userEnabled = computerConfig.enabled;
    this.syntheticAllowed = computerConfig.allowSyntheticFallback;
    this.maxRetainedSnapshots = config?.maxRetainedSnapshots ?? 16;
    this.maxRetainedScreenshots = config?.maxRetainedScreenshots ?? 40;
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
    if (gate) return { apps: [], refusal: gate };

    const session = await this.ensureSession(ctx);
    const result = await session.bridge.listApps(session.handle);
    if (result.refusal) return { apps: [], refusal: result.refusal };

    const visible: ComputerAppInfo[] = [];
    for (const app of result.apps) {
      const titles = await this.windowTitles(session, app, result.windowsByPid);
      // A null means enumeration failed, so the window-title dimension of the
      // blocklist could not run. Omitting the app is the only fail-closed
      // answer — including it would silently drop the control.
      if (titles === null) continue;
      if (!this.evaluate(app, titles).blocked) visible.push(app);
    }
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
    if (gate) return { refusal: gate };

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
    if (gate) return { outcome: 'unknown', results: [], refusal: gate };

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'verify');
    if ('refusal' in resolved) return { outcome: 'unknown', results: [], refusal: resolved.refusal };

    const denied = await this.checkConsent(ctx, resolved.app, 'verify', 'read');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'verify', denied);
      return { outcome: 'unknown', results: [], refusal: denied };
    }

    const result = await this.withPermitFor(
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
    if (gate) return refusalResult(gate);

    const session = await this.ensureSession(ctx);
    const resolved = await this.resolveApp(ctx, session, ref, 'bring_to_front');
    if ('refusal' in resolved) return refusalResult(resolved.refusal);

    const denied = await this.checkConsent(ctx, resolved.app, 'bring_to_front', 'mutate');
    if (denied) {
      await this.recordRefusal(ctx, resolved.app, 'bring_to_front', denied);
      return refusalResult(denied);
    }

    const result = await this.withPermit((signal) =>
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
  ): Promise<{ windows: ComputerWindowInfo[]; refusal?: ComputerRefusal }> {    const gate = this.featureGate();
    if (gate) return { windows: [], refusal: gate };

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
    if (gate) return refusalResult(gate);

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

    const result = await this.withPermit(async (signal) => {
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
    if (gate) return refusalResult(gate);

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
    const result = await this.withPermit(async (signal) => {
      const fresh = await this.reResolve(session, app);
      if (!fresh) return refusalResult(this.refusal('target_lost'));

      const fence = this.checkFence(session, fresh, req);
      if (fence) return refusalResult(fence);

      const outcome = await session.bridge.act(session.handle, this.withResolvedApp(req, fresh), signal);
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
    const listed = await session.bridge.listApps(session.handle);
    if (listed.refusal) return { refusal: listed.refusal };

    const match = listed.apps.find((app) => matchesRef(app, ref));
    if (!match) return { refusal: this.refusal('target_lost') };

    const titles = await this.windowTitles(session, match, listed.windowsByPid);
    if (titles === null) {
      // Enumeration failed, so the window-title dimension could not run. Fail
      // closed: a vault popup under a trusted host is exactly the case that
      // dimension exists for.
      return { refusal: this.refusal('target_lost') };
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
   */
  private async withPermit(
    work: (signal: AbortSignal) => Promise<ComputerActionResult>,
    timeoutMs?: number,
  ): Promise<ComputerActionResult> {
    return this.withPermitFor(work, (refusal) => refusalResult(refusal), timeoutMs);
  }

  /** Same budget and cancellation as `withPermit`, for calls with their own result shape. */
  private async withPermitFor<T>(
    work: (signal: AbortSignal) => Promise<T>,
    onFailure: (refusal: ComputerRefusal) => T,
    timeoutMs?: number,
  ): Promise<T> {
    await this.semaphore.acquire();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.computerConfig.actionTimeoutMs,
    );
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
      this.semaphore.release();
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
   * A captured frame as base64, for handing to a multimodal model.
   *
   * Separate from `persistScreenshot` on purpose: every snapshot writes a PNG
   * for the Computer panel, but only a caller that explicitly asked to see the
   * image should pay a megabyte of context for it.
   */
  async readScreenshot(
    workspaceId: string,
    artifactId: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    const session = this.sessions.get(workspaceId);
    if (!session) return null;
    try {
      const artifacts = await this.artifactRepo.findByWorkspace(workspaceId);
      const artifact = artifacts.find(
        (a) => a.id === artifactId && a.artifactType === 'computer_screenshot',
      );
      if (!artifact) return null;
      // Same containment rule as the write path: the stored path is relative,
      // and resolving it through the session root keeps a tampered row from
      // reading a file outside the workspace.
      const absolute = await resolveWithinBase(session.workspaceRoot, artifact.relativePath);
      if (!absolute) return null;
      const bytes = await fs.readFile(absolute);
      if (bytes.byteLength > this.computerConfig.screenshotMaxBytes) return null;
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
      return null;
    }

    let fileSize: number | undefined;
    try {
      fileSize = (await fs.stat(absolute)).size;
    } catch {
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
      await fs.rm(absolute, { force: true }).catch(() => undefined);
      return null;
    }

    const artifact: WorkspaceArtifactRecord = {
      id: randomUUID(),
      workspaceId: session.workspaceId,
      artifactType: 'computer_screenshot',
      relativePath: path.relative(session.workspaceRoot, absolute),
      fileSize,
      mimeType: 'image/png',
      metadata: { width: shot.width, height: shot.height, scale: shot.scale, engine: shot.engine },
      createdAt: new Date(),
    };
    // Artifact write happens BEFORE the event that references it (INV-3).
    await this.artifactRepo.create(artifact);
    void this.pruneScreenshots(session).catch(() => undefined);
    return artifact;
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
