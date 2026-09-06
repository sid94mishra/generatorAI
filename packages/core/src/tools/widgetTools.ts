// ────────────────────────────────────────────────────────────────
// widgetTools — built-in tools for widget lifecycle + control:
//   - search_widget   (progressive disclosure of installed widgets)
//   - render_widget   (create an instance)
//   - update_widget   (overwrite declarative state)
//   - read_widget     (read current state)
//   - describe_widget (read the descriptor + typed action catalog)
//   - list_widgets    (enumerate open widgets in this chat)
//   - close_widget    (dismiss)
//   - widget_action   (invoke ONE typed action on a live widget)
//   - widget_exec     (code-mode: run a script that calls many actions)
//
// These are constructed per-chat because they carry the session/chat
// context in a closure.
//
// The widget_action / widget_exec pair is how a COMPLEX widget with many
// verbs is driven: rather than registering one tool per action (which
// explodes the tool set and fights the frozen-tool-set model), the widget
// declares an `actions` catalog in its descriptor and the agent invokes
// them through these two generic tools.
// ────────────────────────────────────────────────────────────────

import type { WidgetSurface } from '@generatorai/shared';
import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';
import type { WidgetService } from '../services/WidgetService.js';
import type { IWidgetRegistry } from '../domain/ports/IWidgetRegistry.js';
import { createContext, Script } from 'node:vm';
import { WIDGET_USAGE_REFERENCE } from '../services/chatSystemHints.js';

export interface WidgetToolBinding {
  /** Session id owning the conversation. Required. */
  sessionId: string;
  /** Chat id — attach the widget to the chat scope for SSE routing. */
  chatId?: string;
  /** Workflow run id — attach the widget to the run scope. */
  workflowRunId?: string;
  /** Stage run id — used for workflow stages emitting widgets. */
  stageRunId?: string;
  /** Base URL for widget assets (e.g. `http://localhost:3100`). */
  assetsBase: string;
}

export interface WidgetToolFactoryContext {
  widgetService: WidgetService;
  widgetRegistry: IWidgetRegistry;
}

/**
 * Build the set of widget tools bound to a specific chat/session.
 */
export function buildWidgetTools(
  ctx: WidgetToolFactoryContext,
  binding: WidgetToolBinding,
): ToolDefinition[] {
  return [
    buildSearchWidgetTool(ctx, binding),
    buildRenderWidgetTool(ctx, binding),
    buildUpdateWidgetTool(ctx, binding),
    buildReadWidgetTool(ctx, binding),
    buildDescribeWidgetTool(ctx, binding),
    buildListWidgetsTool(ctx, binding),
    buildCloseWidgetTool(ctx, binding),
    buildWidgetActionTool(ctx, binding),
    buildWidgetExecTool(ctx, binding),
  ];
}

// ── render_widget ───────────────────────────────────────────────

