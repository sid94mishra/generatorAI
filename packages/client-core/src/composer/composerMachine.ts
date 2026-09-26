// ────────────────────────────────────────────────────────────────
// Composer state machine (08 M-12; 03-component-inventory-domain.md §3.2).
//
// What decides whether the composer can send, which blocking bar it shows and
// what its primary control offers — as pure functions and one reducer, with
// no React, DOM or timers, so web (`useComposerSend`, `ChatInput`) and the
// mobile composer hook render the same states from the same rules.
//
// Two layers:
//
//  1. **Rules** — `canSendComposer`, `composerBlockingState`,
//     `composerPrimaryAction`, `isPrepBlocking`. Pure functions of their
//     inputs, for a host that already owns those inputs (the web composer gets
//     them as props and local state).
//  2. **Reducer** — `composerReducer` + selectors. The same rules over an
//     event-driven state, for a host that wants the whole machine in one
//     place (mobile), including the two-phase stop timing.
//
// Behaviour pinned from the shipped web composer (ChatInput characterization,
// 09 §5.1) and the decisions it follows:
//
//  - Typing is never blocked (D-29). Blocking states hold back Send only.
//  - Send eligibility: some content (text that is not just whitespace, an
//    active `/command`, an attachment, or a pending capture) AND not disabled,
//    not already sending, no open gate, and the workspace not still being
//    prepared. A FAILED preparation shows its bar but does not hold back Send:
//    the failure is reported, and the server is the judge of whether the
//    mounts that did prepare are enough.
//  - A running turn does not change eligibility: while a turn is live the
//    primary control is Stop, and a send that reaches the server anyway is
//    refused there (no queue, D-29).
//  - Bars show one at a time: prep failed > preparing > waiting on you. The
//    turn states (running / stopping / force available) apply only when no
//    bar does.
//  - Two-phase stop: the first press cancels and the control is inert for
//    400 ms; after 15 s with the turn still live it offers Force reset; the
//    backend's liveness, not the press count, resets it. The timing and labels
//    are `stopController.ts`'s pure transitions, shared with `StopController`.
// ────────────────────────────────────────────────────────────────

import type { WorkspacePrepStatus } from '@generatorai/shared';
import type {
  ComposerBlockingState,
  ComposerPrepStatus,
  ComposerPrimaryAction,
  ComposerStopView,
  ComposerView,
} from '@generatorai/shared/ui-contract';
import {
  decideStopPress,
  stopPhaseAt,
  stopViewForPhase,
  STOP_BUDGET_DEFAULT_SECONDS,
  type StopAction,
  type StopPhase,
  type TurnLiveness,
} from '../stream/stopController.js';

// The contract mirrors the server's prep status structurally (it may not
// import the shared root); this fails to compile if the two drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const PREP_STATUS_MATCHES_SERVER: Same<ComposerPrepStatus, WorkspacePrepStatus> = true;
void PREP_STATUS_MATCHES_SERVER;

// ── Rules ─────────────────────────────────────────────────────────

/** True while the workspace cannot accept a prompt (mounts still being created). */
export function isPrepBlocking(status: ComposerPrepStatus | null | undefined): boolean {
  return status === 'pending' || status === 'preparing';
}

/** The parts of a draft that count as something to send. */
export interface ComposerContent {
  text: string;
  /** An active `/command` pill. */
  hasCommand: boolean;
  attachmentCount: number;
  /** Browser / terminal captures owned by the page, merged into the message on send. */
  captureCount: number;
}

/** Whether the draft has anything to send — attachments are a message too. */
export function hasComposerContent(content: ComposerContent): boolean {
  return (
    content.text.trim().length > 0 ||
    content.hasCommand ||
    content.attachmentCount > 0 ||
    content.captureCount > 0
  );
}

export interface ComposerSendInput extends ComposerContent {
  disabled: boolean;
  /** A send is in flight (the mutation is pending). */
  sending: boolean;
  /** A gate (permission, question, plan review) is open; the server answers 409 until it closes. */
  pendingInteraction: boolean;
  prepStatus: ComposerPrepStatus | null | undefined;
}

