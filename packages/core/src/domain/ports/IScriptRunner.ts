// ────────────────────────────────────────────────────────────────
// IScriptRunner — Port interface for sandboxed script execution
// ────────────────────────────────────────────────────────────────

export interface ScriptRunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
  abortSignal?: AbortSignal;
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface IScriptRunner {
  run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult>;
  isAvailable(command: string): Promise<boolean>;
}
