// The navigation boundary is the desktop app's only defence against a page
// walking the main window off to another origin. These pin the parsed-origin
// comparison and, above all, the fail-CLOSED behaviour on garbage input.

import { describe, expect, it } from 'vitest';
import { appRouteOf, isAppOrigin, isAppOriginForPermission, isExternalUrlAllowed } from '../navigation-guard';

const APP = 'http://127.0.0.1:3100';

describe('isAppOrigin (navigation)', () => {
  it('accepts the app origin, any path', () => {
    expect(isAppOrigin('http://127.0.0.1:3100/', APP)).toBe(true);
    expect(isAppOrigin('http://127.0.0.1:3100/chats/abc?x=1#y', APP)).toBe(true);
  });

  it('rejects the userinfo trick that defeated startsWith', () => {
    // `new URL(...)` parses everything before `@` as credentials; the real
    // host is evil.com. `startsWith(APP)` returned true for this string.
    const url = 'http://127.0.0.1:3100@evil.com';
    expect(url.startsWith(APP)).toBe(true);
    expect(isAppOrigin(url, APP)).toBe(false);
  });

  it('rejects prefix look-alikes', () => {
    expect(isAppOrigin('http://127.0.0.1:31000/', APP)).toBe(false);
    expect(isAppOrigin('http://127.0.0.1:3100.evil.com/', APP)).toBe(false);
    expect(isAppOrigin('https://127.0.0.1:3100/', APP)).toBe(false); // scheme differs
  });

  it('rejects non-http schemes even on the right host', () => {
    expect(isAppOrigin('javascript:alert(1)', APP)).toBe(false);
    expect(isAppOrigin('file:///etc/passwd', APP)).toBe(false);
    expect(isAppOrigin('data:text/html,hi', APP)).toBe(false);
  });

  it('fails closed on empty or unparseable input', () => {
    expect(isAppOrigin('', APP)).toBe(false);
    expect(isAppOrigin(null, APP)).toBe(false);
    expect(isAppOrigin(undefined, APP)).toBe(false);
    expect(isAppOrigin('not a url', APP)).toBe(false);
    expect(isAppOrigin('http://', APP)).toBe(false);
  });

  it('fails closed when no app URL is known yet', () => {
    expect(isAppOrigin('http://127.0.0.1:3100/', null)).toBe(false);
    expect(isAppOrigin('http://127.0.0.1:3100/', '')).toBe(false);
  });
});

describe('isAppOriginForPermission (media handler)', () => {
  it('treats an EMPTY origin as the app frame, because Electron omits it for internal frames', () => {
    expect(isAppOriginForPermission('', APP)).toBe(true);
    expect(isAppOriginForPermission(undefined, APP)).toBe(true);
  });

  it('is otherwise as strict as the navigation check', () => {
    expect(isAppOriginForPermission('http://127.0.0.1:3100@evil.com', APP)).toBe(false);
    expect(isAppOriginForPermission('javascript:x', APP)).toBe(false);
    expect(isAppOriginForPermission('http://127.0.0.1:3100/', APP)).toBe(true);
  });

  it('grants nothing when no app URL is known', () => {
    expect(isAppOriginForPermission('', null)).toBe(false);
  });
});

describe('isExternalUrlAllowed', () => {
  it('allows the web schemes', () => {
    expect(isExternalUrlAllowed('https://github.com/x')).toBe(true);
    expect(isExternalUrlAllowed('http://example.com')).toBe(true);
    expect(isExternalUrlAllowed('mailto:a@b.c')).toBe(true);
  });

  it('allows the editor fallback schemes the server hands back', () => {
    // `/api/editor/open` answers `{ ok: false, fallbackUrl }` when it cannot
    // spawn the binary; refusing these made "Open in VS Code" silently do
    // nothing in the desktop app.
    for (const url of [
      'vscode://file/Users/me/repo',
      'vscode-insiders://file/Users/me/repo',
      'cursor://file/Users/me/repo',
      'windsurf://file/Users/me/repo',
    ]) {
      expect(isExternalUrlAllowed(url)).toBe(true);
    }
  });

  it('refuses everything else', () => {
    expect(isExternalUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isExternalUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isExternalUrlAllowed('data:text/html,<script>')).toBe(false);
    expect(isExternalUrlAllowed('zoommtg://start')).toBe(false);
    expect(isExternalUrlAllowed('not a url')).toBe(false);
    expect(isExternalUrlAllowed('')).toBe(false);
  });
});

describe('appRouteOf (in-app popups)', () => {
  it('returns a client route with its query and hash intact', () => {
    expect(appRouteOf(`${APP}/chats/abc?focus=1#latest`)).toBe('/chats/abc?focus=1#latest');
    expect(appRouteOf(`${APP}`)).toBe('/');
    expect(appRouteOf(`${APP}/settings/appearance`)).toBe('/settings/appearance');
  });

  it('does not mistake a server resource for a route', () => {
    expect(appRouteOf(`${APP}/api/files/raw?path=x`)).toBeNull();
    expect(appRouteOf(`${APP}/api`)).toBeNull();
    expect(appRouteOf(`${APP}/internal/browser/x`)).toBeNull();
    expect(appRouteOf(`${APP}/assets/index-abc.js`)).toBeNull();
    expect(appRouteOf(`${APP}/favicon.ico`)).toBeNull();
  });

  it('keeps a route that merely starts like a server prefix', () => {
    expect(appRouteOf(`${APP}/apiary`)).toBe('/apiary');
  });

  it('returns null for input that does not parse', () => {
    expect(appRouteOf('not a url')).toBeNull();
  });
});
