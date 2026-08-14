// ────────────────────────────────────────────────────────────────
// /api/workspaces/:id/computer — the human side of Computer Use.
//
// Exists so the user can watch what the agent is doing and answer for it. The
// agent's own snapshots already persist a PNG of the target WINDOW (never the
// whole screen) as a `computer_screenshot` artifact; this serves those frames,
// the audit trail behind them, the consent answers, and the standing grants.
//
// Nothing here can drive the desktop. Every mutation goes through the gated
// `computer_*` tools so it lands in the audit log.
//
// The consent answer also lives on `/internal/computer`, which only the desktop
// shell can reach (loopback + IPC token). This is the same answer from the web
// UI, so it carries the same `appIdentity` cross-check: a caller that scraped a
// requestId off the event stream still cannot approve without naming what it is
// approving.
// ────────────────────────────────────────────────────────────────

import { Router, type Request } from 'express';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Container } from '../composition-root.js';

type WorkspaceIdParams = { id: string };

function idOf(req: Request<WorkspaceIdParams>): string {
  return String((req.params as WorkspaceIdParams).id ?? '');
}

const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'always_allow', 'deny']),
});

const RuntimeActionSchema = z.object({ action: z.enum(['start', 'restart', 'stop']) });

export function createComputerRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const {
    workspaceArtifactRepo,
    workspaceManager,
    computerService,
    computerUseRepo,
    computerConsentStore,
  } = container;

  // GET /workspaces/:id/computer/consent — prompts still awaiting an answer.
  router.get('/consent', (req, res) => {
    const workspaceId = idOf(req as Request<WorkspaceIdParams>);
    res.json({ pending: computerConsentStore.listPending(workspaceId) });
  });

  // POST /workspaces/:id/computer/consent — answer a pending prompt.
  router.post('/consent', (req, res) => {
    const parsed = ConsentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const { requestId, appIdentity, decision } = parsed.data;
    const accepted = computerConsentStore.resolve(requestId, decision, appIdentity);
    if (!accepted) {
      // Expired, already answered, or naming the wrong app. All three are
      // "this prompt is no longer answerable", and the store has already
      // denied on the agent's side where it mattered.
      res.status(409).json({
        error: { code: 'NOT_PENDING', message: 'That request is no longer awaiting an answer.' },
      });
      return;
    }
    res.json({ ok: true, requestId, decision });
  });

  // GET /workspaces/:id/computer/grants — standing "always allow" decisions.
  router.get('/grants', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const grants = await computerUseRepo.listGrants(workspaceId);
      res.json({ grants });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workspaces/:id/computer/grants/:appIdentity — revoke one.
  router.delete('/grants/:appIdentity', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      await computerUseRepo.revokeGrant(
        String(params['id'] ?? ''),
        decodeURIComponent(String(params['appIdentity'] ?? '')),
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/runtime — is the driver installed, started,
  // healthy? Read-only: it reports on a session that already exists and never
  // opens one, so polling this cannot hand out desktop control.
  router.get('/runtime', async (req, res, next) => {
    try {
      res.json(await computerService.runtimeStatus(idOf(req as Request<WorkspaceIdParams>)));
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/computer/runtime — start, restart, or stop the driver
  // session on request, so a broken driver is discovered here rather than
  // half-way through a task.
  router.post('/runtime', async (req, res, next) => {
    try {
      const parsed = RuntimeActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      if (parsed.data.action === 'stop') {
        await computerService.stop(workspaceId, 'user-requested');
        res.json(await computerService.runtimeStatus(workspaceId));
        return;
      }

      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const ctx = {
        workspaceId,
        workspaceRoot: workspaceManager.getWorkingDirectory(workspace),
        chatId: 'system',
        turnId: 'runtime-control',
      };
      res.json(
        parsed.data.action === 'restart'
          ? await computerService.restartRuntime(ctx)
          : await computerService.startRuntime(ctx),
      );
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/activity — recent actions, newest first.
  //
  // Seeds the preview panel on open. Without it the panel shows a captured
  // window next to an empty activity list, which reads as broken rather than
  // as "the live feed starts now".
  router.get('/activity', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const rows = await computerUseRepo.listAudit(workspaceId, 60);
      res.json({
        entries: rows
          .map((r) => ({
            action: r.action,
            appLabel: r.appLabel,
            target: r.target ?? null,
            path: r.path ?? null,
            verified: r.verified,
            refusalCode: r.refusalCode ?? null,
            createdAt: r.createdAt,
          }))
          .reverse(),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/frames — newest window captures first.
  router.get('/frames', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const all = await workspaceArtifactRepo.findByWorkspace(workspaceId);
      const frames = all
        .filter((a) => a.artifactType === 'computer_screenshot')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 50)
        .map((a) => ({
          id: a.id,
          createdAt: a.createdAt,
          width: (a.metadata as { width?: number } | undefined)?.width,
          height: (a.metadata as { height?: number } | undefined)?.height,
        }));
      res.json({ enabled: computerService.isEnabled(), frames });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/frames/:artifactId — the PNG itself.
  //
  // Addressed by artifact id rather than by path: the id is already scoped to
  // a workspace and an artifact type, so there is no client-supplied path to
  // sanitise and no way to name a file the agent never captured.
  router.get('/frames/:artifactId', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const workspaceId = String(params['id'] ?? '');
      const artifactId = String(params['artifactId'] ?? '');
      const all = await workspaceArtifactRepo.findByWorkspace(workspaceId);
      const artifact = all.find((a) => a.id === artifactId && a.artifactType === 'computer_screenshot');
      if (!artifact) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Frame not found' } });
        return;
      }

      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      // Screenshot paths are stored relative to the working directory, which is
      // the root the driver was handed — not `rootPath`.
      const base = path.resolve(workspaceManager.getWorkingDirectory(workspace));
      const absolute = path.resolve(base, artifact.relativePath);
      if (absolute !== base && !absolute.startsWith(base + path.sep)) {
        res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Path escapes workspace' } });
        return;
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      createReadStream(absolute)
        .on('error', () => {
          if (!res.headersSent) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Frame file missing' } });
          }
        })
        .pipe(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