function renderWidgetHandler(
  ctx: WidgetToolFactoryContext,
  binding: WidgetToolBinding,
) {
  return async (args: Record<string, unknown>) => {
    const descriptor =
      typeof args['descriptor'] === 'string' ? (args['descriptor'] as string) : '';
    const props = (args['props'] as Record<string, unknown>) ?? {};
    const initialState = (args['initialState'] as Record<string, unknown>) ??
      (args['state'] as Record<string, unknown>) ?? undefined;
    const surface = args['surface'] as WidgetSurface | undefined;
    const title = typeof args['title'] === 'string' ? args['title'] : undefined;
    if (!descriptor) {
      return { ok: false, error: 'descriptor is required (e.g. "user.kanban/board")' };
    }
    try {
      const instance = await ctx.widgetService.createInstance({
        descriptorId: descriptor,
        sessionId: binding.sessionId,
        chatId: binding.chatId,
        workflowRunId: binding.workflowRunId,
        stageRunId: binding.stageRunId,
        surface,
        props,
        state: initialState,
        title,
        assetsBase: binding.assetsBase,
      });
      const def = ctx.widgetRegistry.get(descriptor);
      const actions = (def?.actions ?? []).map((a) => a.name);
      return {
        ok: true,
        instanceId: instance.instanceId,
        descriptor: instance.descriptorId,
        surface: instance.surface,
        actions,
        hint:
          'Widget rendered. Drive it with widget_action(instanceId, action, args) for a ' +
          'single verb, or widget_exec(instanceId, code) to run several actions in one ' +
          'script. Use update_widget(instanceId, state) for whole-state overwrites, ' +
          'read_widget(instanceId) to observe user changes, and close_widget(instanceId) ' +
          'to dismiss.' +
          (actions.length > 0 ? ` Available actions: ${actions.join(', ')}.` : ''),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

const RENDER_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    descriptor: {
      type: 'string',
      description: '"<extensionId>/<component>" widget descriptor id, e.g. "user.kanban/board". Discover with search_widget.',
    },
    props: {
      type: 'object',
      additionalProperties: true,
      description: 'Initial props passed to the widget',
    },
    initialState: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional initial state (defaults to empty object)',
    },
    surface: {
      type: 'string',
      // Canonical surfaces are "inline" and "widget". Aliases (canvas →
      // widget, chat → inline, right-pane → widget) are accepted here and
      // collapsed by normalizeWidgetSurface, so the model is never rejected
      // for using a synonym it saw elsewhere in the prompt/docs.
      enum: ['inline', 'widget', 'canvas', 'chat', 'right-pane'],
      description:
        'Where to render — defaults to the widget\'s preferredSurface (usually "widget"). ' +
        'Canonical values: "inline" (a small control in the chat stream) and "widget" ' +
        '(a full-page app in the right-pane Widget tab). "canvas"/"right-pane" are treated ' +
        'as "widget"; "chat" is treated as "inline".',
    },
    title: { type: 'string', description: 'Optional title shown on the surface' },
  },
  required: ['descriptor'],
};

export function buildRenderWidgetTool(
  ctx: WidgetToolFactoryContext,
  binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'render_widget',
    description:
      'Render an interactive widget for the user. Widgets are HTML/JS bundles ' +
      'contributed by installed extensions and identified by "<extensionId>/<component>". ' +
      'Call search_widget first if you don\'t know which widgets are available. ' +
      'The widget appears on the surface you specify (default: the widget\'s ' +
      'preferredSurface, usually the full-page Widget tab). Returns instanceId (remember ' +
      'it) and the widget\'s action catalog. Drive complex widgets with widget_action / ' +
      'widget_exec; drive simple state-only widgets with update_widget.',
    parametersSchema: RENDER_WIDGET_SCHEMA,
    handler: renderWidgetHandler(ctx, binding),
    owner: 'system:widgets',
  };
}

// ── update_widget ───────────────────────────────────────────────

function updateWidgetHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    if (!instanceId) return { ok: false, error: 'instanceId is required' };
    const state = (args['state'] as Record<string, unknown>) ?? {};
    const patch = args['patch'] as Record<string, unknown> | undefined;
    const result = await ctx.widgetService.updateState(instanceId, state, patch);
    if (!result) return { ok: false, error: `widget instance not found: ${instanceId}` };
    return { ok: true };
  };
}

const UPDATE_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: {
      type: 'string',
      description: 'instanceId returned by a prior render_widget call',
    },
    state: {
      type: 'object',
      additionalProperties: true,
      description: 'New full state (replaces existing state)',
    },
    patch: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional shallow patch merged on top of current state',
    },
  },
  required: ['instanceId'],
};

export function buildUpdateWidgetTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'update_widget',
    description:
      'Overwrite the whole state of a previously-rendered widget so the client re-renders. ' +
      'Best for simple state-only widgets (polls, toggles). For complex widgets with many ' +
      'verbs, prefer widget_action / widget_exec so you don\'t have to reproduce the entire ' +
      'state. Provide the instanceId from a prior render_widget call and either a full new ' +
      'state object or a shallow patch.',
    parametersSchema: UPDATE_WIDGET_SCHEMA,
    handler: updateWidgetHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── close_widget ────────────────────────────────────────────────

function closeWidgetHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    if (!instanceId) return { ok: false, error: 'instanceId is required' };
    const reason = typeof args['reason'] === 'string' ? args['reason'] : undefined;
    const closed = await ctx.widgetService.close(instanceId, reason);
    return closed ? { ok: true } : { ok: false, error: 'not found' };
  };
}

