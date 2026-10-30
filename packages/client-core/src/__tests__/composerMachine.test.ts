// ────────────────────────────────────────────────────────────────
// Composer state machine (08 M-12; 03 §3.2; D-29).
//
// The rules are asserted exhaustively over their inputs (the send truth table
// and the blocking priority are small enough to enumerate), and the reducer's
// two-phase stop is checked at its real thresholds and against StopController
// on the same scripted timeline, so the two can never drift apart.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  COMPOSER_BAR_STATES,
  COMPOSER_BLOCKING_STATES,
  type ComposerPrepStatus,
} from '@generatorai/shared/ui-contract';

import {
  canSendComposer,
  composerBlockingState,
  composerPrimaryAction,
  composerReducer,
  createComposerState,
  EMPTY_COMPOSER_CONTENT,
  hasComposerContent,
  isPrepBlocking,
  selectBlockingState,
  selectCanSend,
  selectComposerView,
  selectPrimaryAction,
  selectStopPhase,
  selectStopView,
  stopPhaseFromView,
  type ComposerEvent,
  type ComposerMachineState,
} from '../composer/composerMachine.js';
import {
  StopController,
  STOP_ARMING_MS,
  STOP_BUDGET_DEFAULT_SECONDS,
  STOP_FORCE_RESET_MS,
  type StopPhase,
} from '../stream/stopController.js';

const PREP: Array<ComposerPrepStatus | null> = [null, 'pending', 'preparing', 'ready', 'error'];
const PHASES: StopPhase[] = ['idle', 'ready', 'arming', 'stopping', 'force'];
const T0 = 1_000_000;

function run(events: ComposerEvent[], state: ComposerMachineState = createComposerState({ now: T0 })) {
  return events.reduce(composerReducer, state);
}

const bools = [false, true] as const;

describe('send eligibility (canSendComposer) — the truth table', () => {
  const content = [
    { name: 'empty', text: '', hasCommand: false, attachmentCount: 0, captureCount: 0, has: false },
    { name: 'whitespace only', text: '  \n\t', hasCommand: false, attachmentCount: 0, captureCount: 0, has: false },
    { name: 'text', text: 'hi', hasCommand: false, attachmentCount: 0, captureCount: 0, has: true },
    { name: '/command pill only', text: '', hasCommand: true, attachmentCount: 0, captureCount: 0, has: true },
    { name: 'attachments only', text: '', hasCommand: false, attachmentCount: 2, captureCount: 0, has: true },
    { name: 'captures only', text: '', hasCommand: false, attachmentCount: 0, captureCount: 1, has: true },
  ];

  for (const c of content) {
    for (const disabled of bools) {
      for (const sending of bools) {
        for (const pendingInteraction of bools) {
          for (const prepStatus of PREP) {
            const expected = c.has && !disabled && !sending && !pendingInteraction && prepStatus !== 'pending' && prepStatus !== 'preparing';
            it(`${c.name} · disabled=${disabled} sending=${sending} gate=${pendingInteraction} prep=${prepStatus} → ${expected}`, () => {
              expect(
                canSendComposer({ ...c, disabled, sending, pendingInteraction, prepStatus }),
              ).toBe(expected);
            });
          }
        }
      }
    }
  }

  it('content alone decides hasComposerContent', () => {
    for (const c of content) expect(hasComposerContent(c)).toBe(c.has);
  });

  it('a failed preparation shows a bar but does not hold back Send', () => {
    expect(isPrepBlocking('error')).toBe(false);
    expect(
      canSendComposer({ ...EMPTY_COMPOSER_CONTENT, text: 'x', disabled: false, sending: false, pendingInteraction: false, prepStatus: 'error' }),
    ).toBe(true);
  });

  it('only pending and preparing block', () => {
    expect(PREP.filter(isPrepBlocking)).toEqual(['pending', 'preparing']);
  });
});

describe('blocking state — one at a time, prep failed > preparing > waiting > the turn', () => {
  for (const prepStatus of PREP) {
    for (const pendingInteraction of bools) {
      for (const stopPhase of PHASES) {
        const expected =
          prepStatus === 'error'
            ? 'prep_failed'
            : prepStatus === 'pending' || prepStatus === 'preparing'
              ? 'preparing'
              : pendingInteraction
                ? 'waiting_on_you'
                : ({ idle: null, ready: 'running', arming: 'stopping', stopping: 'stopping', force: 'force_available' } as const)[stopPhase];
        it(`prep=${prepStatus} gate=${pendingInteraction} stop=${stopPhase} → ${expected}`, () => {
          expect(composerBlockingState({ prepStatus, pendingInteraction, stopPhase })).toBe(expected);
        });
      }
    }
  }

  it('the contract lists every non-null state once, in the priority composerBlockingState applies', () => {
    expect(new Set(COMPOSER_BLOCKING_STATES).size).toBe(COMPOSER_BLOCKING_STATES.length);
    const produced = new Set<string>();
    for (const prepStatus of PREP)
      for (const pendingInteraction of bools)
        for (const stopPhase of PHASES) {
          const s = composerBlockingState({ prepStatus, pendingInteraction, stopPhase });
          if (s) produced.add(s);
        }
    expect([...produced].sort()).toEqual([...COMPOSER_BLOCKING_STATES].sort());
    // Bars outrank the turn states.
    expect(COMPOSER_BLOCKING_STATES.slice(0, COMPOSER_BAR_STATES.length)).toEqual([...COMPOSER_BAR_STATES]);
  });
});

