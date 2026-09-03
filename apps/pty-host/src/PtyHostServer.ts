/**
 * W14 — PTY Host server process.
 *
 * Receives IPC requests from the gateway, manages node-pty sessions, and
 * streams data notifications back. The gateway never holds PTY handles (L5).
 */

import { spawn } from 'node-pty';
import type {
  PtyHostRequest,
  PtyHostResponse,
  PtyDataNotification,
  PtyExitNotification,
  PtySessionReadyNotification,
} from '@generatorai/shared';
import { buildChildEnv, isPtyHostRequest } from '@generatorai/shared';
import { PtySession } from './PtySession.js';

/**
 * Mirrors `NodePtyHost.buildShellArgs` (packages/core) so switching to the
 * out-of-process host doesn't regress PowerShell startup latency — loading
 * the user's profile takes ~2s vs ~200ms without it, per that file's own
 * measurement.
 */
function buildShellArgs(shell: string, extra?: string[]): string[] {
  const base = extra ?? [];
  if (process.platform === 'win32') {
    const low = shell.toLowerCase();
    if (low.endsWith('pwsh.exe') || low.endsWith('powershell.exe')) {
      const has = (a: string) => base.some((x) => x.toLowerCase() === a);
      const inject: string[] = [];
      if (!has('-nologo')) inject.push('-NoLogo');
      if (!has('-noprofile')) inject.push('-NoProfile');
      return [...inject, ...base];
    }
  }
  return base;
}

export class PtyHostServer {
  /* W14 */
  private readonly sessions = new Map<string, PtySession>();
  private readonly bootTime = Date.now();

  start(): void {
    if (typeof process.send !== 'function') {
      throw new Error('[PtyHostServer] Not running as a forked child process — process.send unavailable');
    }

    process.on('message', (raw: unknown) => {
      if (!isPtyHostRequest(raw)) {
        console.warn('[PtyHostServer] Received unrecognised IPC message');
        return;
      }
      this.handleRequest(raw as PtyHostRequest).catch((err: unknown) => {
        console.error(`[PtyHostServer] Unhandled error: ${String(err)}`);
      });
    });

    this.send({ type: 'pong', reqId: '__ready__' });
    console.log('[PtyHostServer] PTY host ready');
  }

  private send(msg: PtyHostResponse): void {
    process.send!(msg);
  }

  private async handleRequest(req: PtyHostRequest): Promise<void> {
    switch (req.type) {
      case 'ping':
        this.send({ type: 'pong', reqId: req.reqId });
        return;

      case 'create_session': {
        const { reqId, sessionId, cols, rows, cwd, env, shellArgs } = req;
        if (this.sessions.has(sessionId)) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} already exists`, sessionId });
          return;
        }
        try {
          const shell = req.shell ?? (process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash'));
          const args = buildShellArgs(shell, shellArgs);
          const ptyProcess = spawn(shell, args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            // Allowlist, not a clone. This host inherits the gateway's own
            // environment, so cloning it here would put the vault key, the
            // desktop admin token and every provider credential inside a
            // shell the agent can type into.
            env: buildChildEnv({
              passthrough: ['EDITOR', 'VISUAL', 'PAGER', 'LESS'],
              ...(env ? { extra: env } : {}),
            }),
          });

          const session = new PtySession({
            sessionId,
            pty: ptyProcess,
            // The headless VT model needs the same geometry as the PTY, or its
            // rendered scrollback wraps at a different column than the client's.
            cols,
            rows,
            onData: (chunk) => {
              const notification: PtyDataNotification = { type: 'data', sessionId, chunk };
              this.send(notification);
            },
            onExit: (code) => {
              const notification: PtyExitNotification = { type: 'exit', sessionId, code };
              this.send(notification);
              this.sessions.delete(sessionId);
            },
          });

          this.sessions.set(sessionId, session);

          const ready: PtySessionReadyNotification = { type: 'session_ready', sessionId, pid: session.pid };
          this.send(ready);
          this.send({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), sessionId });
        }
        return;
      }

      case 'write': {
        const { reqId, sessionId, data } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        session.write(data);
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'resize': {
        const { reqId, sessionId, cols, rows } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        session.resize(cols, rows);
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'signal': {
        const { reqId, sessionId, signal } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        session.signal(signal);
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'pause': {
        const { reqId, sessionId } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        session.pause();
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'resume': {
        const { reqId, sessionId } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        session.resume();
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'destroy': {
        const { reqId, sessionId } = req;
        const session = this.sessions.get(sessionId);
        if (session) {
          session.destroy();
          this.sessions.delete(sessionId);
        }
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'ack': {
        const { reqId, sessionId, bytesConsumed } = req;
        const session = this.sessions.get(sessionId);
        if (session) {
          session.creditAck(bytesConsumed);
        }
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'scrollback': {
        const { reqId, sessionId, tailLines } = req;
        const session = this.sessions.get(sessionId);
        if (!session) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} not found`, sessionId });
          return;
        }
        this.send({
          type: 'scrollback',
          reqId,
          ok: true,
          sessionId,
          lines: session.scrollbackLines(tailLines ?? 0),
          vt: session.hasVtModel,
        });
        return;
      }

      default: {
        const unknown = req as { type: string; reqId?: string };
        console.warn(`[PtyHostServer] Unknown request type: ${unknown.type}`);
        if (unknown.reqId) {
          this.send({ type: 'error', reqId: unknown.reqId, ok: false, message: `Unknown type: ${unknown.type}` });
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
    console.log('[PtyHostServer] Shutdown complete');
  }
}
