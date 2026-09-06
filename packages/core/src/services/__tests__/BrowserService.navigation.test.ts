// ────────────────────────────────────────────────────────────────
// Review 6.1 — the integrated browser's navigation boundary.
//
// The allow-list used to be host-pattern matching only, which meant two
// things: with no `allowedHosts` configured (the default) every host passed,
// and because the check only looked at the host, `file:///…` — whose host is
// empty — passed as well. An agent could point the browser at a local
// credentials file or at the cloud metadata address and read the result back.
//
// `isNavigationAllowed` is the whole policy. This suite pins the policy
// itself; `BrowserService` routes both of its enforcement points
// (`assertHostAllowed` for tool navigation, `beforeBrowserActionHook` for the
// hook path) through it, so a regression here is a regression there.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { isNavigationAllowed } from '@generatorai/shared';

describe('browser navigation policy (review 6.1)', () => {
  describe('with no allow-list configured — the default', () => {
    const open = undefined;

    it('allows an ordinary public page', () => {
      expect(isNavigationAllowed('https://example.com/docs', open).ok).toBe(true);
    });

    it.each([
      ['file:///C:/Users/me/.aws/credentials'],
      ['file:///etc/passwd'],
      ['data:text/html,<script>1</script>'],
      ['javascript:fetch("/api/keys")'],
      ['chrome://settings'],
    ])('refuses the %s scheme outright', (url) => {
      const verdict = isNavigationAllowed(url, open);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/scheme|valid URL/i);
    });

    it.each([
      ['http://169.254.169.254/latest/meta-data/'],
      ['http://metadata.google.internal/computeMetadata/v1/'],
      ['http://100.100.100.200/latest/meta-data/'],
    ])('refuses the cloud metadata endpoint %s', (url) => {
      expect(isNavigationAllowed(url, open).ok).toBe(false);
    });

    it.each([['http://127.0.0.1:3100/api/chats'], ['http://localhost:3100/'], ['http://[::1]:3100/']])(
      'refuses loopback %s, which is where this server itself listens',
      (url) => {
        expect(isNavigationAllowed(url, open).ok).toBe(false);
      },
    );

    it('refuses a malformed address rather than defaulting to allow', () => {
      expect(isNavigationAllowed('not a url', open).ok).toBe(false);
    });
  });

  describe('with an explicit allow-list', () => {
    it('permits a host the operator named, loopback included', () => {
      // Driving a local development server is a real use, so an explicit
      // opt-in still wins. What changed is that it must be explicit.
      expect(isNavigationAllowed('http://127.0.0.1:5173/', ['127.0.0.1']).ok).toBe(true);
    });

    it('still refuses a host the operator did not name', () => {
      expect(isNavigationAllowed('https://evil.example/', ['127.0.0.1']).ok).toBe(false);
    });

    it('still refuses a non-http scheme, whatever the list says', () => {
      expect(isNavigationAllowed('file:///etc/passwd', ['*']).ok).toBe(false);
    });
  });

  it('allows about:blank, which is what a blocked page is replaced with', () => {
    expect(isNavigationAllowed('about:blank', undefined).ok).toBe(true);
  });
});
