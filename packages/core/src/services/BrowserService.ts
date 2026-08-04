// ────────────────────────────────────────────────────────────────
// BrowserService — Integrated Browser lifecycle + event emission.
//
// One service instance manages every workspace's browser session. It
// chooses a bridge (ServerPlaywrightHost / ElectronBridgeAdapter),
// enforces `browserConfig` (allowedHosts, dialogPolicy, PII), persists
// artifacts, emits `browser.*` events on the unified EventBus / StreamBroker,
// and drives crash-recovery + concurrency capping.
//
// Not called by the agent directly — the agent goes through the
// `playwright-cli` skill + shared CDP endpoint. BrowserService exposes:
//   • lifecycle methods (start / stop / ensureStarted)
//   • user-driven action methods (navigate / click / screenshot / inspector)
//   • descriptor read for the SPA to render the panel
//
// Per-workspace FIFO emit queue → INV-2 preserved.
// Artifact write happens BEFORE event emit → INV-3 preserved.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  BrowserAction,
  BrowserConfig,
  BrowserInspectorSelection,
  BrowserSessionDescriptor,
  BrowserSessionStatus,
  ExecutionWorkspace,
  ILogger,
  WorkspaceArtifactRecord,
  WorkspaceArtifactType,
} from '@generatorai/shared';
import { matchesAnyHostPattern } from '@generatorai/shared';
import { importBrowserCookies, type SupportedCookieBrowser } from '../infrastructure/browser/CookieImport.js';
import { redactPii, flagPromptInjection } from '../infrastructure/browser/ContentSafety.js';
import type {
  BrowserHandle,
  BrowserHostObserver,
  BrowserInputEvent,
  IBrowserBridge,
  InvokeFunctionResult,
  PageOutcome,
  ScreencastFrame,
} from '../domain/ports/IBrowserBridge.js';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';
import type { IWorkspaceArtifactRepository } from '../domain/ports/IWorkspaceArtifactRepository.js';
import { BrowserSessionStateMachine } from '../domain/state-machines/BrowserSessionStateMachine.js';
import type { EventBus } from '../events/EventBus.js';

/** Per-workspace resolved state. */
interface SessionRecord {
  workspaceId: string;
  workspaceRoot: string;
  handle: BrowserHandle;
  bridge: IBrowserBridge;
  fsm: BrowserSessionStateMachine;
  config: BrowserConfig;
  restartCount: number;
  emitQueue: Promise<unknown>;
  /**
   * FS watcher on `<workspace>/browser/.playwright-cli/` — new files
   * created here (by the agent skill) are auto-registered as artifacts and
   * emit `browser.snapshot` events for reactive UI. `null` when the skill
   * output directory doesn't exist yet.
   */
  skillWatcher: fsSync.FSWatcher | null;
  /**
   * Guards against emitting duplicate artifacts for a file that fsevents
   * reports multiple times (Windows fs.watch fires ~2-3 times per write).
   */
  skillSeen: Set<string>;
  /**
   * Epoch-ms of the last activity we observed on this session. Refreshed
   * on every user/agent action (navigate, click, screenshot, …). Used by
   * the max-concurrent LRU eviction — when a new `ensureStarted` hits the
   * cap, we stop the session with the oldest `lastActivityAt` and retry.
   */
  lastActivityAt: number;
  /**
   * VSCode-parity "share with agent" state. When `true` (default), the
   * agent's built-in browser tools can drive this session. When `false`
   * (user pressed the Share toggle to detach), agent tool handlers
   * return an error and no navigation / click / type / screenshot from
   * `from: 'agent'` is executed. User-driven actions (navigate via URL
   * bar, back/forward, click through live-view) are unaffected. The
   * flag auto-flips back to `true` on the next user prompt in the
   * owning chat (see `ChatManagementService.sendPrompt`).
   */
  attachedToChat: boolean;
}

/** Optional observer used by hosts to emit selection payloads. */
export interface BrowserServiceConfig {
  /** Default max concurrent sessions (defensive; hosts also cap). */
  maxConcurrent?: number;
  /** Max Chromium auto-restarts on crash before we give up (default 3). */
  maxRestarts?: number;
  /** Cooldown between auto-restarts (ms). Default 10 000. */
  restartCooldownMs?: number;
  /** Session id used for global event emission ('browser'). Prefixed. */
  eventBusScopeSessionId?: string;
}

export class BrowserService {
  private sessions = new Map<string, SessionRecord>(); // key: workspaceId
  /**
   * In-flight `ensureStarted` promises keyed by workspaceId. Prevents the
   * classic race where the chat's auto-start + the LLM's first
   * `open_browser_page` tool call BOTH pass the "no existing session"
   * check before either has finished registering, then both spawn a
   * separate Chromium. Callers awaiting the same workspaceId while a
   * start is pending share the same promise.
   */
  private pendingStarts = new Map<string, Promise<BrowserSessionDescriptor>>();
  private readonly bridges: IBrowserBridge[];
  private readonly cfg: Required<BrowserServiceConfig>;

  constructor(
    private readonly workspaceRepo: IExecutionWorkspaceRepository,
    private readonly artifactRepo: IWorkspaceArtifactRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    bridges: IBrowserBridge[],
    config?: BrowserServiceConfig,
  ) {
    if (bridges.length === 0) {
      throw new Error('[BrowserService] Requires at least one IBrowserBridge implementation');
    }
    this.bridges = bridges;
    this.cfg = {
      maxConcurrent: config?.maxConcurrent ?? Number(process.env['GENERATORAI_BROWSER_MAX_CONCURRENT'] ?? '5'),
      maxRestarts: config?.maxRestarts ?? 3,
      restartCooldownMs: config?.restartCooldownMs ?? 10_000,
      eventBusScopeSessionId: config?.eventBusScopeSessionId ?? 'browser',
    };
    this.startIdleSweeper();
  }

