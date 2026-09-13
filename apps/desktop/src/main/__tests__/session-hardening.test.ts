// Electron grants every permission on a session with no handler, and imposes
// no CSP of its own. These pin the deny-by-default permission policy for
// browser tabs, the audio-only-for-the-app policy for the main window, and the
// CSP floor that mirrors the server's header onto documents lacking one.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appWindowPermissionPolicy,
  browserTabPermissionPolicy,
  cspFloorHeaders,
  decidePermission,
  denyAllPermissions,
  DESKTOP_CSP,
  hardenBrowserTabSession,
  installCspFloor,
  installPermissionPolicy,
  SENSITIVE_PERMISSIONS,
  setBrowserTabPermissionPolicy,
} from '../session-hardening';

const APP = 'http://127.0.0.1:3100';

describe('DESKTOP_CSP mirrors the server CSP', () => {
  it('matches every directive createCspMiddleware() emits', () => {
    const serverSrc = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'server', 'src', 'middleware', 'csp.ts'),
      'utf8',
    );
    const hash = /THEME_SCRIPT_CSP_HASH = '([^']+)'/.exec(serverSrc)?.[1];
    expect(hash).toBeTruthy();
    const directives = [...serverSrc.matchAll(/^\s+[`"]([a-z-]+ [^`"]+)[`"],?$/gm)]
      .map((m) => m[1]!.replace('${THEME_SCRIPT_CSP_HASH}', hash!));
    expect(directives.length).toBeGreaterThanOrEqual(7);
    for (const d of directives) expect(DESKTOP_CSP).toContain(d);
  });
});

describe('cspFloorHeaders', () => {
  it('adds the CSP to a document response that has none', () => {
    const out = cspFloorHeaders({ url: 'https://other.example/', resourceType: 'mainFrame', responseHeaders: { 'X-Foo': ['1'] } });
    expect(out).toEqual({ 'X-Foo': ['1'], 'Content-Security-Policy': [DESKTOP_CSP] });
  });

  it('leaves a response that already carries a CSP untouched (case-insensitive)', () => {
    expect(
      cspFloorHeaders({ url: `${APP}/`, resourceType: 'mainFrame', responseHeaders: { 'content-security-policy': ["default-src 'none'"] } }),
    ).toBeNull();
  });

  it('ignores non-document resources and non-http schemes', () => {
    expect(cspFloorHeaders({ url: 'https://x/a.js', resourceType: 'script' })).toBeNull();
    expect(cspFloorHeaders({ url: 'file:///error.html', resourceType: 'mainFrame' })).toBeNull();
  });

  it('is wired through onHeadersReceived', () => {
    let listener: ((d: unknown, cb: (r: unknown) => void) => void) | null = null;
    const ses = { webRequest: { onHeadersReceived: vi.fn((l) => (listener = l)) } };
    installCspFloor(ses as never);
    const cb = vi.fn();
    listener!({ url: 'https://other.example/', resourceType: 'mainFrame', responseHeaders: {} }, cb);
    expect(cb).toHaveBeenCalledWith({ responseHeaders: { 'Content-Security-Policy': [DESKTOP_CSP] } });
    listener!({ url: 'https://other.example/x.png', resourceType: 'image', responseHeaders: {} }, cb);
    expect(cb).toHaveBeenLastCalledWith({});
  });
});