/** The send-eligibility truth table (see the header). */
export function canSendComposer(input: ComposerSendInput): boolean {
  return (
    hasComposerContent(input) &&
    !input.disabled &&
    !input.sending &&
    !input.pendingInteraction &&
    !isPrepBlocking(input.prepStatus)
  );
}

export interface ComposerBlockingInput {
  prepStatus: ComposerPrepStatus | null | undefined;
  pendingInteraction: boolean;
  /** The two-phase stop's phase (`idle` when no turn is live). */
  stopPhase: StopPhase;
}

/** The single blocking state to show: prep failed > preparing > waiting on you > the turn. */
export function composerBlockingState(input: ComposerBlockingInput): ComposerBlockingState {
  if (input.prepStatus === 'error') return 'prep_failed';
  if (isPrepBlocking(input.prepStatus)) return 'preparing';
  if (input.pendingInteraction) return 'waiting_on_you';
  switch (input.stopPhase) {
    case 'ready':
      return 'running';
    case 'arming':
    case 'stopping':
      return 'stopping';
    case 'force':
      return 'force_available';
    case 'idle':
    default:
      return null;
  }
}

/** The primary control for a stop phase: Send when no turn is live, else Stop's current face. */
export function composerPrimaryAction(stopPhase: StopPhase): ComposerPrimaryAction {
  switch (stopPhase) {
    case 'ready':
      return 'stop';
    case 'arming':
    case 'stopping':
      return 'stopping';
    case 'force':
      return 'force_reset';
    case 'idle':
    default:
      return 'send';
  }
}

/**
 * The stop phase for a host that does not own the stop machine and only
 * receives its view (the web composer gets `stopState` from the page).
 * `live` is whether the host shows a Stop control at all.
 */
export function stopPhaseFromView(
  live: boolean,
  view: (ComposerStopView & { phase?: StopPhase }) | undefined,
): StopPhase {
  if (!live) return 'idle';
  if (view?.forceAvailable) return 'force';
  if (view?.phase && view.phase !== 'idle') return view.phase;
  return 'ready';
}

// ── Reducer ───────────────────────────────────────────────────────

export interface ComposerMachineState {
  draft: ComposerContent;
  /** The draft that was sent, parked until the send settles; a failure puts it back. */
  inFlight: ComposerContent | null;
  disabled: boolean;
  prep: { status: ComposerPrepStatus; error?: string } | null;
  /** The open gate's label ("The agent is waiting for you to …"), or null. */
  pendingInteraction: string | null;
  turn: {
    /** The BACKEND's view of the turn (stopController rule 4). */
    liveness: TurnLiveness;
    /** Clock reading of the first Stop press of the current attempt. */
    pressedAt: number | null;
    /** Latest clock reading the machine has seen. */
    now: number;
    budgetSeconds: number;
  };
  /** What the most recent `stop/pressed` asked the host to send. */
  lastStopAction: StopAction | null;
}

export type ComposerEvent =
  | { type: 'draft/changed'; draft: Partial<ComposerContent> }
  | { type: 'disabled/changed'; disabled: boolean }
  | { type: 'prep/changed'; prep: { status: ComposerPrepStatus; error?: string } | null }
  | { type: 'interaction/changed'; label: string | null }
  /** Send pressed. Ignored unless eligible — which also makes a second press while one is in flight a no-op. */
  | { type: 'send/requested' }
  | { type: 'send/succeeded' }
  /** The send was refused; the draft comes back. */
  | { type: 'send/failed' }
  | { type: 'turn/observed'; liveness: TurnLiveness; at: number }
  | { type: 'stop/pressed'; at: number }
  | { type: 'clock/ticked'; at: number };

export const EMPTY_COMPOSER_CONTENT: ComposerContent = Object.freeze({
  text: '',
  hasCommand: false,
  attachmentCount: 0,
  captureCount: 0,
});

