// ────────────────────────────────────────────────────────────────
// BrowserSessionStateMachine tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { BrowserSessionStateMachine } from '../src/domain/state-machines/BrowserSessionStateMachine.js';
import { InvalidTransitionError } from '@generatorai/shared';

describe('BrowserSessionStateMachine', () => {
  it('starts in off by default', () => {
    const fsm = new BrowserSessionStateMachine();
    expect(fsm.status).toBe('off');
  });

  it('drives the happy-path lifecycle', () => {
    const fsm = new BrowserSessionStateMachine();
    fsm.transition('sys:start');
    expect(fsm.status).toBe('starting');
    fsm.transition('sys:ready');
    expect(fsm.status).toBe('active');
    fsm.transition('sys:idle');
    expect(fsm.status).toBe('idle');
    fsm.transition('sys:active');
    expect(fsm.status).toBe('active');
    fsm.transition('sys:stop');
    expect(fsm.status).toBe('terminated');
    expect(fsm.isTerminal).toBe(true);
  });

  it('supports crash → retry → recover', () => {
    const fsm = new BrowserSessionStateMachine('active');
    fsm.transition('sys:crash');
    expect(fsm.status).toBe('error');
    fsm.transition('sys:retry');
    expect(fsm.status).toBe('starting');
    fsm.transition('sys:ready');
    expect(fsm.status).toBe('active');
  });

  it('throws on invalid transitions', () => {
    const fsm = new BrowserSessionStateMachine();
    expect(() => fsm.transition('sys:ready')).toThrow(InvalidTransitionError);
  });

  it('terminated is absorbing', () => {
    const fsm = new BrowserSessionStateMachine('terminated');
    expect(fsm.canTransition('sys:start')).toBe(false);
    expect(fsm.canTransition('sys:retry')).toBe(false);
    expect(fsm.isTerminal).toBe(true);
  });
});
