import { describe, expect, it } from 'vitest';

import {
  LAST_ROUTE_TTL_MS,
  isLastRouteFresh,
  isRestorableRoute,
  isSheetRoute,
  resolveLastRoute,
} from '../services/prefs/lastRouteRules';
import { STEP_UP_WINDOW_MS, isStepUpFresh } from '../services/auth/stepUpRules';

const NOW = 1_700_000_000_000;

describe('last route — expiry', () => {
  it('restores a route saved less than 30 minutes ago', () => {
    expect(resolveLastRoute({ route: '/chats/abc', savedAt: NOW - 5 * 60_000 }, NOW)).toBe(
      '/chats/abc',
    );
    expect(LAST_ROUTE_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('does not restore a route saved 30 minutes or more ago', () => {
    expect(resolveLastRoute({ route: '/chats/abc', savedAt: NOW - LAST_ROUTE_TTL_MS }, NOW)).toBeNull();
    expect(resolveLastRoute({ route: '/chats/abc', savedAt: NOW - LAST_ROUTE_TTL_MS + 1 }, NOW)).toBe(
      '/chats/abc',
    );
  });

  it('treats a missing, zero or future timestamp as stale', () => {
    expect(isLastRouteFresh(undefined, NOW)).toBe(false);
    expect(isLastRouteFresh(0, NOW)).toBe(false);
    expect(isLastRouteFresh(Number.NaN, NOW)).toBe(false);
    expect(isLastRouteFresh(NOW + 1000, NOW)).toBe(false);
  });

  it('never restores the entry, pairing, revoked or settings routes', () => {
    for (const route of ['/', '', '/pair', '/paired', '/revoked', '/settings', '/settings/security']) {
      expect(isRestorableRoute(route), route).toBe(false);
      expect(resolveLastRoute({ route, savedAt: NOW - 1000 }, NOW), route).toBeNull();
    }
    expect(isRestorableRoute(undefined)).toBe(false);
    expect(isRestorableRoute('chats/abc')).toBe(false);
  });

  it('never restores a route-addressable sheet', () => {
    for (const route of [
      '/scope-request',
      '/servers',
      '/search',
      '/chats/new',
      '/scope-request?scope=exec%3Aterminal',
      '/chats/abc/gate/int-1',
      '/chats/abc/plan/plan-1',
      // Every presented route of the stack: a Turn sheet left open used to come back on every cold start.
      '/chats/abc/turn',
      '/pickers/model',
      '/workflows/w1/run',
      '/workflows/w1/runs/r1/approval/s1',
      '/workflows/new',
      '/workflows/w1/edit/stages/plan',
      '/agents/a1/edit',
      '/workspaces/ws1/commit',
      '/settings/mcp/add',
    ]) {
      expect(isSheetRoute(route), route).toBe(true);
      expect(isRestorableRoute(route), route).toBe(false);
      expect(resolveLastRoute({ route, savedAt: NOW - 1000 }, NOW), route).toBeNull();
    }
    // The chat itself, and a chat literally named "gate", still restore.
    expect(isSheetRoute('/chats/abc')).toBe(false);
    expect(isSheetRoute('/chats/gate')).toBe(false);
    expect(isRestorableRoute('/chats/gate')).toBe(true);
  });

  it('restores detail routes', () => {
    for (const route of ['/chats/abc', '/workflows/w1/runs/r1', '/chats', '/needs-you', '/terminal/ws1']) {
      expect(isRestorableRoute(route), route).toBe(true);
    }
  });
});

describe('step-up — cache window', () => {
  it('covers ten minutes from the last success', () => {
    expect(STEP_UP_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(isStepUpFresh(NOW - 1000, NOW)).toBe(true);
    expect(isStepUpFresh(NOW - STEP_UP_WINDOW_MS + 1, NOW)).toBe(true);
    expect(isStepUpFresh(NOW - STEP_UP_WINDOW_MS, NOW)).toBe(false);
  });

  it('is never fresh without a success or with a clock step backwards', () => {
    expect(isStepUpFresh(null, NOW)).toBe(false);
    expect(isStepUpFresh(NOW + 1, NOW)).toBe(false);
  });
});
