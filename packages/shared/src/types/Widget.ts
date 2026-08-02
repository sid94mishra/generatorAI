// ────────────────────────────────────────────────────────────────
// Widget — Extension-contributed UI primitive.
//
// A Widget is a sandboxed HTML/JS component the agent renders either
// inline in the chat streaming panel or as a full-page widget in the
// right pane. Both agent and user interact with the running instance via
// a postMessage bridge; the host publishes state + actions back onto the
// event bus so the agent can observe widget interactions.
//
// Surface model (exactly two):
//   - `widget` (default): renders full-page on the right-pane Widget
//     tab. Best for interactive apps, dashboards, forms, editors.
//   - `inline`: renders inside the chat streaming panel at the tool
//     call site. Good for small confirms, cards, tiny controls.
// ────────────────────────────────────────────────────────────────

/**
 * Widget render surfaces.
 *
 *   - `inline`  → rendered in the chat streaming panel.
 *   - `widget`  → rendered full-page in the right-pane Widget tab.
 */
export type WidgetSurface = 'inline' | 'widget';

/** The default surface used when a widget descriptor and a `render_widget`
 *  call both omit an explicit surface. */
export const DEFAULT_WIDGET_SURFACE: WidgetSurface = 'widget';

/**
 * Normalize any surface value (including historical aliases) to one of
 * the two canonical surfaces. `chat` → `inline`; `canvas` / `right-pane`
 * → `widget`.
 */
export function normalizeWidgetSurface(s: string | undefined | null): WidgetSurface {
  if (!s) return DEFAULT_WIDGET_SURFACE;
  if (s === 'inline' || s === 'chat') return 'inline';
  // 'widget', 'canvas', 'right-pane' and anything else fall through to widget.
  return 'widget';
}

/**
 * Permissions a widget can request. Enforced by the existing
 * `PermissionPolicy` at RPC time.
 *
 *   tools:invoke           — may invoke any tool the current session has
 *   tools:invoke:<name>    — may invoke a specific tool
 *   chat:send              — may inject a user message into the chat
 *   workspace:read         — may read files under the owning workspace
 *   workspace:write        — may write files under the owning workspace
 *   browser:navigate       — may drive the integrated browser
 *   network:fetch:<host>   — outbound fetch to a whitelisted host
 *   clipboard:read
 *   clipboard:write
 */
export type WidgetPermission = string;

/**
 * A declarative action a widget exposes to the agent. The agent
 * discovers these via `read_widget` / `describe_widget` / `search_widget`
 * and invokes them through the single generic `widget_action` tool (or a
 * `widget_exec` code-mode script). This lets a complex widget expose an
 * arbitrary number of typed verbs without registering one tool per action.
 */
export interface WidgetActionDef {
  /** Verb name, e.g. `moveCard`. Unique within the widget. */
  name: string;
  /** One-line description of what the action does. */
  description?: string;
  /** JSON Schema (as Record) validating the action's arguments object. */
  argsSchema?: Record<string, unknown>;
  /** Human description of what the action returns (for the agent). */
  returns?: string;
}

export interface WidgetDescriptor {
  /** Fully-qualified: "<extensionId>/<component>" */
  id: string;
  extensionId: string;
  component: string;
  title?: string;
  description?: string;
  /** Preferred initial render surface. Runtime may override per-instance.
   *  Defaults to `widget` when the descriptor omits this. */
  preferredSurface: WidgetSurface;
  /**
   * Where the HTML entry lives, resolved relative to the extension root
   * at load time. Served over `/api/widget-assets/:extensionId/*`.
   */
  entry: string;
  /** JSON Schema (as Record) validating the widget's initial props. */
  propsSchema?: Record<string, unknown>;
  /** JSON Schema validating the widget's persistent state. */
  stateSchema?: Record<string, unknown>;
  /** Declared permissions displayed in install dialogs. */
  permissions?: WidgetPermission[];
  /** Keywords used by search_widget for ranking. */
  keywords?: string[];
  /**
   * Action catalog — the typed verbs the agent can invoke on a live
   * instance of this widget via `widget_action` / `widget_exec`.
   * Optional: simple widgets rely on state-only control and omit this.
   */
  actions?: WidgetActionDef[];
}

export type WidgetInstanceStatus = 'active' | 'suspended' | 'closed' | 'error';

export interface WidgetInstance {
  instanceId: string;
  descriptorId: string;
  sessionId: string;
  chatId?: string;
  workflowRunId?: string;
  stageRunId?: string;
  messageId?: string;
  surface: WidgetSurface;
  props: unknown;
  state: unknown;
  status: WidgetInstanceStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
