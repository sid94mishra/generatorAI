// ────────────────────────────────────────────────────────────────
// StageRunStateMachine Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { StageRunStateMachine } from '../src/domain/state-machines/StageRunStateMachine.js';
import { InvalidTransitionError } from '@generatorai/shared';

describe('StageRunStateMachine', () => {
  // ── Valid transitions ──

  it('pending → queued via sys:enqueue', () => {
    const sm = new StageRunStateMachine('pending');
    expect(sm.transition('sys:enqueue')).toBe('queued');
  });

  it('pending → skipped via sys:skip', () => {
    const sm = new StageRunStateMachine('pending');
    expect(sm.transition('sys:skip')).toBe('skipped');
  });

  it('pending → cancelled via sys:parent_cancel', () => {
    const sm = new StageRunStateMachine('pending');
    expect(sm.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('queued → running via sys:session_ready', () => {
    const sm = new StageRunStateMachine('queued');
    expect(sm.transition('sys:session_ready')).toBe('running');
  });

  it('queued → cancelled via sys:parent_cancel', () => {
    const sm = new StageRunStateMachine('queued');
    expect(sm.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('queued → failed via sys:error', () => {
    const sm = new StageRunStateMachine('queued');
    expect(sm.transition('sys:error')).toBe('failed');
  });

  it('running → paused via user:pause', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('user:pause')).toBe('paused');
  });

  it('running → paused via sys:parent_pause', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:parent_pause')).toBe('paused');
  });

  it('running → completed via sys:done', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:done')).toBe('completed');
  });

  it('running → failed via sys:error', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:error')).toBe('failed');
  });

  it('running → cancelled via user:cancel', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('user:cancel')).toBe('cancelled');
  });

  it('running → cancelled via sys:parent_cancel', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('paused → running via user:resume', () => {
    const sm = new StageRunStateMachine('paused');
    expect(sm.transition('user:resume')).toBe('running');
  });

  it('paused → running via sys:parent_resume', () => {
    const sm = new StageRunStateMachine('paused');
    expect(sm.transition('sys:parent_resume')).toBe('running');
  });

  it('paused → cancelled via user:cancel', () => {
    const sm = new StageRunStateMachine('paused');
    expect(sm.transition('user:cancel')).toBe('cancelled');
  });

  it('paused → cancelled via sys:parent_cancel', () => {
    const sm = new StageRunStateMachine('paused');
    expect(sm.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('failed → queued via sys:retry', () => {
    const sm = new StageRunStateMachine('failed');
    expect(sm.transition('sys:retry')).toBe('queued');
  });

  // ── Invalid transitions ──

  it('throws on invalid transition from completed', () => {
    const sm = new StageRunStateMachine('completed');
    expect(() => sm.transition('sys:enqueue')).toThrow(InvalidTransitionError);
  });

  it('throws on invalid transition from skipped', () => {
    const sm = new StageRunStateMachine('skipped');
    expect(() => sm.transition('sys:enqueue')).toThrow(InvalidTransitionError);
  });

  it('throws on invalid transition from cancelled', () => {
    const sm = new StageRunStateMachine('cancelled');
    expect(() => sm.transition('user:resume')).toThrow(InvalidTransitionError);
  });

  it('throws on pending → running (must go through queued)', () => {
    const sm = new StageRunStateMachine('pending');
    expect(() => sm.transition('sys:session_ready')).toThrow(InvalidTransitionError);
  });

  // ── Properties ──

  it('isTerminal for completed, failed, cancelled, skipped', () => {
    expect(new StageRunStateMachine('completed').isTerminal).toBe(true);
    expect(new StageRunStateMachine('failed').isTerminal).toBe(true);
    expect(new StageRunStateMachine('cancelled').isTerminal).toBe(true);
    expect(new StageRunStateMachine('skipped').isTerminal).toBe(true);
  });

  it('isTerminal false for non-terminal states', () => {
    expect(new StageRunStateMachine('pending').isTerminal).toBe(false);
    expect(new StageRunStateMachine('queued').isTerminal).toBe(false);
    expect(new StageRunStateMachine('running').isTerminal).toBe(false);
    expect(new StageRunStateMachine('paused').isTerminal).toBe(false);
  });

  it('isActive only for running', () => {
    expect(new StageRunStateMachine('running').isActive).toBe(true);
    expect(new StageRunStateMachine('queued').isActive).toBe(false);
    expect(new StageRunStateMachine('paused').isActive).toBe(false);
  });

  it('validTransitions from running', () => {
    const sm = new StageRunStateMachine('running');
    // DUR-05 added `sys:sleep` (→ sleeping); HITL-01 added
    // `sys:input_request` (→ awaiting_input). Count climbed 6 → 7 → 8.
    expect(sm.validTransitions).toEqual(
      expect.arrayContaining([
        'user:pause', 'sys:parent_pause', 'user:cancel', 'sys:parent_cancel',
        'sys:done', 'sys:error', 'sys:sleep', 'sys:input_request',
      ]),
    );
    expect(sm.validTransitions.length).toBe(8);
  });

  // ── Full lifecycle ──

  it('supports full lifecycle: pending → queued → running → completed', () => {
    const sm = new StageRunStateMachine('pending');
    sm.transition('sys:enqueue');
    sm.transition('sys:session_ready');
    sm.transition('sys:done');
    expect(sm.status).toBe('completed');
  });

  it('supports retry: running → failed → queued → running → completed', () => {
    const sm = new StageRunStateMachine('running');
    sm.transition('sys:error');
    sm.transition('sys:retry');
    sm.transition('sys:session_ready');
    sm.transition('sys:done');
    expect(sm.status).toBe('completed');
  });

  it('supports skip: pending → skipped', () => {
    const sm = new StageRunStateMachine('pending');
    sm.transition('sys:skip');
    expect(sm.status).toBe('skipped');
    expect(sm.isTerminal).toBe(true);
  });

  it('supports cascade cancel: running → cancelled via parent', () => {
    const sm = new StageRunStateMachine('running');
    sm.transition('sys:parent_cancel');
    expect(sm.status).toBe('cancelled');
  });

  it('supports cascade pause/resume via parent', () => {
    const sm = new StageRunStateMachine('running');
    sm.transition('sys:parent_pause');
    expect(sm.status).toBe('paused');
    sm.transition('sys:parent_resume');
    expect(sm.status).toBe('running');
  });
});
