// ────────────────────────────────────────────────────────────────
// Finding and running the Tailscale CLI (D-123).
//
// Always an argument array to `spawn` with `shell: false`: nothing the user
// or the tailnet controls is ever parsed by a shell. Every call has a
// timeout, because `tailscale serve` WAITS (prints a link, then blocks) when
// HTTPS still has to be enabled for the tailnet.
//
// Where the CLI lives:
//   GENERATORAI_TAILSCALE_CLI   explicit path (a `.js`/`.mjs` file is run with
//                               this Node — the integration test's fake CLI on
//                               Windows, where a script cannot be spawned bare)
//   PATH                        `tailscale` (`tailscale.exe` on Windows)
//   macOS                       /Applications/Tailscale.app/Contents/MacOS/Tailscale
//                               (the App Store and standalone apps; the CLI is
//                               not on PATH unless the user installed it)
//   Windows                     %ProgramFiles%\Tailscale\tailscale.exe
//   Linux                       /usr/bin/tailscale, /usr/sbin/tailscale,
//                               /usr/local/bin/tailscale, /snap/bin/tailscale
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import * as path from 'node:path';

/** HTTPS port `tailscale serve` listens on for this machine's ts.net name. */
export const TAILSCALE_HTTPS_PORT = 443;

export interface CliLocation {
  /** Program handed to `spawn`. */
  command: string;
  /** Leading arguments (the script, when the CLI is a Node script). */
  prefix: string[];
  /** What the UI shows. */
  path: string;
}

export interface LocateInput {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Test seam: does this file exist and can it be executed? */
  isExecutable?: (file: string) => boolean;
  nodePath?: string;
}

function defaultIsExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Candidate paths in the order they are tried. */
export function tailscaleCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const exe = platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  const pathVar = env['PATH'] ?? env['Path'] ?? '';
  const fromPath = pathVar
    .split(platform === 'win32' ? ';' : ':')
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map((dir) => pathApi.join(dir, exe));
  const known: string[] =
    platform === 'darwin'
      ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']
      : platform === 'win32'
        ? [
            pathApi.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
            pathApi.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
          ]
        : ['/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale', '/snap/bin/tailscale'];
  return [...new Set([...fromPath, ...known])];
}

/** The Tailscale CLI on this machine, or null when it is not installed. */
export function locateTailscale(input: LocateInput = {}): CliLocation | null {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const isExecutable = input.isExecutable ?? defaultIsExecutable;
  const override = env['GENERATORAI_TAILSCALE_CLI']?.trim();
  if (override) {
    if (!isExecutable(override) && !/\.(?:c|m)?js$/i.test(override)) return null;
    return /\.(?:c|m)?js$/i.test(override)
      ? { command: input.nodePath ?? process.execPath, prefix: [override], path: override }
      : { command: override, prefix: [], path: override };
  }
  for (const candidate of tailscaleCandidates(platform, env)) {
    if (isExecutable(candidate)) return { command: candidate, prefix: [], path: candidate };
  }
  return null;
}

// ── Argument builders (one place, unit-tested) ─────────────────────

export function statusArgs(): string[] {
  return ['status', '--json'];
}

export function serveStatusArgs(): string[] {
  return ['serve', 'status', '--json'];
}

/** The loopback target `tailscale serve` proxies to. */
export function serveTarget(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${port}`);
  return `http://127.0.0.1:${port}`;
}

/** `tailscale serve --bg --https=443 http://127.0.0.1:<port>` — background, survives the CLI exiting. */
export function serveOnArgs(port: number): string[] {
  return ['serve', '--bg', `--https=${TAILSCALE_HTTPS_PORT}`, serveTarget(port)];
}

/** `tailscale serve --https=443 off` — removes only this node's 443 root handler. */
export function serveOffArgs(): string[] {
  return ['serve', `--https=${TAILSCALE_HTTPS_PORT}`, 'off'];
}

// ── Running ────────────────────────────────────────────────────────

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The program could not be started at all. */
  spawnError: string | null;
}

export type TailscaleRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<CliResult>;

const MAX_OUTPUT = 512 * 1024;

export function createTailscaleRunner(location: CliLocation, env: NodeJS.ProcessEnv = process.env): TailscaleRunner {
  return (args, options = {}) =>
    new Promise<CliResult>((resolve) => {
      const timeoutMs = options.timeoutMs ?? 10_000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const finish = (result: Omit<CliResult, 'stdout' | 'stderr' | 'timedOut'>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, stdout, stderr, timedOut });
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(location.command, [...location.prefix, ...args], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...env, ELECTRON_RUN_AS_NODE: env['ELECTRON_RUN_AS_NODE'] ?? (location.prefix.length > 0 ? '1' : undefined) },
        });
      } catch (err) {
        resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // A CLI that ignores SIGTERM must not hold the request forever.
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
            finish({ code: null, spawnError: null });
          }
        }, 2_000).unref?.();
      }, timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
      });
      child.once('error', (err) => finish({ code: null, spawnError: err.message }));
      child.once('close', (code) => finish({ code, spawnError: null }));
    });
}
