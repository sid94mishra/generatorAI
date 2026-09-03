// ────────────────────────────────────────────────────────────────
// attachToTerminal — raw PTY takeover.
//
// Speaks the exact same wire protocol `apps/web`'s `TerminalPanel` and
// `apps/mobile`'s `TerminalView` already use against
// `apps/server/src/terminal-ws.ts` (binary frames = raw PTY bytes; JSON
// frames = `{t:'input'|'resize'|'ack'|'signal'|'kill'}` out,
// `{t:'ready'|'exit'|'resized'|'error'}` in). Nothing server-side changes
// for this: the watermark/backpressure handling this file's ACK loop talks
// to is already real (`terminal-ws.ts`'s `HIGH_WATERMARK_BYTES`/
// `LOW_WATERMARK_BYTES`).
//
// This lives in `apps/cli`, not `packages/cli-core`, because it needs `ws`
// and direct control of the process's raw mode — both surface concerns
// cli-core deliberately stays out of (see `commands/workspace.ts`'s
// `terminal.attach`). Two callers share it: the binary `terminal.attach`
// command (plain `process.stdin`/`process.stdout`) and the TUI's own attach
// keybinding (the same streams, handed back mid-render by
// `useTerminalSuspension`).
// ────────────────────────────────────────────────────────────────

import { WebSocket } from 'ws';

/** ACK cadence — matches `apps/web`/`apps/mobile`'s own constant. */
const ACK_BYTE_INTERVAL = 64 * 1024;
/** Ctrl+] — never appears in normal typed input or a UTF-8 continuation byte. */
const DETACH_BYTE = 0x1d;

export interface AttachApi {
  create(workspaceId: string, body: { cols: number; rows: number }): Promise<{ id: string }>;
  scrollback(workspaceId: string, terminalId: string): Promise<{ data: string } | string | null>;
}

export interface AttachOptions {
  workspaceId: string;
  /** Existing session id; omit to create a fresh one sized to the caller's streams. */
  terminalId?: string;
  api: AttachApi;
  /** Same 3-arg shape as `AuthenticatedClientRuntime.buildSocketUrl`. */
  socketUrl: (path: string, scope: string, id: string | null) => Promise<string>;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  /** Aborted (e.g. by a real OS signal reaching this process) to force a clean detach. */
  signal?: AbortSignal;
}

export interface AttachOutcome {
  reason: 'detached' | 'exited' | 'error' | 'aborted';
  terminalId: string;
  /** Only meaningful when `reason === 'exited'`. */
  exitCode?: number | null;
  /** Set on `'error'`; occasionally set on `'exited'` (killed by signal). */
  message?: string;
}

export async function attachToTerminal(options: AttachOptions): Promise<AttachOutcome> {
  const { stdin, stdout, workspaceId, api, socketUrl } = options;

  let terminalId = options.terminalId;
  if (!terminalId) {
    const created = await api.create(workspaceId, {
      cols: stdout.columns || 80,
      rows: stdout.rows || 24,
    });
    terminalId = created.id;
  }
  const sid = terminalId;

  // Replay history before going live: bytes written after the socket opens
  // must land after the backlog, never interleaved with it.
  try {
    const scrollback = await api.scrollback(workspaceId, sid);
    const text =
      typeof scrollback === 'string'
        ? scrollback
        : String((scrollback as { data?: unknown } | null)?.data ?? '');
    if (text) stdout.write(text);
  } catch {
    /* history is optional */
  }

  const url = await socketUrl(
    `/api/workspaces/${workspaceId}/terminals/${sid}/stream`,
    'terminal',
    sid,
  );

  return new Promise<AttachOutcome>((resolve) => {
    const socket = new WebSocket(url);
    const wasRaw = stdin.isRaw;
    const rawModeSupported = Boolean(stdin.isTTY);
    let unackedBytes = 0;
    let settled = false;
    let attached = false;

    const send = (frame: Record<string, unknown>): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        /* connection closing under us */
      }
    };

    const onStdinData = (chunk: Buffer): void => {
      const detachIndex = chunk.indexOf(DETACH_BYTE);
      const payload = detachIndex === -1 ? chunk : chunk.subarray(0, detachIndex);
      if (payload.length > 0) send({ t: 'input', data: payload.toString('utf8') });
      // Deliberately does not send `{t:'kill'}` — Ctrl+] detaches, it does
      // not terminate the session (that is `terminal.kill`'s job; the
      // command's own summary promises exactly this split).
      if (detachIndex !== -1) finish({ reason: 'detached', terminalId: sid });
    };

    const onResize = (): void => {
      send({ t: 'resize', cols: stdout.columns || 80, rows: stdout.rows || 24 });
    };

    const onAbort = (): void => finish({ reason: 'aborted', terminalId: sid });

    function teardown(): void {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      stdin.off('data', onStdinData);
      stdout.off('resize', onResize);
      options.signal?.removeEventListener('abort', onAbort);
      if (attached) {
        if (rawModeSupported) stdin.setRawMode(wasRaw);
        stdin.pause();
      }
    }

    function finish(outcome: AttachOutcome): void {
      if (settled) return;
      settled = true;
      teardown();
      resolve(outcome);
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });

    socket.on('open', () => {
      attached = true;
      if (rawModeSupported) stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onStdinData);
      stdout.on('resize', onResize);
      // The terminal may have drifted between `create()`/pickup and now.
      onResize();
    });

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      // `ws`'s default `binaryType` ('nodebuffer') always hands back a
      // `Buffer` in practice; normalising the wider declared type here
      // avoids relying on that never changing.
      const raw = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);
      if (isBinary) {
        stdout.write(raw);
        // The server pauses the PTY past its own watermark — acking is
        // what keeps a long build streaming instead of stalling after
        // `HIGH_WATERMARK_BYTES` (`apps/server/src/terminal-ws.ts`).
        unackedBytes += raw.length;
        if (unackedBytes >= ACK_BYTE_INTERVAL) {
          send({ t: 'ack', bytes: unackedBytes });
          unackedBytes = 0;
        }
        return;
      }
      let frame: { t?: string; code?: number; signal?: string; message?: string };
      try {
        frame = JSON.parse(raw.toString('utf8')) as typeof frame;
      } catch {
        return;
      }
      if (frame.t === 'exit') {
        finish({
          reason: 'exited',
          terminalId: sid,
          exitCode: frame.code ?? null,
          ...(frame.signal ? { message: `killed by ${frame.signal}` } : {}),
        });
      } else if (frame.t === 'error') {
        finish({ reason: 'error', terminalId: sid, message: frame.message ?? 'Terminal error' });
      }
    });

    socket.on('error', (err: Error) => {
      finish({
        reason: 'error',
        terminalId: sid,
        message: /INSUFFICIENT_SCOPE|403/.test(err.message)
          ? 'This device is not allowed to open terminals (missing exec:terminal).'
          : err.message,
      });
    });

    // A close the local side did not initiate (the code above always calls
    // `finish` first, which is idempotent) — the remote end went away
    // without a proper `exit` frame.
    socket.on('close', () => finish({ reason: 'detached', terminalId: sid }));
  });
}
