// ────────────────────────────────────────────────────────────────
// RelayStreamBridge — the host side of the relay data plane.
//
// When the cell announces `stream_open`, the host dials a data WebSocket back
// to the cell and pipes every frame into a fresh TCP connection to its own
// loopback HTTP listener. The remote client is therefore speaking ordinary
// HTTP to the ordinary Express app:
//
//   phone ──sealed bytes──▶ cell ──opaque──▶ host ──▶ 127.0.0.1:<port>
//
// Why raw bytes instead of a bespoke RPC:
//   * every existing control keeps working unchanged — DPoP verification,
//     scope enforcement, rate limits, SSE, WebSocket upgrades, CORS
//   * the relay path cannot accidentally become a privileged shortcut,
//     because it enters through the exact same front door as a LAN client
//   * there is no second, divergent implementation of authorization
//
// The bridge deliberately connects to `127.0.0.1` and nothing else. Even a
// fully compromised relay can only reach this server's own HTTP port.
// ────────────────────────────────────────────────────────────────

import * as net from 'node:net';
import { WebSocket } from 'ws';
import { RELAY_MAX_DATA_FRAME_BYTES } from '@generatorai/relay-protocol';
import type { ILogger } from '@generatorai/shared';

/** Give up if the loopback server does not accept within this window. */
const LOCAL_CONNECT_TIMEOUT_MS = 5_000;

/** Hard ceiling on concurrently bridged streams, mirroring the cell's cap. */
const MAX_ACTIVE_STREAMS = 64;

export interface RelayStreamBridgeOptions {
  logger: ILogger;
  /** Loopback port of this server's HTTP listener. */
  localPort: number;
  /** Injectable for tests. */
  createSocket?: (url: string) => WebSocket;
}

interface ActiveStream {
  ws: WebSocket;
  tcp: net.Socket;
}

export class RelayStreamBridge {
  private readonly active = new Map<string, ActiveStream>();

  constructor(private readonly options: RelayStreamBridgeOptions) {}

  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Opens one bridged stream.
   *
   * `cellUrl` is the host control URL (`wss://…/relay/host`); the data
   * endpoint is derived from it so a malicious control message cannot point
   * the bridge at an arbitrary origin.
   */
  open(params: { cellUrl: string; relayHostId: string; streamId: string }): void {
    if (this.active.size >= MAX_ACTIVE_STREAMS) {
      this.options.logger.warn('[Relay] Refusing stream: too many active bridges', {
        streamId: params.streamId,
        active: this.active.size,
      });
      return;
    }
    if (this.active.has(params.streamId)) return;

    let dataUrl: URL;
    try {
      dataUrl = new URL(params.cellUrl);
    } catch {
      this.options.logger.warn('[Relay] Invalid cell URL; not bridging stream');
      return;
    }
    dataUrl.pathname = '/relay/data';
    dataUrl.searchParams.set('streamId', params.streamId);
    dataUrl.searchParams.set('relayHostId', params.relayHostId);

    const ws = this.options.createSocket
      ? this.options.createSocket(dataUrl.toString())
      : new WebSocket(dataUrl.toString(), { maxPayload: RELAY_MAX_DATA_FRAME_BYTES });

    const tcp = net.connect({ host: '127.0.0.1', port: this.options.localPort });
    tcp.setNoDelay(true);
    tcp.setTimeout(LOCAL_CONNECT_TIMEOUT_MS, () => {
      // Only guards the connect phase — cleared on 'connect' below, because a
      // long-lived SSE stream is legitimately idle for minutes at a time.
      if (tcp.connecting) tcp.destroy(new Error('local connect timed out'));
    });

    const entry: ActiveStream = { ws, tcp };
    this.active.set(params.streamId, entry);

    const teardown = (reason: string): void => {
      if (!this.active.delete(params.streamId)) return;
      try {
        tcp.destroy();
      } catch {
        /* already destroyed */
      }
      try {
        if (ws.readyState <= WebSocket.OPEN) ws.close(1000, reason.slice(0, 120));
      } catch {
        /* already closing */
      }
    };

    // ── relay → local server ───────────────────────────────────────
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw);
      if (buf.length > RELAY_MAX_DATA_FRAME_BYTES) {
        teardown('frame too large');
        return;
      }
      // Respect TCP backpressure: pause the socket when the kernel buffer is
      // full so a slow local handler cannot balloon memory here.
      if (!tcp.write(buf)) ws.pause();
    });
    tcp.on('drain', () => ws.resume());

    // ── local server → relay ───────────────────────────────────────
    tcp.on('connect', () => {
      tcp.setTimeout(0);
    });
    tcp.on('data', (chunk: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Chunk to the protocol's frame ceiling so a big response body cannot
      // be rejected wholesale by the cell.
      for (let offset = 0; offset < chunk.length; offset += RELAY_MAX_DATA_FRAME_BYTES) {
        ws.send(chunk.subarray(offset, offset + RELAY_MAX_DATA_FRAME_BYTES), { binary: true });
      }
      if (ws.bufferedAmount > RELAY_MAX_DATA_FRAME_BYTES * 8) tcp.pause();
      else tcp.resume();
    });

    ws.on('close', () => teardown('relay stream closed'));
    ws.on('error', (err: Error) => {
      this.options.logger.debug?.('[Relay] Data socket error', { error: err.message });
      teardown('relay socket error');
    });
    tcp.on('close', () => teardown('local socket closed'));
    tcp.on('error', (err: Error) => {
      this.options.logger.debug?.('[Relay] Local socket error', { error: err.message });
      teardown('local socket error');
    });
  }

  /** Closes one bridged stream, e.g. after the cell reports `stream_close`. */
  close(streamId: string, reason = 'closed'): void {
    const entry = this.active.get(streamId);
    if (!entry) return;
    this.active.delete(streamId);
    try {
      entry.tcp.destroy();
    } catch {
      /* already destroyed */
    }
    try {
      if (entry.ws.readyState <= WebSocket.OPEN) entry.ws.close(1000, reason);
    } catch {
      /* already closing */
    }
  }

  /** Tears down every bridged stream. Used on relay detach and shutdown. */
  closeAll(reason = 'shutting down'): void {
    for (const streamId of [...this.active.keys()]) this.close(streamId, reason);
  }
}