const CLOSE_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: {
      type: 'string',
      description: 'instanceId returned by a prior render_widget call',
    },
    reason: {
      type: 'string',
      description: 'Optional reason for closing (for debugging / audit)',
    },
  },
  required: ['instanceId'],
};

export function buildCloseWidgetTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'close_widget',
    description: 'Dismiss a widget instance created via render_widget.',
    parametersSchema: CLOSE_WIDGET_SCHEMA,
    handler: closeWidgetHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── read_widget ─────────────────────────────────────────────────

function readWidgetHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    if (!instanceId) return { ok: false, error: 'instanceId is required' };
    const inst = await ctx.widgetService.getInstance(instanceId);
    if (!inst) return { ok: false, error: `widget instance not found: ${instanceId}` };
    const def = ctx.widgetRegistry.get(inst.descriptorId);
    return {
      ok: true,
      instanceId: inst.instanceId,
      descriptorId: inst.descriptorId,
      surface: inst.surface,
      status: inst.status,
      props: inst.props,
      state: inst.state,
      updatedAt: inst.updatedAt,
      actions: (def?.actions ?? []).map((a) => a.name),
    };
  };
}

const READ_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: {
      type: 'string',
      description: 'instanceId returned by a prior render_widget call',
    },
  },
  required: ['instanceId'],
};

export function buildReadWidgetTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'read_widget',
    description:
      'Read the CURRENT state of a rendered widget instance. Call this when ' +
      'the user says they interacted with a widget (voted, clicked, typed, etc.) ' +
      'and you need to know what they did before responding or calling ' +
      'update_widget / widget_action. Returns { instanceId, descriptorId, surface, ' +
      'status, props, state, updatedAt, actions }. The `state` field is the most ' +
      'recent full state snapshot committed by the widget. Pass `updatedAt` back into ' +
      'widget_action.expectedUpdatedAt for optimistic concurrency when you want to ' +
      'avoid clobbering a concurrent user edit.',
    parametersSchema: READ_WIDGET_SCHEMA,
    handler: readWidgetHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── list_widgets ────────────────────────────────────────────────

function listWidgetsHandler(ctx: WidgetToolFactoryContext, binding: WidgetToolBinding) {
  return async (args: Record<string, unknown>) => {
    const includeClosed = args['includeClosed'] === true;
    // Prefer chat scope; fall back to session scope if no chat is bound.
    const list = binding.chatId
      ? await ctx.widgetService.listByChat(binding.chatId)
      : await ctx.widgetService.listBySession(binding.sessionId);
    const filtered = includeClosed ? list : list.filter((w) => w.status !== 'closed');
    return {
      ok: true,
      widgets: filtered.map((w) => ({
        instanceId: w.instanceId,
        descriptorId: w.descriptorId,
        surface: w.surface,
        status: w.status,
        state: w.state,
        updatedAt: w.updatedAt,
      })),
    };
  };
}

const LIST_WIDGETS_SCHEMA = {
  type: 'object' as const,
  properties: {
    includeClosed: {
      type: 'boolean',
      description: 'When true, also return widgets whose status is "closed". Defaults to false.',
    },
  },
  required: [],
};

export function buildListWidgetsTool(
  ctx: WidgetToolFactoryContext,
  binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'list_widgets',
    description:
      'List every widget instance the user currently has open in this chat, with ' +
      'each one\'s instanceId, descriptorId, surface, status and latest state. ' +
      'Useful when the user refers to "the widget" without giving you an id, or ' +
      'when you need to discover what\'s on the canvas before reading state.',
    parametersSchema: LIST_WIDGETS_SCHEMA,
    handler: listWidgetsHandler(ctx, binding),
    owner: 'system:widgets',
  };
}

// ── search_widget ───────────────────────────────────────────────

interface RankedWidget {
  descriptor: string;
  title: string;
  description: string;
  preferredSurface: WidgetSurface;
  extensionId: string;
  keywords: string[];
  score: number;
}

/** Rank installed widgets against a free-form query using a simple
 *  keyword-match score. Higher = better match. */
