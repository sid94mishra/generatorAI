// ────────────────────────────────────────────────────────────────
// device-ws — the Devices tab's live view (docs/devices DV-5).
//
// URL:  ws://<host>:<port>/api/workspaces/:id/devices/stream?device=<key>
//
//   server → client, binary   16-byte header + payload (the Browser
//                             screencast layout, `browser-ws.ts`): codec 0
//                             JPEG, 2 H.264 AVCC, 3 H.264 Annex-B; flags bit 0
//                             keyframe, bit 1 decoder config.
//   server → client, text     `DeviceStreamMessage` (size, action marks,
//                             agent access, errors).
//   client → server, text     `DeviceInputEvent` — the user's touches, keys,
//                             text, buttons. Moves are coalesced; discrete
//                             events are bounded like the browser's input.
//
// Auth: `exec:device` (or a `devices` socket ticket for the workspace).
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { DeviceInputEvent } from '@generatorai/shared';
import type { DeviceFrame } from '@generatorai/core';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import { trackWebSocket } from './streaming/liveConnections.js';

const PATH_RE = /^\/api\/workspaces\/([^/?#]+)\/devices\/stream$/;
const HEADER_BYTES = 16;
const MAGIC = 0x47;
const VERSION = 1;
const MAX_PENDING_INPUTS = 48;
/** A slow viewer is skipped to the next keyframe rather than buffered without bound. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export function encodeDeviceFrame(frame: DeviceFrame, timestampUs: number): Buffer {
  const out = Buffer.allocUnsafe(HEADER_BYTES + frame.data.byteLength);
  out.writeUInt8(MAGIC, 0);
  out.writeUInt8(VERSION, 1);
  out.writeUInt8(frame.codec, 2);
  out.writeUInt8((frame.keyframe ? 1 : 0) | (frame.config ? 2 : 0), 3);
  out.writeUInt16BE(Math.min(0xffff, frame.width), 4);
  out.writeUInt16BE(Math.min(0xffff, frame.height), 6);
  out.writeDoubleBE(timestampUs, 8);
  out.set(frame.data, HEADER_BYTES);
  return out;
}

const KEYS = new Set(['enter', 'delete', 'tab', 'escape', 'up', 'down', 'left', 'right']);
const BUTTONS = new Set(['home', 'back', 'recents', 'lock', 'volume_up', 'volume_down']);
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10;

/** Validates one client message; null for anything that is not a known input. */
export function parseDeviceInput(raw: string): DeviceInputEvent | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m['type']) {
    case 'touch':
      return (m['action'] === 'down' || m['action'] === 'move' || m['action'] === 'up') && unit(m['x']) && unit(m['y'])
        ? { type: 'touch', action: m['action'], x: m['x'], y: m['y'] }
        : null;
    case 'scroll':
      return unit(m['x']) && unit(m['y']) && finite(m['dx']) && finite(m['dy'])
        ? { type: 'scroll', x: m['x'], y: m['y'], dx: m['dx'], dy: m['dy'] }
        : null;
    case 'key':
      return typeof m['key'] === 'string' && KEYS.has(m['key']) ? { type: 'key', key: m['key'] as never } : null;
    case 'text':
      return typeof m['text'] === 'string' && m['text'].length > 0 && m['text'].length <= 5000 ? { type: 'text', text: m['text'] } : null;
    case 'button':
      return typeof m['button'] === 'string' && BUTTONS.has(m['button']) ? { type: 'button', button: m['button'] as never } : null;
    case 'rotate':
      return { type: 'rotate' };
    default:
      return null;
  }
}

export function attachDeviceWebSocket(server: HttpServer, container: Container): void {
  const { deviceService, logger } = container;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const [pathname, query = ''] = (req.url ?? '').split('?');
    const match = PATH_RE.exec(pathname ?? '');
    if (!match) return;
    const workspaceId = decodeURIComponent(match[1] ?? '');
    const device = new URLSearchParams(query).get('device') ?? '';
    if (!workspaceId || !device) {
      socket.destroy();
      return;
    }
    void (async () => {
      const result = await authorizeWebSocketUpgrade({
        container,
        req,
        socket,
        requiredScopes: ['exec:device'],
        ticketScope: { scope: 'devices', id: workspaceId },
        label: 'device-ws',
      });
      if (!result.ok) return;
      container.security.audit.record({
        action: 'exec.device_opened',
        result: 'success',
        principal: result.principal ?? null,
        resourceType: 'workspace',
        resourceId: workspaceId,
        severity: 'warn',
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        trackWebSocket(result.principal, ws, 'device-ws', ['exec:device']);
        handleConnection(ws, workspaceId, device);
      });
    })().catch((err: unknown) => {
      logger.warn?.(`[device-ws] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
    });
  });

  function handleConnection(ws: WebSocket, workspaceId: string, device: string): void {
    const started = performance.now();
    let skipping = false;
    let closed = false;
    const sendText = (message: unknown): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    const queue: DeviceInputEvent[] = [];
    let draining = false;
    let watch: { input(e: DeviceInputEvent): Promise<void>; close(): void } | null = null;

    const drain = async (): Promise<void> => {
      if (draining) return;
      draining = true;
      try {
        while (!closed && queue.length > 0 && watch) {
          const next = queue.shift()!;
          await watch.input(next).catch((err: unknown) => {
            logger.debug?.(`[device-ws] input failed: ${(err as Error).message}`);
          });
        }
      } finally {
        draining = false;
      }
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const event = parseDeviceInput(data.toString());
      if (!event) return;
      // The pointer's position is state: a newer move replaces a queued one.
      if (event.type === 'touch' && event.action === 'move') {
        const last = queue[queue.length - 1];
        if (last?.type === 'touch' && last.action === 'move') {
          queue[queue.length - 1] = event;
          return;
        }
      }
      if (queue.length >= MAX_PENDING_INPUTS) return;
      queue.push(event);
      void drain();
    });

    ws.on('close', () => {
      closed = true;
      watch?.close();
    });

    void deviceService
      .watch(workspaceId, device, {
        frame: (frame) => {
          if (ws.readyState !== ws.OPEN) return;
          // Behind: drop deltas until the next keyframe or config frame.
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) skipping = true;
          if (skipping && !frame.keyframe && !frame.config) return;
          if (frame.keyframe || frame.config) skipping = false;
          ws.send(encodeDeviceFrame(frame, Math.round((performance.now() - started) * 1000)));
        },
        message: sendText,
      })
      .then((handle) => {
        if (closed) handle.close();
        else {
          watch = handle;
          void drain();
        }
      })
      .catch((err: unknown) => {
        sendText({ type: 'stream_unavailable', message: (err as Error).message });
        ws.close(1011, 'stream unavailable');
      });
  }
}
