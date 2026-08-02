// ────────────────────────────────────────────────────────────────
// WorkflowRunStateMachine Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { WorkflowRunStateMachine } from '../src/domain/state-machines/WorkflowRunStateMachine.js';
import { InvalidTransitionError } from '@generatorai/shared';

describe('WorkflowRunStateMachine', () => {
  // ── Valid transitions ──

  it('created → starting via sys:start', () => {
    const sm = new WorkflowRunStateMachine('created');
    expect(sm.transition('sys:start')).toBe('starting');
  });

  it('starting → running via sys:dag_ready', () => {
    const sm = new WorkflowRunStateMachine('starting');
    expect(sm.transition('sys:dag_ready')).toBe('running');
  });

  it('starting → failed via sys:error', () => {
    const sm = new WorkflowRunStateMachine('starting');
    expect(sm.transition('sys:error')).toBe('failed');
  });

  it('starting → cancelling via user:cancel', () => {
    const sm = new WorkflowRunStateMachine('starting');
    expect(sm.transition('user:cancel')).toBe('cancelling');
  });

  it('running → paused via user:pause', () => {
    const sm = new WorkflowRunStateMachine('running');
    expect(sm.transition('user:pause')).toBe('paused');
  });

  it('running → cancelling via user:cancel', () => {
    const sm = new WorkflowRunStateMachine('running');
    expect(sm.transition('user:cancel')).toBe('cancelling');
  });

  it('running → completed via sys:all_stages_done', () => {
    const sm = new WorkflowRunStateMachine('running');
    expect(sm.transition('sys:all_stages_done')).toBe('completed');
  });

  it('running → failed via sys:stage_failed', () => {
    const sm = new WorkflowRunStateMachine('running');
    expect(sm.transition('sys:stage_failed')).toBe('failed');
  });

  it('paused → running via user:resume', () => {
    const sm = new WorkflowRunStateMachine('paused');
    expect(sm.transition('user:resume')).toBe('running');
  });

  it('paused → cancelling via user:cancel', () => {
    const sm = new WorkflowRunStateMachine('paused');
    expect(sm.transition('user:cancel')).toBe('cancelling');
  });

  it('cancelling → cancelled via sys:all_stopped', () => {
    const sm = new WorkflowRunStateMachine('cancelling');
    expect(sm.transition('sys:all_stopped')).toBe('cancelled');
  });

  it('failed → created via sys:recover', () => {
    const sm = new WorkflowRunStateMachine('failed');
    expect(sm.transition('sys:recover')).toBe('created');
  });

  // ── Invalid transitions ──

  it('throws on invalid transition from completed', () => {
    const sm = new WorkflowRunStateMachine('completed');
    expect(() => sm.transition('sys:start')).toThrow(InvalidTransitionError);
  });

  it('throws on invalid transition from cancelled', () => {
    const sm = new WorkflowRunStateMachine('cancelled');
    expect(() => sm.transition('user:resume')).toThrow(InvalidTransitionError);
  });

  it('throws on created → running (must go through starting)', () => {
    const sm = new WorkflowRunStateMachine('created');
    expect(() => sm.transition('sys:dag_ready')).toThrow(InvalidTransitionError);
  });

  // ── Properties ──

  it('isTerminal for completed, failed, cancelled', () => {
    expect(new WorkflowRunStateMachine('completed').isTerminal).toBe(true);
    expect(new WorkflowRunStateMachine('failed').isTerminal).toBe(true);
    expect(new WorkflowRunStateMachine('cancelled').isTerminal).toBe(true);
  });

  it('isTerminal false for non-terminal states', () => {
    expect(new WorkflowRunStateMachine('created').isTerminal).toBe(false);
    expect(new WorkflowRunStateMachine('running').isTerminal).toBe(false);
    expect(new WorkflowRunStateMachine('paused').isTerminal).toBe(false);
  });

  it('isActive for running and starting', () => {
    expect(new WorkflowRunStateMachine('running').isActive).toBe(true);
    expect(new WorkflowRunStateMachine('starting').isActive).toBe(true);
    expect(new WorkflowRunStateMachine('paused').isActive).toBe(false);
  });

  it('validTransitions returns correct events', () => {
    const sm = new WorkflowRunStateMachine('running');
    expect(sm.validTransitions).toEqual(
      expect.arrayContaining(['user:pause', 'user:cancel', 'sys:all_stages_done', 'sys:stage_failed', 'sys:error']),
    );
  });

  // ── Full lifecycle ──

  it('supports full lifecycle: created → starting → running → completed', () => {
    const sm = new WorkflowRunStateMachine('created');
    sm.transition('sys:start');
    sm.transition('sys:dag_ready');
    sm.transition('sys:all_stages_done');
    expect(sm.status).toBe('completed');
    expect(sm.isTerminal).toBe(true);
  });

  it('supports cancel flow: running → cancelling → cancelled', () => {
    const sm = new WorkflowRunStateMachine('running');
    sm.transition('user:cancel');
    sm.transition('sys:all_stopped');
    expect(sm.status).toBe('cancelled');
  });

  it('supports pause/resume flow', () => {
    const sm = new WorkflowRunStateMachine('running');
    sm.transition('user:pause');
    expect(sm.status).toBe('paused');
    sm.transition('user:resume');
    expect(sm.status).toBe('running');
  });
});