function rankWidgets(
  query: string,
  candidates: readonly {
    id: string;
    extensionId: string;
    title?: string;
    description?: string;
    preferredSurface: WidgetSurface;
    keywords?: readonly string[];
  }[],
  limit: number,
  surface?: WidgetSurface,
): RankedWidget[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
  const surfaceFilter = surface ? (surface === 'inline' ? 'inline' : 'widget') : undefined;

  const scored: RankedWidget[] = candidates
    .filter((w) => !surfaceFilter || w.preferredSurface === surfaceFilter)
    .map((w) => {
      const haystack = [
        w.id,
        w.title ?? '',
        w.description ?? '',
        (w.keywords ?? []).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
        // Small bonus for exact keyword match
        if (w.keywords?.some((k) => k.toLowerCase() === term)) score += 2;
        // Bonus for title match
        if (w.title?.toLowerCase().includes(term)) score += 1;
      }
      // Fall back to slight base score so queries with zero-token overlap
      // still return top widgets (agent can browse).
      if (terms.length === 0 || score > 0) {
        return {
          descriptor: w.id,
          title: w.title ?? w.id,
          description: w.description ?? '',
          preferredSurface: w.preferredSurface,
          extensionId: w.extensionId,
          keywords: [...(w.keywords ?? [])],
          score: score || 0.1,
        } satisfies RankedWidget;
      }
      return null;
    })
    .filter((r): r is RankedWidget => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

function searchWidgetHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const query = typeof args['query'] === 'string' ? args['query'] : '';
    const limitRaw = typeof args['limit'] === 'number' ? args['limit'] : 5;
    const limit = Math.max(1, Math.min(20, limitRaw));
    const surface = args['surface'] as WidgetSurface | undefined;

    const all = ctx.widgetRegistry.list();
    const ranked = rankWidgets(query, all, limit, surface);
    return {
      widgets: ranked.map((w) => ({
        descriptor: w.descriptor,
        title: w.title,
        description: w.description,
        preferredSurface: w.preferredSurface,
        extensionId: w.extensionId,
        keywords: w.keywords,
      })),
      totalInstalled: all.length,
      hint: 'Call render_widget with the chosen descriptor to render.',
      // The full driving contract travels HERE rather than in every system
      // prompt (review 3.7). The model has to call search_widget before it can
      // render anything, so this is the first moment the detail is useful — and
      // chats that never touch a widget never pay for it.
      usage: WIDGET_USAGE_REFERENCE,
    };
  };
}

const SEARCH_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description:
        'What the widget should do or contain (natural language). Empty string returns the top widgets by name.',
    },
    surface: {
      type: 'string',
      enum: ['inline', 'widget'],
      description: 'Only return widgets that prefer this surface (optional filter)',
    },
    limit: {
      type: 'number',
      description: 'Max results to return (1–20, default 5)',
    },
  },
  required: ['query'],
};

export function buildSearchWidgetTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'search_widget',
    description:
      'Search for a widget you can render for the user. Returns a small ranked ' +
      'list of installed widgets that match the query, including each widget\'s ' +
      'descriptor id, title, description, and preferred surface. Once you pick ' +
      'one, call render_widget with its descriptor id. Use this before render_widget ' +
      'when you don\'t already know the descriptor.',
    parametersSchema: SEARCH_WIDGET_SCHEMA,
    handler: searchWidgetHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── describe_widget ─────────────────────────────────────────────

function describeWidgetHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    const descriptorId = typeof args['descriptor'] === 'string' ? args['descriptor'] : '';
    let descId = descriptorId;
    let instState: unknown;
    let updatedAt: string | undefined;
    if (instanceId) {
      const inst = await ctx.widgetService.getInstance(instanceId);
      if (!inst) return { ok: false, error: `widget instance not found: ${instanceId}` };
      descId = inst.descriptorId;
      instState = inst.state;
      updatedAt = inst.updatedAt;
    }
    if (!descId) {
      return { ok: false, error: 'pass instanceId (preferred) or descriptor' };
    }
    const def = ctx.widgetRegistry.get(descId);
    if (!def) return { ok: false, error: `unknown widget descriptor: ${descId}` };
    return {
      ok: true,
      descriptor: def.id,
      title: def.title,
      description: def.description,
      preferredSurface: def.preferredSurface,
      stateSchema: def.stateSchema,
      actions: (def.actions ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        argsSchema: a.argsSchema,
        returns: a.returns,
      })),
      ...(instanceId ? { instanceId, currentState: instState, updatedAt } : {}),
      hint:
        (def.actions && def.actions.length > 0)
          ? 'Invoke any action with widget_action(instanceId, action, args), or chain ' +
            'several with widget_exec(instanceId, code) where the code calls ' +
            'await widget.<action>(args).'
          : 'This widget declares no actions — drive it with update_widget(instanceId, state).',
    };
  };
}

