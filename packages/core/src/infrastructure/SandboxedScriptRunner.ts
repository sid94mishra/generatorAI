// ────────────────────────────────────────────────────────────────
// SandboxedScriptRunner — policy-checked child-process execution
//
// Everything that reaches `run()` is model-authorable (hook configs, script
// hooks, post-processing steps), so the policy has to hold against an
// adversarial command line, not just a careless one:
//
//   1. The command must be a BARE name (no path separators, no drive letter,
//      no `..`) and must be on the allow-list. It is then resolved through
//      PATH to an absolute binary, and THAT path is spawned — never the string
//      the caller supplied. This closes the `./rm` bypass, where a relative
//      path passed the `basename` check but spawned whatever sat at that path
//      inside a caller-controlled cwd.
//   2. The allow-list ships small: interpreters/tooling the product itself
//      depends on. Shells, downloaders and destructive coreutils
//      (`sh bash curl wget rm chmod mv cp find sed awk tar zip unzip`) are
//      only available when the operator opts in via
//      `AppConfig.scripts.extraAllowlist` (env `GENERATORAI_SCRIPT_EXTRA_ALLOWLIST`).
//   3. The dangerous-pattern scan runs over `command + args`, not args alone.
//   4. Interpreter escape hatches that turn an allow-listed binary into
//      "run anything" are refused: `node -e/--eval/-p/--print`, `python -c`,
//      `git -c core.sshCommand=…` (and friends), `git --upload-pack/
//      --receive-pack`, and `npx`/`npm exec`/`pnpm dlx` of a package that is
//      not itself allow-listed. A confined run (a `check` stage, P05 §1.2)
//      accepts pwsh only as `-File <script of its mount>` plus a few inert
//      switches. Every run refuses `pwsh -EncodedCommand`. pwsh switches are
//      matched the way pwsh matches them (any unambiguous prefix, any case,
//      `-`/`--`/`/`), so `-Comm` or `-enc` cannot slip past.
//
// Windows launch (P05 P5-4). An extensionless PATH entry is a POSIX shim
// (`…\npm\pnpm`) and never spawnable, so only PATHEXT candidates count. A
// `.cmd`/`.bat` cannot be spawned without a shell (EINVAL on Node ≥ 18.20.2):
// a standard npm or pnpm shim is resolved to `node <its target script>`;
// any other batch file runs through `%ComSpec% /d /s /c` with every
// argument escaped for cmd (the cross-spawn rules; arguments are literals).
// A process tree that outlives its timeout is killed with `taskkill /T`.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  IScriptRunner,
  ScriptCommandValidation,
  ScriptRunOptions,
  ScriptRunResult,
} from '../domain/ports/IScriptRunner.js';
import type { ILogger } from '@generatorai/shared';
import { SecurityError, buildChildEnv } from '@generatorai/shared';
import { DEFAULT_COMMAND_ALLOWLIST as DEFAULT_LIST, OPT_IN_COMMANDS as OPT_IN_LIST } from '@generatorai/workflow-spec';

// The lists live in the spec package (P05 §1.2): the validator checks a
// `check` stage's command against the same defaults the runner enforces.
const DEFAULT_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set(DEFAULT_LIST);
const OPT_IN_COMMANDS: ReadonlySet<string> = new Set(OPT_IN_LIST);

/**
 * Patterns that should never appear anywhere on the command line (basic
 * injection prevention). Applied to `command + ' ' + args.join(' ')`.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /;\s*rm\s+-rf/i,
  /\brm\s+-rf\s+[/~]/i,
  /\$\(/,
  /`/,
  />\s*\/dev\//,
  /\|\s*sh\b/,
  /\|\s*bash\b/,
  /\beval\s/i,
];

/**
 * Per-interpreter argument rules. Each returns a refusal reason or `null`.
 * These are the escape hatches that make an allow-listed binary equivalent
 * to "run arbitrary code" — the allow-list is meaningless without them.
 */
const NODE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const PYTHON_EVAL_FLAGS = new Set(['-c']);
const GIT_DANGEROUS_CONFIG_KEYS = [
  'core.sshcommand',
  'core.pager',
  'core.editor',
  'core.hookspath',
  'core.fsmonitor',
  'core.askpass',
  'credential.helper',
  'diff.external',
  'filter.',
  'alias.',
  'sequence.editor',
  'gpg.program',
  'ssh.variant',
];
const GIT_DANGEROUS_FLAGS = ['--upload-pack', '--receive-pack', '--exec-path'];

