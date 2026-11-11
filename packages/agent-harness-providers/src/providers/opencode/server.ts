// ────────────────────────────────────────────────────────────────
// The OpenCode 2 server a provider talks to: spawn, auth, version gate.
//
// `opencode serve --stdio --port 0` (cli `server-process.ts`, mode "stdio") is
// a private, lease-owned server: it binds an ephemeral loopback port, prints
// ONE JSON line `{"url":"http://127.0.0.1:PORT"}`, and exits when its stdin
// closes — so it cannot outlive this process even when we are killed. It never
// runs OpenCode's restart sweep (only the managed `--service` does). The
// password comes from `OPENCODE_PASSWORD`, which the server then deletes from
// its own environment so the tools it runs never see it; every request
// authenticates with HTTP Basic, user `opencode`.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** The lowest OpenCode release whose HTTP API this provider speaks. */
export const MIN_OPENCODE_VERSION = '2.0.0';

/** `GET /api/info` (openapi `ServerInfo`). */
export interface OpenCodeServerInfo {
  version: string;
  pid: number;
  urls?: string[];
}

export class OpenCodeVersionError extends Error {}

/** `a.b.c` compare; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function updateOpenCodeMessage(found: string): string {
  return (
    `OpenCodeProvider: ${found}; GeneratorAI needs OpenCode ${MIN_OPENCODE_VERSION} or later. ` +
    'Update OpenCode (`npm i -g @opencode/cli@latest`, `brew upgrade anomalyco/tap/opencode-v2`, or the installer at https://opencode.ai), then restart GeneratorAI.'
  );
}

export function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
}

/**
 * Ask the server who it is and refuse anything older than OpenCode 2. A 1.x
 * server has no `/api/*` routes and answers 404; one that answers 401 was
 * reached with the wrong credential.
 */
export async function checkServer(url: string, auth: string, timeoutMs: number): Promise<OpenCodeServerInfo> {
  const resp = await fetch(`${url}/api/info`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (resp.status === 404) {
    await resp.body?.cancel().catch(() => undefined);
    throw new OpenCodeVersionError(updateOpenCodeMessage(`the server at ${url} is OpenCode 1 (it has no /api/info)`));
  }
  if (resp.status === 401) {
    await resp.body?.cancel().catch(() => undefined);
    throw new Error(`OpenCodeProvider: the OpenCode server at ${url} refused the credential (HTTP 401). Set the server's password.`);
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`OpenCodeProvider: GET /api/info failed with HTTP ${resp.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  const info = (await resp.json()) as OpenCodeServerInfo;
  if (typeof info?.version !== 'string' || compareVersions(info.version, MIN_OPENCODE_VERSION) < 0) {
    throw new OpenCodeVersionError(updateOpenCodeMessage(`the server reports OpenCode ${String(info?.version)}`));
  }
  return info;
}

export interface SpawnedServer {
  url: string;
  password: string;
  proc: ChildProcess;
  /** Resolves when the process has exited (for any reason). */
  exited: Promise<number | null>;
  stderrTail(): string;
}

export interface SpawnServerOptions {
  command: string;
  argsPrefix: string[];
  cwd?: string;
  env: Record<string, string>;
  startupTimeoutMs: number;
}

/** Spawn `opencode serve --stdio --port 0` and read the URL it announces. */
export async function spawnServer(opts: SpawnServerOptions): Promise<SpawnedServer> {
  const password = randomBytes(32).toString('base64url');
  const args = [...opts.argsPrefix, 'serve', '--stdio', '--port', '0'];
  const proc = spawn(opts.command, args, {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    env: { ...opts.env, OPENCODE_PASSWORD: password },
    // stdin is the lease: closing it (or our death) stops the server.
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (c: string) => { stderr = (stderr + c).slice(-8_192); });
  const exited = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
    proc.once('error', () => resolve(null));
  });
  const describe = `\`${opts.command} ${args.join(' ')}\``;
  const withStderr = (msg: string): string => (stderr.trim() ? `${msg}\n--- opencode stderr ---\n${stderr.trim()}` : msg);

  let stdout = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(withStderr(`OpenCodeProvider: ${describe} did not announce its address within ${opts.startupTimeoutMs} ms.`))), opts.startupTimeoutMs);
    timer.unref?.();
    const done = (fn: () => void): void => { clearTimeout(timer); proc.stdout?.off('data', onData); fn(); };
    const onData = (chunk: string): void => {
      stdout += chunk;
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
          // OpenCode 1 has no --stdio: it prints "opencode server listening on …" instead.
          if (/listening on https?:\/\//.test(trimmed)) {
            done(() => reject(new OpenCodeVersionError(updateOpenCodeMessage(`${opts.command} is OpenCode 1 (it does not support \`serve --stdio\`)`))));
            return;
          }
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as { url?: unknown };
          if (typeof parsed.url === 'string') { done(() => resolve(parsed.url as string)); return; }
        } catch { /* a partial line — wait for more */ }
      }
    };
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', onData);
    proc.once('error', (err) => done(() => reject(new Error(
      (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `OpenCodeProvider: the OpenCode binary "${opts.command}" was not found. Install OpenCode 2, or set OPENCODE_BIN.`
        : `OpenCodeProvider: could not start ${describe}: ${err.message}`,
    ))));
    proc.once('exit', (code) => done(() => {
      const unknownFlag = /unknown (option|argument|flag).*stdio|stdio.*(unknown|unrecognized)/i.test(stderr);
      reject(unknownFlag
        ? new OpenCodeVersionError(updateOpenCodeMessage(`${opts.command} does not support \`serve --stdio\` (OpenCode 1)`))
        : new Error(withStderr(`OpenCodeProvider: ${describe} exited with code ${code} before it was ready.`)));
    }));
  }).catch(async (err: unknown) => {
    await stopProcess(proc, exited, 2_000);
    throw err;
  });
  return { url: url.replace(/\/$/, ''), password, proc, exited, stderrTail: () => stderr };
}

/** End the lease (stdin), then SIGTERM, then SIGKILL. */
export async function stopProcess(proc: ChildProcess, exited: Promise<unknown>, graceMs: number): Promise<void> {
  if (proc.exitCode != null || proc.signalCode != null) return;
  const waitExit = (ms: number): Promise<boolean> =>
    Promise.race([exited.then(() => true), new Promise<boolean>((r) => { const t = setTimeout(() => r(false), ms); t.unref?.(); })]);
  try { proc.stdin?.end(); } catch { /* already closed */ }
  if (await waitExit(graceMs)) return;
  proc.kill('SIGTERM');
  if (await waitExit(graceMs)) return;
  proc.kill('SIGKILL');
  await waitExit(graceMs);
}
