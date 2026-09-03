/**
 * W12 / W20 — HostSupervisor.
 *
 * The child process is injected (`forkChild`) so the restart predicate, the
 * re-attach handshake and the fatal path are exercised directly instead of
 * through 5 real Node forks per case.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ILogger } from '@generatorai/shared';
import { HostSupervisor, type HostSupervisorOptions } from '../HostSupervisor.js';

class FakeChild extends EventEmitter {
  connected = true;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly sent: unknown[] = [];
  killed = false;
  /** Every signal this child was sent, in order — SIGTERM then, if it hangs, SIGKILL. */
  readonly killSignals: string[] = [];

  send(msg: unknown, cb?: (err: Error | null) => void): boolean {
    this.sent.push(msg);
    cb?.(null);
    return true;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.killSignals.push(signal ?? 'SIGTERM');
    return true;
  }

  /** Answer the boot handshake. */
  signalReady(): void {
    this.emit('message', { type: 'pong', reqId: '__ready__' });
  }

  crash(code = 1): void {
    this.connected = false;
    this.emit('exit', code, null);
  }

  asChild(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

function silentLogger(): ILogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (m: string) => { lines.push(`${level}: ${m}`); };
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } as unknown as ILogger & { lines: string[] };
}

interface Rig {
  supervisor: HostSupervisor;
  children: FakeChild[];
  logger: ILogger & { lines: string[] };
  restarts: Array<() => void>;
  runPendingRestart: () => void;
}

type RigOverrides = Partial<Omit<HostSupervisorOptions, 'logger'>>;

function makeRig(opts: RigOverrides = {}): Rig {
  const logger = silentLogger();
  const children: FakeChild[] = [];
  const restarts: Array<() => void> = [];
  const supervisor = new HostSupervisor({
    hostEntryPath: '/fake/agent-host.js',
    logger,
    forkChild: () => {
      const child = new FakeChild();
      children.push(child);
      // The real host sends __ready__ as soon as it boots.
      setImmediate(() => child.signalReady());
      return child.asChild();
    },
    scheduleRestart: (fn) => { restarts.push(fn); },
    ...opts,
  });
  return {
    supervisor,
    children,
    logger,
    restarts,
    runPendingRestart: () => {
      const fn = restarts.shift();
      fn?.();
    },
  };
}