export function createComposerState(
  overrides: { now?: number; budgetSeconds?: number; disabled?: boolean } = {},
): ComposerMachineState {
  return {
    draft: EMPTY_COMPOSER_CONTENT,
    inFlight: null,
    disabled: overrides.disabled ?? false,
    prep: null,
    pendingInteraction: null,
    turn: {
      liveness: 'settled',
      pressedAt: null,
      now: overrides.now ?? 0,
      budgetSeconds: overrides.budgetSeconds ?? STOP_BUDGET_DEFAULT_SECONDS,
    },
    lastStopAction: null,
  };
}

export function composerReducer(state: ComposerMachineState, event: ComposerEvent): ComposerMachineState {
  switch (event.type) {
    case 'draft/changed':
      return { ...state, draft: { ...state.draft, ...event.draft } };
    case 'disabled/changed':
      return state.disabled === event.disabled ? state : { ...state, disabled: event.disabled };
    case 'prep/changed':
      return { ...state, prep: event.prep };
    case 'interaction/changed':
      return state.pendingInteraction === event.label ? state : { ...state, pendingInteraction: event.label };
    case 'send/requested':
      if (!selectCanSend(state)) return state;
      return { ...state, inFlight: state.draft, draft: EMPTY_COMPOSER_CONTENT };
    case 'send/succeeded':
      return state.inFlight ? { ...state, inFlight: null } : state;
    case 'send/failed':
      return state.inFlight ? { ...state, draft: state.inFlight, inFlight: null } : state;
    case 'turn/observed': {
      const now = Math.max(state.turn.now, event.at);
      // A settled turn resets the attempt; a turn that goes live again starts
      // a fresh one rather than inheriting the last one's escalation.
      if (event.liveness === state.turn.liveness) return { ...state, turn: { ...state.turn, now } };
      return {
        ...state,
        turn: { ...state.turn, liveness: event.liveness, pressedAt: null, now },
        lastStopAction: null,
      };
    }
    case 'stop/pressed': {
      const now = Math.max(state.turn.now, event.at);
      const { action, pressedAt } = decideStopPress(
        state.turn.liveness,
        state.turn.pressedAt,
        now,
        state.turn.budgetSeconds,
      );
      return { ...state, turn: { ...state.turn, pressedAt, now }, lastStopAction: action };
    }
    case 'clock/ticked':
      return event.at <= state.turn.now ? state : { ...state, turn: { ...state.turn, now: event.at } };
    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────

export function selectStopPhase(state: ComposerMachineState): StopPhase {
  return stopPhaseAt(state.turn.liveness, state.turn.pressedAt, state.turn.now);
}

/** The Stop control while a turn is live, else null. */
export function selectStopView(state: ComposerMachineState): ComposerStopView | null {
  const phase = selectStopPhase(state);
  if (phase === 'idle') return null;
  const { label, enabled, forceAvailable } = stopViewForPhase(phase);
  return { label, enabled, forceAvailable };
}

export function selectCanSend(state: ComposerMachineState): boolean {
  return canSendComposer({
    ...state.draft,
    disabled: state.disabled,
    sending: state.inFlight !== null,
    pendingInteraction: state.pendingInteraction !== null,
    prepStatus: state.prep?.status,
  });
}

export function selectBlockingState(state: ComposerMachineState): ComposerBlockingState {
  return composerBlockingState({
    prepStatus: state.prep?.status,
    pendingInteraction: state.pendingInteraction !== null,
    stopPhase: selectStopPhase(state),
  });
}

export function selectPrimaryAction(state: ComposerMachineState): ComposerPrimaryAction {
  return composerPrimaryAction(selectStopPhase(state));
}

export function selectComposerView(state: ComposerMachineState): ComposerView {
  return {
    blocking: selectBlockingState(state),
    primaryAction: selectPrimaryAction(state),
    canSend: selectCanSend(state),
    typingAllowed: true,
    stop: selectStopView(state),
  };
}
