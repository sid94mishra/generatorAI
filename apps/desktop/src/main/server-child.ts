// ────────────────────────────────────────────────────────────────
// The embedded server's process, behind one shape for the two ways it runs
// (F-4, D-128):
//
//   • packaged app → an Electron utility process (`utilityProcess.fork`).
//     Electron's own Node, no ELECTRON_RUN_AS_NODE — which is what lets the
//     packaged binary ship with the RunAsNode fuse off. Its channel is
//     `postMessage` / `process.parentPort` in the child.
//   • unpackaged / dev, or an explicit GENERATORAI_DESKTOP_NODE → a plain Node
//     child (`child_process.spawn` with an 'ipc' slot), because the workspace's
//     native modules are built for system Node and the source runs through tsx.
//
// ServerManager owns the lifecycle; this module only adapts the two APIs.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import type { UtilityProcess } from 'electron';

export interface ServerChild {
  readonly kind: 'utility' | 'node';
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  /** `signal` is always null for a utility process (Electron reports the code only). */
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  onceExit(listener: () => void): void;
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: Error) => void): void;
  /** Sends over the channel; false when there is none to send on. */
  send(message: unknown): boolean;
  /** SIGTERM on POSIX; on Windows, where nothing can observe a signal, the whole tree is ended. */
  terminate(): void;
  /** Ends the process tree now (SIGKILL / `taskkill /t /f`). */
  forceKill(): void;
}

function killTree(pid: number | undefined, fallback: () => void): void {
  if (process.platform === 'win32' && pid) {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    return;
  }
  fallback();
}

/** A Node child with an IPC slot — dev mode and GENERATORAI_DESKTOP_NODE. */
export function spawnNodeServer(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ServerChild {
  const child: ChildProcess = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    // The 'ipc' channel lets the server be asked to shut down gracefully on
    // Windows (a SIGTERM there is TerminateProcess), and carries the vault key.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  return {
    kind: 'node',
    get pid() {
      return child.pid;
    },
    stdout: child.stdout,
    stderr: child.stderr,
    onExit: (listener) => void child.on('exit', listener),
    onceExit: (listener) => void child.once('exit', () => listener()),
    onMessage: (listener) => void child.on('message', listener),
    onError: (listener) => void child.on('error', listener),
    send: (message) => (child.connected ? child.send(message as never) : false),
    terminate: () => killTree(child.pid, () => child.kill('SIGTERM')),
    forceKill: () => killTree(child.pid, () => child.kill('SIGKILL')),
  };
}

interface UtilityProcessLike {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: 'exit', listener: (code: number) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'error', listener: (type: string, location: string, report: string) => void): unknown;
  postMessage(message: unknown): void;
  kill(): boolean;
}

/** The packaged app: the server runs in an Electron utility process. */
export function forkUtilityServer(
  modulePath: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; serviceName: string },
  fork: (modulePath: string, args: string[], options: object) => UtilityProcessLike = defaultFork,
): ServerChild {
  const child = fork(modulePath, [], {
    cwd: options.cwd,
    env: options.env,
    stdio: 'pipe',
    serviceName: options.serviceName,
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  return {
    kind: 'utility',
    get pid() {
      return child.pid;
    },
    get stdout() {
      return child.stdout;
    },
    get stderr() {
      return child.stderr;
    },
    onExit: (listener) => void child.on('exit', (code) => listener(code, null)),
    onceExit: (listener) => void child.once('exit', () => listener()),
    onMessage: (listener) => void child.on('message', listener),
    onError: (listener) =>
      void child.on('error', (type, location) => listener(new Error(`${type} at ${location}`))),
    send: (message) => {
      if (exited) return false;
      child.postMessage(message);
      return true;
    },
    terminate: () => killTree(child.pid, () => void child.kill()),
    forceKill: () =>
      killTree(child.pid, () => {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }),
  };
}

function defaultFork(modulePath: string, args: string[], options: object): UtilityProcessLike {
  // Loaded on use: unit tests import ServerManager without an Electron runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require('electron') as { utilityProcess: { fork: (m: string, a: string[], o: object) => UtilityProcess } };
  return utilityProcess.fork(modulePath, args, options) as unknown as UtilityProcessLike;
}
