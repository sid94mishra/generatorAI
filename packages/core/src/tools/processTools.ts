// ────────────────────────────────────────────────────────────────
// processTools — stop the process listening on a local port.
//
// A chat moved between providers can find a dev server the previous agent
// started still holding its port, as a process its own shell did not start.
// Codex's sandbox only signals processes inside it ("kill: Operation not
// permitted"), so the agent that took over could neither restart the server
// nor free the port. The host runs this outside any agent sandbox. It is
// scoped to what a person would do by hand — stop what listens on one port
// (1024 and up), never this app itself — and gated like the other tools that
// change things outside the workspace (`askBeforeActing`): asked in the
// asking modes, run when the chat asks for nothing, refused while planning.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';

const execFileAsync = promisify(execFile);

export const STOP_PORT_LISTENER_TOOL_NAME = 'stop_port_listener';

export interface PortListener {
  pid: number;
  /** The process's command line, as far as the OS tells it. */
  command: string;
}

/** The OS side, injectable for tests. */
export interface ProcessControl {
  listeners(port: number): Promise<PortListener[]>;
  stop(pid: number, force: boolean): Promise<void>;
}

/** How long a stopped process gets to let go of its port before it is killed outright. */
const GRACE_MS = 3_000;
const POLL_MS = 200;

export function buildStopPortListenerTool(
  control: ProcessControl,
  opts: { owner: string; protectedPids: readonly number[]; sleep?: (ms: number) => Promise<void> },
): ToolDefinition {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const protectedPids = new Set(opts.protectedPids);
  return {
    name: STOP_PORT_LISTENER_TOOL_NAME,
    description:
      'Stop the process listening on a local TCP port — a dev server or watcher left running (for example by an ' +
      'earlier session of this chat, or another agent) that your own shell is not allowed to stop. Use it when a ' +
      'port you need is taken or a server you must restart will not stop; check what listens there first. Returns ' +
      'what was stopped.',
    parametersSchema: {
      type: 'object',
      properties: {
        port: { type: 'integer', minimum: 1024, maximum: 65535, description: 'The local TCP port, e.g. 4837.' },
      },
      required: ['port'],
      additionalProperties: false,
    },
    owner: opts.owner,
    handler: async (args: Record<string, unknown>) => {
      const port = args['port'];
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
        return { ok: false, error: 'port must be a whole number from 1024 to 65535.' };
      }
      const found = await control.listeners(port);
      if (found.length === 0) return { ok: true, stopped: [], message: `Nothing is listening on port ${port}.` };
      const own = found.filter((l) => protectedPids.has(l.pid));
      const targets = found.filter((l) => !protectedPids.has(l.pid));
      if (targets.length === 0) {
        return { ok: false, error: `Port ${port} belongs to GeneratorAI itself; it is not stopped.` };
      }
      const failed: string[] = [];
      for (const t of targets) {
        await control.stop(t.pid, false).catch((err: unknown) => failed.push(`${t.pid}: ${errorText(err)}`));
      }
      let left = targets;
      for (let waited = 0; waited < GRACE_MS && left.length > 0; waited += POLL_MS) {
        await sleep(POLL_MS);
        const now = new Set((await control.listeners(port)).map((l) => l.pid));
        left = left.filter((t) => now.has(t.pid));
      }
      for (const t of left) {
        await control.stop(t.pid, true).catch((err: unknown) => failed.push(`${t.pid}: ${errorText(err)}`));
      }
      const stillThere = (await control.listeners(port)).filter((l) => !protectedPids.has(l.pid));
      return {
        ok: stillThere.length === 0,
        stopped: targets.filter((t) => !stillThere.some((s) => s.pid === t.pid)),
        ...(stillThere.length ? { stillListening: stillThere } : {}),
        ...(own.length ? { kept: 'GeneratorAI itself also listens there and was left alone.' } : {}),
        ...(failed.length ? { errors: failed } : {}),
        message: stillThere.length ? `Port ${port} is still in use.` : `Port ${port} is free now.`,
      };
    },
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The real OS: `lsof` (macOS, Linux — `ss` when Linux has no lsof) and PowerShell's `Get-NetTCPConnection` (Windows). */
export function createOsProcessControl(): ProcessControl {
  return {
    async listeners(port) {
      const pids = process.platform === 'win32' ? await windowsListeners(port) : await posixListeners(port);
      const out: PortListener[] = [];
      for (const pid of [...new Set(pids)]) out.push({ pid, command: await commandOf(pid) });
      return out;
    },
    async stop(pid, force) {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    },
  };
}

async function posixListeners(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 10_000 });
    return parsePids(stdout);
  } catch (err) {
    // lsof exits 1 when nothing matches; a missing lsof (some Linux images) falls back to ss.
    if ((err as { code?: unknown }).code === 1) return [];
    if (process.platform !== 'linux') return [];
    try {
      const { stdout } = await execFileAsync('ss', ['-ltnpH', `sport = :${port}`], { timeout: 10_000 });
      return [...stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    } catch {
      return [];
    }
  }
}

async function windowsListeners(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { timeout: 15_000, windowsHide: true },
    );
    return parsePids(stdout).filter((pid) => pid > 4);
  } catch {
    return [];
  }
}

async function commandOf(pid: number): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { timeout: 15_000, windowsHide: true },
      );
      return stdout.trim();
    }
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

function parsePids(stdout: string): number[] {
  return stdout
    .split(/\s+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}
