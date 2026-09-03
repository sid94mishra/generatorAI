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
import { createReadStream, watch as watchPath } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import { acquireSseSlot } from '../composition/sseConnectionCap.js';
import { screenCastFile, CAST_FILE as SCREEN_CAST_FILE } from '../computer/screenCast.js';
import {
  newestRun,
  readCursorSince,
  readFramesSince,
  isWindowScopedTurn,
} from '../computer/previewStream.js';
import { subscribeEphemeral } from '../streaming/ephemeralScopes.js';

type WorkspaceIdParams = { id: string };

function idOf(req: Request<WorkspaceIdParams>): string {
  return String((req.params as WorkspaceIdParams).id ?? '');
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
 * Turns without an `action.json` are skipped, and so are turns whose captures
 * the driver did not scope to a target window — both are privacy rules rather
 * than tidiness. The recorder grabs the WHOLE DISPLAY when an action has no
 * target process: an abandoned turn, or a `launch_app` for an app that does not
 * exist yet. Measured at 1920x1200 against 1918x1138 for real window captures,
 * and observed showing an unrelated chat app and a lock screen. No agent action
 * is visible in such a frame anyway, so nothing of value is lost.
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
    if (!(await isWindowScopedTurn(path.join(runDir, name)))) continue;
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
 * Longest a tail wakes up for on its own when the watcher says nothing.
 *
 * P1-11 replaced a flat 250 ms `fs.stat` poll with a watcher, but a watcher
 * alone is not a safe sole source of truth: `fs.watch` is documented as not
 * universally reliable, it does not fire at all on most network filesystems,
 * and on some platforms it coalesces rapid appends. So the watcher is the
 * FAST path and this is the floor — four times fewer wakeups than the old
 * poll in the pathological case, and effectively none in the normal one.
 */
const TAIL_IDLE_STEP_MS = 1000;

/**
 * Floor between two idle wakeups.
 *
 * A directory watcher also fires for metadata-only changes and for events it
 * cannot name (`filename` is null on some platforms), neither of which grows
 * the file — without a floor, a busy recording directory turns the tail into a
 * spin loop, which is a worse failure than the poll it replaced.
 */
const TAIL_MIN_WAIT_MS = 50;

/**
 * Waits for the next change to `file`, or for `timeoutMs`, whichever is first.
 * Returns how long it actually waited, so the caller's idle budget stays honest.
 *
 * Watches the DIRECTORY rather than the file: a capture that has not started
 * yet has no file to watch, and ffmpeg replaces its output by rename on some
 * paths — both of which a file-scoped watcher misses entirely.
 */
async function waitForFileChange(file: string, timeoutMs: number, giveUp: AbortSignal): Promise<number> {
  const started = Date.now();
  const target = path.basename(file);
  if (giveUp.aborted) return 0;
  await new Promise<void>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof watchPath> | undefined;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      giveUp.removeEventListener('abort', done);
      try { watcher?.close(); } catch { /* already closed */ }
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    // A disconnected client must not keep the tail asleep for a full step —
    // that is a whole second of a dead response holding a watcher open.
    giveUp.addEventListener('abort', done, { once: true });
    try {
      watcher = watchPath(path.dirname(file), (_event, name) => {
        // `name` is null on some platforms; a wakeup we cannot attribute is
        // still cheaper than sleeping through the write we were waiting for.
        if (name === null || name === undefined || name === target) done();
      });
      watcher.on('error', done);
      watcher.unref?.();
    } catch {
      // No watcher available (network mount, permissions) — the timeout alone
      // degrades this back to polling, which is exactly the old behaviour.
    }
  });
  // The watcher can fire instantly and repeatedly without the file having
  // grown, so the floor is applied AFTER the wait rather than before it —
  // before, it would delay every legitimate append by that much.
  const elapsed = Date.now() - started;
  if (elapsed < TAIL_MIN_WAIT_MS && !giveUp.aborted) {
    await new Promise((resolve) => setTimeout(resolve, TAIL_MIN_WAIT_MS - elapsed));
  }
  return Date.now() - started;
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

  // P1-39 — this was registered inside the loop below, so a long capture
  // attached hundreds of retained closures to the same response and tripped
  // Node's max-listener warning after eleven chunks. One listener, and it must
  // still be able to settle an in-flight pipe: if the client disconnects mid
  // chunk, `res` is destroyed, the pipe stalls on backpressure and the source
  // emits neither 'end' nor 'error', so a promise waiting only on those two
  // never resolves and the stream leaks for the process lifetime.
  let clientGone = false;
  let abortInFlight: (() => void) | undefined;
  const disconnected = new AbortController();
  res.once('close', () => {
    clientGone = true;
    disconnected.abort();
    abortInFlight?.();
  });

  while (!res.writableEnded && !clientGone) {
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
        let settled = false;
        const settle = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          abortInFlight = undefined;
          resolve(ok);
        };
        abortInFlight = () => {
          chunk.destroy();
          settle(false);
        };
        chunk.on('end', () => settle(true));
        chunk.on('error', () => settle(false));
        if (clientGone) {
          abortInFlight();
          return;
        }
        chunk.pipe(res, { end: false });
      });
      if (!wrote || clientGone) break;
      offset = size;
      continue;
    }

    // Nothing new. Stop once the capture has finished and we have drained it,
    // and give up on a capture that produces nothing at all.
    if (!isActive()) break;
    idleFor += await waitForFileChange(file, TAIL_IDLE_STEP_MS, disconnected.signal);
    if (idleFor > 30_000) break;
  }
  res.end();
}

