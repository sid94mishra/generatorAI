import { describe, expect, it } from 'vitest';

import { isSafeNotificationRoute, safeRoute } from '../notifications/routeGuard';

describe('notification route guard — accepts real routes', () => {
  it.each([
    '/chats/abc-123',
    '/runs/run-1',
    '/automations/a1',
    '/projects/p1',
    '/changes/w1',
    '/changes/w1/file?path=src%2Fa.ts',
    '/settings/security',
  ])('allows %s', (route) => {
    expect(isSafeNotificationRoute(route)).toBe(true);
    expect(safeRoute(route)).toBe(route);
  });
});

describe('notification route guard — rejects navigation escapes', () => {
  it('rejects an absolute URL', () => {
    // Route data originates from server events, which can carry agent output.
    for (const route of [
      'https://evil.test/steal',
      'http://evil.test',
      'generatorai://pair?code=abc',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      expect(isSafeNotificationRoute(route), route).toBe(false);
    }
  });

  it('rejects a protocol-relative URL', () => {
    // `//evil.com` passes a naive "starts with /" check and is treated as an
    // absolute URL by browsers and several link handlers.
    expect(isSafeNotificationRoute('//evil.test/path')).toBe(false);
    expect(isSafeNotificationRoute('///evil.test')).toBe(false);
  });

  it('rejects a scheme hidden mid-string', () => {
    expect(isSafeNotificationRoute('/chats/../../https://evil.test')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(isSafeNotificationRoute('/chats/../settings')).toBe(false);
    expect(isSafeNotificationRoute('/../secrets')).toBe(false);
  });

  it('rejects control characters and newlines', () => {
    // These smuggle a second value past naive parsers downstream.
    expect(isSafeNotificationRoute('/chats/a\nb')).toBe(false);
    expect(isSafeNotificationRoute('/chats/a\r\nLocation: evil')).toBe(false);
    expect(isSafeNotificationRoute('/chats/a\u0000b')).toBe(false);
  });

  it('rejects a relative path', () => {
    expect(isSafeNotificationRoute('chats/abc')).toBe(false);
    expect(isSafeNotificationRoute('./chats')).toBe(false);
  });

  it('rejects an unknown root segment', () => {
    // Allowlist, not denylist: a route table entry added later must be opted
    // into deliberately rather than becoming reachable by accident.
    expect(isSafeNotificationRoute('/admin')).toBe(false);
    expect(isSafeNotificationRoute('/pair')).toBe(false);
    expect(isSafeNotificationRoute('/_sitemap')).toBe(false);
  });

  it('rejects non-strings and empties', () => {
    for (const value of [null, undefined, 42, {}, [], '', '/', true]) {
      expect(isSafeNotificationRoute(value), String(value)).toBe(false);
    }
  });

  it('returns null rather than throwing for bad input', () => {
    expect(safeRoute(undefined)).toBeNull();
    expect(safeRoute('https://evil.test')).toBeNull();
  });
});
