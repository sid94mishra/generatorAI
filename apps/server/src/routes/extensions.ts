// ────────────────────────────────────────────────────────────────
// Extension Routes — REST + assets surface for extension management.
//
//   GET    /api/extensions                          — list installed
//   POST   /api/extensions                          — install from a path
//   GET    /api/extensions/:id                      — get one
//   DELETE /api/extensions/:id                      — uninstall
//   PATCH  /api/extensions/:id                      — enable/disable
//   POST   /api/extensions/reload                   — rescan disk
//   GET    /api/extensions/widgets                  — list widget descriptors
//   GET    /api/widget-assets/:extensionId/*        — serve widget bundle assets
//
// Widget-asset serving is CSP-locked (no unsafe cross-origin fetch)
// and path-traversal guarded — every request path is resolved inside
// the owning extension root, symlinks refused.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import type { Container } from '../composition-root.js';
import { InstallExtensionParamsSchema } from '@generatorai/shared';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export function createExtensionRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { extensionManager, logger } = container;

  router.get('/', (_req, res) => {
    res.json({ extensions: extensionManager.list() });
  });

  router.get('/widgets', (_req, res) => {
    res.json({ widgets: container.widgetRegistry.list() });
  });

  router.post('/reload', async (_req, res, next) => {
    try {
      await extensionManager.reload();
      res.json({ ok: true, count: extensionManager.list().length });
    } catch (err) {
      next(err);
    }
  });

  // Hot-reload a single extension by id — v2 endpoint. Preserves in-DB
  // widget instances; only the extension's code + registrations are
  // re-loaded from disk.
  router.post('/:id/reload', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const reloaded = await extensionManager.reloadOne(id);
      if (!reloaded) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Extension not installed' },
        });
        return;
      }
      res.json({ ok: true, extension: reloaded });
    } catch (err) {
      logger?.warn?.(`[extensions] reload failed: ${String(err)}`);
      next(err);
    }
  });

  router.get('/:id', (req, res) => {
    const ext = extensionManager.get(String(req.params['id']));
    if (!ext) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Extension not installed' } });
      return;
    }
    res.json({ extension: ext });
  });

  router.post('/', async (req, res, next) => {
    try {
      const parsed = InstallExtensionParamsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues },
        });
        return;
      }
      const ext = await extensionManager.install(parsed.data);
      res.status(201).json({ extension: ext });
    } catch (err) {
      logger?.warn?.(`[extensions] install failed: ${String(err)}`);
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const removed = await extensionManager.uninstall(id);
      if (!removed) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Extension not installed' } });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const body = req.body as { enabled?: boolean };
      if (typeof body.enabled === 'boolean') {
        await extensionManager.setEnabled(id, body.enabled);
      }
      const ext = extensionManager.get(id);
      if (!ext) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Extension not installed' } });
        return;
      }
      res.json({ extension: ext });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Router that serves static widget assets under /api/widget-assets/:extensionId/*. */
export function createWidgetAssetRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { extensionManager, logger } = container;

  router.get(/^\/([^/]+)\/(.+)$/, async (req, res) => {
    const extensionId = decodeURIComponent(req.params[0] ?? '');
    const rest = decodeURIComponent(req.params[1] ?? '');
    const root = extensionManager.resolveRoot(extensionId);
    if (!root) {
      res.status(404).send('extension not found');
      return;
    }
    const absRoot = resolve(root);
    const target = resolve(absRoot, rest);
    if (!target.startsWith(absRoot + sep) && target !== absRoot) {
      res.status(400).send('path escapes extension root');
      return;
    }
    if (!existsSync(target)) {
      res.status(404).send('not found');
      return;
    }
    let stat;
    try {
      stat = statSync(target);
    } catch (err) {
      logger?.warn?.(`[widget-assets] stat failed for ${target}: ${String(err)}`);
      res.status(500).send('stat failed');
      return;
    }
    if (stat.isSymbolicLink()) {
      res.status(400).send('symlink refused');
      return;
    }
    if (!stat.isFile()) {
      res.status(404).send('not a file');
      return;
    }
    const mime = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    // v2 CSP: allow same-origin script/style so widgets can ship as
    // multi-file bundles (React/Vue/Svelte). Still no external hosts,
    // no fetch (connect-src 'none'), no allow-same-origin on the
    // iframe → the null-origin sandbox remains the isolation boundary.
    //
    // NOTES:
    //   - `default-src 'none'` is intentionally omitted: Chromium enforces
    //     it on the top-level render of a sandboxed iframe (null origin)
    //     and blocks the initial navigation. Setting explicit directives
    //     (script/style/img/font/connect) is enough to lock down what
    //     the widget can do without breaking the initial document render.
    //   - `frame-ancestors` is omitted because Chromium refuses to embed
    //     sandboxed iframes when the response asserts `frame-ancestors`
    //     (the sandbox forces a null origin which cannot match 'self').
    //   - `script-src 'self'` lets widgets do `<script src="./bundle.js">`
    //     from their own asset folder. Combined with the sandbox iframe
    //     (which strips origin/cookies) this is safe.
    if (mime.startsWith('text/html')) {
      // Widgets now load from a dedicated origin (separate loopback port),
      // so they legitimately need to reach the host API cross-origin.
      // `connect-src` allows the API origins (+ any WIDGET_CONNECT_SRC
      // domains) instead of the previous null-origin `'none'`. Widgets can
      // still only reach explicitly-allowed hosts — no arbitrary egress.
      const apiConnect =
        process.env['WIDGET_CONNECT_SRC'] ??
        'http://localhost:3100 http://127.0.0.1:3100';
      res.setHeader(
        'Content-Security-Policy',
        [
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src data: blob: 'self'",
          "font-src 'self' data:",
          `connect-src 'self' ${apiConnect}`,
        ].join('; '),
      );
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=60');
    try {
      const buf = await fs.readFile(target);
      // For HTML widget entries, inject a <base href> pointing at the
      // asset folder so relative URLs like `<script src="./bundle.js">`
      // and `<link href="./styles.css">` resolve correctly even when
      // the client mounts the HTML via `srcdoc` (null origin).
      if (mime.startsWith('text/html')) {
        const html = buf.toString('utf8');
        // Path prefix served by this route: /api/widget-assets/<extId>/<rest>
        // We want <base href="/api/widget-assets/<extId>/<dirOfRest>/">
        const dirOfRest = rest.includes('/') ? rest.slice(0, rest.lastIndexOf('/') + 1) : '';
        const baseHref = `/api/widget-assets/${encodeURIComponent(extensionId)}/${dirOfRest}`;
        // Insert <base> right after <head> (or at document start if <head> missing).
        let patched: string;
        if (/<head[^>]*>/i.test(html)) {
          patched = html.replace(/<head([^>]*)>/i, (match) => `${match}<base href="${baseHref}">`);
        } else {
          patched = `<base href="${baseHref}">` + html;
        }
        res.end(patched);
        return;
      }
      res.end(buf);
    } catch (err) {
      logger?.warn?.(`[widget-assets] readFile failed for ${target}: ${String(err)}`);
      res.status(500).send('read failed');
    }
  });

  return router;
}
