// ────────────────────────────────────────────────────────────────
// resolveOpenCodeCommand — find an installed OpenCode 2 CLI.
//
// GeneratorAI does not bundle OpenCode (the platform binary is ~230 MB). It
// uses the one the user installed, found the way the user's own shell would:
//
//   1. An explicit path from configuration (`harness.opencode.binaryPath`).
//   2. `OPENCODE_BIN`, then `OPENCODE_BIN_PATH` (the variable OpenCode's own npm
//      launcher, `@opencode/cli/bin/opencode.cjs`, honours).
//   3. `opencode2`, then `opencode`, on PATH (PATHEXT-aware on Windows). The
//      desktop app gives its server the login shell's PATH
//      (apps/desktop/src/main/login-shell-path.ts), so a Finder/Start-menu
//      launch sees the same directories a terminal does. `opencode2` is the
//      bin name only OpenCode 2 installs, so it wins over a 1.x `opencode`.
//   4. Where the official installers put it, per OS (`~/.opencode/bin` from the
//      curl installer, Homebrew, npm's global prefix, Scoop).
//
// The npm package's `opencode` / `opencode.cmd` is a Node launcher that execs
// the platform package's native binary. Windows refuses to spawn a `.cmd`
// without a shell, and a launcher in between means our SIGTERM reaches Node,
// not OpenCode — so the native binary is resolved and spawned directly, the
// same lookup the launcher does.
//
// Which major version a candidate is cannot be told without running it; the
// provider checks `GET /api/info` once the server is up and refuses OpenCode 1
// there with an "update OpenCode" error.
// ────────────────────────────────────────────────────────────────

import { access, realpath, stat } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type OpenCodeCommandSource = 'config' | 'env' | 'path' | 'install-dir';

export interface ResolvedOpenCodeCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede OpenCode's own (a launcher script when no native binary was found). */
  argsPrefix: string[];
  /** The file that was found, for display and diagnostics. */
  path: string;
  source: OpenCodeCommandSource;
}

export interface ResolveOpenCodeCommandOptions {
  /** Explicit binary path from configuration. */
  configuredPath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  homeDir?: string;
  /** Skip the PATH step (tests on a machine that has OpenCode installed). */
  usePath?: boolean;
}

/** Environment variables naming the binary, in the order they are honoured. */
export const OPENCODE_BIN_ENV = ['OPENCODE_BIN', 'OPENCODE_BIN_PATH'] as const;

/** What to tell a user whose machine has no OpenCode 2. */
export const OPENCODE_INSTALL_HINT =
  'Install OpenCode 2 (`npm i -g @opencode/cli`, `brew install anomalyco/tap/opencode-v2`, or the installer at https://opencode.ai), ' +
  'or set OPENCODE_BIN to its location, then restart GeneratorAI.';

