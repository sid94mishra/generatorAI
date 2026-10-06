// ────────────────────────────────────────────────────────────────
// One port, two protocols (D-111).
//
// With Network exposure on, the listener on `0.0.0.0:<port>` answers both
// HTTPS and plain HTTP on the SAME port, told apart by the first byte the
// client sends (a TLS ClientHello always starts with 0x16; an HTTP request
// line starts with an ASCII method). One port keeps every existing piece of
// plumbing as it was:
//   * the desktop window, the local CLI, the loop-turn prober and the port
//     identity check keep using `http://127.0.0.1:<port>`;
//   * a second device uses `https://<lan-ip>:<port>`;
//   * the desktop's remembered port, the firewall rule a user already
//     accepted and every advertised URL keep their port.
//
// Both kinds of connection are handed to the SAME `http.Server`, so every
// WebSocket `upgrade` handler, `closeAllConnections()` and request timeout
// applies to both. A TLS connection reaches Express as a `TLSSocket`, which
// is what makes `req.socket.encrypted` (and so `req.secure`) true.
//
// What plain HTTP may do from another device is decided per request by the
// transport policy middleware (transportPolicy.ts), not here.
// ────────────────────────────────────────────────────────────────

import * as net from 'node:net';
import * as tls from 'node:tls';
import type { Server as HttpServer } from 'node:http';

/** First byte of a TLS record carrying a handshake message. */
const TLS_HANDSHAKE = 0x16;

export interface DualProtocolListenerOptions {
  httpServer: HttpServer;
  /** Asked per connection, so a re-issued certificate applies to the next handshake. */
  secureContext: () => tls.SecureContext;
  /** A client that opens a socket and sends nothing is dropped after this long. */
  firstByteTimeoutMs?: number;
  /** A TLS handshake that has not completed after this long is dropped. */
  handshakeTimeoutMs?: number;
  onTlsError?: (error: Error, remoteAddress: string | undefined) => void;
}

export function createDualProtocolListener(options: DualProtocolListenerOptions): net.Server {
  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? 10_000;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000;

  const routeTls = (socket: net.Socket): void => {
    let tlsSocket: tls.TLSSocket;
    try {
      // `initRead` inside TLSSocket replays the bytes we unshifted, so the
      // ClientHello that told us which protocol this is is not lost.
      tlsSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext: options.secureContext(),
        ALPNProtocols: ['http/1.1'],
      });
    } catch (err) {
      options.onTlsError?.(err instanceof Error ? err : new Error(String(err)), socket.remoteAddress);
      socket.destroy();
      return;
    }
    const handshakeTimer = setTimeout(() => tlsSocket.destroy(), handshakeTimeoutMs);
    handshakeTimer.unref?.();
    tlsSocket.once('secure', () => clearTimeout(handshakeTimer));
    tlsSocket.once('close', () => clearTimeout(handshakeTimer));
    // A browser that has not accepted the certificate yet aborts the
    // handshake (`unknown ca`) on every attempt; that is expected noise, not
    // a fault, and must never reach the process-level error handler.
    tlsSocket.on('error', (err) => {
      options.onTlsError?.(err, socket.remoteAddress);
      tlsSocket.destroy();
    });
    options.httpServer.emit('connection', tlsSocket);
  };

  return net.createServer({ pauseOnConnect: true }, (socket) => {
    socket.on('error', () => socket.destroy());
    socket.setTimeout(firstByteTimeoutMs, () => socket.destroy());
    socket.once('data', (chunk: Buffer) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(chunk);
      if (chunk[0] === TLS_HANDSHAKE) {
        routeTls(socket);
        return;
      }
      options.httpServer.emit('connection', socket);
      // The HTTP parser reads the unshifted request line from the stream
      // buffer once the socket flows again; the buffered chunk is emitted on
      // the next tick, ahead of any further network read.
      socket.resume();
    });
    socket.resume();
  });
}
