// ────────────────────────────────────────────────────────────────
// EditorLauncherService — "Open in editor" (doc §7)
// ────────────────────────────────────────────────────────────────
//
// Availability is probed two ways: the editor's CLI on PATH, then the
// standard per-OS install locations. The per-OS table below is the ONE place
// this feature reads `process.platform` — it is a genuine OS difference
// (different install roots and executable suffixes), not a platform
// work-around; everything else here is platform-neutral.
//
// The response always carries `fallbackUrl` so a browser can try the URL
// scheme itself when the server runs on another machine and could not launch
// anything locally.

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import type { EditorId, EditorInfo, ILogger, OpenInEditorRequest, OpenInEditorResult } from '@generatorai/shared';

export interface EditorLauncherDeps {
  logger: ILogger;
  /** Probe runner (same shape as core's IScriptRunner / IScmProcessRunner). */
  processRunner: {
    run(
      cmd: string,
      args: string[],
      opts: { cwd: string; timeout?: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  /** Injected for tests; defaults to node:child_process spawn. */
  spawn?: (
    cmd: string,
    args: string[],
    opts: { detached: boolean; stdio: 'ignore' },
  ) => { unref(): void };
  /** Injected for tests; defaults to fs.access. */
  fileExists?: (p: string) => Promise<boolean>;
  /** Editor chosen in settings. */
  defaultEditor?: () => EditorId | null;
}

interface EditorEntry {
  id: EditorId;
  name: string;
  command: string;
  scheme: string;
  /** Well-known absolute install locations of the CLI, per platform. */
  appDirs: { darwin: string[]; win32: string[]; linux: string[] };
}

const RESOLVE_TTL_MS = 60_000;

const HOME = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
const LOCALAPPDATA = process.env['LOCALAPPDATA'] ?? '';
const PROGRAMFILES = process.env['PROGRAMFILES'] ?? '';

function windowsPaths(programDir: string, command: string): string[] {
  const paths: string[] = [];
  if (LOCALAPPDATA) paths.push(path.win32.join(LOCALAPPDATA, 'Programs', programDir, 'bin', `${command}.cmd`));
  if (PROGRAMFILES) paths.push(path.win32.join(PROGRAMFILES, programDir, 'bin', `${command}.cmd`));
  return paths;
}

function linuxPaths(command: string): string[] {
  const paths = [`/usr/bin/${command}`, `/usr/local/bin/${command}`, `/snap/bin/${command}`];
  if (HOME) paths.push(path.posix.join(HOME, '.local', 'bin', command));
  return paths;
}

/** The one shared editor table (doc §7). */
export const EDITOR_TABLE: readonly EditorEntry[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    command: 'code',
    scheme: 'vscode',
    appDirs: {
      darwin: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
      win32: windowsPaths('Microsoft VS Code', 'code'),
      linux: linuxPaths('code'),
    },
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    command: 'code-insiders',
    scheme: 'vscode-insiders',
    appDirs: {
      darwin: [
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
      ],
      win32: windowsPaths('Microsoft VS Code Insiders', 'code-insiders'),
      linux: linuxPaths('code-insiders'),
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor',
    scheme: 'cursor',
    appDirs: {
      darwin: ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
      win32: windowsPaths('Cursor', 'cursor'),
      linux: linuxPaths('cursor'),
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    command: 'windsurf',
    scheme: 'windsurf',
    appDirs: {
      darwin: ['/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'],
      win32: windowsPaths('Windsurf', 'windsurf'),
      linux: linuxPaths('windsurf'),
    },
  },
];

/** `C:\src\a.ts` → `/C:/src/a.ts`; `/src/a.ts` → `/src/a.ts`. */
export function toFileUrlPath(filePath: string): string {
  const abs = isAbsoluteAnyPlatform(filePath) ? filePath : path.resolve(filePath);
  const slashed = abs.replace(/\\/g, '/');
  return slashed.startsWith('/') ? slashed : `/${slashed}`;
}

function isAbsoluteAnyPlatform(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** `vscode://file/src/a.ts:12:3` */
export function buildFallbackUrl(
  scheme: string,
  request: { path: string; line?: number; column?: number },
): string {
  const abs = toFileUrlPath(request.path);
  const suffix = request.line
    ? `:${request.line}${request.column ? `:${request.column}` : ''}`
    : '';
  return `${scheme}://file${abs}${suffix}`;
}

async function defaultFileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export class EditorLauncherService {
  private readonly cache = new Map<EditorId, { at: number; command: string | null }>();

  constructor(private readonly deps: EditorLauncherDeps) {}

  async listEditors(): Promise<EditorInfo[]> {
    return Promise.all(
      EDITOR_TABLE.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        available: (await this.resolve(entry.id)) !== null,
        scheme: entry.scheme,
      })),
    );
  }

  /** Resolved absolute/PATH command for an editor, or null. Cached for 60s. */
  async resolve(id: EditorId): Promise<string | null> {
    const cached = this.cache.get(id);
    const now = Date.now();
    if (cached && now - cached.at < RESOLVE_TTL_MS) return cached.command;

    const entry = EDITOR_TABLE.find((e) => e.id === id);
    if (!entry) return null;

    let command: string | null = null;

    // 1 ── the bare command on PATH.
    try {
      const res = await this.deps.processRunner.run(entry.command, ['--version'], {
        cwd: process.cwd(),
        timeout: 5000,
      });
      if (res.exitCode === 0) command = entry.command;
    } catch {
      command = null;
    }

    // 2 ── the well-known install locations for this OS.
    if (!command) {
      const exists = this.deps.fileExists ?? defaultFileExists;
      for (const candidate of this.candidatePaths(entry)) {
        try {
          if (await exists(candidate)) {
            command = candidate;
            break;
          }
        } catch {
          // Treat a failing probe as "not there".
        }
      }
    }

    this.cache.set(id, { at: now, command });
    return command;
  }

  async open(request: OpenInEditorRequest): Promise<OpenInEditorResult> {
    const chosen = request.editor ?? this.deps.defaultEditor?.() ?? (await this.firstAvailable());
    const entry = chosen ? EDITOR_TABLE.find((e) => e.id === chosen) : undefined;
    const fallbackUrl = buildFallbackUrl(entry?.scheme ?? EDITOR_TABLE[0]!.scheme, request);

    if (!entry) {
      return {
        ok: false,
        fallbackUrl,
        error: 'No supported editor was found on the server host.',
      };
    }

    const command = await this.resolve(entry.id);
    if (!command) {
      return {
        ok: false,
        editor: entry.id,
        fallbackUrl,
        error: `${entry.name} is not installed on the server host.`,
      };
    }

    const target = isAbsoluteAnyPlatform(request.path) ? request.path : path.resolve(request.path);
    const args = request.line
      ? ['-g', `${target}:${request.line}${request.column ? `:${request.column}` : ''}`]
      : [target];

    try {
      const spawnFn = this.deps.spawn ?? defaultSpawn;
      const child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, editor: entry.id, fallbackUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn(`[SCM] Could not launch ${entry.name}: ${message}`);
      return { ok: false, editor: entry.id, fallbackUrl, error: message };
    }
  }

  private async firstAvailable(): Promise<EditorId | null> {
    for (const entry of EDITOR_TABLE) {
      if (await this.resolve(entry.id)) return entry.id;
    }
    return null;
  }

  /**
   * The install locations to probe on THIS machine. The only `process.platform`
   * read in the source-control feature — a real OS difference, not a
   * platform-specific work-around.
   */
  private candidatePaths(entry: EditorEntry): string[] {
    switch (process.platform) {
      case 'darwin':
        return entry.appDirs.darwin;
      case 'win32':
        return entry.appDirs.win32;
      default:
        return entry.appDirs.linux;
    }
  }
}

function defaultSpawn(
  cmd: string,
  args: string[],
  opts: { detached: boolean; stdio: 'ignore' },
): { unref(): void } {
  return nodeSpawn(cmd, args, { detached: opts.detached, stdio: opts.stdio });
}
