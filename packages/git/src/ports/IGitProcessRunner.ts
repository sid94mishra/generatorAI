// ────────────────────────────────────────────────────────────────
// IGitProcessRunner — minimal process runner port for git operations
// ────────────────────────────────────────────────────────────────
//
// Structurally compatible with @generatorai/core's `IScriptRunner` so the
// existing sandboxed / host runners satisfy it without any adapter. The git
// package only needs `run`, so we keep the surface minimal.

export interface GitProcessRunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
  abortSignal?: AbortSignal;
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface GitProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface IGitProcessRunner {
  run(
    command: string,
    args: string[],
    options: GitProcessRunOptions,
  ): Promise<GitProcessRunResult>;
}