  /**
   * `browserConfig.idlePauseMinutes` was parsed and defaulted (see
   * `resolveConfig`) but never actually acted on anywhere — accepting a
   * config value that implies a guarantee the code doesn't keep. This
   * sweep is the real behavior: a headless (non-visible) session idle past
   * its configured threshold gets stopped, freeing the Chromium process,
   * same as if the user/agent had called `stop()` themselves. Skips
   * `visibility: 'visible'` sessions — the human may be looking at it, and
   * stopping out from under them is a worse experience than the resource
   * cost of leaving one idle browser running.
   */
  private startIdleSweeper(): void {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [workspaceId, record] of this.sessions) {
        if (record.config.visibility === 'visible') continue;
        if (record.fsm.status !== 'active' && record.fsm.status !== 'idle') continue;
        const idleMinutes = record.config.idlePauseMinutes ?? 5;
        const idleMs = now - record.lastActivityAt;
        if (idleMs < idleMinutes * 60_000) continue;
        this.logger.info?.(
          `[BrowserService] Idle-pausing workspace ${workspaceId} after ${Math.round(idleMs / 60_000)}m idle (limit ${idleMinutes}m)`,
        );
        void this.stop(workspaceId, 'idle-timeout').catch((err) => {
          this.logger.warn?.(`[BrowserService] idle-pause stop failed for ${workspaceId}: ${(err as Error).message}`);
        });
      }
    }, 60_000);
    interval.unref?.();
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /**
   * Ensure a browser session exists for `workspace`. Idempotent — returns
   * the existing descriptor if one is already active. If `browserConfig`
   * is not enabled, returns a descriptor with `mode: 'off'`.
   *
   * Concurrency: races between the chat/workflow's auto-start and the
   * LLM's `open_browser_page` tool call are collapsed via `pendingStarts`
   * so only one Chromium is ever spawned per workspace.
   */
  async ensureStarted(workspace: ExecutionWorkspace): Promise<BrowserSessionDescriptor> {
    // Fast paths BEFORE dedup — cheap to check, avoid promise churn.
    const config = this.resolveConfig(workspace.browserConfig);
    if (!config.enabled) {
      return {
        workspaceId: workspace.id,
        status: 'off',
        mode: 'off',
        ready: false,
      };
    }
    const existing = this.sessions.get(workspace.id);
    if (existing && !existing.fsm.isTerminal && existing.fsm.status !== 'error') {
      return this.buildDescriptor(existing);
    }

    // Dedup — if another caller is already starting this workspace,
    // await their promise instead of spawning our own.
    const pending = this.pendingStarts.get(workspace.id);
    if (pending) return pending;

    const promise = this.doEnsureStarted(workspace).finally(() => {
      // Always clear the pending marker, even on failure — otherwise a
      // transient error would poison the workspaceId forever.
      this.pendingStarts.delete(workspace.id);
    });
    this.pendingStarts.set(workspace.id, promise);
    return promise;
  }

  /** Internal — actual start logic, wrapped by `ensureStarted` for dedup. */
  private async doEnsureStarted(workspace: ExecutionWorkspace): Promise<BrowserSessionDescriptor> {
    const config = this.resolveConfig(workspace.browserConfig);
    // Re-check existing under the pending-starts lock — another caller
    // may have completed while we were queued.
    const existing = this.sessions.get(workspace.id);
    if (existing && !existing.fsm.isTerminal && existing.fsm.status !== 'error') {
      return this.buildDescriptor(existing);
    }

    if (this.sessions.size >= this.cfg.maxConcurrent) {
      // LRU-evict: pick the session with the oldest `lastActivityAt` and
      // stop it. This makes the max-concurrent cap behave like a memory
      // budget rather than a hard "sorry, come back later" — the LLM's
      // lazy-start via `open_browser_page` should always succeed as long
      // as at least one session in the pool has been idle long enough.
      const evictable = Array.from(this.sessions.values())
        .filter((s) => !s.fsm.isTerminal && s.fsm.status !== 'starting')
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
      const victim = evictable[0];
      if (!victim) {
        // Every session is starting — respect the cap; the caller will retry.
        throw new Error(
          `[BrowserService] Cannot start browser: max concurrent sessions (${this.cfg.maxConcurrent}) reached and all are starting`,
        );
      }
      this.logger.info?.(
        `[BrowserService] LRU-evicting browser session ${victim.workspaceId} (idle for ${Date.now() - victim.lastActivityAt}ms) to make room for ${workspace.id}`,
      );
      try {
        await this.stop(victim.workspaceId, 'lru-evicted');
      } catch (err) {
        this.logger.warn?.(`[BrowserService] LRU eviction stop failed: ${(err as Error).message}`);
        // If stop failed but the entry lingers, drop it from the map so
        // the cap check below succeeds. Chromium orphans are cleaned up
        // by WorktreeCleanup on next boot.
        this.sessions.delete(victim.workspaceId);
      }
    }

    const bridge = await this.selectBridge();
    if (!bridge) {
      throw new Error('[BrowserService] No available browser bridge (Playwright unavailable)');
    }

    const fsm = new BrowserSessionStateMachine('off');
    fsm.transition('sys:start');
    await this.updateWorkspaceRow(workspace.id, {
      browserStatus: 'starting',
      browserConfig: config as unknown as Record<string, unknown>,
    });

    let handle: BrowserHandle;
    try {
      handle = await bridge.start(
        {
          workspaceId: workspace.id,
          workspaceRoot: workspace.rootPath,
          config,
        },
        this.buildObserver(workspace.id),
      );
    } catch (err) {
      fsm.transition('sys:crash');
      await this.updateWorkspaceRow(workspace.id, { browserStatus: 'error' });
      await this.emitBrowserEvent(workspace.id, {
        kind: 'browser.error',
        data: { workspaceId: workspace.id, error: (err as Error).message, kind: 'unknown' },
      });
      throw err;
    }

    fsm.transition('sys:ready');

    const record: SessionRecord = {
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      handle,
      bridge,
      fsm,
      config,
      restartCount: 0,
      emitQueue: Promise.resolve(),
      skillWatcher: null,
      skillSeen: new Set(),
      lastActivityAt: Date.now(),
      attachedToChat: true,
    };
    this.sessions.set(workspace.id, record);

    // Start the skill artifact watcher. The playwright-cli skill writes
    // snapshots + screenshots into `.playwright-cli/` inside its working
    // directory; we watch the workspace-scoped copy at
    // `<workspaceRoot>/browser/.playwright-cli/` and auto-register anything
    // that appears there.
    this.startSkillWatcher(record).catch((err) => {
      this.logger.warn?.(`[BrowserService] skill watcher failed to start: ${(err as Error).message}`);
    });

    await this.updateWorkspaceRow(workspace.id, {
      browserStatus: 'active',
      browserCdpEndpoint: handle.cdpEndpoint,
      browserTargetId: handle.targetId,
      browserStartedAt: new Date(),
      browserLastActivityAt: new Date(),
    });

    await this.emitBrowserEvent(workspace.id, {
      kind: 'browser.session_created',
      data: { workspaceId: workspace.id, mode: handle.mode as 'native' | 'screencast' },
    });

    return this.buildDescriptor(record);
  }

  async stop(workspaceId: string, reason?: string): Promise<void> {
    const record = this.sessions.get(workspaceId);
    if (!record) return;
    try {
      record.skillWatcher?.close();
    } catch { /* best effort */ }
    try {
      await record.bridge.stop(record.handle);
    } catch (err) {
      this.logger.warn?.(`[BrowserService] bridge.stop failed: ${(err as Error).message}`);
    }
    record.fsm.transition('sys:stop');
    this.sessions.delete(workspaceId);
    await this.updateWorkspaceRow(workspaceId, {
      browserStatus: 'terminated',
      browserCdpEndpoint: undefined,
      browserLastActivityAt: new Date(),
    });
    await this.emitBrowserEvent(workspaceId, {
      kind: 'browser.session_stopped',
      data: { workspaceId, reason: reason ?? 'user' },
    });
  }

  // ── User-driven actions (called by the /api/browser routes) ──

  async navigate(workspaceId: string, url: string, from: 'user' | 'agent' | 'inspector' | 'system' = 'user'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, from);
    await this.assertHostAllowed(record.config, url);
    await this.emitAction(record, { kind: 'navigate', url, from, ts: Date.now() });
    const outcome = await record.bridge.navigate(record.handle, url);
    await this.finaliseAction(record, { kind: 'navigate', url, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async reload(workspaceId: string, from: 'user' | 'agent' | 'inspector' | 'system' = 'user'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    await this.emitAction(record, { kind: 'reload', from, ts: Date.now() });
    const outcome = await record.bridge.reload(record.handle);
    await this.finaliseAction(record, { kind: 'reload', from, ts: Date.now() }, outcome);
    return outcome;
  }

  async back(workspaceId: string): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    await this.emitAction(record, { kind: 'back', from: 'user', ts: Date.now() });
    const outcome = await record.bridge.back(record.handle);
    await this.finaliseAction(record, { kind: 'back', from: 'user', ts: Date.now() }, outcome);
    return outcome;
  }

  async forward(workspaceId: string): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    await this.emitAction(record, { kind: 'forward', from: 'user', ts: Date.now() });
    const outcome = await record.bridge.forward(record.handle);
    await this.finaliseAction(record, { kind: 'forward', from: 'user', ts: Date.now() }, outcome);
    return outcome;
  }

  async screenshot(workspaceId: string, from: 'user' | 'agent' | 'inspector' | 'system' = 'user'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    await this.emitAction(record, { kind: 'screenshot', from, ts: Date.now() });
    const outcome = await record.bridge.screenshot(record.handle);
    await this.finaliseAction(record, { kind: 'screenshot', from, ts: Date.now() }, outcome);
    return outcome;
  }

  async domSnapshot(workspaceId: string, from: 'user' | 'agent' | 'inspector' | 'system' = 'user'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    await this.emitAction(record, { kind: 'snapshot', from, ts: Date.now() });
    const outcome = await record.bridge.domSnapshot(record.handle);
    await this.finaliseAction(record, { kind: 'snapshot', from, ts: Date.now() }, outcome);
    return outcome;
  }

  async inspector(workspaceId: string, on: boolean): Promise<void> {
    const record = this.mustRecord(workspaceId);
    await record.bridge.inspector(record.handle, on);
  }

  /**
   * Import cookies from the user's own installed browser profile and add
   * them to this workspace's active session — so the agent can reach
   * pages the human is already authenticated on. See CookieImport.ts for
   * per-platform verification status (Windows is the only runtime-verified
   * path as of writing).
   */
  async importCookies(
    workspaceId: string,
    browser: SupportedCookieBrowser,
    hostFilter?: string[],
  ): Promise<{ imported: number; skipped: number }> {
    const record = this.mustRecord(workspaceId);
    const workDir = path.join(record.workspaceRoot, 'browser', 'cookie-import-tmp');
    const result = await importBrowserCookies({ browser, workDir, hostFilter });
    await record.bridge.addCookies(record.handle, result.cookies);
    return { imported: result.cookies.length, skipped: result.skipped };
  }

  /**
   * Toggle "share with agent" for this workspace's browser session.
   * See `SessionRecord.attachedToChat` for semantics.
   * Emits `browser.session_updated` on change so the SPA re-renders
   * the Share button state without polling.
   */
  async setAttachedToChat(workspaceId: string, attached: boolean): Promise<{ attachedToChat: boolean }> {
    const record = this.mustRecord(workspaceId);
    if (record.attachedToChat === attached) return { attachedToChat: attached };
    record.attachedToChat = attached;
    await this.emitBrowserEvent(workspaceId, {
      kind: 'browser.session_updated',
      data: { workspaceId, attachedToChat: attached },
    });
    return { attachedToChat: attached };
  }

  /**
   * Idempotent re-attach hook invoked by ChatManagementService /
   * StageExecutionService on every new user prompt. Restores agent
   * access to a browser the user detached between turns — matches the
   * "next prompt reattaches" semantics discussed in Session 78.
   * No-op when the session doesn't exist yet.
   */
  reattachOnPrompt(workspaceId: string): void {
    const record = this.sessions.get(workspaceId);
    if (!record || record.attachedToChat) return;
    record.attachedToChat = true;
    // Fire-and-forget — this runs on the sendPrompt hot path.
    void this.emitBrowserEvent(workspaceId, {
      kind: 'browser.session_updated',
      data: { workspaceId, attachedToChat: true, reason: 'prompt' },
    }).catch(() => undefined);
  }

  /**
   * Guard used by every agent-facing method. Throws when the user
   * detached the session, so the tool handler surfaces a clear error
   * to the LLM instead of silently driving a browser the user isn't
   * expecting the agent to touch.
   */
  private assertAttachedForAgent(record: SessionRecord, from?: 'agent' | 'user' | 'system' | 'inspector'): void {
    if (from !== 'agent') return;
    if (record.attachedToChat) return;
    throw new Error(
      '[BrowserService] Browser is detached from chat — user must re-share it before the agent can drive it.',
    );
  }

  async describe(workspaceId: string): Promise<BrowserSessionDescriptor> {
    const record = this.sessions.get(workspaceId);
    if (!record) {
      // Load from DB — a workspace may have a previously started browser
      // whose in-memory record has been evicted (server restart).
      const ws = await this.workspaceRepo.findById(workspaceId);
      return {
        workspaceId,
        status: (ws?.browserStatus as BrowserSessionStatus | undefined) ?? 'off',
        mode: 'off',
        ready: false,
      };
    }
    const remote = await record.bridge.describe(record.handle).catch(() => ({} as { url?: string; title?: string; viewport?: { width: number; height: number } }));
    return {
      workspaceId,
      status: record.fsm.status,
      mode: record.handle.mode,
      cdpEndpoint: record.handle.cdpEndpoint,
      targetId: record.handle.targetId,
      currentUrl: remote?.url,
      viewport: remote?.viewport,
      ready: record.fsm.status === 'active' || record.fsm.status === 'idle',
      attachedToChat: record.attachedToChat,
    };
  }

  screencast(workspaceId: string, opts: { fps: number; quality: number }): AsyncIterable<ScreencastFrame> {
    const record = this.mustRecord(workspaceId);
    return record.bridge.screencast(record.handle, opts);
  }

  /**
   * Return a single JPEG frame of the current viewport. Preferred by the
   * SPA over the MJPEG stream because it works reliably through the Vite
   * dev proxy and any HTTP intermediary that would otherwise buffer
   * `multipart/x-mixed-replace`.
   */
  async frame(workspaceId: string, opts?: { quality?: number }): Promise<Buffer> {
    const record = this.mustRecord(workspaceId);
    return record.bridge.frame(record.handle, opts);
  }

  /**
   * Capture a PNG of a user-drawn rectangle in page coordinates. Returned
   * bytes are handed back to the SPA which wraps them in a `File` and
   * pushes them to the chat composer as a pending capture. Not persisted
   * as a workspace artifact — the user attaching it to a message is a
   * lighter-weight surface than the agent's own `screenshot_page` tool.
   */
  async captureRegion(
    workspaceId: string,
    clip: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    const record = this.mustRecord(workspaceId);
    return record.bridge.captureRegion(record.handle, clip);
  }

  /**
   * Dispatch a mouse or keyboard input event to the page. Enables true
   * user interaction (click, type, scroll) through the SPA live view.
   * Runs through the same `beforeBrowserActionHook` gate as other actions
   * so allowlists and policies can veto interactive input if needed.
   */
  async interact(workspaceId: string, event: BrowserInputEvent): Promise<void> {
    const record = this.mustRecord(workspaceId);
    if (record.fsm.status === 'idle') record.fsm.transition('sys:active');
    record.lastActivityAt = Date.now();
    await record.bridge.interact(record.handle, event);
    await this.updateWorkspaceRow(workspaceId, {
      browserLastActivityAt: new Date(),
    });
  }

  /**
   * Resize the browser viewport to match the client's live-view panel
   * so we don't burn CPU rendering pixels that get letterboxed away.
   */
  async resize(workspaceId: string, width: number, height: number): Promise<void> {
    const record = this.mustRecord(workspaceId);
    await record.bridge.resize(record.handle, width, height);
  }

  /**
   * Query the page's scroll position + height so the SPA can render
   * an overlay scrollbar. Headless Chromium's screenshots don't include
   * native scrollbars, so this state powers a custom indicator.
   */
  async scrollState(workspaceId: string): Promise<{ scrollY: number; scrollHeight: number; clientHeight: number }> {
    const record = this.mustRecord(workspaceId);
    return record.bridge.scrollState(record.handle);
  }

  // ── Agent-facing (VSCode-parity built-in tool set) ──────────────

  /**
   * Ensure a session exists for `workspaceId` and return its descriptor.
   * Called by the built-in browser tools before every action so that the
   * LLM can *lazy-start* the browser purely via tool invocation, without
   * requiring the user to pre-enable `browserConfig` on chat create.
   *
   * When the workspace has `browserConfig.enabled` unset (or explicitly
   * `false`), we still start — but only when the caller passes
   * `{ lazyEnable: true }`. Chat creation continues to gate on
   * `enabled: true` as before.
   */
  async ensureStartedForTool(
    workspaceId: string,
    opts?: { lazyEnable?: boolean },
  ): Promise<BrowserSessionDescriptor> {
    // Fast path — already running.
    const existing = this.sessions.get(workspaceId);
    if (existing && !existing.fsm.isTerminal && existing.fsm.status !== 'error') {
      return this.buildDescriptor(existing);
    }
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new Error(`[BrowserService] Workspace not found: ${workspaceId}`);
    }
    // Merge lazy-enable if the caller asked. This does NOT persist the
    // change to the workspace row — it's only for this in-memory session.
    if (opts?.lazyEnable) {
      const cfg = (workspace.browserConfig ?? {}) as BrowserConfig;
      if (!cfg.enabled) {
        workspace.browserConfig = { ...cfg, enabled: true } as Record<string, unknown>;
      }
    }
    return this.ensureStarted(workspace);
  }

  /**
   * Accessibility-tree snapshot of the current page, with element refs
   * tagged in-line for `browserService.click` / `type` / `hover` etc.
   * Prefer over `domSnapshot` for agent input — ~10× more token-efficient.
   */
  async readPage(workspaceId: string): Promise<{ url: string; title: string; snapshot: string }> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, 'agent');
    const result = await record.bridge.readPage(record.handle);
    let snapshot = result.snapshot;
    if (record.config.piiRedaction) snapshot = redactPii(snapshot);
    if ((record.config.injectionDefense ?? 'off') !== 'off') snapshot = flagPromptInjection(snapshot);
    return { ...result, snapshot };
  }

  async clickRef(
    workspaceId: string,
    ref: string,
    opts?: { button?: 'left' | 'right' | 'middle'; dblClick?: boolean; modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[]; from?: 'agent' | 'user' | 'system' },
  ): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    const from = opts?.from ?? 'agent';
    this.assertAttachedForAgent(record, from);
    await this.emitAction(record, { kind: 'click', target: ref, from, ts: Date.now() });
    const outcome = await record.bridge.clickRef(record.handle, ref, opts);
    await this.finaliseAction(record, { kind: 'click', target: ref, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async hoverRef(workspaceId: string, ref: string, from: 'agent' | 'user' | 'system' = 'agent'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, from);
    await this.emitAction(record, { kind: 'hover', target: ref, from, ts: Date.now() });
    const outcome = await record.bridge.hoverRef(record.handle, ref);
    await this.finaliseAction(record, { kind: 'hover', target: ref, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async typeRef(
    workspaceId: string,
    ref: string | null,
    opts: { text?: string; key?: string; from?: 'agent' | 'user' | 'system' },
  ): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    const from = opts.from ?? 'agent';
    this.assertAttachedForAgent(record, from);
    const target = ref ?? 'focused';
    // Kind: 'type' when text is provided, else 'press' for key-only. This
    // keeps action-history granular for auditing / replay.
    const kind = opts.text != null && opts.text !== '' ? 'type' : 'press';
    await this.emitAction(record, { kind, target, text: opts.text, from, ts: Date.now() });
    const outcome = await record.bridge.typeRef(record.handle, ref, { text: opts.text, key: opts.key });
    await this.finaliseAction(record, { kind, target, text: opts.text, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async dragRef(
    workspaceId: string,
    fromRef: string,
    toRef: string,
    from: 'agent' | 'user' | 'system' = 'agent',
  ): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, from);
    await this.emitAction(record, { kind: 'click', target: `${fromRef}→${toRef}`, from, ts: Date.now() });
    const outcome = await record.bridge.dragRef(record.handle, fromRef, toRef);
    await this.finaliseAction(record, { kind: 'click', target: `${fromRef}→${toRef}`, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async screenshotRef(workspaceId: string, ref: string, from: 'agent' | 'user' | 'system' = 'agent'): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, from);
    await this.emitAction(record, { kind: 'screenshot', target: ref, from, ts: Date.now() });
    const outcome = await record.bridge.screenshotRef(record.handle, ref);
    await this.finaliseAction(record, { kind: 'screenshot', target: ref, from, ts: Date.now() }, outcome);
    return outcome;
  }

  async handleDialog(
    workspaceId: string,
    action: 'accept' | 'dismiss',
    promptText?: string,
    from: 'agent' | 'user' | 'system' = 'agent',
  ): Promise<PageOutcome> {
    const record = this.mustRecord(workspaceId);
    this.assertAttachedForAgent(record, from);
    await this.emitAction(record, { kind: 'dialog', target: action, from, ts: Date.now() });
    const outcome = await record.bridge.handleDialogAction(record.handle, action, promptText);
    await this.finaliseAction(record, { kind: 'dialog', target: action, from, ts: Date.now() }, outcome);
    return outcome;
  }

  /**
   * Run arbitrary Playwright code as `async (page) => { ${fnDef} }`.
   * Gated on `browserConfig.evalAllowed === true`. Returns a
   * {@link InvokeFunctionResult} — check `deferredResultId` before
   * dereferencing `result`.
   */
  async invokeFunction(
    workspaceId: string,
    fnDef: string,
    opts?: { timeoutMs?: number; from?: 'agent' | 'user' | 'system' },
  ): Promise<InvokeFunctionResult> {
    const record = this.mustRecord(workspaceId);
    const from = opts?.from ?? 'agent';
    this.assertAttachedForAgent(record, from);
    if (!record.config.evalAllowed) {
      throw new Error(
        `[BrowserService] invokeFunction (run_playwright_code) is disabled — set browserConfig.evalAllowed: true to allow.`,
      );
    }
    await this.emitAction(record, { kind: 'eval', from, ts: Date.now() });
    const outcome = await record.bridge.invokeFunction(record.handle, fnDef, opts?.timeoutMs);
    // Note: no `finaliseAction` here — invokeFunction may produce many
    // side effects (screenshots, navigations) which surface via their
    // own hooks; the eval itself doesn't produce an artifact.
    return outcome;
  }

  async waitForDeferredResult(
    workspaceId: string,
    deferredResultId: string,
    timeoutMs: number,
  ): Promise<InvokeFunctionResult> {
    const record = this.mustRecord(workspaceId);
    return record.bridge.waitForDeferredResult(record.handle, deferredResultId, timeoutMs);
  }

  /**
   * Called by BrowserRoute when the inspector script POSTs a selection.
   * Persists as `browser_selection` artifact + emits `browser.selection`.
   */
  async recordInspectorSelection(workspaceId: string, sel: BrowserInspectorSelection): Promise<{ artifactId: string }> {
    const record = this.mustRecord(workspaceId);
    // Persist the payload as JSON under <workspaceRoot>/browser/selections/.
    const relPath = path.posix.join('browser', 'selections', `${sel.ts}-${randomUUID().slice(0, 8)}.json`);
    const absPath = path.join(record.workspaceRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const data = JSON.stringify(sel, null, 2);
    await fs.writeFile(absPath, data, 'utf8');
    const artifact = await this.persistArtifact(workspaceId, 'browser_selection', relPath, {
      mimeType: 'application/json',
      fileSize: Buffer.byteLength(data, 'utf8'),
      metadata: {
        url: sel.url,
        cssSelector: sel.cssSelector,
        xpath: sel.xpath,
        boundingBox: sel.boundingBox,
      },
    });
    await this.emitBrowserEvent(workspaceId, {
      kind: 'browser.selection',
      data: {
        workspaceId,
        artifactId: artifact.id,
        url: sel.url,
        cssSelector: sel.cssSelector,
        xpath: sel.xpath,
      },
    });
    return { artifactId: artifact.id };
  }

  // ── Hook implementations (called from composition root) ──────

  /**
   * Built-in `beforeBrowserAction` handler exposed as a function hook.
   * Blocks navigations that violate `browserConfig.allowedHosts`.
   * Wired via `hookExecutor.registerFunctionHandler('browser.beforeAction', …)`.
   */
  async beforeBrowserActionHook(workspaceId: string, action: string, target?: string): Promise<{ allow: boolean; reason?: string }> {
    const record = this.sessions.get(workspaceId);
    if (!record) return { allow: true };
    if (action === 'navigate' && target) {
      const ok = this.isHostAllowed(record.config, target);
      if (!ok) return { allow: false, reason: `Blocked by browserConfig.allowedHosts (host of ${target})` };
    }
    if (action === 'eval' && !record.config.evalAllowed) {
      return { allow: false, reason: 'eval disabled by browserConfig.evalAllowed=false' };
    }
    return { allow: true };
  }

  /** Number of active sessions — for /health and diagnostics. */
  getStats(): { active: number; max: number } {
    return { active: this.sessions.size, max: this.cfg.maxConcurrent };
  }

  /**
   * Start a filesystem watcher on `<workspaceRoot>/browser/.playwright-cli/`
   * so files the agent's `playwright-cli` skill writes there (snapshots,
   * screenshots, HAR, videos) are auto-registered as workspace artifacts
   * and surface `browser.snapshot` events for reactive UI. Watcher is
   * non-blocking and best-effort; failures are logged but never throw.
   */
  private async startSkillWatcher(record: SessionRecord): Promise<void> {
    const dir = path.join(record.workspaceRoot, 'browser', '.playwright-cli');
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch { /* best effort */ }
    let watcher: fsSync.FSWatcher;
    try {
      watcher = fsSync.watch(dir, { persistent: false, recursive: true }, (eventType, filename) => {
        if (eventType !== 'rename' && eventType !== 'change') return;
        if (!filename) return;
        const rel = String(filename).replace(/\\/g, '/');
        if (record.skillSeen.has(rel)) return;
        void this.handleSkillFile(record, dir, rel).catch((err) => {
          this.logger.debug?.(`[BrowserService] skill file handler: ${(err as Error).message}`);
        });
      });
    } catch (err) {
      // fs.watch may fail on network mounts / read-only filesystems — skip.
      this.logger.debug?.(`[BrowserService] fs.watch unavailable at ${dir}: ${(err as Error).message}`);
      return;
    }
    record.skillWatcher = watcher;
  }

  /** Register a newly-observed skill file as an artifact. */
  private async handleSkillFile(record: SessionRecord, dir: string, relName: string): Promise<void> {
    const abs = path.join(dir, relName);
    let stat: fsSync.Stats;
    try {
      stat = await fs.stat(abs);
    } catch {
      return; // File was deleted between the event and stat — ignore.
    }
    if (!stat.isFile()) return;
    // Mark seen synchronously so parallel events collapse to one artifact.
    record.skillSeen.add(relName);

    // Infer artifact type from extension. The playwright-cli skill produces
    // PNG screenshots (screenshot), YAML/JSON snapshots (page state), HAR
    // network captures, and WebM/MP4 videos.
    const ext = path.extname(relName).toLowerCase();
    let artifactType: WorkspaceArtifactType | null = null;
    let mimeType: string | undefined;
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
      artifactType = 'browser_screenshot';
      mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    } else if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
      // Skill's page snapshots are structured accessibility trees.
      artifactType = 'browser_dom';
      mimeType = 'application/x-yaml';
    } else if (ext === '.har') {
      artifactType = 'browser_har';
      mimeType = 'application/json';
    } else if (ext === '.log' || ext === '.txt') {
      artifactType = 'browser_console_log';
      mimeType = 'text/plain';
    } else if (ext === '.webm' || ext === '.mp4') {
      artifactType = 'browser_video';
      mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4';
    }
    if (!artifactType) return;

    const relativePath = path.posix.join('browser', '.playwright-cli', relName);
    const artifact = await this.persistArtifact(record.workspaceId, artifactType, relativePath, {
      fileSize: stat.size,
      mimeType,
      metadata: {
        source: 'playwright-cli-skill',
        from: 'agent',
        ts: Date.now(),
      },
    });
    await this.emitBrowserEvent(record.workspaceId, {
      kind: 'browser.snapshot',
      data: {
        workspaceId: record.workspaceId,
        artifactId: artifact.id,
        artifactType,
        from: 'agent',
      },
    });
  }

  // ── Internal helpers ─────────────────────────────────────────

  private buildObserver(workspaceId: string): BrowserHostObserver {
    return {
      onInspectorSelection: (_h, sel) => {
        void this.recordInspectorSelection(workspaceId, sel).catch((err) => {
          this.logger.warn?.(`[BrowserService] recordInspectorSelection failed: ${(err as Error).message}`);
        });
      },
      onCrash: (_h, error) => {
        void this.handleCrash(workspaceId, error);
      },
    };
  }

  private async handleCrash(workspaceId: string, error: string): Promise<void> {
    const record = this.sessions.get(workspaceId);
    if (!record) return;
    if (!record.fsm.canTransition('sys:crash')) return;
    record.fsm.transition('sys:crash');

    // Native mode: the WebContentsView lifecycle is owned by the desktop
    // renderer — the WCV is created when a Browser tab mounts and destroyed
    // when the user navigates away or closes the tab. A page "close" is
    // therefore an EXPECTED teardown, not a crash to recover from. Auto-
    // restarting here would call `discoverTargetPage` while no WCV carries
    // the workspace marker, producing a 10s "Timed out waiting for WCV"
    // error. Treat it as a graceful stop instead: drop the session so the
    // next `/browser/start` (on reopen) binds cleanly to the fresh WCV.
    if (record.handle.mode === 'native') {
      try { record.skillWatcher?.close(); } catch { /* best effort */ }
      this.sessions.delete(workspaceId);
      await this.updateWorkspaceRow(workspaceId, {
        browserStatus: 'terminated',
        browserCdpEndpoint: undefined,
        browserTargetId: undefined,
        browserLastActivityAt: new Date(),
      });
      await this.emitBrowserEvent(workspaceId, {
        kind: 'browser.session_stopped',
        data: { workspaceId, reason: 'native-view-closed' },
      });
      this.logger.info?.(
        `[BrowserService] Native WCV closed for ${workspaceId}; session stopped (no restart) — reopen will start fresh`,
      );
      return;
    }

    await this.updateWorkspaceRow(workspaceId, { browserStatus: 'error' });
    await this.emitBrowserEvent(workspaceId, {
      kind: 'browser.error',
      data: { workspaceId, error, kind: 'crash' },
    });

    // In visible mode, auto-restart causes user-facing browser window flicker
    // loops (close/reopen). Treat crash as terminal and require an explicit
    // user/agent start to relaunch.
    if (record.config.visibility === 'visible') {
      try {
        record.skillWatcher?.close();
      } catch { /* best effort */ }
      this.sessions.delete(workspaceId);
      await this.updateWorkspaceRow(workspaceId, {
        browserStatus: 'terminated',
        browserCdpEndpoint: undefined,
        browserTargetId: undefined,
        browserLastActivityAt: new Date(),
      });
      await this.emitBrowserEvent(workspaceId, {
        kind: 'browser.session_stopped',
        data: { workspaceId, reason: 'crash-visible-no-restart' },
      });
      this.logger.info?.(
        `[BrowserService] Visible-session crash for ${workspaceId}; auto-restart skipped to avoid flicker loop`,
      );
      return;
    }

    // Auto-restart with cooldown for non-visible sessions (headless/off).
    if (record.restartCount >= this.cfg.maxRestarts) {
      this.logger.warn?.(
        `[BrowserService] Max restarts (${this.cfg.maxRestarts}) reached for workspace ${workspaceId}; giving up`,
      );
      this.sessions.delete(workspaceId);
      return;
    }
    setTimeout(() => {
      void this.attemptRestart(workspaceId, record).catch((err) => {
        this.logger.warn?.(`[BrowserService] restart failed: ${(err as Error).message}`);
      });
    }, this.cfg.restartCooldownMs);
  }

  private async attemptRestart(workspaceId: string, prev: SessionRecord): Promise<void> {
    prev.restartCount += 1;
    prev.fsm.transition('sys:retry');
    try {
      // Re-probe bridge availability on every restart instead of always
      // retrying whichever bridge crashed — a session started under
      // ElectronBridgeAdapter (desktop) whose CDP endpoint died mid-session
      // used to retry that same dead bridge until restarts ran out, with no
      // path back to a working browser even though ServerPlaywrightHost
      // was right there as a fallback. `selectBridge()` returns bridges in
      // the configured preference order, so this also self-heals back to
      // Electron once its endpoint comes back (e.g. the user reopened the
      // tab) instead of staying pinned to the fallback forever.
      const nextBridge = await this.selectBridge();
      const switchedBridge = nextBridge !== null && nextBridge !== prev.bridge;
      if (nextBridge) prev.bridge = nextBridge;
      const handle = await prev.bridge.start(
        {
          workspaceId,
          workspaceRoot: prev.workspaceRoot,
          config: prev.config,
        },
        this.buildObserver(workspaceId),
      );
      prev.handle = handle;
      prev.fsm.transition('sys:ready');
      await this.updateWorkspaceRow(workspaceId, {
        browserStatus: 'active',
        browserCdpEndpoint: handle.cdpEndpoint,
        browserTargetId: handle.targetId,
      });
      if (switchedBridge) {
        this.logger.warn?.(
          `[BrowserService] Bridge failover for workspace ${workspaceId}: switched to mode=${handle.mode} after the previous bridge became unavailable`,
        );
      }
      await this.emitBrowserEvent(workspaceId, {
        kind: 'browser.session_created',
        data: { workspaceId, mode: handle.mode as 'native' | 'screencast', ...(switchedBridge ? { bridgeFailover: true } : {}) },
      });
    } catch (err) {
      await this.emitBrowserEvent(workspaceId, {
        kind: 'browser.error',
        data: { workspaceId, error: (err as Error).message, kind: 'crash' },
      });
      throw err;
    }
  }

  private async selectBridge(): Promise<IBrowserBridge | null> {
    for (const b of this.bridges) {
      try {
        if (await b.isAvailable()) return b;
      } catch { /* try next */ }
    }
    return null;
  }

  private mustRecord(workspaceId: string): SessionRecord {
    const r = this.sessions.get(workspaceId);
    if (!r) throw new Error(`[BrowserService] No active browser session for workspace ${workspaceId}`);
    return r;
  }

  private buildDescriptor(record: SessionRecord): BrowserSessionDescriptor {
    return {
      workspaceId: record.workspaceId,
      status: record.fsm.status,
      mode: record.handle.mode,
      cdpEndpoint: record.handle.cdpEndpoint,
      targetId: record.handle.targetId,
      ready: record.fsm.status === 'active' || record.fsm.status === 'idle',
      attachedToChat: record.attachedToChat,
    };
  }

  /** Apply defaults to a workspace/workflow/stage browserConfig. */
  resolveConfig(input?: BrowserConfig | Record<string, unknown> | null): Required<Pick<BrowserConfig, 'enabled' | 'visibility' | 'headless' | 'screencastFps' | 'screencastQuality' | 'idlePauseMinutes' | 'evalAllowed' | 'dialogPolicy' | 'piiRedaction' | 'injectionDefense'>> & BrowserConfig {
    const cfg = (input ?? {}) as BrowserConfig;
    const visibility: 'visible' | 'headless' | 'off' = cfg.visibility ?? 'headless';
    // In-pane rendering: BOTH 'visible' and 'headless' modes launch Chromium
    // headless. 'visible' means "visible inside the RightPane preview via
    // screencast", NOT a detached OS window. If we honoured `visibility ===
    // 'visible'` as headless=false, Chromium would pop an OS window AND we'd
    // stream the same page into the pane → two views of one browser plus
    // repaint flicker on every screencast frame. 'off' also stays headless
    // for lazy starts triggered later.
    const headless = true;
    return {
      ...cfg,
      enabled: cfg.enabled ?? false,
      visibility,
      headless,
      screencastFps: cfg.screencastFps ?? 5,
      screencastQuality: cfg.screencastQuality ?? 60,
      idlePauseMinutes: cfg.idlePauseMinutes ?? 5,
      evalAllowed: cfg.evalAllowed ?? false,
      dialogPolicy: cfg.dialogPolicy ?? 'dismiss',
      piiRedaction: cfg.piiRedaction ?? false,
      injectionDefense: cfg.injectionDefense ?? 'off',
    };
  }

  private isHostAllowed(cfg: BrowserConfig, url: string): boolean {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return false;
    }
    return matchesAnyHostPattern(host, cfg.allowedHosts);
  }

  private async assertHostAllowed(cfg: BrowserConfig, url: string): Promise<void> {
    if (!this.isHostAllowed(cfg, url)) {
      throw new Error(`URL blocked by browserConfig.allowedHosts: ${url}`);
    }
  }

  private async emitAction(record: SessionRecord, action: BrowserAction): Promise<void> {
    // Refresh in-memory activity so the LRU-evict picks a truly idle
    // session (not one currently being driven by the agent).
    record.lastActivityAt = Date.now();
    await this.emitBrowserEvent(record.workspaceId, {
      kind: 'browser.action_started',
      data: {
        workspaceId: record.workspaceId,
        action: action.kind,
        target: action.target,
        url: action.url,
        from: action.from,
      },
    });
  }

  private async finaliseAction(record: SessionRecord, action: BrowserAction, outcome: PageOutcome): Promise<void> {
    let artifactId: string | undefined;
    if (outcome.ok && outcome.artifactPath && outcome.artifactType) {
      const stats = await fs
        .stat(path.join(record.workspaceRoot, outcome.artifactPath))
        .catch(() => null);
      const artifact = await this.persistArtifact(
        record.workspaceId,
        outcome.artifactType,
        outcome.artifactPath,
        {
          fileSize: stats?.size,
          mimeType: outcome.artifactType === 'browser_screenshot' ? 'image/png' : 'text/html',
          metadata: {
            url: outcome.url,
            action: action.kind,
            from: action.from,
            ts: action.ts,
          },
        },
      );
      artifactId = artifact.id;
      await this.emitBrowserEvent(record.workspaceId, {
        kind: 'browser.snapshot',
        data: {
          workspaceId: record.workspaceId,
          artifactId: artifact.id,
          artifactType: outcome.artifactType,
          url: outcome.url,
          from: action.from,
        },
      });
    }
    await this.emitBrowserEvent(record.workspaceId, {
      kind: 'browser.action_completed',
      data: {
        workspaceId: record.workspaceId,
        action: action.kind,
        target: action.target,
        url: outcome.url ?? action.url,
        from: action.from,
        ok: outcome.ok,
        artifactId,
        durationMs: outcome.durationMs,
        error: outcome.error,
      },
    });
    await this.updateWorkspaceRow(record.workspaceId, {
      browserCurrentUrl: outcome.url,
      browserLastActivityAt: new Date(),
    });
  }

  private async persistArtifact(
    workspaceId: string,
    artifactType: WorkspaceArtifactType,
    relativePath: string,
    extra?: { fileSize?: number; mimeType?: string; metadata?: Record<string, unknown> },
  ): Promise<WorkspaceArtifactRecord> {
    const artifact: WorkspaceArtifactRecord = {
      id: randomUUID(),
      workspaceId,
      artifactType,
      relativePath,
      fileSize: extra?.fileSize,
      mimeType: extra?.mimeType,
      metadata: extra?.metadata,
      createdAt: new Date(),
    };
    // Artifact write happens BEFORE event broadcast (INV-3 replay >= live).
    await this.artifactRepo.create(artifact);
    return artifact;
  }

  private async updateWorkspaceRow(workspaceId: string, updates: Partial<ExecutionWorkspace>): Promise<void> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) return;
    await this.workspaceRepo.updateStatus(workspaceId, ws.status, updates);
  }

  /**
   * Sequential per-workspace emit queue → INV-2 preserved. All `browser.*`
   * events for a given workspace serialise onto one Promise chain.
   */
  private async emitBrowserEvent(
    workspaceId: string,
    event: AgentEvent,
  ): Promise<void> {
    const record = this.sessions.get(workspaceId);
    const chain = record?.emitQueue ?? Promise.resolve();
    const next = chain
      .catch(() => undefined)
      .then(async () => {
        try {
          // The EventBus scope for browser events is a synthetic session id
          // per-workspace so downstream fan-out routes it into the SSE
          // stream keyed on the workspace/chat/run that owns it.
          const scopeSession = `${this.cfg.eventBusScopeSessionId}:${workspaceId}`;
          await this.eventBus.emit(scopeSession, event);
        } catch (err) {
          this.logger.warn?.(
            `[BrowserService] emit failed for workspace ${workspaceId}: ${(err as Error).message}`,
          );
        }
      });
    if (record) record.emitQueue = next;
    await next;
  }
}
