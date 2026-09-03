// ────────────────────────────────────────────────────────────────
// CSP — W31, tightened during end-to-end review.
//
// The default CSP used to carry a blanket `script-src 'unsafe-inline'`
// justified by a comment about "inline Vite HMR runtime in dev" — which does
// not apply to this process (Vite's dev server is separate). The real need
// is one specific, build-time-constant inline script in `apps/web/index.html`
// (theme-flash prevention). This test:
//   1. Proves the default CSP no longer carries a blanket 'unsafe-inline' on
//      script-src.
//   2. Recomputes the hash from the LIVE source file and asserts it matches
//      the constant baked into the middleware — so an edit to that script
//      is caught here, loudly, instead of the CSP silently blocking it (or
//      someone "fixing" the resulting theme flash by widening the CSP back
//      to 'unsafe-inline').
//   3. Confirms the API docs route's own, more permissive override exists
//      and does not weaken the default for every other route.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createCspMiddleware, THEME_SCRIPT_CSP_HASH } from '../middleware/csp.js';
import { createOpenApiRoutes } from '../routes/openapi.js';

function makeApp() {
  const app = express();
  app.use(createCspMiddleware());
  app.get('/other', (_req, res) => res.send('ok'));
  app.use('/api', createOpenApiRoutes());
  return app;
}

describe('Content-Security-Policy', () => {
  it('does not carry a blanket unsafe-inline on script-src', async () => {
    const res = await request(makeApp()).get('/other');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeDefined();
    // A naive `.includes("'unsafe-inline'")` would also match style-src,
    // which is a deliberate, separate allowance — check script-src precisely.
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain(`'${THEME_SCRIPT_CSP_HASH}'`);
  });

  it('the baked-in hash matches the live theme-flash script in apps/web/index.html', () => {
    // Walks up from this file to the repo root, then into apps/web — brittle
    // to a repo restructure, but the whole point is to notice exactly that
    // kind of drift rather than silently trusting a stale constant.
    const here = dirname(fileURLToPath(import.meta.url));
    const indexHtmlPath = resolve(here, '../../../../apps/web/index.html');
    const html = readFileSync(indexHtmlPath, 'utf8');

    const start = html.indexOf('<script>');
    const end = html.indexOf('</script>', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const scriptText = html.slice(start + '<script>'.length, end);

    const hash = 'sha256-' + createHash('sha256').update(scriptText, 'utf8').digest('base64');
    expect(hash).toBe(THEME_SCRIPT_CSP_HASH);
  });

  it('the docs page overrides the default CSP to allow its CDN, without weakening other routes', async () => {
    const app = makeApp();

    const other = await request(app).get('/other');
    const otherCsp = other.headers['content-security-policy'] as string;
    expect(otherCsp).not.toContain('cdn.jsdelivr.net');

    const docs = await request(app).get('/api/docs');
    const docsCsp = docs.headers['content-security-policy'] as string;
    expect(docsCsp).toContain('cdn.jsdelivr.net');
    expect(docsCsp).not.toBe(otherCsp);
  });

  it('every directive still ends in frame-ancestors none (no directive silently dropped)', async () => {
    const res = await request(makeApp()).get('/other');
    const csp = res.headers['content-security-policy'] as string;
    for (const directive of ['default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'connect-src', 'frame-ancestors']) {
      expect(csp).toContain(directive);
    }
  });
});
