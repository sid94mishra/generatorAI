// ────────────────────────────────────────────────────────────────
// ScreenCast — a live-playable screen recording of a computer-use run.
//
// The driver records video too, but with `-movflags +faststart`: the moov
// atom is written only when ffmpeg exits, so the file is unplayable until the
// run is over and then rewritten wholesale. That rules out watching along.
//
// This runs the same tool with fragmented-MP4 flags instead, so the file is
// readable while it grows — verified with ffprobe reporting a valid stream and
// a rising duration mid-write. One capture serves both the live feed and the
// replay afterwards, so the driver is left to do the part only it can: the
// per-turn window captures and the accessibility trace.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';

export interface ScreenCastState {
  active: boolean;
  /** Wall-clock ms at which frame zero was captured — the origin for markers. */
  startedAt?: number;
  file?: string;
  detail?: string;
}

interface Cast {
  process: ChildProcess;
  file: string;
  startedAt: number;
  stopping: boolean;
}

const CAST_FILE = 'screencast.mp4';

export class ScreenCast {
  private readonly casts = new Map<string, Cast>();

  constructor(private readonly logger: ILogger) {}

  state(workspaceId: string): ScreenCastState {
    const cast = this.casts.get(workspaceId);
    if (!cast) return { active: false };
    return { active: !cast.stopping, startedAt: cast.startedAt, file: cast.file };
  }

  /** Idempotent: a second start for the same workspace returns the running cast. */
  start(workspaceId: string, outputDir: string, windowTitle?: string): ScreenCastState {
    const existing = this.casts.get(workspaceId);
    if (existing && !existing.stopping) return this.state(workspaceId);

    const file = path.join(outputDir, CAST_FILE);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch {
      // The recorder created it a moment ago; a race here is not a failure.
    }

    // Capturing the target window rather than the desktop keeps the frame on
    // what the agent is driving — a 4K desktop is mostly black bars and other
    // people's windows. Falls back to the desktop when no window is named,
    // which is the case before the agent has read anything.
    const source = windowTitle ? `title=${windowTitle}` : 'desktop';

    // `zerolatency` and a 2 s keyframe interval keep the first fragment close
    // behind the action — without them a viewer waits for the first GOP.
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'gdigrab', '-framerate', '15', '-draw_mouse', '1', '-i', source,
      // Even dimensions: libx264 rejects an odd width or height, and a window
      // can be any size the user dragged it to.
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p', '-g', '30',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', file,
    ];

    let child: ChildProcess;
    try {
      child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch (err) {
      this.logger.warn?.(`[ScreenCast] ffmpeg could not start: ${String(err)}`);
      return { active: false, detail: 'ffmpeg is not installed or not on PATH.' };
    }

    const cast: Cast = { process: child, file, startedAt: Date.now(), stopping: false };
    this.casts.set(workspaceId, cast);

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.warn?.(`[ScreenCast] ffmpeg: ${text}`);
    });
    child.on('error', (err) => {
      this.logger.warn?.(`[ScreenCast] ffmpeg failed: ${err.message}`);
      this.casts.delete(workspaceId);
    });
    child.on('exit', (code) => {
      this.logger.info?.(`[ScreenCast] capture ended for ${workspaceId} (code ${code ?? 0})`);
      this.casts.delete(workspaceId);
    });

    this.logger.info?.(`[ScreenCast] capturing to ${file}`);
    return this.state(workspaceId);
  }

  /**
   * Asks ffmpeg to finish, then waits for it.
   *
   * `q` on stdin rather than a kill: ffmpeg buffers the tail of the stream and
   * a killed process loses it, which shows up as a recording that stops a few
   * seconds before the run did.
   */
  async stop(workspaceId: string): Promise<ScreenCastState> {
    const cast = this.casts.get(workspaceId);
    if (!cast) return { active: false };
    cast.stopping = true;

    const finished = new Promise<void>((resolve) => {
      const done = (): void => resolve();
      cast.process.once('exit', done);
      // A capture that will not exit must not hold the request open.
      setTimeout(() => {
        if (!cast.process.killed) cast.process.kill();
        resolve();
      }, 5_000).unref?.();
    });

    try {
      cast.process.stdin?.write('q');
      cast.process.stdin?.end();
    } catch {
      cast.process.kill();
    }
    await finished;
    this.casts.delete(workspaceId);
    return { active: false, startedAt: cast.startedAt, file: cast.file };
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.casts.keys()].map((id) => this.stop(id)));
  }
}

export function screenCastFile(outputDir: string): string {
  return path.join(outputDir, CAST_FILE);
}