const DESCRIBE_WIDGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: {
      type: 'string',
      description: 'A live instance id (preferred — also returns current state).',
    },
    descriptor: {
      type: 'string',
      description: 'A descriptor id "<extensionId>/<component>" to describe without an instance.',
    },
  },
  required: [],
};

export function buildDescribeWidgetTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'describe_widget',
    description:
      'Get the full capability profile of a widget: its title, description, state ' +
      'schema, and — most importantly — its ACTION CATALOG (the typed verbs you can ' +
      'invoke with widget_action / widget_exec). Call this on a complex widget before ' +
      'driving it so you know the exact action names and argument shapes. Pass an ' +
      'instanceId to also get the current state.',
    parametersSchema: DESCRIBE_WIDGET_SCHEMA,
    handler: describeWidgetHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── widget_action (single typed verb) ───────────────────────────

function widgetActionHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    const action = typeof args['action'] === 'string' ? args['action'] : '';
    if (!instanceId) return { ok: false, error: 'instanceId is required' };
    if (!action) return { ok: false, error: 'action is required' };
    const actionArgs = (args['args'] as Record<string, unknown>) ?? {};
    const expectedUpdatedAt =
      typeof args['expectedUpdatedAt'] === 'string' ? (args['expectedUpdatedAt'] as string) : undefined;
    const res = await ctx.widgetService.invokeAction(instanceId, action, actionArgs, {
      expectedUpdatedAt,
    });
    return res;
  };
}

const WIDGET_ACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: { type: 'string', description: 'instanceId from a prior render_widget call' },
    action: {
      type: 'string',
      description: 'The action/verb name from the widget\'s action catalog (see describe_widget).',
    },
    args: {
      type: 'object',
      additionalProperties: true,
      description: 'Arguments object for the action, validated against the action\'s argsSchema.',
    },
    expectedUpdatedAt: {
      type: 'string',
      description:
        'Optional optimistic-concurrency guard — pass the `updatedAt` you last read; ' +
        'the call is rejected as stale if the widget changed since (e.g. a concurrent ' +
        'user edit), so you can re-read and retry instead of clobbering.',
    },
  },
  required: ['instanceId', 'action'],
};

export function buildWidgetActionTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'widget_action',
    description:
      'Invoke ONE typed action (verb) on a live widget — e.g. moveCard, addRow, setCell. ' +
      'This is how you drive a COMPLEX widget without reproducing its entire state: the ' +
      'widget declares an action catalog (see describe_widget), executes the verb, mutates ' +
      'its own state, and returns a result. The call round-trips to the mounted widget and ' +
      'waits for its result. For several verbs in a row, prefer widget_exec. NOTE: this ' +
      'requires the widget to be MOUNTED in a live browser client. If the result has ' +
      'notMounted:true, do NOT rewrite the widget (it is fine) — fall back to ' +
      'update_widget(instanceId, {full state}) or ask the user to open the Widget tab.',
    parametersSchema: WIDGET_ACTION_SCHEMA,
    handler: widgetActionHandler(ctx),
    owner: 'system:widgets',
  };
}

// ── widget_exec (code-mode: many verbs in one script) ───────────

function widgetExecHandler(ctx: WidgetToolFactoryContext) {
  return async (args: Record<string, unknown>) => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : '';
    const code = typeof args['code'] === 'string' ? args['code'] : '';
    if (!instanceId) return { ok: false, error: 'instanceId is required' };
    if (!code) return { ok: false, error: 'code is required' };
    const inst = await ctx.widgetService.getInstance(instanceId);
    if (!inst) return { ok: false, error: `widget instance not found: ${instanceId}` };
    const def = ctx.widgetRegistry.get(inst.descriptorId);
    const actions = def?.actions ?? [];
    if (actions.length === 0) {
      return {
        ok: false,
        error:
          `widget ${inst.descriptorId} declares no actions — widget_exec has nothing to call. ` +
          `Use update_widget for state-only widgets.`,
      };
    }
    return runWidgetExec(ctx, instanceId, actions.map((a) => a.name), code);
  };
}