describe('primary control', () => {
  it('maps each stop phase to Send / Stop / Stopping… / Force reset', () => {
    expect(PHASES.map(composerPrimaryAction)).toEqual(['send', 'stop', 'stopping', 'stopping', 'force_reset']);
  });

  it('stopPhaseFromView: a host with only the view (web) still gets the right face', () => {
    const stop = { label: 'Stop', enabled: true, forceAvailable: false };
    expect(stopPhaseFromView(false, stop)).toBe('idle');
    expect(stopPhaseFromView(true, undefined)).toBe('ready');
    expect(stopPhaseFromView(true, stop)).toBe('ready');
    expect(stopPhaseFromView(true, { ...stop, phase: 'arming' })).toBe('arming');
    // Live but the view has not caught up yet (first render): still a Stop control.
    expect(stopPhaseFromView(true, { ...stop, phase: 'idle' })).toBe('ready');
    expect(stopPhaseFromView(true, { label: 'Force reset', enabled: true, forceAvailable: true })).toBe('force');
  });
});

describe('composerReducer — drafting and sending', () => {
  it('starts idle: nothing to send, no blocking state, Send', () => {
    const s = createComposerState();
    expect(selectComposerView(s)).toEqual({ blocking: null, primaryAction: 'send', canSend: false, typingAllowed: true, stop: null });
  });

  it('typing enables Send; whitespace does not', () => {
    expect(selectCanSend(run([{ type: 'draft/changed', draft: { text: 'hello' } }]))).toBe(true);
    expect(selectCanSend(run([{ type: 'draft/changed', draft: { text: '   ' } }]))).toBe(false);
  });

  it('attachments or captures alone enable Send', () => {
    expect(selectCanSend(run([{ type: 'draft/changed', draft: { attachmentCount: 1 } }]))).toBe(true);
    expect(selectCanSend(run([{ type: 'draft/changed', draft: { captureCount: 1 } }]))).toBe(true);
  });

  it('a requested send parks the draft and clears the box; success drops it', () => {
    const typed = run([{ type: 'draft/changed', draft: { text: 'go', attachmentCount: 1 } }]);
    const sending = composerReducer(typed, { type: 'send/requested' });
    expect(sending.draft).toEqual(EMPTY_COMPOSER_CONTENT);
    expect(sending.inFlight).toEqual(typed.draft);
    const done = composerReducer(sending, { type: 'send/succeeded' });
    expect(done.inFlight).toBeNull();
    expect(done.draft).toEqual(EMPTY_COMPOSER_CONTENT);
  });

  it('a failed send restores the draft', () => {
    const typed = run([{ type: 'draft/changed', draft: { text: 'go', hasCommand: true } }]);
    const failed = run([{ type: 'send/requested' }, { type: 'send/failed' }], typed);
    expect(failed.draft).toEqual(typed.draft);
    expect(failed.inFlight).toBeNull();
  });

  it('a second Send while one is in flight is ignored', () => {
    const sending = run([{ type: 'draft/changed', draft: { text: 'one' } }, { type: 'send/requested' }]);
    const typedAgain = composerReducer(sending, { type: 'draft/changed', draft: { text: 'two' } });
    expect(selectCanSend(typedAgain)).toBe(false);
    expect(composerReducer(typedAgain, { type: 'send/requested' })).toBe(typedAgain);
  });

  it('an ineligible send request is a no-op (same state object)', () => {
    const empty = createComposerState();
    expect(composerReducer(empty, { type: 'send/requested' })).toBe(empty);
    const disabled = run([{ type: 'draft/changed', draft: { text: 'x' } }, { type: 'disabled/changed', disabled: true }]);
    expect(composerReducer(disabled, { type: 'send/requested' })).toBe(disabled);
  });

  it('send/succeeded and send/failed without a send in flight change nothing', () => {
    const s = run([{ type: 'draft/changed', draft: { text: 'x' } }]);
    expect(composerReducer(s, { type: 'send/succeeded' })).toBe(s);
    expect(composerReducer(s, { type: 'send/failed' })).toBe(s);
  });

  it('workspace preparation blocks Send but not typing; failure shows its bar', () => {
    const preparing = run([
      { type: 'draft/changed', draft: { text: 'x' } },
      { type: 'prep/changed', prep: { status: 'preparing' } },
    ]);
    expect(selectComposerView(preparing)).toMatchObject({ blocking: 'preparing', canSend: false, typingAllowed: true });
    const failed = composerReducer(preparing, { type: 'prep/changed', prep: { status: 'error', error: 'checked out elsewhere' } });
    expect(selectComposerView(failed)).toMatchObject({ blocking: 'prep_failed', canSend: true });
    const ready = composerReducer(failed, { type: 'prep/changed', prep: { status: 'ready' } });
    expect(selectBlockingState(ready)).toBeNull();
  });

  it('an open gate blocks Send and shows "waiting on you" until it clears', () => {
    const gated = run([
      { type: 'draft/changed', draft: { text: 'x' } },
      { type: 'interaction/changed', label: 'The agent is waiting for you to allow or deny a tool call.' },
    ]);
    expect(selectComposerView(gated)).toMatchObject({ blocking: 'waiting_on_you', canSend: false });
    const cleared = composerReducer(gated, { type: 'interaction/changed', label: null });
    expect(selectComposerView(cleared)).toMatchObject({ blocking: null, canSend: true });
  });

  it('no-change events return the same state', () => {
    const s = createComposerState();
    expect(composerReducer(s, { type: 'disabled/changed', disabled: false })).toBe(s);
    expect(composerReducer(s, { type: 'interaction/changed', label: null })).toBe(s);
    expect(composerReducer(s, { type: 'clock/ticked', at: -1 })).toBe(s);
  });
});

