// ────────────────────────────────────────────────────────────────
// Harness child-process reaping — P0-14 / X-22.
//
// Measured on a live development machine: 24 orphaned `claude.exe` processes,
// the oldest 7 days old, ~870 MB resident. Claude spawns one CLI per turn and
// nothing cleans up when the server is killed rather than shut down.
//
// We do NOT control the spawn. Both vendor SDKs start their CLI internally, so
// there is no pid to record at spawn time and no way to inject a cooperating
// heartbeat into a binary we did not write. The mechanism therefore lives
// entirely on the parent side, in two halves:
//
//   1. PREVENTION (the durable fix). On shutdown — including SIGINT/SIGTERM —
//      we enumerate our own descendants and kill the tree. A server that exits
//      through a handled path and REACHES this step leaves nothing behind. It
//      is not unconditional: it runs inside the shutdown force-exit budget, and
//      enumeration alone costs ~1 s on Windows, so a shutdown that hits the
//      timeout still leaks. Recovery exists because of that.
//
//   2. RECOVERY (for SIGKILL, power loss, and anything prevention missed).
//      While running, the server maintains a small liveness record containing
//      its pid, boot id, start time and a periodically refreshed `lastSeenAt`.
//      On the next boot, any record that is not ours describes a server that
//      died uncleanly. We enumerate processes once and terminate only those
//      whose parent pid is that dead server AND whose own creation time falls
//      inside the window that server was alive.
//
// Creation time is what makes the predicate safe, so both platforms must supply
// it: Windows from `Win32_Process.CreationDate`, POSIX from `ps -o etime` (see
// `parseEtimeMs` for why not `lstart`). A row without one is never killed.
//
// The predicate deliberately never matches on image name alone. The user runs
// their own `claude` and `copilot` sessions on this machine; killing those
// would be far worse than leaking a process. Anything we cannot positively
// attribute to a dead server of ours is left running.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Identifies this server process across restarts. Stable for the process lifetime. */
export const SPAWN_BOOT_ID = randomUUID();

/** Env var name carrying the boot id into every harness child. */
export const SPAWN_MARKER_ENV = 'GENERATORAI_SPAWN_MARKER';
/** Env var name carrying the spawning server's pid into every harness child. */
export const PARENT_PID_ENV = 'GENERATORAI_PARENT_PID';

/** How often the liveness record's `lastSeenAt` is refreshed. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Slack added to `lastSeenAt` when deciding whether a child was created during
 * a dead server's lifetime. Covers the gap between the final heartbeat and the
 * actual death, plus clock granularity.
 */
const CREATION_WINDOW_SLACK_MS = 2 * HEARTBEAT_INTERVAL_MS;

/** Records older than this are ignored entirely — pid reuse becomes likely. */
const RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Longest attribution window we will accept, regardless of what a record says.
 *
 * The window is `[startedAt, lastSeenAt + slack]`, and it is the ONLY thing
 * standing between "a child of a dead pid" and "the user's own `claude` session
 * whose launching shell has since exited, leaving it reparented onto a reused
 * pid". A server that ran for a week produces a week-wide window, inside which
 * a coincidental pid match is no longer improbable. Beyond this bound we refuse
 * rather than widen.
 */
const MAX_ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServerLivenessRecord {
  pid: number;
  bootId: string;
  startedAt: number;
  lastSeenAt: number;
}

export interface ReapResult {
  /** Stale server records examined. */
  recordsInspected: number;
  terminated: Array<{ pid: number; name: string }>;
  skipped: Array<{ pid: number; name: string; reason: string }>;
}

export interface ReapLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
  /** Epoch-ms creation time, or undefined when the platform did not report one. */
  createdAt?: number;
}

function registryDir(): string {
  return resolve(
    process.env['GENERATORAI_CHILD_REGISTRY_DIR'] ??
      join(homedir(), '.generatorai', 'children'),
  );
}

function recordPath(bootId: string): string {
  return join(registryDir(), `server-${bootId}.json`);
}

// ── Process enumeration ─────────────────────────────────────────────────────

/**
 * Snapshot every process on the machine. Called at most twice per server
 * lifetime (boot reap, shutdown tree-kill), never on a timer — the Windows
 * implementation costs roughly a second and has no business on a hot path.
 *
 * Returns an empty list rather than throwing: failing to enumerate must degrade
 * to "reap nothing", never to a failed boot.
 */
async function snapshotProcesses(): Promise<ProcessRow[]> {
  try {
    if (process.platform === 'win32') return await snapshotWindows();
    return await snapshotPosix();
  } catch {
    return [];
  }
}

async function snapshotWindows(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress',
    ],
    { timeout: 20_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed: unknown = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: ProcessRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const pid = Number(r['ProcessId']);
    const ppid = Number(r['ParentProcessId']);
    const name = typeof r['Name'] === 'string' ? r['Name'] : '';
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || name === '') continue;
    // ConvertTo-Json renders a CIM DateTime as "/Date(1699999999999)/".
    let createdAt: number | undefined;
    const created = r['CreationDate'];
    if (typeof created === 'string') {
      const epoch = /\/Date\((\d+)/.exec(created);
      createdAt = epoch ? Number(epoch[1]) : Date.parse(created) || undefined;
    }
    out.push({ pid, ppid, name, createdAt });
  }
  return out;
}

