// ────────────────────────────────────────────────────────────────
// BrowserSessionStateMachine — 6 states, tracks the per-workspace
// integrated-browser lifecycle. Purely in-memory; the workspace row's
// `browser_status` column is written by BrowserService on every transition.
//
//   off ─start→ starting ─ready→ active ⇄ idle ─stop→ terminated
//                                    ↘─crash→ error ─retry→ starting
// ────────────────────────────────────────────────────────────────

import type { BrowserSessionStatus } from '@generatorai/shared';
import { InvalidTransitionError } from '@generatorai/shared';

export type BrowserSessionTransition =
  | 'sys:start'
  | 'sys:ready'
  | 'sys:idle'
  | 'sys:active'
  | 'sys:stop'
  | 'sys:crash'
  | 'sys:retry';

const TRANSITIONS: Record<
  BrowserSessionStatus,
  Partial<Record<BrowserSessionTransition, BrowserSessionStatus>>
> = {
  off: {
    'sys:start': 'starting',
  },
  starting: {
    'sys:ready': 'active',
    'sys:crash': 'error',
    'sys:stop': 'terminated',
  },
  active: {
    'sys:idle': 'idle',
    'sys:stop': 'terminated',
    'sys:crash': 'error',
  },
  idle: {
    'sys:active': 'active',
    'sys:stop': 'terminated',
    'sys:crash': 'error',
  },
  terminated: {
    // Terminal.
  },
  error: {
    'sys:retry': 'starting',
    'sys:stop': 'terminated',
  },
};

export class BrowserSessionStateMachine {
  private currentStatus: BrowserSessionStatus;

  constructor(initial: BrowserSessionStatus = 'off') {
    this.currentStatus = initial;
  }

  get status(): BrowserSessionStatus {
    return this.currentStatus;
  }

  canTransition(event: BrowserSessionTransition): boolean {
    return !!TRANSITIONS[this.currentStatus]?.[event];
  }

  transition(event: BrowserSessionTransition): BrowserSessionStatus {
    const next = TRANSITIONS[this.currentStatus]?.[event];
    if (!next) {
      throw new InvalidTransitionError(
        `Cannot apply '${event}' to browser session in '${this.currentStatus}' state`,
      );
    }
    this.currentStatus = next;
    return next;
  }

  get isTerminal(): boolean {
    return this.currentStatus === 'terminated';
  }
}
