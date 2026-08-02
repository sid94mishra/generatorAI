// ────────────────────────────────────────────────────────────────
// Static Files Middleware — serves web app in production
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs';
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

  if (!fs.existsSync(webDistPath)) {
    return router;
  }

  // Serve static files
  router.use(express.static(webDistPath));

  // Fallback to index.html for client-side routing.
  // NOTE: Express 5 / path-to-regexp@8 reject the bare string path '*'
  // ("Missing parameter name"). Use a RegExp catch-all, which bypasses
  // path-to-regexp entirely and matches every GET path.
  router.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    // Don't intercept API routes
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    const indexPath = path.join(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });

  return router;
}
