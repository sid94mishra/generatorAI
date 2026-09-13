// ────────────────────────────────────────────────────────────────
// resolveCodexCommand — find the Codex CLI the way Codex's own clients do.
//
// Codex is not only an npm global any more. It ships inside the ChatGPT
// desktop app, and a machine with that app has a working, signed-in `codex`
// that is not on PATH at all. Treating "not on PATH" as "not installed" is how
// a fully usable Codex showed up as `Not installed` in Settings.
//
// Resolution order, first hit wins:
//   1. An explicit path from configuration (`harness.codex.binaryPath`).
//   2. `CODEX_CLI_PATH` — the variable the Codex desktop app itself honours,
//      so a user who already set it for Codex does not have to set it twice.
//   3. The `@openai/codex` package this build pins (an optional dependency of
//      this package, like the Claude Agent SDK): the same version the
//      generated protocol types were captured from, present on every platform
//      pnpm installed a platform binary for. Sign-in still comes from
//      `CODEX_HOME` (`~/.codex`), which every Codex binary shares.
//   4. `codex` on PATH (PATHEXT-aware on Windows, via `resolveOnPath`).
//   5. The CLI bundled with a desktop app installed in a known location.
//
// Every step runs on every platform; only the data differs (step 5's list).
//
// Windows npm installs put a `codex.cmd` shim on PATH. Node refuses to spawn a
// `.cmd` without a shell (`spawn EINVAL`), and a shell wrapper would make the
// provider's SIGTERM/SIGKILL reach `cmd.exe` rather than Codex. The shim only
// runs `@openai/codex/bin/codex.js` with Node, so that script is resolved and
// run directly instead.
// ────────────────────────────────────────────────────────────────

import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

export type CodexCommandSource = 'config' | 'env' | 'bundled' | 'path' | 'app-bundle';

export interface ResolvedCodexCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede Codex's own (a script path when run via Node). */
  argsPrefix: string[];
  /** Extra environment the launch needs (e.g. running Electron's binary as Node). */
  env: Record<string, string>;
  /** The Codex entry point that was found, for display and diagnostics. */
  path: string;
  source: CodexCommandSource;
}

export interface ResolveCodexCommandOptions {
  /** Explicit binary path from configuration. */
  configuredPath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  /**
   * Whether to consider the `@openai/codex` package pinned by this build
   * (step 3). Defaults to true; tests turn it off to exercise the later steps
   * on a machine where the package is installed.
   */
  useBundled?: boolean;
}

/**
 * The `codex.js` launcher of the pinned `@openai/codex` package, when its
 * platform binary is installed. The launcher picks the platform package by
 * `process.platform`/`process.arch` and execs it, so running it through the
 * current Node runtime is the same on every OS.
 */
export async function bundledCodexScript(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  let script: string;
  try {
    script = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  } catch {
    return null; // optional dependency not installed
  }
  // The launcher is useless without the platform binary next to it.
  const pkgRoot = path.dirname(path.dirname(script));
  const req = createRequire(path.join(pkgRoot, 'package.json'));
  const bin = `@openai/codex-${platform}-${process.arch}`;
  try {
    req.resolve(`${bin}/package.json`);
  } catch {
    return null;
  }
  return (await isExecutableFile(script, 'win32')) ? script : null;
}

/** Name of the environment variable the Codex desktop app reads its CLI path from. */
export const CODEX_CLI_PATH_ENV = 'CODEX_CLI_PATH';

/**
 * Desktop apps known to bundle the Codex CLI, as paths relative to an
 * applications directory. Only locations verified against a real install are
 * listed; anything else is left to PATH and `CODEX_CLI_PATH`.
 */
function appBundleCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    const rel = path.join('ChatGPT.app', 'Contents', 'Resources', 'codex');
    return [path.join('/Applications', rel), path.join(home, 'Applications', rel)];
  }
  return [];
}

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

/** Launch through the running Node runtime (Electron's binary when hosted by the desktop app). */
function viaNode(script: string, source: CodexCommandSource): ResolvedCodexCommand {
  return {
    command: process.execPath,
    argsPrefix: [script],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
    path: script,
    source,
  };
}

/**
 * Turn a found file into something spawnable. Returns null when the file is a
 * Windows shim whose script cannot be located — spawning it would fail anyway.
 */
async function toCommand(
  found: string,
  source: CodexCommandSource,
  platform: NodeJS.Platform,
): Promise<ResolvedCodexCommand | null> {
  const ext = path.extname(found).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return viaNode(found, source);
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    const script = path.join(path.dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return (await isExecutableFile(script, 'win32')) ? viaNode(script, source) : null;
  }
  return { command: found, argsPrefix: [], env: {}, path: found, source };
}

export async function resolveCodexCommand(
  options: ResolveCodexCommandOptions = {},
): Promise<ResolvedCodexCommand | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();

  const explicit: Array<[string | null | undefined, CodexCommandSource]> = [
    [options.configuredPath, 'config'],
    [env[CODEX_CLI_PATH_ENV], 'env'],
  ];
  for (const [candidate, source] of explicit) {
    if (!candidate?.trim()) continue;
    const resolved = path.resolve(candidate.trim());
    if (await isExecutableFile(resolved, platform)) {
      const cmd = await toCommand(resolved, source, platform);
      if (cmd) return cmd;
    }
  }

  if (options.useBundled !== false) {
    const bundled = await bundledCodexScript(platform);
    if (bundled) return viaNode(bundled, 'bundled');
  }

  // Loaded on use: this module is exported from the package barrel, and a
  // static value import would make importing the barrel load all of core.
  const { resolveOnPath } = await import('@generatorai/core');
  const onPath = await resolveOnPath('codex', env);
  if (onPath) {
    const cmd = await toCommand(onPath, 'path', platform);
    if (cmd) return cmd;
  }

  for (const candidate of appBundleCandidates(platform, home)) {
    if (await isExecutableFile(candidate, platform)) {
      return { command: candidate, argsPrefix: [], env: {}, path: candidate, source: 'app-bundle' };
    }
  }
  return null;
}
