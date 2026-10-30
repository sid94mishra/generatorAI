// F-4 (D-128) — the packaged app runs the embedded server in an Electron
// utility process; ServerManager talks to it through the same ServerChild
// shape as the dev-mode Node child.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { forkUtilityServer } from '../server-child';
import { inheritedServerEnv } from '../server-manager';

vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../paths', () => ({ resolvePaths: () => ({}), ensureDataDirs: vi.fn(), fileExists: () => false }));

function fakeUtility() {
  const proc = Object.assign(new EventEmitter(), {
    pid: 4242 as number | undefined,
    stdout: null,
    stderr: null,
    postMessage: vi.fn(),
    kill: vi.fn(() => true),
  });
  return proc;
}

describe('forkUtilityServer', () => {
  it('forks the bundle with the env, cwd and piped stdio, and adapts messages, errors and exit', () => {
    const proc = fakeUtility();
    const fork = vi.fn(() => proc);
    const child = forkUtilityServer('/r/server/server.mjs', { cwd: '/r', env: { A: '1' }, serviceName: 'GeneratorAI Server' }, fork as never);
    expect(fork).toHaveBeenCalledWith('/r/server/server.mjs', [], { cwd: '/r', env: { A: '1' }, stdio: 'pipe', serviceName: 'GeneratorAI Server' });
    expect(child.kind).toBe('utility');
    expect(child.pid).toBe(4242);

    const messages: unknown[] = [];
    child.onMessage((m) => messages.push(m));
    proc.emit('message', { type: 'secret-key-request' });
    expect(messages).toEqual([{ type: 'secret-key-request' }]);

    const errors: Error[] = [];
    child.onError((e) => errors.push(e));
    proc.emit('error', 'FatalError', 'v8::Something', '{}');
    expect(errors[0]?.message).toContain('FatalError');

    expect(child.send({ type: 'shutdown' })).toBe(true);
    expect(proc.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });

    const exits: Array<[number | null, NodeJS.Signals | null]> = [];
    child.onExit((code, signal) => exits.push([code, signal]));
    proc.emit('exit', 3);
    expect(exits).toEqual([[3, null]]);
    // Nothing to send on once it has exited: the caller falls back to terminate().
    expect(child.send({ type: 'shutdown' })).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('terminate() asks Electron to end it (SIGTERM, reaped)', () => {
    const proc = fakeUtility();
    const child = forkUtilityServer('/m', { cwd: '/', env: {}, serviceName: 's' }, (() => proc) as never);
    child.terminate();
    expect(proc.kill).toHaveBeenCalled();
  });
});

describe('inheritedServerEnv', () => {
  it('passes the user environment through but never ELECTRON_RUN_AS_NODE', () => {
    const env = inheritedServerEnv({ PATH: '/bin', ANTHROPIC_BASE_URL: 'x', ELECTRON_RUN_AS_NODE: '1' });
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_BASE_URL: 'x' });
  });
});
