// ────────────────────────────────────────────────────────────────
// Free TCP port discovery on the loopback interface.
// ────────────────────────────────────────────────────────────────

import * as net from 'node:net';

/**
 * Which port to ask for: the configured one when set, otherwise the port the
 * server used last time in this process (so a restart keeps the window's URL
 * valid), otherwise "any" (0).
 */
export function preferredPort(configured: number, last: number | null): number {
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) return configured;
  if (last !== null && Number.isInteger(last) && last > 0) return last;
  return 0;
}

/** Resolve a free port, preferring `preferred` when it is available. */
export function findFreePort(preferred = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, allowFallback: boolean) => {
      const srv = net.createServer();
      srv.once('error', (err: NodeJS.ErrnoException) => {
        srv.close();
        if (allowFallback && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          // Preferred port taken — let the OS choose one.
          tryListen(0, false);
        } else {
          reject(err);
        }
      });
      srv.listen(port, '127.0.0.1', () => {
        const address = srv.address();
        srv.close(() => {
          if (address && typeof address === 'object') {
            resolve(address.port);
          } else {
            reject(new Error('Failed to acquire a free port'));
          }
        });
      });
    };
    tryListen(preferred > 0 ? preferred : 0, preferred > 0);
  });
}
