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

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';

/**
 * The ffmpeg to spawn.
 *
 * Bare `'ffmpeg'` relies on PATH, and a dev server inherits the PATH of the
 * shell that launched it — routinely one that predates the install. The spawn
 * then fails with ENOENT *asynchronously*, so the cast reports itself started
 * and quietly produces no file. Falling back to the usual Windows install roots
 * is what makes video work without relaunching the server.
 */
function resolveFfmpeg(): string {
  if (process.platform !== 'win32') return 'ffmpeg';
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, 'ffmpeg.exe'))) return 'ffmpeg';
  }
  const local = process.env['LOCALAPPDATA'] ?? '';
  for (const root of [path.join(local, 'ffmpeg'), path.join(local, 'Microsoft', 'WinGet', 'Packages')]) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const exe = path.join(root, entry, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'ffmpeg';
}

/**
 * Primary display size in physical pixels, or null off Windows.
 *
 * The driver can report this, but only while it holds a healthy session, and
 * the capture geometry should not depend on that — measured: the driver
 * returned nothing and every recording came out as the whole virtual desktop,
 * 5760x2160 for a 1920x1200 primary, mostly black and 406 MB for one run.
 *
 * Queried per recording rather than cached: docking, a resolution change or a
 * scaling change all move it, and a stale value crops the capture to a corner
 * or leaves black bands around it. Once per recording start is cheap.
 */
function primaryDisplaySize(): { width: number; height: number } | null {
  if (process.platform !== 'win32') return null;
  try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // DPI-aware on purpose: gdigrab addresses physical pixels, and the
          // default (scaled) answer is smaller on any display above 100%,
          // which silently crops the capture to a corner of the screen.
          'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class D{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}\'; [void][D]::SetProcessDPIAware(); Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output ("{0}x{1}" -f $b.Width,$b.Height)',
        ],
        { encoding: 'utf8', timeout: 8_000, windowsHide: true },
      );
    const match = /(\d+)x(\d+)/.exec(out.trim());
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  } catch {
    // Capture the whole desktop rather than fail the cast.
    return null;
  }
}

export interface ScreenCastState {
  active: boolean;
  /** Wall-clock ms at which frame zero was captured — the origin for markers. */
  startedAt?: number;
  file?: string;
  detail?: string;
  /** How many times the capture had to be respawned after ffmpeg died. */
  restarts?: number;
}

interface Cast {
  process: ChildProcess;
  file: string;
  startedAt: number;
  stopping: boolean;
  outputDir: string;
  windowTitle: string | undefined;
  bounds: { width: number; height: number } | null;
  restarts: number;
  detail?: string;
  lastError?: string;
}

export const CAST_FILE = 'screencast.mp4';

/**
 * How many times to respawn ffmpeg after it dies unexpectedly.
 *
 * gdigrab aborts the whole demuxer on the first frame it cannot grab —
 * measured live as `Failed to capture image (error 5)` followed by
 * `Error during demuxing: I/O error`, which is what Windows returns while the
 * secure desktop is up (lock screen, UAC). That is transient, but ffmpeg never
 * retries, so a run that locked once produced a video that stopped minutes
 * before the agent did and nothing said why.
 */
const MAX_RESTARTS = 20;
const RESTART_DELAY_MS = 3_000;

export class ScreenCast {
  private readonly casts = new Map<string, Cast>();

  constructor(private readonly logger: ILogger) {}

  state(workspaceId: string): ScreenCastState {
    const cast = this.casts.get(workspaceId);
    if (!cast) return { active: false };
    return {
      active: !cast.stopping,
      startedAt: cast.startedAt,
      file: cast.file,
      restarts: cast.restarts,
      ...(cast.detail ? { detail: cast.detail } : {}),
    };
  }

  /** Idempotent: a second start for the same workspace returns the running cast. */
  start(
    workspaceId: string,
    outputDir: string,
    windowTitle?: string,
    screen?: { width: number; height: number } | null,
  ): ScreenCastState {
    const existing = this.casts.get(workspaceId);
    if (existing && !existing.stopping) return this.state(workspaceId);
    const bounds = screen ?? primaryDisplaySize();
    return this.spawnCapture(workspaceId, outputDir, windowTitle, bounds, 0);
  }

