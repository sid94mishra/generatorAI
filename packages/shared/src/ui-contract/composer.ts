// ────────────────────────────────────────────────────────────────
// Composer contract (03-component-inventory-domain.md §3.2; 08 M-11, M-12;
// D-29, D-40).
//
// The states a composer can be in and what its primary control offers, drawn
// the same on web (`blocks/composer`) and, next pass, mobile. The machine that
// moves between them is the pure reducer in `@generatorai/client-core`
// (`composerReducer`); this file only names the states so both platforms
// render the same set.
//
// Types and constants only, dependency-free: never import the shared root
// (the Electron main bundle loads `@generatorai/shared/ui-contract`).
// ────────────────────────────────────────────────────────────────

/**
 * Readiness of a chat's workspace mounts, as the composer sees it. Mirrors
 * the server's `WorkspacePrepStatus` (kept structural here so this module
 * stays dependency-free; client-core pins the two together).
 */
export type ComposerPrepStatus = 'pending' | 'preparing' | 'ready' | 'error';

/**
 * What currently stands between the user and a Send (03 §3.2 F-composer-22,
 * F-composer-13). Typing is never blocked by any of these (D-29):
 *
 * - `prep_failed`      workspace preparation failed — Retry / Edit sources.
 * - `preparing`        worktrees and checkouts still being created.
 * - `waiting_on_you`   a gate (permission, question, plan review) is open —
 *                      "Cancel and send".
 * - `running`          a turn is live; Send is Stop.
 * - `stopping`         Stop was pressed; the graceful cancel is in flight.
 * - `force_available`  the graceful path failed; the control offers Force reset.
 * - `null`             nothing blocks; Send is available once there is content.
 *
 * Bars show one at a time with the priority `prep_failed > preparing >
 * waiting_on_you`; the turn states apply only when no bar does.
 */
export type ComposerBlockingState =
  | 'preparing'
  | 'prep_failed'
  | 'waiting_on_you'
  | 'running'
  | 'stopping'
  | 'force_available'
  | null;

/** Every non-null blocking state, highest priority first. */
export const COMPOSER_BLOCKING_STATES = [
  'prep_failed',
  'preparing',
  'waiting_on_you',
  'force_available',
  'stopping',
  'running',
] as const satisfies readonly Exclude<ComposerBlockingState, null>[];

/** The blocking states that render a bar above the box (F-composer-22). */
export const COMPOSER_BAR_STATES = ['prep_failed', 'preparing', 'waiting_on_you'] as const satisfies readonly Exclude<
  ComposerBlockingState,
  null
>[];

/**
 * The composer's primary control (F-composer-13): Send; Stop while a turn is
 * live; "Stopping…" (inert for the 400 ms arming window) after the first
 * press; Force reset once 15 s pass with the turn still live. No queue (D-29).
 */
export type ComposerPrimaryAction = 'send' | 'stop' | 'stopping' | 'force_reset';

/** What the Stop control says and whether it takes a press (from the two-phase stop machine). */
export interface ComposerStopView {
  label: string;
  enabled: boolean;
  forceAvailable: boolean;
}

/** Everything a composer view needs to draw its blocking bar and primary control. */
export interface ComposerView {
  blocking: ComposerBlockingState;
  primaryAction: ComposerPrimaryAction;
  /** Send would be accepted right now. */
  canSend: boolean;
  /** Always true: typing is never blocked (D-29); disabling is the host's `disabled`. */
  typingAllowed: boolean;
  /** The Stop control, while a turn is live; `null` otherwise. */
  stop: ComposerStopView | null;
}

/**
 * Who the composer's next turn is bound to (ComposerStates "Binding" panels):
 * the model alone, a worker agent (locked chip), orchestrate mode without an
 * agent, or an orchestrator agent (team row).
 */
export type ComposerBinding = 'model' | 'worker_agent' | 'orchestrate' | 'orchestrator_agent';

/** Where a composer is mounted: the chat page, a workflow stage message box, Home quick-start. */
export type ComposerVariant = 'chat' | 'stage' | 'quick';

/** Ids of the composer tool-toggle registry (03 §3.2 "Composer tool-toggle registry"). */
export type ComposerToolToggleId = 'browser' | 'computer' | 'widgets' | 'workflows';

export const COMPOSER_TOOL_TOGGLE_IDS = ['browser', 'computer', 'widgets', 'workflows'] as const satisfies readonly ComposerToolToggleId[];

/**
 * One entry of the composer tool-toggle registry. `TChat` is the host's chat
 * shape; `icon` is an icon concept name (D-17). Mobile consumes the same ids.
 */
export interface ComposerToolToggle<TChat> {
  id: ComposerToolToggleId;
  label: string;
  hint: string;
  icon: string;
  order: number;
  defaultFor: (chat: TChat) => boolean;
  available: (chat: TChat) => boolean;
  read: (chat: TChat) => boolean;
  write: (chatId: string, on: boolean) => Promise<void>;
}