/**
 * pwsh's own command-line switches, in the order its parser tries them (first
 * match wins). pwsh accepts any prefix of a name at least `min` characters
 * long, plus the listed aliases, case-insensitively, after `-`, `--`, `/` or a
 * Unicode dash. `kind` says what the switch does to the rest of the line:
 * `value` takes the next argument, `command`/`file` end switch parsing (the
 * rest is the code or the script's arguments), `encoded` runs base64 code.
 */
type PwshSwitchKind = 'switch' | 'value' | 'command' | 'file' | 'encoded';
const PWSH_SWITCHES: ReadonlyArray<{ name: string; min: number; aliases?: readonly string[]; kind: PwshSwitchKind }> = [
  { name: 'help', min: 1, aliases: ['?'], kind: 'switch' },
  { name: 'login', min: 1, kind: 'switch' },
  { name: 'noexit', min: 3, kind: 'switch' },
  { name: 'noprofile', min: 3, kind: 'switch' },
  { name: 'nologo', min: 3, kind: 'switch' },
  { name: 'noninteractive', min: 4, kind: 'switch' },
  { name: 'socketservermode', min: 2, kind: 'switch' },
  { name: 'servermode', min: 1, kind: 'switch' },
  { name: 'namedpipeservermode', min: 3, kind: 'switch' },
  { name: 'sshservermode', min: 4, kind: 'switch' },
  { name: 'noprofileloadtime', min: 17, kind: 'switch' },
  { name: 'interactive', min: 1, kind: 'switch' },
  { name: 'configurationfile', min: 17, kind: 'value' },
  { name: 'configurationname', min: 6, kind: 'value' },
  { name: 'custompipename', min: 14, kind: 'value' },
  { name: 'command', min: 1, kind: 'command' },
  { name: 'commandwithargs', min: 15, aliases: ['cwa'], kind: 'command' },
  { name: 'windowstyle', min: 1, kind: 'value' },
  { name: 'file', min: 1, kind: 'file' },
  { name: 'outputformat', min: 1, aliases: ['of'], kind: 'value' },
  { name: 'inputformat', min: 2, aliases: ['if'], kind: 'value' },
  { name: 'executionpolicy', min: 2, aliases: ['ep'], kind: 'value' },
  { name: 'encodedcommand', min: 1, aliases: ['ec'], kind: 'encoded' },
  { name: 'encodedarguments', min: 8, aliases: ['ea'], kind: 'encoded' },
  { name: 'settingsfile', min: 8, kind: 'value' },
  { name: 'sta', min: 3, kind: 'switch' },
  { name: 'mta', min: 3, kind: 'switch' },
  { name: 'workingdirectory', min: 2, aliases: ['wd'], kind: 'value' },
  { name: 'version', min: 1, kind: 'switch' },
];
/** The only switches a confined run (a check) may pass besides `-File`. */
const PWSH_CONFINED_SWITCHES = new Set(['noprofile', 'nologo', 'noninteractive', 'executionpolicy', 'outputformat', 'inputformat', 'sta', 'mta']);
const PWSH_DASHES = new Set(['-', '–', '—', '―']);

/**
 * Parse one pwsh argument as a switch. `null` = not a switch (a positional
 * script path). `name` is `undefined` for a switch pwsh would not recognise.
 */
function pwshSwitch(arg: string): { name: string | undefined; kind: PwshSwitchKind | undefined; attached: boolean } | null {
  const trimmed = arg.trim();
  const first = trimmed[0];
  if (first === undefined || (!PWSH_DASHES.has(first) && first !== '/')) return null;
  let key = trimmed.slice(1);
  if (PWSH_DASHES.has(first) && key[0] === first) key = key.slice(1);
  const sep = key.search(/[:=]/);
  const attached = sep >= 0;
  if (attached) key = key.slice(0, sep);
  key = key.toLowerCase();
  const hit = key.length === 0 ? undefined : PWSH_SWITCHES.find((s) => s.aliases?.includes(key) || (key.length >= s.min && s.name.startsWith(key)));
  // A `/…` that names no switch is a path (POSIX absolute), not a switch.
  if (!hit && first === '/') return null;
  return { name: hit?.name, kind: hit?.kind, attached };
}

function flagName(arg: string): string {
  const eq = arg.indexOf('=');
  return (eq >= 0 ? arg.slice(0, eq) : arg).toLowerCase();
}