/**
 * Parse `ps` `etime` — elapsed wall time since the process started, in the
 * POSIX-mandated `[[DD-]hh:]mm:ss` form. This is the portable route to a
 * creation time: `lstart` formats vary by locale and platform, `/proc` does not
 * exist on macOS, and `-o start` truncates to a date once a process is a day
 * old. Returns milliseconds of age, or undefined if the field is unparseable.
 */
export function parseEtimeMs(raw: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(raw.trim());
  if (!m) return undefined;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1_000;
}

async function snapshotPosix(): Promise<ProcessRow[]> {
  // `etime` rather than `lstart`: see `parseEtimeMs`. Without a creation time
  // the reaper refuses to act, so this field is what makes recovery work at all
  // on macOS and Linux.
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,etime=,comm='], {
    timeout: 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const sampledAt = Date.now();
  const out: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const ageMs = parseEtimeMs(m[3] ?? '');
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: m[4] ?? '',
      // `etime` has one-second resolution, so this is accurate to ±1s. The
      // attribution window carries a minute of slack, so that is immaterial.
      ...(ageMs === undefined ? {} : { createdAt: sampledAt - ageMs }),
    });
  }
  return out;
}

function terminate(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

type Liveness = 'alive' | 'gone' | 'not-ours';

function liveness(pid: number): Liveness {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    // EPERM means the pid exists but belongs to another user. Not ours to touch.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM' ? 'not-ours' : 'gone';
  }
}

/** True when the pid is running and signallable by us. */
function isAlive(pid: number): boolean {
  return liveness(pid) !== 'gone';
}

/**
 * Every field a record contributes to the kill decision must be validated
 * before it is used. `startedAt` in particular: it is the lower bound of the
 * attribution window, and `x < undefined` is `false`, so an absent value does
 * not narrow the window — it removes it, and every child of that pid becomes a
 * candidate at any age. The file is JSON on disk and can be truncated, written
 * by an older build, or hand-edited.
 */
export function isUsableRecord(record: ServerLivenessRecord, now: number): boolean {
  if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
  if (!Number.isFinite(record.lastSeenAt) || !Number.isFinite(record.startedAt)) return false;
  if (record.startedAt <= 0 || record.startedAt > record.lastSeenAt) return false;
  if (now - record.lastSeenAt > RECORD_MAX_AGE_MS) return false;
  const window = record.lastSeenAt + CREATION_WINDOW_SLACK_MS - record.startedAt;
  return window <= MAX_ATTRIBUTION_WINDOW_MS;
}

// ── Liveness record ─────────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Begin publishing this server's liveness record. Idempotent. The timer is
 * unref'd so it can never hold the event loop open.
 */
export function startChildReaperHeartbeat(): void {
  if (heartbeatTimer) return;
  const startedAt = Date.now() - Math.floor(process.uptime() * 1000);
  const write = (): void => {
    try {
      mkdirSync(registryDir(), { recursive: true });
      const record: ServerLivenessRecord = {
        pid: process.pid,
        bootId: SPAWN_BOOT_ID,
        startedAt,
        lastSeenAt: Date.now(),
      };
      // Temp-and-rename: a truncate-then-write torn by a crash leaves a record
      // that parses but whose `startedAt` is gone, which is precisely the input
      // `isUsableRecord` exists to reject. Cheaper to make it impossible.
      const target = recordPath(SPAWN_BOOT_ID);
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(record), 'utf8');
      renameSync(tmp, target);
    } catch {
      /* bookkeeping only — never fail a boot over this */
    }
  };
  write();
  heartbeatTimer = setInterval(write, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

/** Stop the heartbeat and drop our record. Call from the shutdown path. */
export function stopChildReaperHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  try {
    rmSync(recordPath(SPAWN_BOOT_ID), { force: true });
  } catch {
    /* bookkeeping only */
  }
}

// ── Prevention: kill our own tree on the way out ────────────────────────────

/**
 * Terminate every descendant of this process, deepest first.
 *
 * This is the half that actually removes the orphan class: a server that exits
 * through any handled path leaves nothing running.
 *
 * The snapshot takes seconds to produce, and on Windows `terminate` is
 * `taskkill /T /F` — which kills a pid AND everything under it. Between the
 * snapshot and the kill, a pid can exit and be reused; the enumerator we spawn
 * to take the snapshot is itself guaranteed to be in that state, because we
 * awaited its exit. So every pid is re-checked for liveness immediately before
 * it is signalled. That narrows the window to microseconds rather than seconds;
 * it does not close it, which is why the walk is descendants-only.
 */
