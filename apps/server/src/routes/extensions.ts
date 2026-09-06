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
import { existsSync, lstatSync, realpathSync } from 'node:fs';
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
    let realTarget: string;
    try {
      // `lstat`, not `stat`: `stat` FOLLOWS symlinks, so `isSymbolicLink()`
      // below was always false and the check could never fire. Containment
      // above only bounds the path as written — a link planted inside the
      // extension folder pointed anywhere on disk and was served happily.
      // The extension-writing tool can plant exactly such a link, which is
      // what made this a real chain rather than a theoretical one (review 6.1).
      stat = lstatSync(target);
      // Resolve the whole path and re-check containment, which also catches a
      // link on an intermediate directory rather than the final segment.
      realTarget = realpathSync(target);
    } catch (err) {
      logger?.warn?.(`[widget-assets] stat failed for ${target}: ${String(err)}`);
      res.status(500).send('stat failed');
      return;
    }
    if (stat.isSymbolicLink()) {
      res.status(400).send('symlink refused');
      return;
    }
    const realRoot = (() => {
      try {
        return realpathSync(absRoot);
      } catch {
        return absRoot;
      }
    })();
    if (!realTarget.startsWith(realRoot + sep) && realTarget !== realRoot) {
      res.status(400).send('path escapes extension root');
      return;
    }
    if (!stat.isFile()) {
      res.status(404).send('not a file');
      return;
    }
    const mime = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    //
    // This is the origin that renders MODEL-AUTHORED HTML, so its CSP is the
    // real boundary — the host-app CSP protects a document the model does not
    // write. Two things the previous version got wrong, both worth naming
    // because the comments here asserted the opposite of the code:
    //
    //  1. The header was set only for `text/html`. `.svg` is served as
    //     `image/svg+xml`, and an SVG rendered as a *top-level document*
    //     (which a widget can navigate its own frame to) executes any
    //     `<script>` inside it — with no CSP at all. Every response now
    //     carries a policy; non-document types simply get the strictest one.
    //  2. The old comment claimed "no allow-same-origin on the iframe → the
    //     null-origin sandbox remains the isolation boundary." That has not
    //     been true since widgets moved to a dedicated origin: the embedder
    //     sets `allow-same-origin` (WidgetFrame.tsx), so widget script runs
    //     with a real origin and real storage. The isolation boundary is now
    //     the separate loopback origin, not a null origin — which means the
    //     policy has to do the work the sandbox flag used to.
    //
    // `default-src 'none'` is still omitted deliberately: Chromium applies it
    // to the top-level render of the frame's own document and blocks the
    // initial navigation. The directives below therefore enumerate every
    // fetch type explicitly rather than relying on a fallback.
    // `frame-ancestors` is likewise omitted — Chromium refuses to embed a
    // sandboxed frame whose response asserts it.
    const isDocument = mime.startsWith('text/html');
    // Widgets load from a dedicated origin, so reaching the host API is a
    // legitimate cross-origin call. `connect-src` names the API origins
    // explicitly (plus any WIDGET_CONNECT_SRC additions) — no arbitrary egress.
    const apiConnect =
      process.env['WIDGET_CONNECT_SRC'] ?? 'http://localhost:3100 http://127.0.0.1:3100';
    res.setHeader(
      'Content-Security-Policy',
      (isDocument
        ? [
            // 'unsafe-inline'/'unsafe-eval' are what bundled widget frameworks
            // need; they are scoped to this origin, which holds no host
            // credentials and no host DOM.
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src data: blob: 'self'",
            "font-src 'self' data:",
            `connect-src 'self' ${apiConnect}`,
            // This route injects a <base href> below. Without `base-uri`,
            // widget script could inject a second <base> and re-point every
            // relative URL in the document.
            "base-uri 'self'",
            // Nothing here needs plugins or form posts; both are live
            // exfiltration paths that the fetch directives above do not cover.
            "object-src 'none'",
            "form-action 'none'",
          ]
        : // Non-document assets (scripts, styles, images, fonts, and any
          // scripted SVG a widget tries to open directly) get the strictest
          // policy that still lets them be *loaded* as subresources.
          ["script-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]
      ).join('; '),
    );
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
