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

/**
 * The composer's placeholder (D-90). It names who answers only when that is a
 * person-made agent or the orchestrator; a chat with a plain model gets a
 * provider-neutral line — never the provider or harness name ("Message
 * Copilot…" read as if the chat were bound to that product). `files` says
 * whether `@` mentions files here (a chat with a workspace). Web and mobile.
 */
export function composerPromptPlaceholder(who: { agent?: string | null; orchestrator?: boolean; files?: boolean }): string {
  if (who.agent) return `Reply to ${who.agent}…`;
  if (who.orchestrator) return 'Reply to the orchestrator…';
  return who.files ? 'Ask anything — @ for files, / for skills' : 'Ask anything — / for skills';
}

/**
 * Display name of a reasoning-effort level, the same on every surface (composer chip, create flows, agent editor,
 * workflow session editor, mobile): "Low", "Medium", "High", "Extra high", "Max", "Ultra". Unknown levels a provider
 * adds are title-cased.
 */
export function reasoningEffortLabel(level: string): string {
  if (level === 'xhigh') return 'Extra high';
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : level;
}

/** A chat's or run's tool-approval policy (the server's `permissionMode`). */
export type ApprovalMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/**
 * How each approval policy is named: `label` in pickers (composer Agent mode menu, run header, workflow session
 * editor), `short` beside the mode on the composer chip (null = the default "never ask" state shows nothing extra),
 * `word` in compact summaries (workflow setup card, settings, run dialog), `hint` under the label in a picker (what
 * runs on its own and what waits for you).
 *
 * `plan` is the read-only tier (D-149): it is called "Read-only" wherever a person reads it, so it is never
 * mistaken for the Plan AGENT mode (plan first, wait for approval).
 */
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, { label: string; short: string | null; word: string; hint: string }> = {
  default: { label: 'Ask before tools run', short: 'Ask first', word: 'Ask', hint: 'Every edit and command waits for your OK.' },
  acceptEdits: {
    label: 'Accept edits, ask for the rest',
    short: 'Accept edits',
    word: 'Accept edits',
    hint: 'File edits run; commands, network and MCP tools ask.',
  },
  plan: { label: 'Read-only (no changes)', short: 'Read-only', word: 'Read-only', hint: 'Reads and searches only; nothing is changed.' },
  bypassPermissions: { label: 'Full access (never ask)', short: null, word: 'Full access', hint: 'Nothing asks. For folders you trust.' },
};

/**
 * The composer's Agent mode menu: its Approvals group's heading and note. A chat's approval policy is part of its
 * session binding, so a change applies from the next message (a turn already running keeps its policy); in Plan
 * mode nothing is written until the plan is approved, so the policy governs the implementation after that.
 */
export const COMPOSER_APPROVALS_COPY = {
  heading: 'Tool approvals',
  appliesNext: 'Applies from your next message.',
  inPlanMode: 'Plan mode changes nothing until you approve the plan; this applies to the work after.',
} as const;

/** The approval policies a person picks for a chat (plan-only is the Plan agent mode there). */
export const CHAT_APPROVAL_MODES: readonly ApprovalMode[] = ['default', 'acceptEdits', 'bypassPermissions'];
