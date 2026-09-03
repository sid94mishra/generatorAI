// ────────────────────────────────────────────────────────────────
// Browser Routes — Integrated Browser REST + streaming surface (v13).
//
//  POST   /api/workspaces/:id/browser/start           — start / attach
//  POST   /api/workspaces/:id/browser/stop            — terminate session
//  POST   /api/workspaces/:id/browser/actions         — user actions (URL bar, back/forward, screenshot, dom, inspector on/off, navigate)
//  POST   /api/workspaces/:id/browser/selection       — INTERNAL: inspector script posts a selection
//  POST   /api/workspaces/:id/browser/read-page       — serialised accessibility tree (text; for non-graphical clients)
//  GET    /api/workspaces/:id/browser/snapshots       — list browser artifacts
//  GET    /api/workspaces/:id/browser/descriptor      — current mode/status/url for the SPA
//  GET    /api/workspaces/:id/browser/screencast.jpg  — ONE JPEG frame (poll)
//
// △ W15 — `GET …/screencast.mjpg` (multipart/x-mixed-replace) is DELETED. It
// was a second, concurrent capture path: an `<img>` on it drove its own CDP
// screencast subscription alongside the WebSocket live view, so a workspace
// with the panel open captured and JPEG-encoded every frame twice. The live
// view is the WebSocket (`browser-ws.ts`), which now negotiates its codec on
// the same socket. `screencast.jpg` stays because it is a genuinely different
// thing — one frame, on request — and is what the mobile client and
// `client-core`'s admin surface use.
//
// The route lives under /api/workspaces/:id/browser (owned by the workspace
// resource) rather than a peer entity because a browser session is a
// workspace-scoped resource — INV-7 compatible (browser follows worktree/
// workspace lifecycle).
//
// Events flow through the unified /api/stream SSE endpoint via `browser.*`
// kinds — no new streaming transport needed.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import type { BrowserInspectorSelection } from '@generatorai/shared';
import type { BrowserConfig } from '@generatorai/shared';
import type { BrowserInputEvent } from '@generatorai/core';
import { BrowserConfigSchema } from '@generatorai/shared';

type WorkspaceIdParams = { id: string };
type BrowserRequest = Request<WorkspaceIdParams>;

/** Extract the workspace id from a request whose parent router uses `:id`. */
function idOf(req: BrowserRequest): string {
  return String((req.params as WorkspaceIdParams).id ?? '');
}

const StartBodySchema = z.object({
  url: z.string().url().optional(),
  config: BrowserConfigSchema.optional(),
});

const ActionBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().url() }),
  z.object({ kind: z.literal('reload') }),
  z.object({ kind: z.literal('back') }),
  z.object({ kind: z.literal('forward') }),
  z.object({ kind: z.literal('screenshot') }),
  z.object({ kind: z.literal('snapshot') }),
  z.object({ kind: z.literal('inspector'), on: z.boolean() }),
]);

const CookieImportBodySchema = z.object({
  browser: z.enum(['chrome', 'edge', 'brave', 'arc']),
  hostFilter: z.array(z.string().min(1).max(200)).max(50).optional(),
});

const SelectionBodySchema = z.object({
  url: z.string(),
  cssSelector: z.string().optional(),
  xpath: z.string().optional(),
  outerHtml: z.string(),
  computedStyle: z.record(z.string()).optional(),
  boundingBox: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  ts: z.number(),
});

