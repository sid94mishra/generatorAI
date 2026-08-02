import { describe, it, expect } from 'vitest';
import { SessionStateMachine } from '../src/domain/state-machines/SessionStateMachine.js';

describe('SessionStateMachine', () => {
  it('starts with the given initial status', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.status).toBe('created');
  });

  it('transitions from created to active on sys:activate', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.transition('sys:activate')).toBe('active');
    expect(sm.status).toBe('active');
  });

  it('transitions from created to error on sys:error', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('transitions from active to paused on user:pause', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('user:pause')).toBe('paused');
  });

  it('transitions from active to closing on user:close', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('user:close')).toBe('closing');
  });

  it('transitions from active to error on sys:error', () => {
    const sm = new SessionStateMachine('active');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('transitions from paused to active on user:resume', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('user:resume')).toBe('active');
  });

  it('transitions from paused to closing on user:close', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('user:close')).toBe('closing');
  });

  it('transitions from paused to active on sys:recover', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('sys:recover')).toBe('active');
  });

  it('transitions from paused to error on sys:error', () => {
    const sm = new SessionStateMachine('paused');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('transitions from closing to closed on sys:cleanup_done', () => {
    const sm = new SessionStateMachine('closing');
    expect(sm.transition('sys:cleanup_done')).toBe('closed');
  });

  it('transitions from closing to error on sys:error', () => {
    const sm = new SessionStateMachine('closing');
    expect(sm.transition('sys:error')).toBe('error');
  });

  it('transitions from error to active on sys:recover', () => {
    const sm = new SessionStateMachine('error');
    expect(sm.transition('sys:recover')).toBe('active');
  });

  it('transitions from error to closing on user:close', () => {
    const sm = new SessionStateMachine('error');
    expect(sm.transition('user:close')).toBe('closing');
  });

  it('throws InvalidTransitionError on invalid transition', () => {
    const sm = new SessionStateMachine('created');
    expect(() => sm.transition('user:pause')).toThrow(
      "Cannot apply 'user:pause' to session in 'created' state",
    );
  });

  it('canTransition returns true for valid transitions', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.canTransition('sys:activate')).toBe(true);
    expect(sm.canTransition('sys:error')).toBe(true);
  });

  it('canTransition returns false for invalid transitions', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.canTransition('user:pause')).toBe(false);
    expect(sm.canTransition('user:close')).toBe(false);
  });

  it('isChatEnabled only when closed', () => {
    expect(new SessionStateMachine('closed').isChatEnabled).toBe(true);
    expect(new SessionStateMachine('active').isChatEnabled).toBe(false);
    expect(new SessionStateMachine('created').isChatEnabled).toBe(false);
    expect(new SessionStateMachine('paused').isChatEnabled).toBe(false);
    expect(new SessionStateMachine('error').isChatEnabled).toBe(false);
  });

  it('canChatWhilePaused only when paused', () => {
    expect(new SessionStateMachine('paused').canChatWhilePaused).toBe(true);
    expect(new SessionStateMachine('active').canChatWhilePaused).toBe(false);
  });

  it('handles full happy-path lifecycle', () => {
    const sm = new SessionStateMachine('created');
    sm.transition('sys:activate');
    expect(sm.status).toBe('active');
    sm.transition('user:pause');
    expect(sm.status).toBe('paused');
    sm.transition('user:resume');
    expect(sm.status).toBe('active');
    sm.transition('user:close');
    expect(sm.status).toBe('closing');
    sm.transition('sys:cleanup_done');
    expect(sm.status).toBe('closed');
  });

  it('handles error recovery lifecycle', () => {
    const sm = new SessionStateMachine('created');
    sm.transition('sys:activate');
    sm.transition('sys:error');
    expect(sm.status).toBe('error');
    sm.transition('sys:recover');
    expect(sm.status).toBe('active');
    sm.transition('user:close');
    expect(sm.status).toBe('closing');
    sm.transition('sys:cleanup_done');
    expect(sm.status).toBe('closed');
  });

  it('closed state has no valid transitions', () => {
    const sm = new SessionStateMachine('closed');
    expect(sm.validTransitions).toEqual([]);
  });

  it('validTransitions returns correct events for each state', () => {
    expect(new SessionStateMachine('created').validTransitions).toContain('sys:activate');
    expect(new SessionStateMachine('active').validTransitions).toContain('user:pause');
    expect(new SessionStateMachine('active').validTransitions).toContain('user:close');
    expect(new SessionStateMachine('paused').validTransitions).toContain('user:resume');
    expect(new SessionStateMachine('error').validTransitions).toContain('sys:recover');
    expect(new SessionStateMachine('error').validTransitions).toContain('user:close');
  });
});