/**
 * Memoised path → artifact-id join for the activity feed.
 *
 * The audit trail stores a relative PATH and the artifact store is keyed by id,
 * so the two have to be joined somewhere. The repository port exposes no
 * lookup-by-path, so the join needs the workspace's artifact rows — and the
 * activity feed is POLLED, which turned a full table read into a per-second
 * cost that grows with the length of the session.
 *
 * The cache is invalidated by a path it has never seen, not only by time: a new
 * capture is exactly the event that makes it stale, and nothing else can add a
 * path. Paths that were absent when the map was built are remembered as absent
 * (their frame was pruned, and pruning is permanent) so a session whose oldest
 * audit rows outlive their frames does not rebuild on every poll — the only
 * case where a time-only cache would have been useless.
 */
const ACTIVITY_JOIN_TTL_MS = 30_000;
const activityJoin = new Map<string, { at: number; byPath: Map<string, string>; absent: Set<string> }>();

async function artifactIdsByPath(
  repo: Container['workspaceArtifactRepo'],
  workspaceId: string,
  wanted: readonly string[],
): Promise<Map<string, string>> {
  const cached = activityJoin.get(workspaceId);
  if (
    cached &&
    Date.now() - cached.at < ACTIVITY_JOIN_TTL_MS &&
    wanted.every((p) => cached.byPath.has(p) || cached.absent.has(p))
  ) {
    return cached.byPath;
  }

  const byPath = new Map<string, string>();
  for (const artifact of await repo.findByWorkspace(workspaceId)) {
    if (artifact.artifactType !== 'computer_screenshot') continue;
    byPath.set(artifact.relativePath.replace(/\\/g, '/'), artifact.id);
  }
  const absent = new Set(wanted.filter((p) => !byPath.has(p)));
  activityJoin.set(workspaceId, { at: Date.now(), byPath, absent });
  // Unbounded growth would make this a leak of its own; workspaces are few and
  // the entries are small, but "few" is not a bound.
  if (activityJoin.size > 64) {
    const oldest = activityJoin.keys().next().value;
    if (oldest !== undefined && oldest !== workspaceId) activityJoin.delete(oldest);
  }
  return byPath;
}