const WIDGET_EXEC_SCHEMA = {
  type: 'object' as const,
  properties: {
    instanceId: { type: 'string', description: 'instanceId from a prior render_widget call' },
    code: {
      type: 'string',
      description:
        'Async JavaScript body. You get an async `widget` object whose methods are the ' +
        'widget\'s actions (each returns a Promise of the action result), a `read()` ' +
        'helper returning the current state, and `log(...)` to return values. Example: ' +
        '`const s = await read(); for (const c of s.cards) { await widget.moveCard({ id: c.id, to: "done" }); } log("moved", s.cards.length);`. ' +
        'No imports, no network, no filesystem — only `widget`, `read`, and `log`.',
    },
  },
  required: ['instanceId', 'code'],
};

export function buildWidgetExecTool(
  ctx: WidgetToolFactoryContext,
  _binding: WidgetToolBinding,
): ToolDefinition {
  return {
    name: 'widget_exec',
    description:
      'CODE MODE for complex widgets. Run a short async JavaScript script that calls ' +
      'several widget actions in sequence (and reads state between them) in ONE tool call, ' +
      'instead of many round-trips. The script gets a typed `widget` API (one async method ' +
      'per declared action), a `read()` state getter, and `log()`. Ideal for multi-step ' +
      'operations like "rebalance the board" or "sort then recolor". Discover the available ' +
      'methods with describe_widget first. NOTE: like widget_action, this requires the ' +
      'widget MOUNTED in a live browser client; on notMounted:true fall back to ' +
      'update_widget with the full declarative state (do NOT rewrite the widget).',
    parametersSchema: WIDGET_EXEC_SCHEMA,
    handler: widgetExecHandler(ctx),
    owner: 'system:widgets',
  };
}

/** Wall-clock budget for one agent-authored widget script. */
const WIDGET_SCRIPT_TIMEOUT_MS = 5_000;

/**
 * Ceiling on what one script may DO, not just how long it may take.
 *
 * Time alone is not a bound: a tight `while (true) { await widget.act() }`
 * completes millions of iterations inside the deadline, and every one appends
 * to the call and log arrays — enough to exhaust memory before the clock runs
 * out. A real script drives a widget a few dozen times.
 */
const WIDGET_SCRIPT_MAX_CALLS = 1_000;
const WIDGET_SCRIPT_MAX_LOGS = 1_000;

/**
 * Execute an agent-authored widget-control script. Each `widget.<action>()`
 * call is dispatched through `WidgetService.invokeAction`, which round-trips
 * to the live iframe.
 *
 * The script runs in a FRESH `node:vm` context whose global object holds only
 * the injected `widget`, `read` and `log`, under a wall-clock timeout. The vm
 * timeout alone would bound only synchronous work — an awaiting loop escapes
 * it — so the deadline also disarms every injected function, which is what
 * stops an async loop rather than merely stopping the wait for it.
 *
 * It previously ran through `new Function`, whose body compiles in the global
 * scope — so this comment claimed "no access to require/process/globals"
 * while `process`, `globalThis` and `global` were all reachable. One line
 * could read every API key in the environment into the transcript, and
 * another could block the only thread forever. The isolated context and the
 * timeout are what make the sentence above true (review 6.1).
 */
