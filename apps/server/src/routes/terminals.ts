// ────────────────────────────────────────────────────────────────
// Terminal Routes — Integrated Terminal REST surface.
//
//   POST   /workspaces/:id/terminals                     — spawn session
//   GET    /workspaces/:id/terminals                     — list sessions
//   GET    /workspaces/:id/terminals/:sid                — describe
//   GET    /workspaces/:id/terminals/:sid/scrollback     — replay tail
//            ?tailBytes=N                — raw PTY bytes (default)
//            ?format=text&tailLines=N    — rendered lines from the host's
//                                          headless VT model (W14)
//   POST   /workspaces/:id/terminals/:sid/resize         — resize
//   POST   /workspaces/:id/terminals/:sid/signal         — POSIX signal
//   DELETE /workspaces/:id/terminals/:sid                — kill
//
// The WebSocket for live IO is registered separately (`terminal-ws.ts`).
// Events flow through /api/stream via `terminal.*` kinds.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Container } from '../composition-root.js';

type WorkspaceIdParams = { id: string };
type SessionParams = { id: string; sid: string };
type TerminalRequest = Request<WorkspaceIdParams | SessionParams>;

function idOf(req: TerminalRequest): string {
  return String((req.params as WorkspaceIdParams).id ?? '');
}
function sidOf(req: TerminalRequest): string {
  return String((req.params as SessionParams).sid ?? '');
}

const CreateBodySchema = z.object({
  cols: z.number().int().min(1).max(500).optional(),
  rows: z.number().int().min(1).max(200).optional(),
  shell: z.string().min(1).max(512).optional(),
  attachToSandbox: z.boolean().optional(),
  runId: z.string().min(1).max(128).optional(),
});
const ResizeBodySchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});
const SignalBodySchema = z.object({
  name: z.string().min(1).max(32),
});

export function createTerminalRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { terminalService, executionWorkspaceRepo } = container;

  // ── Guard: feature flag off returns 501 everywhere ────────────────
  router.use((_req, res, next) => {
    if (process.env['GENERATORAI_TERMINAL'] === '0') {
      res.status(501).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Integrated terminal is disabled (GENERATORAI_TERMINAL=0)',
        },
      });
      return;
    }
    next();
  });

  // POST /workspaces/:id/terminals
  router.post('/', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as TerminalRequest);
      const workspace = await executionWorkspaceRepo.findById(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${workspaceId}` } });
        return;
      }
      const parsed = CreateBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues } });
        return;
      }
      const descriptor = await terminalService.spawn({
        workspaceId,
        cols: parsed.data.cols,
        rows: parsed.data.rows,
        ...(parsed.data.shell ? { shell: parsed.data.shell } : {}),
        ...(parsed.data.attachToSandbox ? { attachToSandbox: true } : {}),
        ...(parsed.data.runId ? { runId: parsed.data.runId } : {}),
      });
      res.status(201).json(descriptor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cap (')) {
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: msg } });
        return;
      }
      next(err);
    }
  });

  // GET /workspaces/:id/terminals
  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as TerminalRequest);
      const list = terminalService.list(workspaceId);
      res.json({ terminals: list });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/terminals/:sid
  router.get('/:sid', async (req, res, next) => {
    try {
      const sid = sidOf(req as TerminalRequest);
      const workspaceId = idOf(req as TerminalRequest);
      const d = terminalService.describe(sid);
      if (!d || d.workspaceId !== workspaceId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Terminal not found: ${sid}` } });
        return;
      }
      res.json(d);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/terminals/:sid/scrollback
  router.get('/:sid/scrollback', async (req, res, next) => {
    try {
      const sid = sidOf(req as TerminalRequest);
      const workspaceId = idOf(req as TerminalRequest);
      const d = terminalService.describe(sid);
      if (!d || d.workspaceId !== workspaceId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Terminal not found: ${sid}` } });
        return;
      }
      // W14: `?format=text` serves the host's headless VT model — the parsed,
      // rendered view, bounded at O(lines × columns) however much the command
      // printed — instead of the gateway's raw byte ring. Only the
      // out-of-process pty-host keeps one, so this 409s rather than silently
      // handing back a different representation than the caller asked for.
      if (String(req.query['format'] ?? '') === 'text') {
        const tailLinesRaw = req.query['tailLines'];
        const tailLines = tailLinesRaw ? Math.max(0, parseInt(String(tailLinesRaw), 10) || 0) : 0;
        const lines = await terminalService.scrollbackText(sid, tailLines);
        if (!lines) {
          res.status(409).json({
            error: {
              code: 'UNSUPPORTED',
              message: `Terminal ${sid} runs on a host with no VT model — omit ?format=text for raw bytes`,
            },
          });
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ lines });
        return;
      }
      const tailRaw = req.query['tailBytes'];
      const tailBytes = tailRaw ? Math.max(0, parseInt(String(tailRaw), 10) || 0) : 0;
      const buf = terminalService.scrollback(sid, tailBytes);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(buf);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/terminals/:sid/resize
  router.post('/:sid/resize', async (req, res, next) => {
    try {
      const sid = sidOf(req as TerminalRequest);
      const workspaceId = idOf(req as TerminalRequest);
      const d = terminalService.describe(sid);
      if (!d || d.workspaceId !== workspaceId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Terminal not found: ${sid}` } });
        return;
      }
      const parsed = ResizeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues } });
        return;
      }
      const ok = await terminalService.resize(sid, parsed.data.cols, parsed.data.rows);
      if (!ok) {
        res.status(409).json({ error: { code: 'GONE', message: 'Terminal has exited' } });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/terminals/:sid/signal
  router.post('/:sid/signal', async (req, res, next) => {
    try {
      const sid = sidOf(req as TerminalRequest);
      const workspaceId = idOf(req as TerminalRequest);
      const d = terminalService.describe(sid);
      if (!d || d.workspaceId !== workspaceId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Terminal not found: ${sid}` } });
        return;
      }
      const parsed = SignalBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues } });
        return;
      }
      terminalService.signal(sid, parsed.data.name);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workspaces/:id/terminals/:sid
  router.delete('/:sid', async (req, res, next) => {
    try {
      const sid = sidOf(req as TerminalRequest);
      const workspaceId = idOf(req as TerminalRequest);
      const d = terminalService.describe(sid);
      if (!d || d.workspaceId !== workspaceId) {
        // Idempotent: DELETE of an unknown terminal is a no-op.
        res.status(204).end();
        return;
      }
      await terminalService.kill(sid, 'user_close');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