describe('composerReducer — two-phase stop (400 ms inert, Force reset after 15 s)', () => {
  const live = (at = T0): ComposerEvent => ({ type: 'turn/observed', liveness: 'live', at });

  it('a live turn turns Send into Stop and shows "running"; typing keeps Send eligibility', () => {
    const s = run([live(), { type: 'draft/changed', draft: { text: 'next' } }]);
    expect(selectComposerView(s)).toEqual({
      blocking: 'running',
      primaryAction: 'stop',
      canSend: true,
      typingAllowed: true,
      stop: { label: 'Stop', enabled: true, forceAvailable: false },
    });
  });

  it('the first press cancels; the control is inert for exactly 400 ms', () => {
    const pressed = run([live(), { type: 'stop/pressed', at: T0 }]);
    expect(pressed.lastStopAction).toEqual({ kind: 'cancel', budgetSeconds: STOP_BUDGET_DEFAULT_SECONDS });
    expect(selectStopView(pressed)).toEqual({ label: 'Stopping…', enabled: false, forceAvailable: false });
    expect(selectBlockingState(pressed)).toBe('stopping');

    const justBefore = composerReducer(pressed, { type: 'clock/ticked', at: T0 + STOP_ARMING_MS - 1 });
    expect(selectStopPhase(justBefore)).toBe('arming');
    const doubleTap = composerReducer(justBefore, { type: 'stop/pressed', at: T0 + STOP_ARMING_MS - 1 });
    expect(doubleTap.lastStopAction).toEqual({ kind: 'noop', reason: 'arming' });
    expect(doubleTap.turn.pressedAt).toBe(T0);

    const armed = composerReducer(pressed, { type: 'clock/ticked', at: T0 + STOP_ARMING_MS });
    expect(selectStopPhase(armed)).toBe('stopping');
    expect(selectStopView(armed)).toEqual({ label: 'Stopping…', enabled: true, forceAvailable: false });
    expect(selectPrimaryAction(armed)).toBe('stopping');
  });

  it('a press after arming but before 15 s re-sends the graceful cancel', () => {
    const s = run([live(), { type: 'stop/pressed', at: T0 }, { type: 'stop/pressed', at: T0 + 5_000 }]);
    expect(s.lastStopAction).toEqual({ kind: 'cancel', budgetSeconds: STOP_BUDGET_DEFAULT_SECONDS });
    expect(s.turn.pressedAt).toBe(T0);
  });

  it('at exactly 15 s the control offers Force reset and a press sends force', () => {
    const pressed = run([live(), { type: 'stop/pressed', at: T0 }]);
    const before = composerReducer(pressed, { type: 'clock/ticked', at: T0 + STOP_FORCE_RESET_MS - 1 });
    expect(selectStopPhase(before)).toBe('stopping');
    const at15 = composerReducer(pressed, { type: 'clock/ticked', at: T0 + STOP_FORCE_RESET_MS });
    expect(selectComposerView(at15)).toMatchObject({
      blocking: 'force_available',
      primaryAction: 'force_reset',
      stop: { label: 'Force reset', enabled: true, forceAvailable: true },
    });
    const forced = composerReducer(at15, { type: 'stop/pressed', at: T0 + STOP_FORCE_RESET_MS });
    expect(forced.lastStopAction).toEqual({ kind: 'force', budgetSeconds: STOP_BUDGET_DEFAULT_SECONDS });
  });

  it('the backend settling the turn stands the control down, whatever was pressed', () => {
    const s = run([
      live(),
      { type: 'stop/pressed', at: T0 },
      { type: 'clock/ticked', at: T0 + STOP_FORCE_RESET_MS },
      { type: 'turn/observed', liveness: 'settled', at: T0 + STOP_FORCE_RESET_MS + 1 },
    ]);
    expect(selectComposerView(s)).toMatchObject({ blocking: null, primaryAction: 'send', stop: null });
    expect(s.turn.pressedAt).toBeNull();
    expect(s.lastStopAction).toBeNull();
  });

  it('a new live turn starts a fresh attempt', () => {
    const s = run([
      live(),
      { type: 'stop/pressed', at: T0 },
      { type: 'turn/observed', liveness: 'settled', at: T0 + 100 },
      live(T0 + 200),
      { type: 'clock/ticked', at: T0 + STOP_FORCE_RESET_MS + 500 },
    ]);
    expect(selectStopPhase(s)).toBe('ready');
    const pressed = composerReducer(s, { type: 'stop/pressed', at: s.turn.now });
    expect(pressed.lastStopAction?.kind).toBe('cancel');
  });

  it('a press with no live turn does nothing', () => {
    const s = run([{ type: 'stop/pressed', at: T0 }]);
    expect(s.lastStopAction).toEqual({ kind: 'noop', reason: 'no-turn' });
    expect(selectStopView(s)).toBeNull();
  });

  it('the clock never runs backwards', () => {
    const s = run([live(), { type: 'stop/pressed', at: T0 + 1_000 }, { type: 'clock/ticked', at: T0 }]);
    expect(s.turn.now).toBe(T0 + 1_000);
  });

  it('a caller budget reaches the cancel action', () => {
    const s = run([live(), { type: 'stop/pressed', at: T0 }], createComposerState({ now: T0, budgetSeconds: 3 }));
    expect(s.lastStopAction).toEqual({ kind: 'cancel', budgetSeconds: 3 });
  });

  it('bars outrank the turn: a gate opened mid-turn shows "waiting on you"', () => {
    const s = run([live(), { type: 'interaction/changed', label: 'Waiting' }]);
    expect(selectBlockingState(s)).toBe('waiting_on_you');
    expect(selectPrimaryAction(s)).toBe('stop');
  });
});