  private spawnCapture(
    workspaceId: string,
    outputDir: string,
    windowTitle: string | undefined,
    bounds: { width: number; height: number } | null,
    restarts: number,
  ): ScreenCastState {
    // Each respawn writes its own segment: ffmpeg's `-y` would truncate the
    // file it already filled, and appending a second fragmented-MP4 header to
    // the first stream produces a file players stop reading at the seam.
    const file = path.join(outputDir, restarts === 0 ? CAST_FILE : `screencast-${restarts + 1}.mp4`);
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

    // `desktop` means the whole VIRTUAL desktop, so a second monitor is encoded
    // as dead pixels: measured 5760x2160 for a 1920x1200 primary, and a 406 MB
    // file that was mostly black. Bounding it to the main display is what the
    // per-turn frames already show, and what the agent's coordinates refer to.
    const region =
      !windowTitle && bounds
        ? ['-offset_x', '0', '-offset_y', '0', '-video_size', `${bounds.width}x${bounds.height}`]
        : [];

    // `zerolatency` and a 2 s keyframe interval keep the first fragment close
    // behind the action — without them a viewer waits for the first GOP.
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'gdigrab', '-framerate', '15', '-draw_mouse', '1', ...region, '-i', source,
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
      child = spawn(resolveFfmpeg(), args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch (err) {
      this.logger.warn?.(`[ScreenCast] ffmpeg could not start: ${String(err)}`);
      return { active: false, detail: 'ffmpeg is not installed or not on PATH.' };
    }

    const cast: Cast = {
      process: child,
      file,
      startedAt: Date.now(),
      stopping: false,
      outputDir,
      windowTitle,
      bounds,
      restarts,
    };
    this.casts.set(workspaceId, cast);
    try {
      fs.appendFileSync(
        path.join(outputDir, 'screencast.log'),
        `capture region: ${region.length > 0 ? `${bounds?.width}x${bounds?.height}` : 'full virtual desktop (no screen size available)'}\n`,
      );
    } catch {
      // Diagnostics must never take the capture down with them.
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      cast.lastError = text.split('\n').pop();
      this.logger.warn?.(`[ScreenCast] ffmpeg: ${text}`);
      // Beside the video, because a capture that silently produced the wrong
      // geometry or no file at all leaves nothing else to read afterwards.
      try {
        fs.appendFileSync(path.join(outputDir, 'screencast.log'), `${text}\n`);
      } catch {
        // Diagnostics must never take the capture down with them.
      }
    });
    child.on('error', (err) => {
      this.logger.warn?.(`[ScreenCast] ffmpeg failed: ${err.message}`);
      this.casts.delete(workspaceId);
    });
    child.on('exit', (code) => {
      this.logger.info?.(`[ScreenCast] capture ended for ${workspaceId} (code ${code ?? 0})`);
      if (this.casts.get(workspaceId) !== cast) return;
      this.casts.delete(workspaceId);
      if (cast.stopping) return;
      this.scheduleRestart(workspaceId, cast);
    });

    this.logger.info?.(`[ScreenCast] capturing to ${file}`);
    return this.state(workspaceId);
  }

  /**
   * Bring the capture back after ffmpeg died on its own.
   *
   * The cast is kept in the map while the timer runs so `state()` still reports
   * `active` — the panel would otherwise flip to "recording stopped" for three
   * seconds on every lock-screen blip.
   */
  private scheduleRestart(workspaceId: string, dead: Cast): void {
    const detail = dead.lastError ?? 'the screen capture ended unexpectedly';
    if (dead.restarts >= MAX_RESTARTS) {
      this.logger.warn?.(
        `[ScreenCast] giving up on ${workspaceId} after ${dead.restarts} restarts: ${detail}`,
      );
      return;
    }
    const placeholder: Cast = { ...dead, stopping: false, detail: `recovering: ${detail}` };
    this.casts.set(workspaceId, placeholder);
    setTimeout(() => {
      // A stop() during the delay wins: it marks the placeholder stopping.
      if (this.casts.get(workspaceId) !== placeholder || placeholder.stopping) return;
      this.casts.delete(workspaceId);
      this.logger.info?.(`[ScreenCast] restarting capture for ${workspaceId} (${detail})`);
      this.spawnCapture(
        workspaceId,
        dead.outputDir,
        dead.windowTitle,
        dead.bounds,
        dead.restarts + 1,
      );
    }, RESTART_DELAY_MS).unref?.();
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

    // A cast waiting to be respawned has no live ffmpeg to drain.
    if (cast.process.exitCode !== null || cast.process.signalCode !== null) {
      this.casts.delete(workspaceId);
      return { active: false, startedAt: cast.startedAt, file: cast.file, restarts: cast.restarts };
    }

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
    return { active: false, startedAt: cast.startedAt, file: cast.file, restarts: cast.restarts };
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.casts.keys()].map((id) => this.stop(id)));
  }
}

/**
 * The segment to play for a run.
 *
 * A capture that had to be respawned mid-run leaves `screencast.mp4` plus
 * `screencast-2.mp4`, `-3` and so on. The newest one is the live edge, which
 * is what both the tail-stream and the finished playback want.
 */
export function screenCastFile(outputDir: string): string {
  let newest = path.join(outputDir, CAST_FILE);
  for (let n = 2; ; n++) {
    const next = path.join(outputDir, `screencast-${n}.mp4`);
    if (!fs.existsSync(next)) return newest;
    newest = next;
  }
}