async function isExecutableFile(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const s = await stat(candidate);
    if (!s.isFile()) return false;
    if (platform !== 'win32') await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `@opencode/cli-<os>-<arch>` package names the launcher tries, most specific first. */
function platformPackageNames(platform: NodeJS.Platform, arch: string): string[] {
  const os = platform === 'win32' ? 'windows' : platform;
  const base = `@opencode/cli-${os}-${arch}`;
  if (platform === 'linux') {
    return arch === 'x64'
      ? [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
      : [base, `${base}-musl`];
  }
  return arch === 'x64' ? [base, `${base}-baseline`] : [base];
}

/**
 * The native binary an `@opencode/cli` launcher script would exec: the cached
 * copy next to it (`bin/.opencode`), else the platform package found by walking
 * up `node_modules` from the script's directory — the launcher's own lookup.
 */
export async function nativeOpenCodeForLauncher(
  script: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<string | null> {
  let real = script;
  try { real = await realpath(script); } catch { /* keep the given path */ }
  const scriptDir = path.dirname(real);
  const exe = platform === 'win32' ? 'opencode.exe' : 'opencode';
  const cached = path.join(scriptDir, platform === 'win32' ? '.opencode.exe' : '.opencode');
  if (await isExecutableFile(cached, platform)) return cached;
  const names = platformPackageNames(platform, arch);
  let current = scriptDir;
  for (;;) {
    const modules = path.join(current, 'node_modules');
    if (existsSync(modules)) {
      for (const name of names) {
        const candidate = path.join(modules, ...name.split('/'), 'bin', exe);
        if (await isExecutableFile(candidate, platform)) return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Turn a found file into something spawnable. A launcher (script, `.cmd`
 * shim, or a symlink to `opencode.cjs`) becomes its native binary; a launcher
 * whose binary cannot be found is run directly on POSIX (its shebang finds
 * Node) and skipped on Windows, where it cannot be spawned without a shell.
 */
async function toCommand(
  found: string,
  source: OpenCodeCommandSource,
  platform: NodeJS.Platform,
  arch: string,
): Promise<ResolvedOpenCodeCommand | null> {
  let real = found;
  try { real = await realpath(found); } catch { /* keep the given path */ }
  const ext = path.extname(real).toLowerCase();
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    const launcher = path.join(path.dirname(found), 'node_modules', '@opencode', 'cli', 'bin', 'opencode.cjs');
    const native = existsSync(launcher) ? await nativeOpenCodeForLauncher(launcher, platform, arch) : null;
    return native ? { command: native, argsPrefix: [], path: found, source } : null;
  }
  if (ext === '.cjs' || ext === '.js' || ext === '.mjs') {
    const native = await nativeOpenCodeForLauncher(real, platform, arch);
    if (native) return { command: native, argsPrefix: [], path: found, source };
    if (platform === 'win32') return null;
    return { command: real, argsPrefix: [], path: found, source };
  }
  return { command: found, argsPrefix: [], path: found, source };
}

/** Where the official installers put the binary, per OS. Only existing files are returned by the caller. */
export function installLocations(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    return [
      path.join(home, '.opencode', 'bin', 'opencode.exe'),
      path.join(appData, 'npm', 'opencode2.cmd'),
      path.join(appData, 'npm', 'opencode.cmd'),
      path.join(home, 'scoop', 'shims', 'opencode.exe'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'opencode.exe'),
    ];
  }
  const dirs = [
    path.join(home, '.opencode', 'bin'),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : ['/home/linuxbrew/.linuxbrew/bin']),
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    ...(platform === 'linux' ? ['/usr/bin'] : []),
  ];
  return dirs.flatMap((dir) => [path.join(dir, 'opencode2'), path.join(dir, 'opencode')]);
}

export async function resolveOpenCodeCommand(
  options: ResolveOpenCodeCommandOptions = {},
): Promise<ResolvedOpenCodeCommand | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const home = options.homeDir ?? homedir();

  const explicit: Array<[string | null | undefined, OpenCodeCommandSource]> = [
    [options.configuredPath, 'config'],
    ...OPENCODE_BIN_ENV.map((name): [string | undefined, OpenCodeCommandSource] => [env[name], 'env']),
  ];
  for (const [candidate, source] of explicit) {
    if (!candidate?.trim()) continue;
    const resolved = path.resolve(candidate.trim());
    if (await isExecutableFile(resolved, platform)) {
      const cmd = await toCommand(resolved, source, platform, arch);
      if (cmd) return cmd;
    }
  }

  if (options.usePath !== false) {
    // Loaded on use: a static value import would make importing the barrel load all of core.
    const { resolveOnPath } = await import('@generatorai/core');
    for (const name of ['opencode2', 'opencode']) {
      const onPath = await resolveOnPath(name, env);
      if (!onPath) continue;
      const cmd = await toCommand(onPath, 'path', platform, arch);
      if (cmd) return cmd;
    }
  }

  for (const candidate of installLocations(platform, home, env)) {
    if (await isExecutableFile(candidate, platform)) {
      const cmd = await toCommand(candidate, 'install-dir', platform, arch);
      if (cmd) return cmd;
    }
  }
  return null;
}