export interface SandboxedScriptRunnerOptions {
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  /**
   * Operator-approved additions to the default allow-list (bare command
   * names). Wired from `AppConfig.scripts.extraAllowlist`. Names that are
   * neither default nor in `OPT_IN_COMMANDS` are accepted but logged, since
   * they widen the surface beyond what this file documents.
   */
  extraAllowlist?: readonly string[];
  /** PATH lookup override (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1 MB

export class SandboxedScriptRunner implements IScriptRunner {
  private readonly defaultTimeout: number;
  private readonly maxOutput: number;
  private readonly allowlist: Set<string>;
  private readonly lookupEnv: NodeJS.ProcessEnv;
  private activeProcesses = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly logger: ILogger,
    options?: SandboxedScriptRunnerOptions,
  ) {
    this.defaultTimeout = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutput = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    this.lookupEnv = options?.env ?? process.env;
    this.allowlist = new Set(DEFAULT_COMMAND_ALLOWLIST);
    for (const raw of options?.extraAllowlist ?? []) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      if (!isBareCommandName(name)) {
        this.logger.warn(`[ScriptRunner] Ignoring extraAllowlist entry "${raw}" — must be a bare command name`);
        continue;
      }
      if (!OPT_IN_COMMANDS.has(name) && !DEFAULT_COMMAND_ALLOWLIST.has(name)) {
        this.logger.warn(`[ScriptRunner] extraAllowlist adds "${name}", which is outside the documented opt-in set`);
      }
      this.allowlist.add(name);
    }
    if (options?.extraAllowlist?.length) {
      this.logger.warn(
        `[ScriptRunner] Script allow-list widened by operator config: ${[...this.allowlist].sort().join(', ')}`,
      );
    }
  }

  /** The effective allow-list (defaults + operator additions). */
  getAllowlist(): string[] {
    return [...this.allowlist].sort();
  }