export async function killOwnDescendants(logger?: ReapLogger): Promise<number> {
  const rows = await snapshotProcesses();
  if (rows.length === 0) return 0;

  const byParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.ppid);
    if (siblings) siblings.push(row);
    else byParent.set(row.ppid, [row]);
  }

  const ordered: ProcessRow[] = [];
  const seen = new Set<number>([process.pid]);
  const walk = (pid: number): void => {
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue; // cycle guard
      seen.add(child.pid);
      walk(child.pid);
      ordered.push(child); // post-order: leaves first
    }
  };
  walk(process.pid);

  let killed = 0;
  const killedNames: string[] = [];
  for (const proc of ordered) {
    if (liveness(proc.pid) !== 'alive') continue;
    terminate(proc.pid);
    killed += 1;
    killedNames.push(proc.name);
  }
  if (killed > 0) {
    logger?.info?.('[ChildReaper] terminated own descendants on shutdown', {
      count: killed,
      inSnapshot: ordered.length,
      // Names, not full command lines (a snapshot row carries no cmdline) —
      // enough to tell "a leftover shell" from "a leftover crash-handler"
      // from "a leftover browser" when this shows up in production logs.
      names: killedNames,
    });
  }
  return killed;
}

// ── Recovery: reap children of a server that died uncleanly ─────────────────

/**
 * Injection seam. Production passes nothing; tests supply a synthetic process
 * table and a recording `terminate` so the KILL decision can be exercised
 * without spawning anything. The refusal paths are only half the predicate.
 */
export interface ReapDeps {
  snapshot?: () => Promise<ProcessRow[]>;
  terminate?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
  now?: () => number;
}

export async function reapOrphanedHarnessChildren(
  logger?: ReapLogger,
  deps: ReapDeps = {},
): Promise<ReapResult> {
  const takeSnapshot = deps.snapshot ?? snapshotProcesses;
  const kill = deps.terminate ?? terminate;
  const alive = deps.isAlive ?? isAlive;
  const now = deps.now ?? Date.now;

  const result: ReapResult = { recordsInspected: 0, terminated: [], skipped: [] };
  const dir = registryDir();

  let files: string[];
  try {
    mkdirSync(dir, { recursive: true });
    files = readdirSync(dir).filter((f) => f.startsWith('server-') && f.endsWith('.json'));
  } catch {
    return result;
  }

  // Paired with its file so the record is removed only AFTER it has been acted
  // on. Deleting first meant one failed enumeration — a PowerShell policy
  // block, the 20 s timeout on a loaded machine — permanently orphaned that
  // server's children, destroying recovery with the code meant to perform it.
  const stale: Array<{ record: ServerLivenessRecord; file: string }> = [];
  for (const file of files) {
    const full = join(dir, file);
    let record: ServerLivenessRecord;
    try {
      record = JSON.parse(readFileSync(full, 'utf8')) as ServerLivenessRecord;
    } catch {
      rmSync(full, { force: true });
      continue;
    }
    if (record.bootId === SPAWN_BOOT_ID) continue;
    result.recordsInspected += 1;

    if (!isUsableRecord(record, now())) {
      rmSync(full, { force: true });
      continue;
    }
    // A live pid means that server is still running (a second instance, or the
    // pid was reused). Either way it is not ours to clean up after.
    if (alive(record.pid)) continue;

    stale.push({ record, file: full });
  }

  if (stale.length === 0) return result;

  const rows = await takeSnapshot();
  if (rows.length === 0) {
    // Records deliberately left in place: the next boot retries.
    logger?.warn?.('[ChildReaper] could not enumerate processes — skipping reap', {
      staleServers: stale.length,
    });
    return result;
  }

  for (const { record, file } of stale) {
    const windowStart = record.startedAt;
    const windowEnd = record.lastSeenAt + CREATION_WINDOW_SLACK_MS;

    for (const proc of rows) {
      if (proc.ppid !== record.pid) continue;
      if (proc.pid === process.pid) continue;

      // Without a creation time we cannot rule out that the dead server's pid
      // was reused and this process belongs to its new owner. Refusing here
      // costs a leaked process; guessing costs the user their own session.
      if (proc.createdAt === undefined) {
        result.skipped.push({
          pid: proc.pid,
          name: proc.name,
          reason: 'no creation time available to confirm attribution',
        });
        continue;
      }
      if (proc.createdAt < windowStart || proc.createdAt > windowEnd) {
        result.skipped.push({
          pid: proc.pid,
          name: proc.name,
          reason: "created outside the dead server's lifetime — pid was reused",
        });
        continue;
      }
      // Same race as `killOwnDescendants`: the snapshot is seconds old.
      if (!alive(proc.pid)) continue;

      kill(proc.pid);
      result.terminated.push({ pid: proc.pid, name: proc.name });
    }
    rmSync(file, { force: true });
  }

  if (result.terminated.length > 0 || result.skipped.length > 0) {
    logger?.info?.('[ChildReaper] boot reap complete', {
      staleServers: stale.length,
      terminated: result.terminated,
      skipped: result.skipped,
    });
  }
  return result;
}
