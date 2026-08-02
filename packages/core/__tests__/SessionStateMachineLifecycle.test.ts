// ────────────────────────────────────────────────────────────────
// SessionStateMachine Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { SessionStateMachine } from '../src/domain/state-machines/index.js';
import { InvalidTransitionError } from '@generatorai/shared';

describe('SessionStateMachine', () => {
  // ── Valid transitions ──

  it('created → active via sys:activate', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.transition('sys:activate')).toBe('active');
    expect(sm.status).toBe('active');
  });

  it('created → error via sys:error', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('active → paused via user:pause', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('user:pause')).toBe('paused');
  });

  it('active → closing via user:close', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('user:close')).toBe('closing');
  });

  it('active → error via sys:error', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('paused → active via user:resume', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('user:resume')).toBe('active');
  });

  it('paused → closing via user:close', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('user:close')).toBe('closing');
  });

  it('closing → closed via sys:cleanup_done', () => {
    const sm = new SessionStateMachine('closing');
    expect(sm.transition('sys:cleanup_done')).toBe('closed');
  });

  it('error → active via sys:recover', () => {
    const sm = new SessionStateMachine('error');
    expect(sm.transition('sys:recover')).toBe('active');
  });

  it('error → closing via user:close', () => {
    const sm = new SessionStateMachine('error');
    expect(sm.transition('user:close')).toBe('closing');
  });

  // ── Invalid transitions ──

  it('throws on invalid transition from closed', () => {
    const sm = new SessionStateMachine('closed');
    expect(() => sm.transition('sys:activate')).toThrow(InvalidTransitionError);
  });

  it('throws on invalid transition created → paused', () => {
    const sm = new SessionStateMachine('created');
    expect(() => sm.transition('user:pause')).toThrow(InvalidTransitionError);
  });

  // ── canTransition ──

  it('canTransition returns true for valid transitions', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.canTransition('sys:activate')).toBe(true);
  });

  it('canTransition returns false for invalid transitions', () => {
    const sm = new SessionStateMachine('closed');
    expect(sm.canTransition('sys:activate')).toBe(false);
  });

  // ── Properties ──

  it('isTerminal is true for closed', () => {
    const sm = new SessionStateMachine('closed');
    expect(sm.isTerminal).toBe(true);
  });

  it('isTerminal is false for active', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.isTerminal).toBe(false);
  });

  it('canAcceptPrompts is true for active', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.canAcceptPrompts).toBe(true);
  });

  it('canAcceptPrompts is false for paused', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.canAcceptPrompts).toBe(false);
  });

  it('validTransitions lists all valid events', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.validTransitions).toEqual(
      expect.arrayContaining(['user:pause', 'user:close', 'sys:error']),
    );
    expect(sm.validTransitions.length).toBe(3);
  });

  // ── Full lifecycle ──

  it('supports full lifecycle: created → active → paused → active → closing → closed', () => {
    const sm = new SessionStateMachine('created');
    sm.transition('sys:activate');
    sm.transition('user:pause');
    sm.transition('user:resume');
    sm.transition('user:close');
    sm.transition('sys:cleanup_done');
    expect(sm.status).toBe('closed');
    expect(sm.isTerminal).toBe(true);
  });

  it('supports error recovery: created → error → active → closing → closed', () => {
    const sm = new SessionStateMachine('created');
    sm.transition('sys:error');
    sm.transition('sys:recover');
    sm.transition('user:close');
    sm.transition('sys:cleanup_done');
    expect(sm.status).toBe('closed');
  });
});
