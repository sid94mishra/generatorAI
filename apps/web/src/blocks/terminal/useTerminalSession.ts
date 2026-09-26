// ────────────────────────────────────────────────────────────────
// useTerminalSession — one server PTY per (workspace, dock tab) (03 §6.7).
//
// Lookup-or-create over REST (`hooks/terminalQueries.ts`), scrollback replay,
// then a WebSocket authorised by a single-use ticket
// (`buildAuthenticatedSocketUrl`):
//   • binary frames → xterm, ACK every ≥ 64 KB written (server watermarks);
//   • JSON frames → ready / exit / error;
//   • client sends `input`, `resize`, `ack`, `kill`.
// The sid is cached in localStorage per (workspace, tab) so a reload
// re-attaches while the server still has the session. Unmount kills it (WS
// `kill` first — a DELETE racing unmount is regularly aborted — then DELETE
// with keepalive). Must be called AFTER `useXtermInstance` in the same
// component so the terminal exists when the session effect runs.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as Xterm } from '@xterm/xterm';
import type { TerminalSessionDescriptor } from '@generatorai/shared';
import { buildAuthenticatedSocketUrl } from '@/platform/authTransport.js';
import { liveViewTransport } from '@/platform/surfaceCapabilities.js';
import {
  createTerminalSession,
  describeTerminalSession,
  fetchTerminalScrollback,
  killTerminalSession,
  terminalStreamPath,
} from '@/hooks/terminalQueries.js';

/** ACK the server every ~64 KB of output written into xterm. */
const ACK_BYTE_INTERVAL = 64 * 1024;

const sidStorageKey = (workspaceId: string, tabId: string): string => `generatorai:terminal:${workspaceId}:${tabId}`;

type ServerFrame =
  | { t: 'ready'; descriptor: TerminalSessionDescriptor }
  | { t: 'exit'; code: number; signal?: string }
  | { t: 'resized'; cols: number; rows: number }
  | { t: 'error'; message: string };

export interface TerminalExit {
  code: number;
  signal?: string;
}

export interface TerminalSession {
  descriptor: TerminalSessionDescriptor | null;
  connecting: boolean;
  error: string | null;
  exit: TerminalExit | null;
  /** Types `cd "<path>"⏎` into the shell; a no-op while the socket is closed. */
  cd: (path: string) => void;
  /** Ends the PTY; the exit frame then arrives over the socket. */
  kill: () => Promise<void>;
}

