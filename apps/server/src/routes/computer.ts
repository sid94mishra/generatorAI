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

import { Router, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import { screenCastFile } from '../computer/screenCast.js';
import { readCursorSince, readFramesSince } from '../computer/previewStream.js';

type WorkspaceIdParams = { id: string };

function idOf(req: Request<WorkspaceIdParams>): string {
  return String((req.params as WorkspaceIdParams).id ?? '');
}

/** Newest recorder run directory, or null when nothing has been recorded. */
async function newestRun(root: string): Promise<string | null> {  let runs: string[];
  try {
    runs = await fs.readdir(root);
  } catch {
    return null;
  }
  let best: { dir: string; at: number } | null = null;
  for (const run of runs) {
    const dir = path.join(root, run);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) continue;
      if (!best || stat.mtimeMs > best.at) best = { dir, at: stat.mtimeMs };
    } catch {
      // Vanished between readdir and stat — skip it.
    }
  }
  return best?.dir ?? null;
}

/**
 * The recorder's per-turn window captures, oldest first.
 *
 * These are the honest replay of a run. The `recording.mp4` beside them grabs
 * the whole physical display, so it captures the lock screen when the machine
 * locks mid-run — which it does, because the agent drives windows in the
 * background and never touches the real mouse to reset the idle timer. These
 * PNGs come from Windows Graphics Capture scoped to the target window, so they
 * survive locking, occlusion and other windows entirely.
 *
 * Turns without an `action.json` are skipped, and that is a privacy rule rather
 * than tidiness. The recorder opens a turn folder and takes a `before` frame
 * before the target window is resolved, so if the run ends there the capture it
 * leaves behind is a full-display grab of whatever the operator had on screen —
 * measured at 1920x1200 against 1918x1138 for real window captures. No agent
 * action happened in such a turn, so nothing of value is lost by dropping it.
 */
async function replayTurns(runDir: string): Promise<Array<Record<string, unknown>>> {
  let entries: string[];
  try {
    entries = await fs.readdir(runDir);
  } catch {
    return [];
  }
  const turns: Array<Record<string, unknown>> = [];
  for (const name of entries.filter((e) => e.startsWith('turn-')).sort()) {
    let action: Record<string, unknown>;
    try {
      action = JSON.parse(await fs.readFile(path.join(runDir, name, 'action.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      // No action ran in this turn, so its frames are not window-scoped.
      continue;
    }
    const frames: string[] = [];
    for (const kind of ['before', 'click', 'after']) {
      try {
        await fs.access(path.join(runDir, name, `${kind}.png`));
        frames.push(kind);
      } catch {
        // Not every turn produces every frame — click.png is click-only.
      }
    }
    if (frames.length === 0) continue;
    turns.push({
      turn: name,
      tool: action['tool'] ?? action['tool_name'] ?? null,
      at: action['timestamp'] ?? null,
      frames,
    });
  }
  return turns;
}

async function exists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Streams a file that is still being written, then keeps going as it grows.
 *
 * A fragmented MP4 is playable from the first fragment, so the browser can
 * start watching seconds into a run. `Content-Length` is deliberately absent:
 * the length is not known until the capture stops, and sending a wrong one
 * makes the player stall at that byte.
 */
async function tailFile(
  file: string,
  res: Response,
  isActive: () => boolean,
): Promise<void> {
  let offset = 0;
  let idleFor = 0;

  while (!res.writableEnded) {
    let size: number;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      // The capture has not created the file yet.
      size = 0;
    }

    if (size > offset) {
      idleFor = 0;
      const chunk = createReadStream(file, { start: offset, end: size - 1 });
      const wrote = await new Promise<boolean>((resolve) => {
        chunk.on('end', () => resolve(true));
        chunk.on('error', () => resolve(false));
        res.on('close', () => resolve(false));
        chunk.pipe(res, { end: false });
      });
      if (!wrote) break;
      offset = size;
      continue;
    }

    // Nothing new. Stop once the capture has finished and we have drained it,
    // and give up on a capture that produces nothing at all.
    if (!isActive()) break;
    idleFor += 250;
    if (idleFor > 30_000) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  res.end();
}

const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'always_allow', 'deny']),
});

const RuntimeActionSchema = z.object({ action: z.enum(['start', 'restart', 'stop']) });