describe('parity with StopController on one scripted timeline', () => {
  it('phase, label, enabled and every press action agree', () => {
    let now = T0;
    const controller = new StopController({ now: () => now });
    let state = createComposerState({ now: T0 });

    type Step = { at: number } & ({ observe: 'live' | 'settled' } | { press: true } | { tick: true });
    const script: Step[] = [
      { at: 0, observe: 'live' },
      { at: 50, press: true },
      { at: 200, press: true },
      { at: 399, tick: true },
      { at: 400, tick: true },
      { at: 900, press: true },
      { at: 14_999, tick: true },
      { at: 15_000, tick: true },
      { at: 15_001, press: true },
      { at: 16_000, observe: 'settled' },
      { at: 16_100, press: true },
      { at: 17_000, observe: 'live' },
      { at: 17_100, press: true },
      { at: 40_000, tick: true },
      { at: 40_001, press: true },
    ];

    for (const step of script) {
      now = T0 + step.at;
      let expectedAction: unknown = undefined;
      if ('observe' in step) {
        controller.observe(step.observe);
        state = composerReducer(state, { type: 'turn/observed', liveness: step.observe, at: now });
      } else if ('press' in step) {
        expectedAction = controller.press();
        state = composerReducer(state, { type: 'stop/pressed', at: now });
      } else {
        state = composerReducer(state, { type: 'clock/ticked', at: now });
      }
      const view = controller.view();
      expect(selectStopPhase(state), `phase at +${step.at}`).toBe(view.phase);
      const stop = selectStopView(state);
      if (view.phase === 'idle') expect(stop).toBeNull();
      else expect(stop).toEqual({ label: view.label, enabled: view.enabled, forceAvailable: view.forceAvailable });
      if (expectedAction !== undefined) expect(state.lastStopAction, `press at +${step.at}`).toEqual(expectedAction);
    }
  });
});
