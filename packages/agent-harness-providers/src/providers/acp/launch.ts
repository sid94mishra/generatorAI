// ────────────────────────────────────────────────────────────────
// Launching ACP agents on every OS (docs/acp ACP-6).
//
// - A registry `cmd` is relative to the install directory and may use either
//   separator (`./goose-package\goose.exe`, `harn.exe`): it is normalised and
//   must stay inside that directory.
// - An archive entry may not escape the directory it is extracted into
//   (zip-slip): absolute names, drive letters and `..` segments are refused.
// - Windows: Node refuses to spawn a `.cmd` / `.bat` without a shell since the
//   April 2024 security releases (CVE-2024-27980, EINVAL). Those go through
//   `cmd.exe /d /s /c "<line>"` with verbatim arguments and strict quoting:
//   every argument is double-quoted, cmd metacharacters are caret-escaped
//   (twice, because the batch file re-parses `%*`), and characters cmd cannot
//   pass through literally (`"`, `%`, CR, LF, NUL) are refused rather than
//   guessed at. Everything else is spawned directly.
//
// Pure (no fs, no SDK): unit-tested on every OS with an explicit platform.
// ────────────────────────────────────────────────────────────────

import path from 'node:path';

/** True when `target` is inside `root` (not `root` itself). Both are resolved first. */
export function isPathInside(root: string, target: string, p: typeof path = path): boolean {
  const rel = p.relative(p.resolve(root), p.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
}

/** Segments of a relative archive/registry path, or null when it is absolute or climbs out. */
function relativeSegments(name: string): string[] | null {
  if (name.includes('\0')) return null;
  const trimmed = name.trim();
  // Absolute POSIX, UNC / rooted Windows, or a drive letter (`C:foo`, `C:\foo`).
  if (/^[\\/]/.test(trimmed) || /^[a-zA-Z]:/.test(trimmed)) return null;
  const parts = trimmed.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.some((s) => s === '..')) return null;
  return parts;
}

/**
 * The absolute path of a registry `cmd` inside `root`: `./a\b.exe` → `<root>/a/b.exe`.
 * Throws when it is absolute, empty, or leaves `root`.
 */
export function resolveAgentCmd(root: string, cmd: string, p: typeof path = path): string {
  const parts = relativeSegments(cmd);
  if (!parts) throw new Error(`The agent's command "${cmd}" is not a path inside its install directory.`);
  const full = p.join(p.resolve(root), ...parts);
  if (!isPathInside(root, full, p)) throw new Error(`The agent's command "${cmd}" leaves its install directory.`);
  return full;
}

/**
 * Zip-slip guard: where an archive entry may be written inside `root`, or null when the entry must be refused
 * (absolute, drive-relative, `..`, NUL). A directory entry's trailing separator is fine.
 */
export function safeArchiveEntryPath(root: string, entryName: string, p: typeof path = path): string | null {
  const parts = relativeSegments(entryName);
  if (!parts) return null;
  const full = p.join(p.resolve(root), ...parts);
  return isPathInside(root, full, p) ? full : null;
}

// ── Windows `.cmd` / `.bat` wrapping ─────────────────────────────

/** cmd.exe metacharacters (cross-spawn's set). */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/** Characters that cannot reach a batch file literally through cmd.exe. */
const CMD_UNSAFE = /["%\r\n\0]/;

function assertCmdSafe(value: string, what: string): void {
  if (CMD_UNSAFE.test(value)) {
    throw new Error(
      `${what} contains a character cmd.exe cannot pass to a .cmd/.bat launcher safely (", %, line breaks): ${JSON.stringify(value)}`,
    );
  }
}

/** One argument for a batch file run through `cmd.exe /d /s /c`: quoted (MSVCRT rules), then caret-escaped twice. */
export function quoteCmdArg(arg: string): string {
  assertCmdSafe(arg, 'An argument');
  // MSVCRT: backslashes before the closing quote are doubled (no inner quotes are possible: refused above).
  const quoted = `"${arg.replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/** The batch file itself: caret-escaped once (cmd resolves it, it is not re-parsed by `%*`). */
export function quoteCmdCommand(command: string): string {
  assertCmdSafe(command, 'The command');
  return command.replace(CMD_META, '^$1');
}

export interface SpawnTarget {
  file: string;
  args: string[];
  /** Pass the arguments to the process as they are (cmd.exe's own quoting is already applied). */
  windowsVerbatimArguments?: boolean;
}

/** Whether `command` is a batch file Windows can only run through cmd.exe. */
export function isWindowsBatch(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

/**
 * How to spawn `command args…` on `platform`. Batch files on Windows go through `cmd.exe /d /s /c "<line>"`
 * (`/d` skips AutoRun, `/s` keeps the outer quotes literal); everything else is spawned directly, never through a
 * shell.
 */
export function resolveSpawnTarget(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string | undefined = process.env['ComSpec'],
): SpawnTarget {
  if (platform !== 'win32' || !isWindowsBatch(command)) return { file: command, args: [...args] };
  const line = [quoteCmdCommand(command), ...args.map(quoteCmdArg)].join(' ');
  return { file: comspec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

// ── Command lines for display (terminal sign-in) ─────────────────

function posixQuote(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `KEY='v' '/path/agent' 'arg'` for a POSIX shell. */
export function posixCommandLine(command: string, args: readonly string[], env: Record<string, string> = {}): string {
  const assigns = Object.entries(env).filter(([k]) => ENV_NAME.test(k)).map(([k, v]) => `${k}=${posixQuote(v)}`);
  return [...assigns, posixQuote(command), ...args.map(posixQuote)].join(' ');
}

/** `$env:KEY='v'; & 'C:\…\agent.exe' 'arg'` for PowerShell. */
export function powershellCommandLine(command: string, args: readonly string[], env: Record<string, string> = {}): string {
  const assigns = Object.entries(env).filter(([k]) => ENV_NAME.test(k)).map(([k, v]) => `$env:${k}=${powershellQuote(v)}; `);
  return `${assigns.join('')}& ${[powershellQuote(command), ...args.map(powershellQuote)].join(' ')}`;
}
