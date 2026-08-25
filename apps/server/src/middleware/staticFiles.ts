// ────────────────────────────────────────────────────────────────
// Static Files Middleware — serves web app in production
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

/**
 * In production, serves the built web app from apps/web/dist/.
 * All non-API routes fall through to index.html for client-side routing.
 * v2: Supports /chats/:id, /workflows/:id, /workflow-runs/:id routes.
 * In development, this is a no-op (Vite dev server handles it).
 */
export function createStaticFilesMiddleware(): express.Router {
  const router = express.Router();

  if (process.env['NODE_ENV'] !== 'production') {
    return router;
  }

  // Resolve the web app dist directory. `WEB_DIST_DIR` lets an embedding host
  // (e.g. the Electron desktop app, where the bundle layout differs) point at
  // the built SPA explicitly; otherwise fall back to the monorepo-relative path.
  const webDistPath = process.env['WEB_DIST_DIR']
    ? path.resolve(process.env['WEB_DIST_DIR'])
    : path.resolve(
        new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        '../../../../apps/web/dist',
      );

  // P3-c — check existence asynchronously once at startup rather than via
  // the blocking sync fs.existsSync. `fs.promises.access` is used here instead
  // of `fs.statSync` so the check is non-blocking even on slow network volumes.
  // This function can return the router synchronously (before the check resolves)
  // because Express lazily resolves routes; the `router.use(express.static(...))`
  // call below is conditional on the check resolving truthy — we wire the sub-
  // router dynamically into a placeholder router that is always mounted.
  const placeholder = express.Router();
  router.use(placeholder);

  void fsPromises.access(webDistPath, fs.constants.F_OK).then(() => {
    const indexPath = path.join(webDistPath, 'index.html');

    // Serve static assets (JS, CSS, images …)
    placeholder.use(express.static(webDistPath));

    // Fallback to index.html for client-side routing.
    // NOTE: Express 5 / path-to-regexp@8 reject the bare string path '*'
    // ("Missing parameter name"). Use a RegExp catch-all, which bypasses
    // path-to-regexp entirely and matches every GET path.
    //
    // P3-c — no sync fs.existsSync per request. `res.sendFile` propagates a
    // not-found error into `next(err)` automatically, so no pre-flight check
    // is needed; index.html should always be present if webDistPath exists.
    placeholder.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
      // Don't intercept API routes
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexPath, (err) => {
        if (err) next(err);
      });
    });
  }).catch(() => {
    // webDistPath does not exist (dev mode, partial build) — leave the
    // placeholder empty so all routes fall through normally.
  });

  return router;
}