describe('HostSupervisor', () => {
  it('starts, reports state, and forwards streamed notifications', async () => {
    const events: unknown[] = [];
    const rig = makeRig({ onHostEvent: (msg: unknown) => events.push(msg) });
    await rig.supervisor.start();
    expect(rig.supervisor.getState()).toBe('running');

    rig.children[0]!.emit('message', { type: 'agent_event', sessionId: 's1', event: { kind: 'harness.token', data: { text: 'x' } }, seq: 1 });
    rig.children[0]!.emit('message', { type: 'session_ended', sessionId: 's1', reason: 'complete' });
    expect(events).toHaveLength(2);
  });

  it('calls onHostRestart after a RESTARTED host signals ready, not on first boot', async () => {
    // Regression: the restarted host boots with EMPTY session maps while the
    // client keeps its handler map, so every later turn fails
    // SESSION_NOT_FOUND forever and health stays green.
    const onHostRestart = vi.fn(async () => {});
    const rig = makeRig({ onHostRestart });

    await rig.supervisor.start();
    expect(onHostRestart).not.toHaveBeenCalled();

    rig.children[0]!.crash();
    expect(rig.restarts).toHaveLength(1);
    rig.runPendingRestart();
    await vi.waitFor(() => expect(onHostRestart).toHaveBeenCalledTimes(1));
    expect(rig.supervisor.getState()).toBe('running');
  });

  it('does NOT restart on an unrecoverable failure, and reports it', async () => {
    // W20: the restart predicate must be conditional, not purely count-based.
    const onFatal = vi.fn();
    const rig = makeRig({ onFatal });
    await rig.supervisor.start();

    rig.children[0]!.stderr.emit('data', Buffer.from("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/fake/agent-host.js'"));
    rig.children[0]!.crash();

    expect(rig.restarts).toHaveLength(0);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(rig.supervisor.getState()).toBe('fatal');
    expect(rig.supervisor.getFatalReason()).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('treats an ENOENT spawn error as unrecoverable', async () => {
    const onFatal = vi.fn();
    const rig = makeRig({ onFatal });
    await rig.supervisor.start();

    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    rig.children[0]!.emit('error', err);
    rig.children[0]!.crash();

    expect(rig.restarts).toHaveLength(0);
    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining('spawn ENOENT'));
  });

  it('restarts on a recoverable crash', async () => {
    const rig = makeRig();
    await rig.supervisor.start();
    rig.children[0]!.stderr.emit('data', Buffer.from('provider connection reset'));
    rig.children[0]!.crash();
    expect(rig.restarts).toHaveLength(1);
    expect(rig.supervisor.getState()).toBe('restarting');
  });

  it('reports restart-cap exhaustion instead of failing silently forever', async () => {
    // Regression: exhaustion set `stopped = true`, `spawn()` threw forever, and
    // nothing was told — the gateway reported the harness healthy.
    const onFatal = vi.fn();
    const rig = makeRig({ onFatal });
    await rig.supervisor.start();

    for (let i = 0; i < 7; i++) {
      const child = rig.children[rig.children.length - 1]!;
      child.stderr.emit('data', Buffer.from('boom'));
      child.crash();
      if (rig.restarts.length > 0) {
        rig.runPendingRestart();
        await vi.waitFor(() => expect(rig.children.length).toBe(i + 2));
      }
      if (onFatal.mock.calls.length > 0) break;
    }

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(rig.supervisor.getState()).toBe('fatal');
    await expect(rig.supervisor.send({ type: 'ping' })).rejects.toThrow(/state=fatal/);
  });

  it('restart() clears a fatal state so recovery is possible', async () => {
    const rig = makeRig({ onFatal: () => {} });
    await rig.supervisor.start();
    rig.children[0]!.stderr.emit('data', Buffer.from('SyntaxError: unexpected token'));
    rig.children[0]!.crash();
    expect(rig.supervisor.getState()).toBe('fatal');

    await rig.supervisor.restart();
    expect(rig.supervisor.getState()).toBe('running');
    await expect(rig.supervisor.send({ type: 'ping' })).resolves.toBeDefined;
  });

  // ── B2: restart() must replace the host, not clone it ──────────────────────
  it('restart() does not leave the old host running or detach from the new one', async () => {
    // Regression (BLOCKER B2): restart() killed the old child and immediately
    // nulled `this.child`, but left the OLD child's exit handler armed. SIGTERM
    // is asynchronous, so that handler fired AFTER the replacement was up and
    // (a) set `this.child = null`, detaching the supervisor from the live
    // replacement, and (b) scheduled another restart, forking a THIRD process.
    // Result: two live agent-host processes, the supervisor talking to neither.
    const rig = makeRig();
    await rig.supervisor.start();
    const first = rig.children[0]!;

    await rig.supervisor.restart();
    expect(rig.children).toHaveLength(2);
    const second = rig.children[1]!;
    expect(first.killSignals[0]).toBe('SIGTERM');

    // The SIGTERM finally lands, after the replacement is already serving.
    first.crash(0);

    expect(rig.restarts).toHaveLength(0);
    expect(rig.children).toHaveLength(2);
    expect(rig.supervisor.getState()).toBe('running');

    // Still attached to the survivor.
    const pending = rig.supervisor.send({ type: 'ping' });
    const sent = second.sent[second.sent.length - 1] as { reqId: string };
    second.emit('message', { type: 'pong', reqId: sent.reqId });
    await expect(pending).resolves.toMatchObject({ type: 'pong' });
  });

  it('escalates to SIGKILL when a host ignores SIGTERM', async () => {
    // The other half of "two live processes": a wedged host that never acts on
    // SIGTERM outlives its replacement, and nothing ever kills it.
    const rig = makeRig({ stopGraceMs: 20 });
    await rig.supervisor.start();
    const first = rig.children[0]!;

    await rig.supervisor.restart();
    await new Promise((r) => setTimeout(r, 80));
    expect(first.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('does not SIGKILL a host that exited on SIGTERM', async () => {
    const rig = makeRig({ stopGraceMs: 20 });
    await rig.supervisor.start();
    const first = rig.children[0]!;

    await rig.supervisor.restart();
    first.crash(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(first.killSignals).toEqual(['SIGTERM']);
  });

  it('correlates responses by reqId', async () => {
    const rig = makeRig();
    await rig.supervisor.start();
    const child = rig.children[0]!;

    const promise = rig.supervisor.send({ type: 'ping' });
    const sent = child.sent[0] as { reqId: string };
    child.emit('message', { type: 'pong', reqId: sent.reqId });
    await expect(promise).resolves.toMatchObject({ type: 'pong' });
  });

  it('ignores messages that are not AgentHostResponses', async () => {
    const events: unknown[] = [];
    const rig = makeRig({ onHostEvent: (m: unknown) => events.push(m) });
    await rig.supervisor.start();
    // Regression: `isAgentHostResponse` accepted any object with a string type.
    rig.children[0]!.emit('message', { type: 'spawn_session', reqId: 'x', sessionId: 's' });
    rig.children[0]!.emit('message', { type: 'agent_event' }); // no sessionId
    expect(events).toHaveLength(0);
  });
});
