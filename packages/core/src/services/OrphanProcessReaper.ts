// ────────────────────────────────────────────────────────────────
// OrphanProcessReaper — kill grandchildren the last process left behind.
//
// On Windows, ending a process does not end its descendants. When a Claude
// CLI session is closed (or the server is killed), the `rg` file scans the
// CLI had started keep running with a dead parent. Measured on one developer
// machine: sixty-plus orphaned `rg` processes, 0–82 MB each, dating back ten
// days — invisible in the app, real in the task manager, and attributed to
// "the app uses too much memory".
//
// The SDK does not expose the CLI's pid, so the leak cannot be closed at the
// moment we close a session. It CAN be closed at boot: list processes, keep
// the ones that (a) are ripgrep or Claude CLI invocations, (b) have no living
// parent, and (c) name one of THIS installation's directories on their
// command line. The third test is what keeps this from touching anything
// else on the machine — an orphan scanning another tool's directory is not
// ours to kill. Selection is a pure function so it is tested without spawning
// anything; the OS calls are injectable and default to PowerShell + taskkill.
//
// Linux/macOS re-parent orphans to init and the same scans exit on their own
// when their stdout closes, so this is Windows-only by default.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import type { ILogger } from '@generatorai/shared';

export interface OsProcess {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string;
}

export interface OrphanProcessReaperOptions {
  /** Directories this installation owns (artifacts, workspaces, data dir). */
  ownedDirs: string[];
  logger: ILogger;
  listProcesses?: () => Promise<OsProcess[]>;
  killProcess?: (pid: number) => Promise<void>;
  platform?: NodeJS.Platform;
  selfPid?: number;
}

export interface ReapSummary {
  scanned: number;
  candidates: number;
  killed: number;
  failed: number;
  skipped: 'platform' | 'disabled' | null;
}

const RG_INVOCATION = /(^|[\\/\s"'])rg(\.exe)?["']?(\s|$)/i;
const CLAUDE_SESSION = /--output-format\s+stream-json/i;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Which processes to kill. Exported for tests.
 *
 * A process qualifies only when ALL hold: it is an `rg` scan or a Claude CLI
 * session; its parent pid is not in the list (dead); its command line names one
 * of `ownedDirs`; and it is neither this process nor an ancestor of it.
 */
export function selectOrphans(processes: OsProcess[], ownedDirs: string[], selfPid: number): OsProcess[] {
  // This process is alive whatever the listing says (it can race a fresh spawn).
  const alive = new Set([...processes.map((p) => p.pid), selfPid]);
  const owned = ownedDirs.map(normalizePath).filter((d) => d.length > 0);
  if (owned.length === 0) return [];

  // Never kill our own ancestry, whatever its command line says.
  const protectedPids = new Set<number>([selfPid]);
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  let cursor = byPid.get(selfPid);
  while (cursor && !protectedPids.has(cursor.parentPid) && cursor.parentPid > 0) {
    protectedPids.add(cursor.parentPid);
    cursor = byPid.get(cursor.parentPid);
  }

  return processes.filter((p) => {
    if (protectedPids.has(p.pid)) return false;
    const cmd = p.commandLine ?? '';
    const isRg = RG_INVOCATION.test(cmd) || /^rg(\.exe)?$/i.test(p.name);
    const isClaudeSession = /^claude(\.exe)?$/i.test(p.name) && CLAUDE_SESSION.test(cmd);
    if (!isRg && !isClaudeSession) return false;
    if (alive.has(p.parentPid)) return false;
    const norm = normalizePath(cmd);
    return owned.some((dir) => norm.includes(dir));
  });
}

export class OrphanProcessReaper {
  private readonly listProcesses: () => Promise<OsProcess[]>;
  private readonly killProcess: (pid: number) => Promise<void>;
  private readonly platform: NodeJS.Platform;
  private readonly selfPid: number;

  constructor(private readonly opts: OrphanProcessReaperOptions) {
    this.platform = opts.platform ?? process.platform;
    this.selfPid = opts.selfPid ?? process.pid;
    this.listProcesses = opts.listProcesses ?? (() => listWindowsProcesses());
    this.killProcess = opts.killProcess ?? ((pid) => taskkillTree(pid));
  }

  async reap(): Promise<ReapSummary> {
    const summary: ReapSummary = { scanned: 0, candidates: 0, killed: 0, failed: 0, skipped: null };
    if (this.platform !== 'win32') {
      summary.skipped = 'platform';
      return summary;
    }
    let processes: OsProcess[];
    try {
      processes = await this.listProcesses();
    } catch (err) {
      this.opts.logger.warn(`[OrphanReaper] could not list processes: ${err instanceof Error ? err.message : String(err)}`);
      return summary;
    }
    summary.scanned = processes.length;
    const orphans = selectOrphans(processes, this.opts.ownedDirs, this.selfPid);
    summary.candidates = orphans.length;
    for (const p of orphans) {
      try {
        await this.killProcess(p.pid);
        summary.killed += 1;
      } catch (err) {
        summary.failed += 1;
        this.opts.logger.warn(`[OrphanReaper] failed to kill ${p.name} pid=${p.pid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (summary.candidates > 0) {
      this.opts.logger.info(
        `[OrphanReaper] killed ${summary.killed}/${summary.candidates} orphaned child process(es) left by a previous run` +
          (summary.failed > 0 ? ` (${summary.failed} failed)` : ''),
      );
    }
    return summary;
  }
}

/** PowerShell process listing; bounded so a wedged shell cannot hold boot. */
async function listWindowsProcesses(timeoutMs = 15_000): Promise<OsProcess[]> {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2';
  const output = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], timeoutMs);
  const parsed = JSON.parse(output.trim() || '[]') as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((r) => r as { ProcessId?: number; ParentProcessId?: number; Name?: string; CommandLine?: string | null })
    .filter((r) => typeof r.ProcessId === 'number')
    .map((r) => ({
      pid: r.ProcessId!,
      parentPid: r.ParentProcessId ?? 0,
      name: r.Name ?? '',
      commandLine: r.CommandLine ?? '',
    }));
}

async function taskkillTree(pid: number): Promise<void> {
  await runCapture('taskkill', ['/pid', String(pid), '/t', '/f'], 10_000);
}

function runCapture(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited ${code}: ${err.trim().slice(0, 200)}`));
    });
  });
}