  async run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult> {
    // ── Security checks — throw before anything is spawned ──
    const resolved = await this.resolveOrThrow(command, args, options.confineTo);

    const timeout = options.timeout ?? this.defaultTimeout;
    const processId = randomUUID();
    const startTime = Date.now();
    const launch = launchPlan(resolved, args, this.lookupEnv);

    this.logger.info(`[ScriptRunner] Executing: ${launch.command} ${launch.args.join(' ')} (pid=${processId})`);

    return new Promise<ScriptRunResult>((resolve) => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(launch.command, launch.args, {
          cwd: options.cwd ? path.resolve(options.cwd) : undefined,
          // Workflow scripts are model-authorable, so this child gets an
          // allowlisted environment rather than a clone of the server's — a
          // clone would hand a generated `.workflow.mjs` the vault key, the
          // desktop admin token, DATABASE_URL and every provider credential.
          env: buildChildEnv(options.env || launch.env ? { extra: { ...(launch.env ?? {}), ...(options.env ?? {}) } } : {}),
          shell: false, // Never use shell to prevent injection
          stdio: [options.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          windowsHide: true,
          ...(launch.verbatim ? { windowsVerbatimArguments: true } : {}),
        });
      } catch (err) {
        // A synchronous spawn failure (EINVAL, a bad cwd): the process never started.
        const e = err as NodeJS.ErrnoException;
        resolve({ exitCode: -1, stdout: '', stderr: e.message, durationMs: Date.now() - startTime, launchError: e.code ?? e.message });
        return;
      }

      this.activeProcesses.set(processId, proc);

      if (options.stdin !== undefined && proc.stdin) {
        proc.stdin.on('error', () => { /* child exited before reading — reported via exit code */ });
        proc.stdin.end(options.stdin);
      }

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let killed = false;
      let timedOut = false;

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= this.maxOutput) {
          stdout += chunk.toString();
        } else if (options.keepTail) {
          // Keep the END of a long output (what a check reports), bounded.
          stdout = (stdout + chunk.toString()).slice(-this.maxOutput);
        }
        options.streamTo?.(chunk.toString(), 'stdout');
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= this.maxOutput) {
          stderr += chunk.toString();
        } else if (options.keepTail) {
          stderr = (stderr + chunk.toString()).slice(-this.maxOutput);
        }
        options.streamTo?.(chunk.toString(), 'stderr');
      });

      const timer = setTimeout(() => {
        killed = true;
        timedOut = true;
        killTree(proc);
        this.logger.warn(`[ScriptRunner] Process ${processId} timed out after ${timeout}ms`);
      }, timeout);

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          killed = true;
          killTree(proc);
        }, { once: true });
      }

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);

        resolve({
          exitCode: killed ? -1 : (code ?? -1),
          stdout: stdout.trimEnd(),
          stderr: timedOut
            ? `Process timed out after ${timeout}ms\n${stderr}`.trimEnd()
            : stderr.trimEnd(),
          durationMs: Date.now() - startTime,
          ...(timedOut ? { timedOut: true } : {}),
        });
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - startTime,
          launchError: err.code ?? err.message,
        });
      });
    });
  }

  /**
   * True when `command` is allow-listed AND resolves to a binary on PATH.
   * Pure lookup — nothing is spawned (the old implementation spawned
   * `which`/`where`, which are no longer allow-listed themselves).
   */
  async isAvailable(command: string): Promise<boolean> {
    const result = await this.validate(command, []);
    return result.ok;
  }

  /**
   * Run the full policy without spawning. Shared by `run()` and by hook dry
   * runs, so a dry run reports exactly what a real run would have refused.
   */
  async validate(command: string, args: string[]): Promise<ScriptCommandValidation> {
    try {
      const resolved = await this.resolveOrThrow(command, args);
      return { ok: true, resolvedCommand: resolved.binary };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Kill all active child processes during graceful shutdown. */
  async shutdown(): Promise<void> {
    for (const [id, proc] of this.activeProcesses) {
      proc.kill('SIGKILL');
      this.logger.warn(`[ScriptRunner] Killed leftover process ${id}`);
    }
    this.activeProcesses.clear();
  }

  // ── Validation ──

  private async resolveOrThrow(command: string, args: string[], confineTo?: string): Promise<ResolvedCommand> {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new SecurityError('Command must be a non-empty bare executable name');
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      throw new SecurityError('Script arguments must be an array of strings');
    }

    // (b) bare names only — a path would let the caller pick which binary
    // "node" means by planting one inside a cwd they control.
    const trimmed = command.trim();
    if (!isBareCommandName(trimmed)) {
      throw new SecurityError(
        `Command "${command}" must be a bare executable name (no path separators); it is resolved via PATH`,
      );
    }
    const name = normaliseCommandName(trimmed);

    if (!this.allowlist.has(name)) {
      const hint = OPT_IN_COMMANDS.has(name)
        ? ` "${name}" requires an explicit operator opt-in: add it to scripts.extraAllowlist (GENERATORAI_SCRIPT_EXTRA_ALLOWLIST).`
        : '';
      throw new SecurityError(
        `Command "${name}" is not in the allowlist.${hint} Allowed: ${this.getAllowlist().join(', ')}`,
      );
    }

    // (a) pattern scan sees the command AND the args.
    const joined = `${trimmed} ${args.join(' ')}`;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(joined)) {
        throw new SecurityError(`Potentially dangerous command-line pattern detected: ${pattern}`);
      }
    }

    // (d) interpreter escape hatches.
    const escape = this.checkInterpreterEscapes(name, args, confineTo);
    if (escape) throw new SecurityError(escape);

    // Resolve to an absolute binary — `spawn` gets this path, never `command`.
    if (process.platform === 'win32' && name === 'echo') {
      const comspec = this.lookupEnv['ComSpec'] ?? this.lookupEnv['COMSPEC'] ?? 'C:\\Windows\\System32\\cmd.exe';
      return { name, binary: comspec, viaCmdShell: true };
    }
    const binary = await resolveOnPath(name, this.lookupEnv);
    if (!binary) {
      throw new SecurityError(`Command "${name}" is allow-listed but could not be found on PATH`);
    }
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
      const shim = await parseNodeShim(binary);
      if (shim) return { name, binary, viaCmdShell: false, shim: { ...shim, node: (await resolveOnPath('node', this.lookupEnv)) ?? process.execPath } };
      return { name, binary, viaCmdShell: false, batch: true };
    }
    return { name, binary, viaCmdShell: false };
  }

  private checkInterpreterEscapes(name: string, args: string[], confineTo?: string): string | null {
    switch (name) {
      case 'node': {
        for (const arg of args) {
          const flag = flagName(arg);
          if (NODE_EVAL_FLAGS.has(flag)) {
            return `"node ${arg}" evaluates inline code and is not permitted; run a script file instead`;
          }
          if (!arg.startsWith('-')) break; // first positional = script file; later args belong to it
        }
        return null;
      }
      case 'python':
      case 'python3': {
        for (const arg of args) {
          if (PYTHON_EVAL_FLAGS.has(flagName(arg))) {
            return `"${name} ${arg}" evaluates inline code and is not permitted; run a script file instead`;
          }
          if (!arg.startsWith('-')) break;
        }
        return null;
      }
      case 'git': {
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          const flag = flagName(arg);
          if (GIT_DANGEROUS_FLAGS.includes(flag)) {
            return `"git ${flag}" can execute an arbitrary program and is not permitted`;
          }
          // `-c key=value`, `-ckey=value`, `--config-env key=ENV`, `--config-env=key=ENV`
          let configValue: string | undefined;
          if (arg === '-c' || arg === '--config-env') configValue = args[i + 1] ?? '';
          else if (arg.startsWith('--config-env=')) configValue = arg.slice('--config-env='.length);
          else if (arg.startsWith('-c') && !arg.startsWith('--') && arg.length > 2) configValue = arg.slice(2);
          if (configValue !== undefined) {
            const key = configValue.split('=')[0]!.trim().toLowerCase();
            if (GIT_DANGEROUS_CONFIG_KEYS.some((k) => (k.endsWith('.') ? key.startsWith(k) : key === k))) {
              return `"git -c ${key}=…" can execute an arbitrary program and is not permitted`;
            }
          }
        }
        return null;
      }
      case 'npx':
        return this.checkPackageRunner('npx', args, 0);
      case 'npm': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'exec' || sub === 'x') return this.checkPackageRunner('npm exec', args, 1);
        return null;
      }
      case 'pnpm': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'dlx' || sub === 'exec') return this.checkPackageRunner(`pnpm ${sub}`, args, 1);
        return null;
      }
      case 'pwsh': {
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          const sw = pwshSwitch(arg);
          if (sw?.kind === 'encoded') return `"pwsh ${arg}" runs an encoded command and is not permitted`;
          if (!confineTo) {
            if (!sw || sw.kind === 'command' || sw.kind === 'file') break; // the rest is the code or the script's arguments
            if (sw.kind === 'value' && !sw.attached) i++;
            continue;
          }
          // A confined run (a check) executes files of its mount only, never inline code.
          if (sw?.kind === 'command') return `"pwsh ${arg}" runs inline code and is not permitted in a check; run a script file of the mount`;
          let file: string | undefined;
          if (!sw) file = arg;
          else if (sw.kind === 'file' && !sw.attached) file = args[i + 1] ?? '';
          else if (!sw.name || sw.attached || !PWSH_CONFINED_SWITCHES.has(sw.name)) {
            return `"pwsh ${arg}" is not permitted in a check; use -File <script of the mount>`;
          } else {
            if (sw.kind === 'value') i++;
            continue;
          }
          const rel = path.relative(path.resolve(confineTo), path.resolve(confineTo, file));
          if (!file || file === '-' || rel.startsWith('..') || path.isAbsolute(rel)) return `"pwsh -File ${file}" is outside the mount`;
          break; // the rest belongs to the script
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * `npx foo` / `npm exec foo` / `pnpm dlx foo` download and run `foo` — an
   * arbitrary package from the registry. Only allow-listed tool names may be
   * run this way, and `--package`/`-p` (which picks the package independently
   * of the command) must name an allow-listed package too.
   */
  private checkPackageRunner(label: string, args: string[], start: number): string | null {
    let target: string | undefined;
    for (let i = start; i < args.length; i++) {
      const arg = args[i]!;
      const flag = flagName(arg);
      if (flag === '--package' || flag === '-p') {
        const pkg = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
        if (!pkg || !this.allowlist.has(packageBaseName(pkg))) {
          return `${label} --package "${pkg ?? ''}" is not an allow-listed tool`;
        }
        continue;
      }
      if (flag === '--') {
        target = args[i + 1];
        break;
      }
      if (arg.startsWith('-')) continue; // other flags (--yes, --no-install, …)
      target = arg;
      break;
    }
    if (!target) return `${label} without an allow-listed tool name is not permitted`;
    if (!this.allowlist.has(packageBaseName(target))) {
      return `${label} "${target}" would download and run an arbitrary package; only allow-listed tools may be run this way`;
    }
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/** `foo`, `foo.exe`, `foo.cmd` — but not `./foo`, `C:\foo`, `bin/foo`, `..`. */
function isBareCommandName(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) return false;
  if (command === '.' || command === '..' || command.includes('..')) return false;
  if (/^[A-Za-z]:/.test(command)) return false;
  if (/[\s\0]/.test(command)) return false;
  return true;
}

/** Strip a Windows executable extension so `node.exe` matches `node`. */
function normaliseCommandName(command: string): string {
  return command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
}

/** `@scope/name@1.2.3` → `name`; `tsc@latest` → `tsc`. */
function packageBaseName(spec: string): string {
  let s = spec.trim().toLowerCase();
  if (s.startsWith('@')) {
    const slash = s.indexOf('/');
    s = slash >= 0 ? s.slice(slash + 1) : s;
  }
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * Locate `name` on PATH (honouring PATHEXT on Windows) and return the
 * absolute path, or `null`. Only regular files count — a directory named
 * `node` does not satisfy the lookup.
 */
export async function resolveOnPath(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const pathVar = env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
    : [''];
  // Windows: an extensionless file is a POSIX shim (`…\npm\pnpm`) and never
  // spawnable; only the executable PATHEXT extensions count (P5-4).
  const candidates = isWin ? exts.filter((e) => WINDOWS_LAUNCHABLE.has(e)) : exts;

  for (const dir of dirs) {
    for (const ext of candidates) {
      const candidate = path.join(dir, name + ext);
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
        if (!isWin) {
          await fs.access(candidate, 1 /* X_OK */);
        }
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

const WINDOWS_LAUNCHABLE = new Set(['.com', '.exe', '.bat', '.cmd']);

/** What `resolveOrThrow` found: the binary, and how it is launched on Windows. */
interface ResolvedCommand {
  name: string;
  binary: string;
  /** `echo` on Windows: the cmd builtin. */
  viaCmdShell: boolean;
  /** A standard npm/pnpm `.cmd` shim: run `node <script>` instead. */
  shim?: { script: string; node: string; nodePath?: string };
  /** Another `.cmd`/`.bat`: run through `%ComSpec% /d /s /c` with escaped arguments. */
  batch?: boolean;
}

/**
 * The target script of a standard npm (`cmd-shim`) or pnpm `.cmd` shim:
 * the quoted `%dp0%`/`%~dp0` path followed by `%*`. Null for any other
 * batch file.
 */
export async function parseNodeShim(file: string): Promise<{ script: string; nodePath?: string } | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  if (text.length > 64 * 1024) return null;
  const target = /"%~?dp0%?\\([^"%]+)"\s+%\*/i.exec(text);
  if (!target) return null;
  const rel = target[1]!;
  if (/^node(\.exe)?$/i.test(rel)) return null;
  const script = path.resolve(path.dirname(file), rel);
  const nodePath = /@?SET\s+"NODE_PATH=([^"]+)"/i.exec(text)?.[1];
  return { script, ...(nodePath && !nodePath.includes('%') ? { nodePath } : {}) };
}

