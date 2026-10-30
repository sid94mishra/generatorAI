// ────────────────────────────────────────────────────────────────
// WidgetService — Lifecycle for widget instances.
//
// Responsibilities:
//   - Create a WidgetInstance row from a descriptorId + props.
//   - Emit `harness.widget.render` on the event bus so the SSE
//     stream carries the render event to the browser.
//   - Persist state updates via updateState() (called by the widget
//     over the postMessage bridge on the client, forwarded here as
//     PATCH /api/widgets/:id/state).
//   - Dispatch widget actions back into the agent's conversation as
//     `harness.widget.action` events.
//   - Close instances on chat/run cleanup.
// ────────────────────────────────────────────────────────────────

import type { ILogger, WidgetInstance, WidgetSurface, WidgetActionDef } from '@generatorai/shared';
import { normalizeWidgetSurface, DEFAULT_WIDGET_SURFACE } from '@generatorai/shared';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { EventBus } from '../events/EventBus.js';
import type { IWidgetRegistry } from '../domain/ports/IWidgetRegistry.js';
import type { IExtensionRegistry } from '../domain/ports/IExtensionRegistry.js';
import type { IWidgetInstanceRepository } from '@generatorai/db';
import { newWidgetInstanceId } from './ExtensionManager.js';

export interface CreateWidgetInstanceParams {
  descriptorId: string;
  sessionId: string;
  chatId?: string;
  workflowRunId?: string;
  stageRunId?: string;
  messageId?: string;
  surface?: WidgetSurface;
  props?: unknown;
  /** Optional initial state. Defaults to `{}`. */
  state?: unknown;
  title?: string;
  /** Optional tool-call id when the widget is created via the widget tools. */
  callId?: string | null;
  /** Base URL used to prefix widget-asset URLs (e.g. `http://localhost:3100`). */
  assetsBase?: string;
}

export interface WidgetServiceConfig {
  /** Base URL for /api/widget-assets. Falls back to relative path. */
  assetsBase?: string;
  logger?: ILogger;
  /** Timeout for a `widget:invoke` round-trip. Defaults to 30s. */
  invokeTimeoutMs?: number;
  /** Max time to wait for a client teardown-ack before closing anyway.
   *  Defaults to 2.5s. */
  teardownTimeoutMs?: number;
}

/** A recorded interaction the user (not the agent) performed on a widget,
 *  buffered so the next chat turn can surface it into the LLM context. */
export interface RecentWidgetInteraction {
  instanceId: string;
  descriptorId: string;
  kind: 'action' | 'state' | 'context';
  action?: string;
  payload?: unknown;
  state?: unknown;
  /** For kind:'context' — a widget-authored, model-visible summary note
   *  (the `sendWidgetContext` / MCP-Apps `ui/update-model-context` path). */
  content?: string;
  at: string;
}

/** Result of a `widget_action` / `widget_exec` invoke round-trip. */
export interface WidgetInvokeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** True when the failure is because no live browser client has the widget
   *  mounted (so the action never ran). Signals the agent to fall back to
   *  update_widget rather than rewrite the widget. */
  notMounted?: boolean;
  /** The instance's committed state after the action (best-effort read). */
  state?: unknown;
  updatedAt?: string;
}