describe('permission policies', () => {
  it('browser tabs deny every sensitive permission by default', () => {
    for (const permission of SENSITIVE_PERMISSIONS) {
      expect(decidePermission({ permission, origin: 'https://site.example' }, denyAllPermissions), permission).toBe(false);
    }
    expect(decidePermission({ permission: 'clipboard-read', origin: 'https://site.example' }, denyAllPermissions)).toBe(false);
  });

  it('the main window allows audio media for the app origin only', () => {
    const policy = appWindowPermissionPolicy(() => APP);
    expect(decidePermission({ permission: 'media', origin: APP, mediaTypes: ['audio'] }, policy)).toBe(true);
    expect(decidePermission({ permission: 'media', origin: '', mediaTypes: ['audio'] }, policy)).toBe(true); // internal frame
    expect(decidePermission({ permission: 'media', origin: APP, mediaTypes: ['video'] }, policy)).toBe(false);
    expect(decidePermission({ permission: 'media', origin: 'https://evil.example', mediaTypes: ['audio'] }, policy)).toBe(false);
    expect(decidePermission({ permission: 'media', origin: `${APP}@evil.com`, mediaTypes: ['audio'] }, policy)).toBe(false);
    expect(decidePermission({ permission: 'geolocation', origin: APP }, policy)).toBe(false);
    expect(decidePermission({ permission: 'display-capture', origin: APP }, policy)).toBe(false);
    expect(decidePermission({ permission: 'notifications', origin: APP }, policy)).toBe(false);
  });

  it('the app window may WRITE to the clipboard (Copy transcript), never read it', () => {
    const policy = appWindowPermissionPolicy(() => APP);
    expect(decidePermission({ permission: 'clipboard-sanitized-write', origin: APP }, policy)).toBe(true);
    expect(decidePermission({ permission: 'clipboard-sanitized-write', origin: 'https://evil.example' }, policy)).toBe(false);
    expect(decidePermission({ permission: 'clipboard-read', origin: APP }, policy)).toBe(false);
  });

  it('a throwing policy denies', () => {
    expect(decidePermission({ permission: 'media', origin: APP }, () => { throw new Error('x'); })).toBe(false);
  });

  it('installPermissionPolicy wires both Electron handlers', () => {
    const handlers: Record<string, (...a: unknown[]) => unknown> = {};
    const ses = {
      setPermissionRequestHandler: vi.fn((h) => (handlers['request'] = h)),
      setPermissionCheckHandler: vi.fn((h) => (handlers['check'] = h)),
    };
    installPermissionPolicy(ses as never, appWindowPermissionPolicy(() => APP));
    const cb = vi.fn();
    handlers['request']!({}, 'media', cb, { securityOrigin: APP, mediaTypes: ['audio'] });
    expect(cb).toHaveBeenLastCalledWith(true);
    handlers['request']!({}, 'geolocation', cb, { securityOrigin: APP });
    expect(cb).toHaveBeenLastCalledWith(false);
    handlers['request']!({}, 'media', cb, { requestingUrl: 'https://evil.example/', mediaTypes: ['audio'] });
    expect(cb).toHaveBeenLastCalledWith(false);
    expect(handlers['check']!({}, 'media', APP, { mediaType: 'audio' })).toBe(true);
    expect(handlers['check']!({}, 'media', 'https://evil.example', { mediaType: 'audio' })).toBe(false);
    expect(handlers['check']!({}, 'notifications', APP, {})).toBe(false);
  });

  it('hardenBrowserTabSession installs deny-all and honours the allow-list hook live', () => {
    const handlers: Record<string, (...a: unknown[]) => unknown> = {};
    const ses = {
      setPermissionRequestHandler: vi.fn((h) => (handlers['request'] = h)),
      setPermissionCheckHandler: vi.fn((h) => (handlers['check'] = h)),
    };
    hardenBrowserTabSession(ses as never);
    const cb = vi.fn();
    handlers['request']!({}, 'media', cb, { securityOrigin: 'https://meet.example', mediaTypes: ['video', 'audio'] });
    expect(cb).toHaveBeenLastCalledWith(false);
    expect(handlers['check']!({}, 'geolocation', 'https://maps.example', {})).toBe(false);

    try {
      setBrowserTabPermissionPolicy(({ permission, origin }) => permission === 'geolocation' && origin === 'https://maps.example');
      expect(browserTabPermissionPolicy()({ permission: 'geolocation', origin: 'https://maps.example' })).toBe(true);
      // Sessions created earlier pick up the new policy too — the hook is read per request.
      expect(handlers['check']!({}, 'geolocation', 'https://maps.example', {})).toBe(true);
      expect(handlers['check']!({}, 'media', 'https://maps.example', {})).toBe(false);
    } finally {
      setBrowserTabPermissionPolicy(null);
    }
    expect(handlers['check']!({}, 'geolocation', 'https://maps.example', {})).toBe(false);
  });

  it('browser-host applies the hardening to every tab session it creates', () => {
    const src = readFileSync(join(__dirname, '..', 'browser-host.ts'), 'utf8');
    expect(src).toMatch(/hardenBrowserTabSession\(tabSession\)/);
    expect(src).toMatch(/session: tabSession/);
  });
});