// cmd.exe metacharacters (the cross-spawn rules).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument for `cmd /d /s /c "…"`: quoted, backslashes doubled before quotes, metacharacters caret-escaped. */
export function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  a = a.replace(CMD_META, '^$1');
  if (doubleEscape) a = a.replace(CMD_META, '^$1');
  return a;
}

/** The spawn call for a resolved command. */
function launchPlan(
  r: ResolvedCommand,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; verbatim?: boolean; env?: Record<string, string> } {
  if (r.viaCmdShell) {
    // `echo` is a cmd.exe builtin on Windows — there is no binary to
    // resolve. Run it through the shell but with the command name fixed by
    // us, not by the caller, and every argument passed as its own argv
    // entry (no string interpolation).
    return { command: r.binary, args: ['/d', '/s', '/c', r.name, ...args] };
  }
  if (r.shim) {
    return { command: r.shim.node, args: [r.shim.script, ...args], ...(r.shim.nodePath ? { env: { NODE_PATH: r.shim.nodePath } } : {}) };
  }
  if (r.batch) {
    const comspec = env['ComSpec'] ?? env['COMSPEC'] ?? 'C:\\Windows\\System32\\cmd.exe';
    // A batch file re-parses its arguments once more (the cross-spawn "double escape").
    const line = [r.binary.replace(CMD_META, '^$1'), ...args.map((a) => escapeCmdArgument(a, true))].join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { command: r.binary, args };
}

/** Kill a child and everything it started (on Windows `taskkill /T`; a shim's node has children). */
function killTree(proc: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => proc.kill('SIGKILL'));
      return;
    } catch {
      /* fall through */
    }
  }
  proc.kill('SIGKILL');
}
