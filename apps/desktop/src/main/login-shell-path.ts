// ────────────────────────────────────────────────────────────────
// The PATH a GUI launch does not get.
//
// Started from a terminal, the app inherits the user's shell environment and
// everything works. Started the way users actually start it — Finder, the
// Dock, Spotlight, a Linux desktop launcher — it inherits the session's bare
// PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS). The embedded server and
// every agent under it then cannot find what lives in `/opt/homebrew/bin`,
// `/usr/local/bin`, `~/.local/bin`, an nvm/fnm/volta shim directory, …:
//
//   • the Claude Code CLI (`~/.local/bin/claude`) → provider "not installed"
//   • `node` / `npm` / `pnpm` → the agent's own `npm test` is "command not found"
//   • `gh`, a Homebrew `git`, `code` for "Open in editor"
//
// It is invisible in development, because development starts from a terminal.
// Reproduced by launching with that bare PATH: the unpackaged app could not
// even start its server (`node` not found).
//
// This is a genuine OS difference, handled once, here. Windows GUI processes
// receive the full user PATH from the registry, so there it is a no-op.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const START = '__GAI_ENV_START__';
const END = '__GAI_ENV_END__';

/** Pull `PATH` out of `env` output wrapped in our markers, ignoring rc-file noise. */
export function parsePathFromEnvOutput(stdout: string): string | null {
  const from = stdout.lastIndexOf(START);
  const to = stdout.lastIndexOf(END);
  if (from < 0 || to < from) return null;
  for (const line of stdout.slice(from + START.length, to).split(/\r?\n/)) {
    if (line.startsWith('PATH=')) {
      const value = line.slice('PATH='.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * `preferred` first (the order the user's shell set up), then anything only
 * the current PATH has, then well-known tool directories that exist — the
 * safety net for a shell that could not be asked.
 */
export function mergePathLists(
  preferred: string | null,
  current: string | undefined,
  fallbacks: readonly string[],
  delimiter: string = path.delimiter,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...(preferred ?? '').split(delimiter), ...(current ?? '').split(delimiter), ...fallbacks]) {
    const dir = entry.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(delimiter);
}

/** Tool directories worth having even when the login shell cannot be asked. */
export function wellKnownToolDirs(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return [];
  const dirs = [
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : ['/home/linuxbrew/.linuxbrew/bin', '/snap/bin']),
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, 'bin'),
  ];
  return dirs.filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });
}

/** Ask the user's login shell for its PATH. `null` on Windows, timeout or failure. */
export function readLoginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  timeoutMs = 4_000,
): Promise<string | null> {
  if (platform === 'win32') return Promise.resolve(null);
  const shell = env['SHELL'] || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return new Promise((resolve) => {
    try {
      execFile(
        shell,
        // Interactive + login so rc files that set PATH (nvm, fnm, brew
        // shellenv) run. `command env` also works in fish, where `$PATH` is a
        // list and would not survive string interpolation.
        ['-ilc', `echo ${START}; command env; echo ${END}`],
        {
          timeout: timeoutMs,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          // Keep plugin managers from doing network work on our startup path.
          env: { ...env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' },
        },
        (err, stdout) => resolve(err && !stdout ? null : parsePathFromEnvOutput(String(stdout ?? ''))),
      );
    } catch {
      resolve(null);
    }
  });
}

let repaired: Promise<void> | null = null;

/**
 * Make `process.env.PATH` what the user's terminal would have — once. Every
 * child the app starts afterwards (the embedded server, and through it each
 * agent CLI and shell command) inherits it. Never throws, never blocks longer
 * than the shell timeout.
 */
export function repairProcessPath(): Promise<void> {
  repaired ??= (async () => {
    if (process.platform === 'win32') return;
    const login = await readLoginShellPath();
    process.env['PATH'] = mergePathLists(login, process.env['PATH'], wellKnownToolDirs());
  })();
  return repaired;
}
