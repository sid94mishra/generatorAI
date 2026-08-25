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
import { isPtyHostRequest } from '@generatorai/shared';
import { PtySession } from './PtySession.js';

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
        const { reqId, sessionId, cols, rows, cwd, env } = req;
        if (this.sessions.has(sessionId)) {
          this.send({ type: 'error', reqId, ok: false, message: `Session ${sessionId} already exists`, sessionId });
          return;
        }
        try {
          const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');
          const ptyProcess = spawn(shell, [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env: { ...process.env, ...env } as Record<string, string>,
          });

          const session = new PtySession({
            sessionId,
            pty: ptyProcess,
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