interface PendingInvoke {
  resolve: (r: WidgetInvokeResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WidgetService {
  private readonly logger: ILogger | undefined;
  private readonly cfg: Required<Pick<WidgetServiceConfig, 'assetsBase' | 'invokeTimeoutMs' | 'teardownTimeoutMs'>>;
  /** In-flight agent→widget invokes keyed by invokeId. */
  private readonly pendingInvokes = new Map<string, PendingInvoke>();
  /** In-flight teardown handshakes keyed by teardownId — resolved when the
   *  client bridge POSTs /teardown-ack after the widget commits final state. */
  private readonly pendingTeardowns = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  /** Buffered user-driven interactions keyed by chatId (falls back to
   *  sessionId when the widget has no owning chat). Drained by
   *  ChatManagementService at the top of each turn. */
  private readonly recentInteractions = new Map<string, RecentWidgetInteraction[]>();

  constructor(
    private readonly repo: IWidgetInstanceRepository,
    private readonly widgetRegistry: IWidgetRegistry,
    private readonly extensionRegistry: IExtensionRegistry,
    private readonly eventBus: EventBus,
    config: WidgetServiceConfig = {},
  ) {
    this.logger = config.logger;
    this.cfg = {
      assetsBase: config.assetsBase ?? '',
      invokeTimeoutMs: config.invokeTimeoutMs ?? 30_000,
      teardownTimeoutMs: config.teardownTimeoutMs ?? 2_500,
    };
  }

  /** Create a new widget instance + emit render event. */
  async createInstance(params: CreateWidgetInstanceParams): Promise<WidgetInstance> {
    const descriptor = this.widgetRegistry.get(params.descriptorId);
    if (!descriptor) {
      throw new Error(
        `Unknown widget descriptor "${params.descriptorId}". Ensure the extension providing it is installed and enabled.`,
      );
    }
    const ext = this.extensionRegistry.get(descriptor.extensionId);
    if (!ext || !ext.enabled || !ext.ready) {
      throw new Error(
        `Extension ${descriptor.extensionId} is not active — cannot render widget ${descriptor.id}`,
      );
    }
    await this.assertEntryExists(ext.rootPath, descriptor.entry, descriptor.id);
    const surface: WidgetSurface = normalizeWidgetSurface(
      params.surface ?? descriptor.preferredSurface ?? DEFAULT_WIDGET_SURFACE,
    );
    const now = new Date().toISOString();
    const instance: WidgetInstance = {
      instanceId: newWidgetInstanceId(),
      descriptorId: descriptor.id,
      sessionId: params.sessionId,
      chatId: params.chatId,
      workflowRunId: params.workflowRunId,
      stageRunId: params.stageRunId,
      messageId: params.messageId,
      surface,
      props: params.props ?? {},
      state: params.state ?? {},
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(instance);

    const assetsBase = params.assetsBase ?? this.cfg.assetsBase;
    await this.eventBus.emit(params.sessionId, {
      kind: 'harness.widget.render',
      data: {
        instanceId: instance.instanceId,
        descriptorId: descriptor.id,
        extensionId: descriptor.extensionId,
        component: descriptor.component,
        surface,
        title: params.title ?? descriptor.title,
        props: instance.props,
        // Carry the initial state so a widget rendered with initialState
        // (and never subsequently update_widget'd) re-hydrates correctly on
        // refresh / replay instead of mounting with an empty state.
        state: instance.state,
        assetsBase,
        entry: descriptor.entry,
        callId: params.callId ?? undefined,
        // Attach the widget event to the chat/run scope by including the FK
        // fields — the EventBus→StreamBroker bridge picks these up and
        // republishes to scope='chat'/'run' automatically (no code change
        // needed here).
        ...(params.chatId ? { chatId: params.chatId } : {}),
        ...(params.workflowRunId ? { workflowRunId: params.workflowRunId } : {}),
        // A stage's widget is routed to that stage's stream, not whichever
        // stage spoke last (parallel stages share the run scope).
        ...(params.stageRunId ? { stageRunId: params.stageRunId } : {}),
      },
    });
    return instance;
  }

  /**
   * The iframe loads `entry` from the widget-asset origin, and a missing file
   * there renders as the browser's own 404 page inside the panel — a blank
   * widget with nothing to act on. Checking here turns that into a tool error
   * the agent can actually fix (usually: it declared the widget but never
   * wrote the HTML).
   */
  private async assertEntryExists(
    rootPath: string,
    entry: string,
    descriptorId: string,
  ): Promise<void> {
    if (!rootPath) return;
    const target = path.resolve(rootPath, entry);
    const root = path.resolve(rootPath);
    const withinRoot = target === root || target.startsWith(root + path.sep);
    if (!withinRoot) {
      throw new Error(`Widget ${descriptorId} declares an entry outside its extension: ${entry}`);
    }
    try {
      await access(target);
    } catch {
      throw new Error(
        `Widget ${descriptorId} declares entry "${entry}" but that file does not exist in the ` +
          `extension. Write it (e.g. via write_extension) before rendering the widget.`,
      );
    }
  }

  /** Fetch an instance by id. */
  async getInstance(id: string): Promise<WidgetInstance | null> {
    return this.repo.findById(id);
  }

  /** Fetch instances by chat. */
  async listByChat(chatId: string): Promise<WidgetInstance[]> {
    return this.repo.findByChat(chatId);
  }

  /** Fetch instances by workflow run. */
  async listByRun(workflowRunId: string): Promise<WidgetInstance[]> {
    return this.repo.findByWorkflowRun(workflowRunId);
  }

  /** Fetch instances by session. */
  async listBySession(sessionId: string): Promise<WidgetInstance[]> {
    return this.repo.findBySession(sessionId);
  }

  /** Bulk fetch by ids — used by chatMessageToBlocks on replay. */
  async getInstances(ids: readonly string[]): Promise<WidgetInstance[]> {
    return this.repo.findByIds(ids);
  }

  /**
   * Build the client render payload for an instance (the same shape as the
   * `harness.widget.render` event data). Used by the REST list route so the
   * web client can RECONSTITUTE widgets on chat mount straight from the DB —
   * independent of the SSE event-replay window. Returns null if the
   * descriptor/extension is no longer available.
   */
  buildRenderPayload(instance: WidgetInstance): {
    instanceId: string;
    descriptorId: string;
    extensionId: string;
    component: string;
    surface: WidgetSurface;
    title?: string;
    props: unknown;
    state: unknown;
    assetsBase: string;
    entry: string;
    status: WidgetInstance['status'];
  } | null {
    const descriptor = this.widgetRegistry.get(instance.descriptorId);
    if (!descriptor) return null;
    return {
      instanceId: instance.instanceId,
      descriptorId: descriptor.id,
      extensionId: descriptor.extensionId,
      component: descriptor.component,
      surface: instance.surface,
      title: descriptor.title,
      props: instance.props,
      state: instance.state,
      assetsBase: this.cfg.assetsBase,
      entry: descriptor.entry,
      status: instance.status,
    };
  }

  /** Overwrite state (widget sends full snapshots) + emit event. */
  async updateState(
    id: string,
    state: unknown,
    patch?: unknown,
    from: 'agent' | 'user' = 'agent',
  ): Promise<WidgetInstance | null> {
    const existing = await this.repo.findById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    await this.repo.updateState(id, state, now);
    const next: WidgetInstance = { ...existing, state, updatedAt: now };
    if (from === 'user') {
      this.recordInteraction(existing, { kind: 'state', state, at: now });
    }
    await this.eventBus.emit(existing.sessionId, {
      kind: 'harness.widget.state',
      data: {
        instanceId: id,
        state,
        patch,
        ...(existing.chatId ? { chatId: existing.chatId } : {}),
        ...(existing.workflowRunId ? { workflowRunId: existing.workflowRunId } : {}),
        ...(existing.stageRunId ? { stageRunId: existing.stageRunId } : {}),
      },
    });
    return next;
  }

  /** Emit a widget action event so the LLM sees the interaction. */
  async dispatchAction(
    id: string,
    action: string,
    payload: unknown,
    from: 'agent' | 'user',
  ): Promise<WidgetInstance | null> {
    const existing = await this.repo.findById(id);
    if (!existing) return null;
    if (from === 'user') {
      this.recordInteraction(existing, {
        kind: 'action',
        action,
        payload,
        at: new Date().toISOString(),
      });
    }
    await this.eventBus.emit(existing.sessionId, {
      kind: 'harness.widget.action',
      data: {
        instanceId: id,
        action,
        payload,
        from,
        ...(existing.chatId ? { chatId: existing.chatId } : {}),
        ...(existing.workflowRunId ? { workflowRunId: existing.workflowRunId } : {}),
        ...(existing.stageRunId ? { stageRunId: existing.stageRunId } : {}),
      },
    });
    return existing;
  }

  // ── Agent → widget imperative action dispatch (Phase 1 + 2) ──

  /**
   * Invoke a typed action on a live widget instance. Validates the action
   * against the widget's declared action catalog, then dispatches a
   * `harness.widget.invoke` event and awaits the client bridge posting the
   * result back via `resolveInvoke`. Returns a structured result the tool
   * layer hands to the LLM.
   *
   * `expectedUpdatedAt` provides optimistic concurrency: if the caller
   * passes the `updatedAt` it last read and the instance has changed since,
   * the call is rejected as stale so the agent can re-read and retry.
   */
  async invokeAction(
    id: string,
    action: string,
    args: unknown,
    opts: { expectedUpdatedAt?: string } = {},
  ): Promise<WidgetInvokeResult> {
    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, error: `widget instance not found: ${id}` };
    if (existing.status === 'closed') {
      return { ok: false, error: `widget instance ${id} is closed` };
    }

    // Optimistic concurrency check.
    if (opts.expectedUpdatedAt && opts.expectedUpdatedAt !== existing.updatedAt) {
      return {
        ok: false,
        error: `stale: widget ${id} changed since you last read it ` +
          `(expected updatedAt ${opts.expectedUpdatedAt}, current ${existing.updatedAt}). ` +
          `Call read_widget again and retry.`,
        state: existing.state,
        updatedAt: existing.updatedAt,
      };
    }

    // Validate the action against the descriptor's catalog (when declared).
    const descriptor = this.widgetRegistry.get(existing.descriptorId);
    const catalog: WidgetActionDef[] = descriptor?.actions ?? [];
    if (catalog.length > 0) {
      const def = catalog.find((a) => a.name === action);
      if (!def) {
        return {
          ok: false,
          error:
            `unknown action "${action}" for ${existing.descriptorId}. ` +
            `Valid actions: ${catalog.map((a) => a.name).join(', ') || '(none)'}.`,
        };
      }
      const validationError = validateArgs(def.argsSchema, args);
      if (validationError) {
        return { ok: false, error: `invalid args for "${action}": ${validationError}` };
      }
    }

    const invokeId = `wi_${randomUUID().slice(0, 12)}`;
    const resultPromise = new Promise<WidgetInvokeResult>((resolvePromise) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(invokeId);
        resolvePromise({
          ok: false,
          notMounted: true,
          error:
            `widget "${existing.descriptorId}" is not mounted in a live browser client, so ` +
            `its action handler could not run. This is NOT a bug in your widget code — the ` +
            `widget renders fine; it just needs a browser tab with the Widget panel open to ` +
            `service widget_action / widget_exec. Do NOT rewrite the widget. Instead either ` +
            `(a) fall back to update_widget(instanceId, { ...full declarative state }) which ` +
            `persists state WITHOUT needing a live client, or (b) ask the user to open the ` +
            `Widget tab, then retry.`,
        });
      }, this.cfg.invokeTimeoutMs);
      this.pendingInvokes.set(invokeId, { resolve: resolvePromise, timer });
    });

