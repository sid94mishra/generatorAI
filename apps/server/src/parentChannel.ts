// ────────────────────────────────────────────────────────────────
// The message channel to the process that started this server, whichever kind
// of child it is (D-128):
//
//   • an Electron utility process (the packaged desktop app since F-4):
//     `process.parentPort` — messages arrive as `{ data }` events;
//   • a Node child with an IPC slot (the desktop app's unpackaged/dev mode, the
//     redesign sandbox): `process.send` / `process.on('message')`;
//   • nothing (a headless server started from a shell or a service manager).
//
// Callers speak plain objects and never care which one it is.
// ────────────────────────────────────────────────────────────────

export interface ParentChannel {
  readonly kind: 'utility' | 'ipc';
  send(message: unknown): void;
  /** Subscribe; returns the unsubscribe. */
  onMessage(listener: (message: unknown) => void): () => void;
}

interface ElectronParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown;
}

let cached: ParentChannel | null | undefined;

export function parentChannel(proc: NodeJS.Process = process): ParentChannel | null {
  if (proc === process && cached !== undefined) return cached;
  const port = (proc as NodeJS.Process & { parentPort?: ElectronParentPort }).parentPort;
  let channel: ParentChannel | null = null;
  if (port && typeof port.postMessage === 'function') {
    channel = {
      kind: 'utility',
      send: (message) => port.postMessage(message),
      onMessage: (listener) => {
        const handler = (event: { data: unknown }) => listener(event?.data);
        port.on('message', handler);
        return () => {
          port.off('message', handler);
        };
      },
    };
  } else if (typeof proc.send === 'function') {
    channel = {
      kind: 'ipc',
      send: (message) => {
        proc.send?.(message as never);
      },
      onMessage: (listener) => {
        proc.on('message', listener);
        return () => {
          proc.off('message', listener);
        };
      },
    };
  }
  if (proc === process) cached = channel;
  return channel;
}

/** Set by the desktop app when it hands the vault key over the channel instead of the environment (F-8). */
export const SECRET_KEY_HANDOFF_ENV = 'GENERATORAI_SECRET_KEY_HANDOFF';

/**
 * F-8 — the vault key-encryption key, asked for over the parent channel. The
 * desktop shell answers `{ type: 'secret-key', key }` (or `key: null` when it
 * has none to give). Asking, rather than waiting for an unsolicited message,
 * means nothing is lost to a listener that was not registered yet.
 *
 * Kept out of `process.env` on purpose: `ps eww` / `/proc/<pid>/environ` show
 * the environment a process was started with, and everything this server
 * spawns would inherit it.
 */
export function receiveSecretKey(channel: ParentChannel, timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`The desktop app did not hand over the vault key within ${timeoutMs} ms`));
    }, timeoutMs);
    const unsubscribe = channel.onMessage((message) => {
      const m = message as { type?: unknown; key?: unknown } | null;
      if (!m || m.type !== 'secret-key') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(typeof m.key === 'string' && m.key.length > 0 ? m.key : null);
    });
    channel.send({ type: 'secret-key-request' });
  });
}

/**
 * An Electron utility process is not told when the app that forked it dies
 * the way a Node child sees `disconnect`. Polls the parent: the pid changes on
 * POSIX when we are reparented, and signal 0 fails once the original parent is
 * gone (every OS). Returns the stop function.
 */
export function watchParentExit(onGone: () => void, intervalMs = 2_000, proc: NodeJS.Process = process): () => void {
  const parent = proc.ppid;
  const timer = setInterval(() => {
    let gone = proc.ppid !== parent;
    if (!gone) {
      try {
        proc.kill(parent, 0);
      } catch (err) {
        gone = (err as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }
    if (gone) {
      clearInterval(timer);
      onGone();
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