const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'allow_run', 'always_allow', 'deny']),
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
      const cast =
        started.refusal || !parsed.data.screenVideo
          ? { active: false }
          : screenCast.start(
              workspaceId,
              started.outputDir ?? outputDir,
              parsed.data.windowTitle,
              await computerService.screenSize(workspaceId),
            );
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
      const wanted = rows
        .map((r) => r.artifactPath?.replace(/\\/g, '/'))
        .filter((p): p is string => p !== undefined && p !== null);
      const idByPath = await artifactIdsByPath(workspaceArtifactRepo, workspaceId, wanted);
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
      // P1-31 — `findById`, not "load every row for the workspace and scan".
      // A long session holds thousands of artifact rows and this route is hit
      // once per thumbnail. The workspace comparison that the old `.find()` got
      // for free is done explicitly, so a frame from another workspace is still
      // a 404 rather than a leak.
      const found = await workspaceArtifactRepo.findById(artifactId);
      const artifact =
        found && found.workspaceId === workspaceId && found.artifactType === 'computer_screenshot'
          ? found
          : null;
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

      // From the artifact row, not a constant: captures are re-encoded to
      // WebP/JPEG by `screenshotCodec`, and a consumer that trusts the header
      // (Safari, a download, a transcoding proxy) will not sniff past a lie.
      res.setHeader('Content-Type', artifact.mimeType ?? 'image/png');
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
      // Same rule as the index: only frames the driver scoped to a target
      // window may be served. Checked here too, or a client holding a stale
      // index could still pull a full-display grab of the operator's screen.
      if (!(await isWindowScopedTurn(path.join(run, turn)))) {
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
  // W09 — the web client no longer opens this: the preview is a scope on the
  // shared multiplexed connection. It stays for the CLI, `curl` and any client
  // that has not moved, exactly like the single-scope `/api/stream`.
  //
  // What changed underneath is that it no longer runs a filesystem poll of its
  // own. It attaches to the same per-workspace producer the multiplexed path
  // uses, so N watchers cost one poll rather than N (P1-11).
  router.get('/preview/stream', async (req, res, next) => {
    try {
      const workspaceId = idOf(req as Request<WorkspaceIdParams>);
      const workspace = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        return;
      }

      // W08 — this endpoint used to open a stream with no connection slot at
      // all, so the documented invariant "every stream handler releases its
      // slot on close" was vacuously true here: it never acquired one. A tab
      // reload loop could open unbounded preview streams against one workspace.
      const slot = acquireSseSlot('computer', workspaceId);
      if (!slot.ok) {
        res
          .status(503)
          .setHeader('Retry-After', '10')
          .json({
            error: {
              code: 'SSE_CAP_EXCEEDED',
              message: `Max ${slot.cap} concurrent preview streams for this workspace; ${slot.current} open.`,
            },
          });
        return;
      }
      // Registered before the first write, so it survives every exit path
      // below — including the ones that throw into `next`.
      res.once('close', () => slot.release());

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      // P1-11 / L2 — this endpoint ignored `res.write()`'s return value
      // entirely, so a client that stopped reading accumulated frames in Node's
      // writableBuffer without limit. Now a congested socket is DROPPED FROM,
      // not queued to. Which frames survive is the producer's `latest` rule: a
      // window frame is replayed to whoever attaches next, a cursor sample is
      // not, so a slow reader loses pointer motion and never loses the picture.
      let congested = false;
      let droppedWhileCongested = 0;
      res.on('drain', () => {
        congested = false;
      });
      const send = (event: string, data: unknown): void => {
        if (res.writableEnded) return;
        if (congested) {
          droppedWhileCongested += 1;
          return;
        }
        congested = !res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // The wire names predate the scope and are what existing clients listen
      // for, so the kind is mapped back rather than renamed.
      const detach = subscribeEphemeral(
        'computer',
        workspaceId,
        (ev) => send(ev.kind.replace('computer.preview.', ''), ev.payload),
        container.logger,
      );
      res.once('close', () => {
        detach();
        if (droppedWhileCongested > 0) {
          container.logger.info?.('[ComputerPreview] dropped frames to a slow client', {
            workspaceId,
            dropped: droppedWhileCongested,
          });
        }
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
