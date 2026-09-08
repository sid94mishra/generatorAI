import { beforeEach, describe, expect, it } from 'vitest';

import {
  connectionFromDisconnect,
  describeNotice,
  requiredScopeFromReason,
  useStreamHealth,
} from '../stream/streamHealth';

describe('requiredScopeFromReason', () => {
  it('extracts the scope the server asked for, colon and all', () => {
    // Scopes contain a colon themselves, so a naive split on ':' would hand
    // back `read` and lose the half that matters.
    expect(requiredScopeFromReason('rejected:insufficient_scope:read:activity')).toBe(
      'read:activity',
    );
  });

  it('is null for every other disconnect reason', () => {
    for (const reason of [undefined, '', 'network', 'gap:not_resumed', 'rejected:forbidden', 'disposed']) {
      expect(requiredScopeFromReason(reason), String(reason)).toBeNull();
    }
  });

  it('is null when the prefix carries no scope', () => {
    expect(requiredScopeFromReason('rejected:insufficient_scope:')).toBeNull();
  });
});

describe('connectionFromDisconnect', () => {
  it('treats a scope-level gap or rejection as saying nothing about the socket', () => {
    // Raising the offline strip on a working connection is the failure
    // mode this mapping exists to prevent.
    expect(connectionFromDisconnect('gap:not_resumed')).toBeNull();
    expect(connectionFromDisconnect('rejected:insufficient_scope:read:activity')).toBeNull();
  });

  it('returns to idle on a deliberate teardown', () => {
    expect(connectionFromDisconnect('disposed')).toBe('idle');
  });

  it('is offline for a real loss', () => {
    for (const reason of [undefined, 'network', 'http:503', 'giving up after 20 attempts', 'slow_consumer_dropped']) {
      expect(connectionFromDisconnect(reason), String(reason)).toBe('offline');
    }
  });
});

describe('describeNotice', () => {
  const rejected = [{ scope: 'global', id: 'all', requiredScope: 'read:activity' }];

  it('shows nothing when connected with no rejections', () => {
    expect(describeNotice('connected', 0, [])).toBeNull();
    expect(describeNotice('idle', 0, [])).toBeNull();
  });

  it('puts the connection ahead of a rejected scope', () => {
    // "Ask an admin" is the wrong advice for someone out of Wi-Fi range.
    expect(describeNotice('offline', 0, rejected)?.kind).toBe('offline');
    expect(describeNotice('reconnecting', 3, rejected)?.kind).toBe('reconnecting');
  });

  it('names the attempt while reconnecting', () => {
    expect(describeNotice('reconnecting', 4, [])?.message).toContain('attempt 4');
    expect(describeNotice('reconnecting', 0, [])?.message).not.toContain('attempt');
  });

  it('names the missing permission and offers a retry', () => {
    const notice = describeNotice('connected', 0, rejected);
    expect(notice?.kind).toBe('rejected');
    expect(notice?.retry).toBe(true);
    expect(notice?.message).toContain('Activity feed');
    expect(notice?.message).toContain('read:activity');
    expect(notice?.message).toContain('ask an admin');
  });

  it('never offers a retry for an outage', () => {
    expect(describeNotice('offline', 0, [])?.retry).toBe(false);
  });
});

describe('useStreamHealth store', () => {
  beforeEach(() => {
    useStreamHealth.setState({ connection: 'idle', attempt: 0, rejectedScopes: [], retryGeneration: 0 });
  });

  it('records connection transitions with the attempt', () => {
    useStreamHealth.getState().setConnection('reconnecting', 2);
    expect(useStreamHealth.getState()).toMatchObject({ connection: 'reconnecting', attempt: 2 });
    useStreamHealth.getState().setConnection('connected');
    expect(useStreamHealth.getState()).toMatchObject({ connection: 'connected', attempt: 0 });
  });

  it('does not duplicate a rejection for the same scope and id', () => {
    const entry = { scope: 'global', id: 'all', requiredScope: 'read:activity' };
    useStreamHealth.getState().noteRejected(entry);
    useStreamHealth.getState().noteRejected({ ...entry });
    expect(useStreamHealth.getState().rejectedScopes).toHaveLength(1);
  });

  it('clearing a rejection bumps the retry generation so the scope is asked for again', () => {
    useStreamHealth.getState().noteRejected({ scope: 'global', id: 'all', requiredScope: 'read:activity' });
    useStreamHealth.getState().clearRejected();
    expect(useStreamHealth.getState().rejectedScopes).toEqual([]);
    expect(useStreamHealth.getState().retryGeneration).toBe(1);
  });
});
