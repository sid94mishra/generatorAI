// Child-process helpers for the device bridges: argv only (never a shell), a
// timeout on every call, and stdout as bytes or text.

import { execFile } from 'node:child_process';

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Max stdout bytes kept (default 64 MB: a full-resolution PNG fits). */
  maxBuffer?: number;
}

export class RunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | string | null,
  ) {
    super(message);
  }
}

export function runBytes(file: string, args: readonly string[], options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'buffer',
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.env ? { env: options.env } : {}),
      },
      (err, stdout, stderr) => {
        if (err) {
          const text = stderr.toString('utf8').trim();
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code ?? null;
          reject(new RunError(`${file.split(/[\\/]/).pop()} ${args.slice(0, 3).join(' ')} failed: ${text || err.message}`, text, code));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function runText(file: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
  return (await runBytes(file, args, options)).toString('utf8');
}