const RecordingActionSchema = z.object({
  action: z.enum(['start', 'stop', 'status']),
  /**
   * Also run a whole-screen video capture. Off by default: it needs ffmpeg, it
   * records everything on screen rather than the target window, and it records
   * the lock screen once the workstation locks. The live preview does not use
   * it — window frames and the cursor trace survive a lock, and this does not.
   */
  screenVideo: z.boolean().optional(),
  /** Window to frame the capture on. Omitted means the whole desktop. */
  windowTitle: z.string().max(300).optional(),
});

export function createComputerRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const {
    workspaceArtifactRepo,
    workspaceManager,
    computerService,
    computerUseRepo,
    computerConsentStore,
    screenCast,
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

  // POST /workspaces/:id/computer/recording — operator-only trajectory capture.
  //
  // Not an agent tool: recording writes a screen video and a full before/after
  // trace of every action, so the person being recorded has to be the one who
  // turns it on.
  router.post('/recording', async (req, res, next) => {
    try {
      const parsed = RecordingActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      if (parsed.data.action === 'stop') {
        const stopped = await computerService.stopRecording(workspaceId);
        const cast = await screenCast.stop(workspaceId);
        res.json({ ...stopped, cast });
        return;
      }
      if (parsed.data.action === 'status') {
        const state = await computerService.recordingState(workspaceId);
        // Whether a replay exists is a question about the disk, not about the
        // driver session — the frames outlive the session that wrote them.
        const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
        const root = workspace
          ? path.resolve(workspaceManager.getWorkingDirectory(workspace), 'computer', 'recordings')
          : null;
        const run = root ? await newestRun(root) : null;
        res.json({
          ...state,
          turnCount: run ? (await replayTurns(run)).length : 0,
          cast: screenCast.state(workspaceId),
          hasCast: run ? await exists(screenCastFile(run)) : false,
        });
        return;
      }

      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const workspaceRoot = workspaceManager.getWorkingDirectory(workspace);
      // Confined to the workspace: an absolute path from the client would let
      // the caller aim a screen recorder at any directory on the machine.
      const outputDir = path.join(workspaceRoot, 'computer', 'recordings', `run-${Date.now()}`);
      // The driver's own `record_video` is deliberately NOT requested: it writes
      // with `+faststart`, so nothing is playable until the run ends. Our cast
      // covers the video; the driver still writes the per-turn window frames.
      const started = await computerService.startRecording(
        { workspaceId, workspaceRoot, chatId: 'system' },
        { outputDir },
      );
      const cast = started.refusal || !parsed.data.screenVideo
        ? { active: false }
        : screenCast.start(workspaceId, started.outputDir ?? outputDir, parsed.data.windowTitle);
      res.json({ ...started, cast });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/activity — recent actions, newest first.
  //
  // Seeds the preview panel on open. Without it the panel shows a captured
  // window next to an empty activity list, which reads as broken rather than
  // as "the live feed starts now".
  //
  // Each row carries the artifact id of the frame captured for it, so clicking
  // an entry can show the window as it was at that moment. The audit stores a
  // relative path and the artifact store is keyed by id, so they are joined
  // here rather than making the client fetch both and guess.
  router.get('/activity', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const rows = await computerUseRepo.listAudit(workspaceId, 60);
      const artifacts = await workspaceArtifactRepo.findByWorkspace(workspaceId);
      const idByPath = new Map<string, string>();
      for (const artifact of artifacts) {
        if (artifact.artifactType !== 'computer_screenshot') continue;
        idByPath.set(artifact.relativePath.replace(/\\/g, '/'), artifact.id);
      }
      res.json({
        entries: rows
          .map((r) => ({
            action: r.action,
            appLabel: r.appLabel,
            target: r.target ?? null,
            path: r.path ?? null,
            verified: r.verified,
            refusalCode: r.refusalCode ?? null,
            artifactId: r.artifactPath ? (idByPath.get(r.artifactPath.replace(/\\/g, '/')) ?? null) : null,
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

  // GET /workspaces/:id/computer/recording/video — the run, live or finished.
  //
  // While the capture is running the file is tail-streamed so the player can
  // follow along; once it has stopped the same file is served with ranges so
  // the player can scrub it. No client-supplied path, for the same reason the
  // frames route takes an artifact id: the recorder only ever writes under
  // `<workspace>/computer/recordings/`.
  router.get('/recording/video', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const root = path.resolve(workspaceManager.getWorkingDirectory(workspace), 'computer', 'recordings');
      const run = await newestRun(root);
      const newest = run ? screenCastFile(run) : null;
      if (!newest || !(await exists(newest))) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No recording yet' } });
        return;
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');

      if (screenCast.state(workspaceId).active) {
        // Deliberately no `Accept-Ranges`: the length is still changing, and a
        // player that tries to seek a growing file stalls at the old end.
        await tailFile(newest, res, () => screenCast.state(workspaceId).active);
        return;
      }

      const { size } = await fs.stat(newest);
      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes');

      if (!range) {
        res.setHeader('Content-Length', size);
        createReadStream(newest).pipe(res);
        return;
      }

      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!match || Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(newest, { start, end }).pipe(res);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/recording/turns — the replay index.
  router.get('/recording/turns', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const root = path.resolve(workspaceManager.getWorkingDirectory(workspace), 'computer', 'recordings');
      const run = await newestRun(root);
      res.json({ turns: run ? await replayTurns(run) : [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/recording/turns/:turn/:kind — one PNG.
  //
  // Both segments are pattern-checked rather than sanitised: the recorder names
  // turn folders `turn-NNNNN` and frames `before|click|after`, so anything else
  // is a caller trying to walk out of the run directory.
  router.get('/recording/turns/:turn/:kind', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const turn = String(params['turn'] ?? '');
      const kind = String(params['kind'] ?? '');
      if (!/^turn-\d{1,8}$/.test(turn) || !/^(before|click|after)$/.test(kind)) {
        res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Unknown frame' } });
        return;
      }
      // The route's own params shadow the merged `:id`, so the cast has to go
      // through `unknown` — the id is still there at runtime via mergeParams.
      const workspaceId = idOf(req as unknown as Request<WorkspaceIdParams>);
      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const root = path.resolve(workspaceManager.getWorkingDirectory(workspace), 'computer', 'recordings');
      const run = await newestRun(root);
      if (!run) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No recording yet' } });
        return;
      }
      const file = path.join(run, turn, `${kind}.png`);
      try {
        await fs.access(file);
      } catch {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such frame' } });
        return;
      }
      // Same rule as the index: a turn with no action never resolved a target
      // window, so its frame is a full-display grab. Refuse it here too, or a
      // client holding a stale index could still pull the operator's screen.
      try {
        await fs.access(path.join(run, turn, 'action.json'));
      } catch {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such frame' } });
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      createReadStream(file).pipe(res);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/computer/preview/stream — the live feed.
  //
  // Frames and cursor positions travel separately because they come from
  // different places and change at wildly different rates: a window frame per
  // action, a cursor sample every ~30 ms. Sending them as data rather than as
  // pixels is what makes this work on a locked workstation and over a VPS
  // link, where a screen video shows the lock screen and a 4K stream is
  // unaffordable.
  router.get('/preview/stream', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }
      const root = path.resolve(workspaceManager.getWorkingDirectory(workspace), 'computer', 'recordings');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let run = await newestRun(root);
      const seen = new Set<string>();
      let cursorOffset = 0;
      let boundsAt = 0;
      let closed = false;
      req.on('close', () => {
        closed = true;
      });

      send('open', { run: run ? path.basename(run) : null });

      while (!closed && !res.writableEnded) {
        // The recorder starts a new run directory each time; following it keeps
        // a preview opened before the first recording from staying blank.
        const newest = await newestRun(root);
        if (newest && newest !== run) {
          run = newest;
          seen.clear();
          cursorOffset = 0;
          send('run', { run: path.basename(run) });
        }

        if (run) {
          for (const frame of await readFramesSince(run, seen)) send('frame', frame);

          const cursor = await readCursorSince(run, cursorOffset);
          cursorOffset = cursor.offset;
          // Thinned to ~20 Hz: the recorder samples faster than a browser can
          // paint, and every sample is bytes on a remote link.
          if (cursor.samples.length > 0) {
            const step = Math.max(1, Math.floor(cursor.samples.length / 20));
            send(
              'cursor',
              cursor.samples.filter((_, i) => i % step === 0 || i === cursor.samples.length - 1),
            );
          }
        }

        // Window bounds translate the cursor's screen coordinates onto the
        // frame. Refreshed slowly because a window rarely moves, and each read
        // is a driver round trip.
        if (Date.now() - boundsAt > 3_000) {
          boundsAt = Date.now();
          const bounds = await computerService.previewWindow(workspaceId);
          if (bounds) send('window', bounds);
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      res.end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