export function createBrowserRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { browserService, executionWorkspaceRepo, workspaceArtifactRepo, logger } = container;

  // POST /workspaces/:id/browser/start
  router.post('/start', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const workspace = await executionWorkspaceRepo.findById(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${workspaceId}` } });
        return;
      }

      const parsed = StartBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues } });
        return;
      }

      // Merge inline overrides with the stored workspace.browserConfig.
      const merged = {
        ...(workspace.browserConfig ?? {}),
        ...(parsed.data.config ?? {}),
        enabled: true,
      } as BrowserConfig;
      workspace.browserConfig = merged as Record<string, unknown>;

      const descriptor = await browserService.ensureStarted(workspace);
      if (parsed.data.url && descriptor.ready) {
        // Fire-and-forget so the client doesn't have to wait for the
        // full page load before rendering the live view. The SPA
        // polls the descriptor + subscribes to browser.* SSE events,
        // so `currentUrl` will update within ~1 s of nav completion.
        void browserService.navigate(workspaceId, parsed.data.url, 'user').catch((err) => {
          logger.warn?.(`[BrowserRoutes] initial navigate failed for ${workspaceId}: ${(err as Error).message}`);
        });
      }

      // Redact the CDP endpoint from the response — it is loopback-only and
      // may leak an attach vector to an untrusted client (though same-origin
      // gating usually protects it). The agent-side skill reads it from env,
      // not from this response.
      res.json({
        workspaceId: descriptor.workspaceId,
        status: descriptor.status,
        mode: descriptor.mode,
        targetId: descriptor.targetId,
        currentUrl: descriptor.currentUrl,
        viewport: descriptor.viewport,
        ready: descriptor.ready,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/stop
  router.post('/stop', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      await browserService.stop(workspaceId, 'user');
      res.status(200).json({ status: 'stopped' });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/cookies/import — pull cookies from the
  // user's own installed Chrome/Edge/Brave/Arc profile into this
  // workspace's active session (see CookieImport.ts for platform caveats).
  router.post('/cookies/import', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const parsed = CookieImportBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues } });
        return;
      }
      const result = await browserService.importCookies(workspaceId, parsed.data.browser, parsed.data.hostFilter);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/actions
  router.post('/actions', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const parsed = ActionBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message } });
        return;
      }
      const action = parsed.data;
      switch (action.kind) {
        case 'navigate':
          res.json(await browserService.navigate(workspaceId, action.url, 'user'));
          return;
        case 'reload':
          res.json(await browserService.reload(workspaceId, 'user'));
          return;
        case 'back':
          res.json(await browserService.back(workspaceId));
          return;
        case 'forward':
          res.json(await browserService.forward(workspaceId));
          return;
        case 'screenshot':
          res.json(await browserService.screenshot(workspaceId, 'user'));
          return;
        case 'snapshot':
          res.json(await browserService.domSnapshot(workspaceId, 'user'));
          return;
        case 'inspector':
          await browserService.inspector(workspaceId, action.on);
          res.json({ ok: true });
          return;
      }
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/selection
  //
  // Called by the InspectorScript running inside the target page (see
  // packages/core/src/infrastructure/browser/InspectorScript.ts). The page
  // itself invokes `window.__generatoraiInspectorPost` which is bound via
  // Playwright's `context.exposeFunction` — so in practice this endpoint is
  // rarely hit for the *server-side* headless flow. It's kept here so the
  // desktop-native flow (where the inspector runs inside an Electron
  // `WebContentsView` and cannot use `exposeFunction`) can POST directly.
  router.post('/selection', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const parsed = SelectionBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message } });
        return;
      }
      const sel: BrowserInspectorSelection = parsed.data;
      const result = await browserService.recordInspectorSelection(workspaceId, sel);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/attach
  // POST /workspaces/:id/browser/detach
  //
  // "Share with Agent" toggle — VSCode parity. Detach flips the agent's
  // access off (built-in tools return an error) but leaves Chromium
  // running so the user can keep looking at the page and pick elements
  // via the inspector. `sendPrompt` re-attaches automatically on the
  // next user turn.
  router.post('/attach', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const out = await browserService.setAttachedToChat(workspaceId, true);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });
  router.post('/detach', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const out = await browserService.setAttachedToChat(workspaceId, false);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/capture
  //
  // Region screenshot: caller supplies { clip: {x,y,width,height} } in
  // page coordinates; server returns a PNG stream. Used by the SPA's
  // drag-to-capture affordance so the user can hand a rectangle from
  // the live view to the chat composer.
  const CaptureBodySchema = z.object({
    clip: z.object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    quality: z.number().min(20).max(100).optional(),
  });
  router.post('/capture', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const parsed = CaptureBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message } });
        return;
      }
      let buf: Buffer;
      try {
        buf = await browserService.captureRegion(workspaceId, parsed.data.clip);
      } catch (err) {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message: (err as Error).message } });
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(buf);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/read-page
  //
  // The serialised accessibility tree — `BrowserService.readPage()`, which
  // existed only as an agent tool and had no HTTP surface at all, so no
  // client could ask for it. It is the single most useful representation of
  // a page for a NON-GRAPHICAL client: a text tree of the page's interactive
  // shape, roughly a tenth the size of the DOM snapshot, and readable in a
  // terminal as-is. `POST` rather than `GET` because it drives the live page
  // (it re-issues element refs on the host, invalidating the previous set) —
  // it is not a cacheable read.
  router.post('/read-page', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      res.json(await browserService.readPage(workspaceId));
    } catch (err) {
      // `mustRecord` throws when no session is running — a 409 the way
      // `/capture` already reports the same condition, rather than a 500.
      const message = (err as Error).message ?? '';
      if (/no .*session|not (started|active|running)/i.test(message)) {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message } });
        return;
      }
      next(err);
    }
  });

  // GET /workspaces/:id/browser/descriptor
  router.get('/descriptor', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const descriptor = await browserService.describe(workspaceId);
      // Include a lightweight snapshot of user-facing config so the SPA
      // can drive UX (e.g. auto-open Browser tab on visibility='visible')
      // without hitting a second endpoint. `resolveConfig` returns the
      // shape with defaults applied.
      const ws = await executionWorkspaceRepo.findById(workspaceId).catch(() => null);
      const cfg = browserService.resolveConfig(ws?.browserConfig);
      res.json({
        workspaceId: descriptor.workspaceId,
        status: descriptor.status,
        mode: descriptor.mode,
        targetId: descriptor.targetId,
        currentUrl: descriptor.currentUrl,
        viewport: descriptor.viewport,
        ready: descriptor.ready,
        // Config peek — only the fields the SPA needs. Not authoritative
        // for security decisions (server enforces those).
        config: {
          enabled: cfg.enabled,
          visibility: cfg.visibility,
          evalAllowed: cfg.evalAllowed,
        },
        attachedToChat: descriptor.attachedToChat ?? true,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/browser/snapshots — list browser_* artifacts
  router.get('/snapshots', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const all = await workspaceArtifactRepo.findByWorkspace(workspaceId);
      const browserOnly = all.filter((a) => a.artifactType.startsWith('browser_'));
      res.json({ artifacts: browserOnly });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/browser/files/* — serve a raw browser artifact.
  //
  // The path parameter is the artifact's `relativePath` (URL-encoded). This
  // endpoint is intentionally narrower than the generic workspace files
  // route: it only serves files whose relative path starts with `browser/`
  // (so screenshots, DOM snapshots, HAR, video, inspector-selection JSONs).
  // Path-traversal-safe: any `..` segment or absolute component is rejected.
  router.get(/^\/files\/(.+)$/, async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const rawPath = decodeURIComponent(
        // Express matches the capture group into `req.params[0]` for RegExp routes.
        (req.params as Record<string, string>)[0] ?? '',
      );
      if (!rawPath || rawPath.includes('..') || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
        res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Invalid file path' } });
        return;
      }
      // Only allow reads from the `browser/` subtree.
      const normalised = rawPath.replace(/\\/g, '/');
      if (!normalised.startsWith('browser/')) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only browser/ files are exposed' } });
        return;
      }
      const workspace = await executionWorkspaceRepo.findById(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const fs = await import('node:fs');
      const nodePath = await import('node:path');
      const absPath = nodePath.resolve(workspace.rootPath, normalised);
      const baseRoot = nodePath.resolve(workspace.rootPath, 'browser');
      if (!absPath.startsWith(baseRoot)) {
        res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Path escapes workspace' } });
        return;
      }
      // Guess content type from extension.
      const ext = nodePath.extname(absPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : ext === '.webm' ? 'video/webm'
        : ext === '.mp4' ? 'video/mp4'
        : ext === '.har' ? 'application/json'
        : ext === '.json' ? 'application/json'
        : ext === '.yaml' || ext === '.yml' ? 'application/x-yaml'
        : ext === '.html' ? 'text/html'
        : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=60');
      fs.createReadStream(absPath)
        .on('error', () => {
          if (!res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        })
        .pipe(res);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/browser/screencast.jpg — single JPEG frame
  //
  // Client-friendly polling endpoint. Returns exactly one frame captured at
  // request time. Preferred over the MJPEG stream because it works through
  // any HTTP proxy (Vite dev, corporate proxies, load balancers) which may
  // buffer `multipart/x-mixed-replace`. The SPA polls this every ~500ms
  // while the panel is visible.
  router.get('/screencast.jpg', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const quality = Math.max(20, Math.min(95, Number(req.query['quality'] ?? '60')));
      let buf: Buffer;
      try {
        buf = await browserService.frame(workspaceId, { quality });
      } catch {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message: 'Browser is not running' } });
        return;
      }
      res.status(200)
        .setHeader('Content-Type', 'image/jpeg')
        .setHeader('Cache-Control', 'no-store')
        .setHeader('X-Content-Type-Options', 'nosniff')
        .send(buf);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/input — dispatch a mouse/keyboard event.
  //
  // Enables real user interaction (click, type, scroll) through the SPA
  // live view. Coordinates are in page space (0..viewport.width/height).
  // Body is a `BrowserInputEvent` discriminated union.
  router.post('/input', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const event = req.body as BrowserInputEvent;
      if (!event || typeof event !== 'object' || typeof (event as { type?: unknown }).type !== 'string') {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'Missing event.type' } });
        return;
      }
      try {
        await browserService.interact(workspaceId, event);
      } catch (err) {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message: (err as Error).message } });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/browser/resize — resize the browser viewport.
  //
  // Called by the SPA when the panel is dragged so the live view fills
  // available space without letterbox bars (and stops burning CPU
  // rendering pixels we'd clip).
  router.post('/resize', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      const body = req.body as { width?: unknown; height?: unknown };
      const w = Number(body?.width);
      const h = Number(body?.height);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'width and height (>=100) required' } });
        return;
      }
      try {
        await browserService.resize(workspaceId, w, h);
      } catch (err) {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message: (err as Error).message } });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/browser/scroll — page scroll state.
  //
  // Returns { scrollY, scrollHeight, clientHeight } so the SPA can
  // render an overlay scrollbar. Headless Chromium's page.screenshot
  // doesn't paint native OS scrollbars.
  router.get('/scroll', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as BrowserRequest);
      try {
        const state = await browserService.scrollState(workspaceId);
        res.status(200).json(state);
      } catch (err) {
        res.status(409).json({ error: { code: 'NOT_ACTIVE', message: (err as Error).message } });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

