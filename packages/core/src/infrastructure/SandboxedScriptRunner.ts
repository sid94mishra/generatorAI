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
//      not itself allow-listed.
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

/**
 * Commands runnable without any operator opt-in. Interpreters and the
 * tooling the product's own templates/hooks rely on — nothing that can
 * fetch from the network or destroy a tree on its own.
 */
export const DEFAULT_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'git',
  'python',
  'python3',
  'pip',
  'pip3',
  'pwsh',
  'echo',
  'gh',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'jq',
]);

/**
 * Commands the previous allow-list shipped by default that now require an
 * explicit `scripts.extraAllowlist` entry. Listed so the refusal message can
 * tell the operator exactly which knob enables them.
 */
export const OPT_IN_COMMANDS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'curl',
  'wget',
  'rm',
  'chmod',
  'mv',
  'cp',
  'find',
  'sed',
  'awk',
  'tar',
  'zip',
  'unzip',
]);

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
const PWSH_ENCODED_FLAGS = new Set(['-encodedcommand', '-ec', '-e']);

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
    const resolved = await this.resolveOrThrow(command, args);

    const timeout = options.timeout ?? this.defaultTimeout;
    const processId = randomUUID();
    const startTime = Date.now();

    let spawnCmd = resolved.binary;
    let spawnArgs = args;
    if (resolved.viaCmdShell) {
      // `echo` is a cmd.exe builtin on Windows — there is no binary to
      // resolve. Run it through the shell but with the command name fixed by
      // us, not by the caller, and every argument passed as its own argv
      // entry (no string interpolation).
      spawnCmd = resolved.binary;
      spawnArgs = ['/d', '/s', '/c', resolved.name, ...args];
    }

    this.logger.info(`[ScriptRunner] Executing: ${spawnCmd} ${spawnArgs.join(' ')} (pid=${processId})`);

    return new Promise<ScriptRunResult>((resolve) => {
      const proc = spawn(spawnCmd, spawnArgs, {
        cwd: options.cwd ? path.resolve(options.cwd) : undefined,
        // Workflow scripts are model-authorable, so this child gets an
        // allowlisted environment rather than a clone of the server's — a
        // clone would hand a generated `.workflow.mjs` the vault key, the
        // desktop admin token, DATABASE_URL and every provider credential.
        env: buildChildEnv(options.env ? { extra: options.env } : {}),
        shell: false, // Never use shell to prevent injection
        stdio: [options.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        timeout,
      });

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

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= this.maxOutput) {
          stdout += chunk.toString();
        }
        options.streamTo?.(chunk.toString(), 'stdout');
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= this.maxOutput) {
          stderr += chunk.toString();
        }
        options.streamTo?.(chunk.toString(), 'stderr');
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
        this.logger.warn(`[ScriptRunner] Process ${processId} timed out after ${timeout}ms`);
      }, timeout);

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          killed = true;
          proc.kill('SIGKILL');
        }, { once: true });
      }

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);

        resolve({
          exitCode: killed ? -1 : (code ?? -1),
          stdout: stdout.trimEnd(),
          stderr: killed
            ? `Process timed out after ${timeout}ms\n${stderr}`.trimEnd()
            : stderr.trimEnd(),
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - startTime,
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

  private async resolveOrThrow(
    command: string,
    args: string[],
  ): Promise<{ name: string; binary: string; viaCmdShell: boolean }> {
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
    const escape = this.checkInterpreterEscapes(name, args);
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
    return { name, binary, viaCmdShell: false };
  }

  private checkInterpreterEscapes(name: string, args: string[]): string | null {
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
        for (const arg of args) {
          if (PWSH_ENCODED_FLAGS.has(flagName(arg))) {
            return `"pwsh ${arg}" runs an encoded command and is not permitted`;
          }
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
  const candidates = isWin ? ['', ...exts] : exts;

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