export function useTerminalSession(
  workspaceId: string | undefined,
  tabId: string,
  termRef: React.RefObject<Xterm | null>,
): TerminalSession {
  const [descriptor, setDescriptor] = useState<TerminalSessionDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [exit, setExit] = useState<TerminalExit | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sidRef = useRef<string | null>(null);
  /**
   * StrictMode double-invokes effects in dev; without this guard a second
   * POST per mount would leak a PTY. Stored on the fiber, so it survives the
   * immediate unmount/remount.
   */
  const initStarted = useRef(false);

  // Unmount (or a new workspace/tab): end the server-side session. Declared
  // before the session effect so its cleanup runs first, while the socket is
  // still open and the WS `kill` can reach the server.
  useEffect(() => {
    return () => {
      const sid = sidRef.current;
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try { sock.send(JSON.stringify({ t: 'kill' })); } catch { /* ignore */ }
      }
      if (workspaceId && sid) {
        void killTerminalSession(workspaceId, sid);
        try { window.localStorage.removeItem(sidStorageKey(workspaceId, tabId)); } catch { /* ignore */ }
      }
    };
  }, [workspaceId, tabId]);

  useEffect(() => {
    const term = termRef.current;
    if (!workspaceId || !term) return;
    // W29 — a surface without WebSocket streaming must not create a PTY that
    // no socket will ever attach to.
    if (liveViewTransport() !== 'websocket') {
      setError('This surface does not support live terminal streaming.');
      return;
    }
    if (initStarted.current) return;
    initStarted.current = true;
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      setConnecting(true);
      setError(null);
      setExit(null);

      // 1. A live cached sid is reused; a dead one is dropped.
      let sid: string | null = null;
      try {
        const cached = window.localStorage.getItem(sidStorageKey(workspaceId, tabId));
        if (cached) {
          const d = await describeTerminalSession(workspaceId, cached);
          if (d && d.exitCode === null) {
            sid = cached;
            setDescriptor(d);
          } else {
            window.localStorage.removeItem(sidStorageKey(workspaceId, tabId));
          }
        }
      } catch { /* storage unavailable */ }

      // 2. Otherwise create one.
      if (!cancelled && !sid) {
        try {
          const d = await createTerminalSession(workspaceId, term.cols || 80, term.rows || 24);
          sid = d.id;
          // Cancelled while the POST was in flight: the session is an orphan.
          if (cancelled) {
            void killTerminalSession(workspaceId, sid);
            return;
          }
          setDescriptor(d);
          try { window.localStorage.setItem(sidStorageKey(workspaceId, tabId), sid); } catch { /* ignore */ }
        } catch (err) {
          if (!cancelled) {
            setError((err as Error).message);
            setConnecting(false);
          }
          return;
        }
      }
      if (cancelled || !sid) return;
      sidRef.current = sid;

      // 3. Replay scrollback.
      try {
        const bytes = await fetchTerminalScrollback(workspaceId, sid);
        if (!cancelled && bytes.length > 0) term.write(bytes);
      } catch { /* ignore */ }

      // 4. Socket, authorised by a ticket (a WS handshake carries no header).
      let wsUrl: string;
      try {
        wsUrl = await buildAuthenticatedSocketUrl(terminalStreamPath(workspaceId, sid), { scope: 'terminal', id: sid });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && /INSUFFICIENT_SCOPE|403/.test(err.message)
              ? 'This device is not allowed to open terminals (missing exec:terminal).'
              : (err as Error).message,
          );
          setConnecting(false);
        }
        return;
      }
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      let writtenSinceAck = 0;

      ws.onopen = () => {
        if (cancelled) return;
        setConnecting(false);
        try { ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows })); } catch { /* ignore */ }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const frame = JSON.parse(ev.data) as ServerFrame;
            if (frame.t === 'ready') setDescriptor(frame.descriptor);
            else if (frame.t === 'exit') setExit({ code: frame.code, ...(frame.signal ? { signal: frame.signal } : {}) });
            else if (frame.t === 'error') setError(frame.message);
          } catch { /* not a control frame */ }
          return;
        }
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        term.write(bytes, () => {
          writtenSinceAck += bytes.length;
          if (writtenSinceAck >= ACK_BYTE_INTERVAL && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ t: 'ack', bytes: writtenSinceAck }));
              writtenSinceAck = 0;
            } catch { /* ignore */ }
          }
        });
      };
      ws.onerror = () => {
        if (!cancelled) setError('Terminal connection error');
      };
      ws.onclose = () => {
        if (!cancelled) setConnecting(false);
      };

      // 5. xterm → socket.
      const inputSub = term.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ t: 'input', data })); } catch { /* ignore */ }
      });
      const resizeSub = term.onResize((size) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ t: 'resize', cols: size.cols, rows: size.rows })); } catch { /* ignore */ }
      });
      detach = () => {
        try { inputSub.dispose(); } catch { /* ignore */ }
        try { resizeSub.dispose(); } catch { /* ignore */ }
        try { ws.close(); } catch { /* ignore */ }
      };
    })();

    return () => {
      cancelled = true;
      detach?.();
      wsRef.current = null;
      // A real deps change (new workspace or tab) may spawn a fresh session.
      initStarted.current = false;
    };
  }, [workspaceId, tabId, termRef]);

  const cd = useCallback((path: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Double quotes are accepted by POSIX shells, cmd and PowerShell alike.
    try { ws.send(JSON.stringify({ t: 'input', data: `cd "${path}"\r` })); } catch { /* ignore */ }
  }, []);

  const kill = useCallback(async () => {
    const sid = sidRef.current;
    if (!workspaceId || !sid) return;
    await killTerminalSession(workspaceId, sid);
  }, [workspaceId]);

  return { descriptor, connecting, error, exit, cd, kill };
}