    await this.eventBus.emit(existing.sessionId, {
      kind: 'harness.widget.invoke',
      data: {
        instanceId: id,
        invokeId,
        action,
        args: args ?? {},
        ...(existing.chatId ? { chatId: existing.chatId } : {}),
        ...(existing.workflowRunId ? { workflowRunId: existing.workflowRunId } : {}),
        ...(existing.stageRunId ? { stageRunId: existing.stageRunId } : {}),
      },
    } as never);

    const result = await resultPromise;
    // Read back the (possibly updated) state so the caller sees the effect.
    const after = await this.repo.findById(id);
    if (after) {
      result.state = after.state;
      result.updatedAt = after.updatedAt;
    }
    return result;
  }

  /** Resolve a pending `invokeAction` promise from the client bridge. */
  resolveInvoke(invokeId: string, result: unknown, error?: string): boolean {
    const pending = this.pendingInvokes.get(invokeId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingInvokes.delete(invokeId);
    if (error) {
      // The bridge marks the client-side "no mounted iframe" case with a
      // sentinel prefix so we can flag it as notMounted (recoverable via
      // update_widget) rather than a widget-code bug.
      const notMounted = error.startsWith('NOT_MOUNTED:');
      const cleanError = notMounted
        ? `widget is not mounted in a live browser client, so its action handler could not ` +
          `run. This is NOT a bug in your widget code. Do NOT rewrite the widget. Instead ` +
          `either fall back to update_widget(instanceId, { ...full declarative state }) which ` +
          `persists WITHOUT a live client, or ask the user to open the Widget tab and retry.`
        : error;
      pending.resolve({ ok: false, error: cleanError, result, ...(notMounted ? { notMounted: true } : {}) });
    } else {
      pending.resolve({ ok: true, result });
    }
    return true;
  }

  // ── User-interaction buffer (surfaced into the next LLM turn) ──

  private recordInteraction(
    inst: WidgetInstance,
    rec: Omit<RecentWidgetInteraction, 'instanceId' | 'descriptorId'>,
  ): void {
    const key = inst.chatId ?? inst.sessionId;
    const list = this.recentInteractions.get(key) ?? [];
    list.push({ instanceId: inst.instanceId, descriptorId: inst.descriptorId, ...rec });
    // Cap to the most recent 50 to bound memory.
    if (list.length > 50) list.splice(0, list.length - 50);
    this.recentInteractions.set(key, list);
  }

  /** Return and clear buffered user interactions for a chat/session scope. */
  drainRecentInteractions(chatId?: string, sessionId?: string): RecentWidgetInteraction[] {
    const out: RecentWidgetInteraction[] = [];
    for (const key of [chatId, sessionId]) {
      if (!key) continue;
      const list = this.recentInteractions.get(key);
      if (list && list.length > 0) {
        out.push(...list);
        this.recentInteractions.delete(key);
      }
    }
    return out;
  }

  /**
   * Record a widget-authored, model-visible context note (the
   * `sendWidgetContext` / MCP-Apps `ui/update-model-context` path). Buffered
   * like a user interaction and surfaced into the LLM at the next turn — it
   * does NOT wake the agent. Returns false if the instance is unknown.
   */
  async recordContext(id: string, content: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) return false;
    this.recordInteraction(existing, {
      kind: 'context',
      content,
      at: new Date().toISOString(),
    });
    return true;
  }

  /** Resolve a pending teardown handshake — called when the client bridge
   *  POSTs /teardown-ack after the widget committed its final state. */
  resolveTeardown(teardownId: string): boolean {
    const pending = this.pendingTeardowns.get(teardownId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingTeardowns.delete(teardownId);
    pending.resolve();
    return true;
  }

  /**
   * Close an instance. Before marking it closed we run a teardown handshake:
   * emit `harness.widget.teardown` so a live client asks the widget to commit
   * its final state (via widget:state → PATCH), and wait briefly for the
   * bridge's /teardown-ack. If no live client acks within the timeout, we
   * close anyway (state is already persisted on every user change). The row
   * is retained for replay.
   */
  async close(id: string, reason?: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) return false;
    if (existing.status !== 'closed') {
      await this.syncStateBeforeTeardown(existing, reason);
    }
    const now = new Date().toISOString();
    await this.repo.updateStatus(id, 'closed', now, reason);
    await this.eventBus.emit(existing.sessionId, {
      kind: 'harness.widget.closed',
      data: {
        instanceId: id,
        reason,
        ...(existing.chatId ? { chatId: existing.chatId } : {}),
        ...(existing.workflowRunId ? { workflowRunId: existing.workflowRunId } : {}),
        ...(existing.stageRunId ? { stageRunId: existing.stageRunId } : {}),
      },
    });
    return true;
  }

  /** Emit a teardown request and await the client's ack (bounded). */
  private async syncStateBeforeTeardown(inst: WidgetInstance, reason?: string): Promise<void> {
    const teardownId = `wt_${randomUUID().slice(0, 12)}`;
    const ackPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTeardowns.delete(teardownId);
        resolve(); // no live client — state already persisted, close proceeds
      }, this.cfg.teardownTimeoutMs);
      this.pendingTeardowns.set(teardownId, { resolve, timer });
    });
    await this.eventBus.emit(inst.sessionId, {
      kind: 'harness.widget.teardown',
      data: {
        instanceId: inst.instanceId,
        teardownId,
        reason,
        ...(inst.chatId ? { chatId: inst.chatId } : {}),
        ...(inst.workflowRunId ? { workflowRunId: inst.workflowRunId } : {}),
        ...(inst.stageRunId ? { stageRunId: inst.stageRunId } : {}),
      },
    } as never);
    await ackPromise;
  }
}

/**
 * Minimal JSON-Schema argument validator — checks `type: object`,
 * `required` fields and top-level primitive property types. This is a
 * light guard (not a full JSON-Schema engine): its job is to give the LLM
 * a crisp, correctable error before the round-trip, not to enforce every
 * constraint (the widget itself is the final authority). Returns an error
 * string, or `null` when the args are acceptable.
 */
function validateArgs(schema: Record<string, unknown> | undefined, args: unknown): string | null {
  if (!schema) return null;
  const obj = (args ?? {}) as Record<string, unknown>;
  if (typeof obj !== 'object' || Array.isArray(obj)) return 'args must be an object';

  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) {
      return `missing required field "${key}"`;
    }
  }

  const props = (schema['properties'] as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, spec] of Object.entries(props)) {
    if (obj[key] === undefined) continue;
    const expected = spec?.type;
    if (!expected) continue;
    const val = obj[key];
    const actual = Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val;
    const ok =
      (expected === 'integer' && actual === 'number') ||
      expected === actual ||
      (expected === 'object' && actual === 'object');
    if (!ok) {
      return `field "${key}" should be ${expected} but got ${actual}`;
    }
  }
  return null;
}
