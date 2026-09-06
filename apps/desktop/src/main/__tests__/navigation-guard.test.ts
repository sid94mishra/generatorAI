// The navigation boundary is the desktop app's only defence against a page
// walking the main window off to another origin. These pin the parsed-origin
// comparison and, above all, the fail-CLOSED behaviour on garbage input.

import { describe, expect, it } from 'vitest';
import { isAppOrigin, isAppOriginForPermission } from '../navigation-guard';

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