async function runWidgetExec(
  ctx: WidgetToolFactoryContext,
  instanceId: string,
  actionNames: string[],
  code: string,
): Promise<Record<string, unknown>> {
  const logs: unknown[] = [];
  const calls: Array<{ action: string; ok: boolean; error?: string }> = [];

  const widget: Record<string, (a?: unknown) => Promise<unknown>> = {};
  /**
   * Tripped when the script outlives its budget.
   *
   * The vm's own `timeout` only bounds SYNCHRONOUS execution: the moment the
   * script awaits, control returns to the event loop and that budget stops
   * applying. So `while (true) { await widget.act() }` would keep running —
   * and keep driving the real widget — long after the caller had been handed a
   * timeout error. Every injected function refuses once this is set, which
   * makes the next `await` throw and unwinds the loop for real.
   */
  let deadlineExceeded = false;
  const assertWithinBudget = (): void => {
    if (deadlineExceeded) {
      throw new Error(`Widget script exceeded ${WIDGET_SCRIPT_TIMEOUT_MS} ms and was stopped.`);
    }
    if (calls.length >= WIDGET_SCRIPT_MAX_CALLS) {
      deadlineExceeded = true;
      throw new Error(
        `Widget script exceeded ${WIDGET_SCRIPT_MAX_CALLS} widget calls and was stopped.`,
      );
    }
    if (logs.length >= WIDGET_SCRIPT_MAX_LOGS) {
      deadlineExceeded = true;
      throw new Error(`Widget script exceeded ${WIDGET_SCRIPT_MAX_LOGS} log lines and was stopped.`);
    }
  };

  for (const name of actionNames) {
    widget[name] = async (a?: unknown) => {
      assertWithinBudget();
      const res = await ctx.widgetService.invokeAction(instanceId, name, a ?? {});
      assertWithinBudget();
      calls.push({ action: name, ok: res.ok, error: res.error });
      if (!res.ok) {
        throw new Error(`widget.${name} failed: ${res.error ?? 'unknown error'}`);
      }
      return res.result;
    };
  }
  /**
   * The state read WE do when assembling the result. Not budget-checked: it
   * runs after the script has finished (or been stopped), and a refusal here
   * would make the error path throw instead of reporting the error.
   */
  const readState = async () => {
    const inst = await ctx.widgetService.getInstance(instanceId);
    return inst?.state ?? null;
  };
  /** The `read()` handed to the SCRIPT — budget-checked like every injected call. */
  const read = async () => {
    assertWithinBudget();
    return readState();
  };
  const log = (...xs: unknown[]) => {
    assertWithinBudget();
    logs.push(xs.length === 1 ? xs[0] : xs);
  };

  try {
    // A bare object as the context global: no `process`, no `require`, no
    // `globalThis` inherited from this realm. Only what we put in it.
    const sandbox: Record<string, unknown> = { widget, read, log };
    const context = createContext(sandbox, { name: 'widget-script' });
    const script = new Script(`"use strict"; (async () => { ${code}
 })();`, { filename: 'widget-script.js' });
    // Two different budgets, because one is not enough:
    //   • the vm's `timeout` stops a purely SYNCHRONOUS spin (`while (true) {}`)
    //     from wedging the only thread;
    //   • the race below bounds how long the CALLER waits, and — crucially —
    //     trips `deadlineExceeded`, which is what actually halts an async loop.
    //     Without that a script could keep driving the widget forever after
    //     this function had already returned an error.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = script.runInContext(context, {
      timeout: WIDGET_SCRIPT_TIMEOUT_MS,
    }) as Promise<unknown>;
    // Once a budget trips we report immediately, but the script's own promise
    // rejects a moment later when its next injected call refuses. Nothing is
    // awaiting it by then, so without this it surfaces as an unhandled
    // rejection — which, with Node's default, can take the process down.
    void Promise.resolve(started).catch(() => undefined);
    const returned = await Promise.race([
      Promise.resolve(started),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          deadlineExceeded = true;
          reject(new Error(`Widget script exceeded ${WIDGET_SCRIPT_TIMEOUT_MS} ms and was stopped.`));
        }, WIDGET_SCRIPT_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    const finalState = await readState();
    return {
      ok: true,
      calls,
      logs,
      returned,
      state: finalState,
      hint: `Ran ${calls.length} action(s). Final state attached.`,
    };
  } catch (err) {
    const finalState = await readState();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      calls,
      logs,
      state: finalState,
    };
  }
}

// ── Canonical names for permission filters / UI badges ─────────

export const WIDGET_TOOL_NAMES = [
  'search_widget',
  'render_widget',
  'update_widget',
  'read_widget',
  'describe_widget',
  'list_widgets',
  'close_widget',
  'widget_action',
  'widget_exec',
] as const;

export type WidgetToolName = (typeof WIDGET_TOOL_NAMES)[number];
