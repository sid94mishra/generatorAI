// ────────────────────────────────────────────────────────────────
// IScriptRunner — Port interface for sandboxed script execution
// ────────────────────────────────────────────────────────────────

export interface ScriptRunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
  abortSignal?: AbortSignal;
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
  /**
   * Text written to the child's stdin, then closed. Only server code can set
   * this — a model-authored hook config carries `command`/`args`/`cwd`/`env`
   * and nothing else — which is what lets `HookExecutor` feed `node -` its
   * fixed function-hook runner without the runner having to permit the
   * `node -e` escape hatch for everyone.
   */
  stdin?: string;
  /**
   * A confined run (a `check` stage, P05 §1.2): `pwsh` may run a script
   * file of this directory only, never inline code (`-Command`, `-c`).
   */
  confineTo?: string;
  /** Keep the END of an output longer than the cap instead of its start (a check's tails). */
  keepTail?: boolean;
}

export interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** The process never started (ENOENT, EINVAL, EACCES, …): the spawn error code. */
  launchError?: string;
  /** Killed by the timeout. */
  timedOut?: boolean;
}

/** Outcome of checking a command line against the runner's policy without running it. */
export interface ScriptCommandValidation {
  ok: boolean;
  /** Why the command would be refused (present when `ok` is false). */
  reason?: string;
  /** Absolute binary the runner would spawn (present when `ok` is true). */
  resolvedCommand?: string;
}

export interface IScriptRunner {
  run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult>;
  isAvailable(command: string): Promise<boolean>;
  /**
   * Apply the same policy `run()` enforces — allow-list, path resolution,
   * dangerous-pattern scan — WITHOUT spawning anything. Used by hook dry
   * runs. Optional so third-party runners keep compiling.
   */
  validate?(command: string, args: string[]): Promise<ScriptCommandValidation>;
  /** The effective allow-list (defaults plus the operator's extras): the builder's command picker, check validation. */
  getAllowlist?(): string[];
}
