// ────────────────────────────────────────────────────────────────
// D5 / W15 / P1-33 — the live-view socket's transport contract.
//
// Two things are pinned here, both regressions against the pre-fix code:
//
//   1. Transport is DECLARED. A bridge that says it cannot stream gets told so
//      on the socket and the socket closes. The old code called `screencast()`
//      inside a `try` and, on the throw, silently started an HTTP polling loop
//      — five `page.screenshot()` calls a second, for the rest of the session,
//      with nothing anywhere saying it had happened.
//
//   2. Frames are SELF-DESCRIBING. Every binary message carries a 16-byte
//      header naming its codec, so a JPEG seed on a VP8 stream, or a
//      mid-stream fall back to JPEG, needs no out-of-band signalling. The old
//      wire format was bare JPEG bytes, which cannot express either.
//
// These drive the real handler over a real `ws` socket; auth is mocked exactly
// as `browser-ws-input.test.ts` mocks it, because the subject is the protocol.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { WebSocket } from 'ws';
import { attachBrowserWebSocket } from '../browser-ws.js';
import type { Container } from '../composition-root.js';
import type { ScreencastCodec, ScreencastFrame } from '@generatorai/core';

vi.mock('../middleware/wsAuth.js', () => ({
  authorizeWebSocketUpgrade: vi.fn(async () => ({ ok: true, principal: undefined })),
}));

const WORKSPACE_ID = 'ws_1';
const HEADER_BYTES = 16;

interface ParsedFrame {
  magic: number;
  version: number;
  codec: number;
  keyframe: boolean;
  width: number;
  height: number;
  timestampUs: number;
  payload: Buffer;
}

function parseFrame(buf: Buffer): ParsedFrame {
  return {
    magic: buf.readUInt8(0),
    version: buf.readUInt8(1),
    codec: buf.readUInt8(2),
    keyframe: (buf.readUInt8(3) & 1) === 1,
    width: buf.readUInt16BE(4),
    height: buf.readUInt16BE(6),
    timestampUs: buf.readDoubleBE(8),
    payload: buf.subarray(HEADER_BYTES),
  };
}

interface FakeService {
  capabilities: { supportsScreencast: boolean; codecs: readonly ScreencastCodec[] };
  /** Codecs the handler forwarded to the bridge, recorded by `screencast()`. */
  requestedCodecs: (readonly ScreencastCodec[] | undefined)[];
  push: (frame: ScreencastFrame) => void;
}

function fakeBrowserService(capabilities: FakeService['capabilities']) {
  const requestedCodecs: (readonly ScreencastCodec[] | undefined)[] = [];
  let emit: ((frame: ScreencastFrame) => void) | null = null;
  const queued: ScreencastFrame[] = [];
  /** Key-frame requests the handler made through the registered channel. */
  const keyframeRequests = { count: 0 };

  const service = {
    requestedCodecs,
    keyframeRequests,
    capabilities,
    bumpActivity: vi.fn(),
    interact: vi.fn(async () => undefined),
    screencastCapabilities: vi.fn(() => capabilities),
    // A JPEG that `readJpegSize` can parse, used as the seed and keepalive.
    frame: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    screencast: vi.fn((_id: string, opts: {
      codecs?: readonly ScreencastCodec[];
      onRequestKeyframe?: (request: () => void) => void;
    }) => {
      requestedCodecs.push(opts.codecs);
      opts.onRequestKeyframe?.(() => { keyframeRequests.count += 1; });
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<ScreencastFrame>>((resolve) => {
              const next = queued.shift();
              if (next) { resolve({ value: next, done: false }); return; }
              emit = (frame) => { emit = null; resolve({ value: frame, done: false }); };
            }),
        }),
      };
    }),
    push(frame: ScreencastFrame): void {
      if (emit) emit(frame);
      else queued.push(frame);
    },
  };
  return service;
}

function fakeContainer(browserService: unknown): Container {
  return {
    browserService,
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    security: { audit: { record: vi.fn() } },
  } as unknown as Container;
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets) { try { s.close(); } catch { /* ignore */ } }
  sockets.length = 0;
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

async function connect(service: unknown): Promise<{
  ws: WebSocket;
  binary: Buffer[];
  text: Record<string, unknown>[];
}> {
  const server = http.createServer();
  servers.push(server);
  attachBrowserWebSocket(server, fakeContainer(service));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/${WORKSPACE_ID}/browser/stream`);
  sockets.push(ws);
  const binary: Buffer[] = [];
  const text: Record<string, unknown>[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) binary.push(data as Buffer);
    else { try { text.push(JSON.parse(data.toString())); } catch { /* ignore */ } }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, binary, text };
}

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('browser-ws — declared transport (P1-33)', () => {
  it('tells the client outright when the bridge cannot stream, and sends no frames', async () => {
    const service = fakeBrowserService({ supportsScreencast: false, codecs: [] });
    const { ws, binary, text } = await connect(service);
    await settle(300);

    expect(text.some((m) => m['type'] === 'stream_unavailable')).toBe(true);
    expect(binary).toHaveLength(0);
    // Never even attempted: asking is what replaced attempt-and-catch.
    expect(service.screencast).not.toHaveBeenCalled();
    await settle(100);
    expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(ws.readyState);
  });

  it('does not fall back to a second transport when a live stream fails', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['jpeg'] });
    service.screencast = vi.fn(() => { throw new Error('CDP died'); }) as never;
    const { text } = await connect(service);
    await settle(2_000);   // past the hello timeout, so the stream really starts

    // A broken stream is an error the client is told about — not a cue to
    // start five screenshots a second behind its back.
    expect(text.some((m) => m['type'] === 'stream_error')).toBe(true);
    expect(service.frame).not.toHaveBeenCalledTimes(20);
  });
});

describe('browser-ws — codec negotiation and framing', () => {
  it('forwards the client accept-list to the bridge', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8', 'jpeg'] }));
    await settle(300);
    expect(service.requestedCodecs[0]).toEqual(['vp8', 'jpeg']);
  });

  it('assumes JPEG-only for a client that never says hello', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    await connect(service);
    // An old client, or a proxy that buffered the first message, must still
    // get a picture rather than a blank panel.
    await settle(2_000);
    expect(service.requestedCodecs[0]).toEqual(['jpeg']);
  });

  it('ignores accept entries it does not recognise', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['av1-from-the-future', 42, 'jpeg'] }));
    await settle(300);
    expect(service.requestedCodecs[0]).toEqual(['jpeg']);
  });

  it('frames the seed screenshot with a JPEG header, not as bare bytes', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8', 'jpeg'] }));
    await settle(300);

    expect(binary.length).toBeGreaterThan(0);
    const seed = parseFrame(binary[0]!);
    expect(seed.magic).toBe(0x47);
    expect(seed.version).toBe(1);
    expect(seed.codec).toBe(0);          // jpeg
    expect(seed.keyframe).toBe(true);
    expect(Array.from(seed.payload)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('carries the codec, keyframe flag, size and timestamp of every VP8 frame', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8', 'jpeg'] }));
    await settle(300);
    const seedCount = binary.length;

    service.push({
      codec: 'vp8', data: Buffer.from([1, 2, 3, 4]), keyframe: true,
      width: 1280, height: 720, timestampUs: 33_333, ts: Date.now(),
    });
    await settle(200);

    expect(binary.length).toBeGreaterThan(seedCount);
    const frame = parseFrame(binary[seedCount]!);
    expect(frame.codec).toBe(1);         // vp8
    expect(frame.keyframe).toBe(true);
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
    expect(frame.timestampUs).toBe(33_333);
    expect(Array.from(frame.payload)).toEqual([1, 2, 3, 4]);
  });

  it('marks a VP8 delta frame as not-a-keyframe so a late joiner knows to wait', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8'] }));
    await settle(300);
    const seedCount = binary.length;

    service.push({
      codec: 'vp8', data: Buffer.from([9]), keyframe: false,
      width: 1280, height: 720, timestampUs: 66_666, ts: Date.now(),
    });
    await settle(200);
    expect(parseFrame(binary[seedCount]!).keyframe).toBe(false);
  });

  it('interleaves a JPEG frame on a VP8 stream without any out-of-band signal', async () => {
    // This is why the codec is per-frame: the keepalive screenshot and a
    // mid-stream encoder failure both produce JPEG on a socket whose steady
    // state is VP8, and the client must follow without being told.
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8', 'jpeg'] }));
    await settle(300);
    const seedCount = binary.length;

    service.push({
      codec: 'vp8', data: Buffer.from([1]), keyframe: true,
      width: 800, height: 600, timestampUs: 1_000, ts: Date.now(),
    });
    await settle(120);
    service.push({
      codec: 'jpeg', data: Buffer.from([0xff, 0xd8]), keyframe: true,
      width: 800, height: 600, timestampUs: 2_000, ts: Date.now(),
    });
    await settle(120);

    const codecs = binary.slice(seedCount).map((b) => parseFrame(b).codec);
    expect(codecs).toEqual([1, 0]);
  });
});

// ────────────────────────────────────────────────────────────────
// Backpressure must not be able to freeze the view.
//
// A VP8 delta references the frame before it, so the socket dropping ONE
// chunk makes every later chunk undecodable. The drop was unconditional and
// silent, and nothing anywhere asked for a new key frame — so a moment of
// congestion froze the live view for the rest of the session.
// ────────────────────────────────────────────────────────────────
describe('browser-ws — backpressure never freezes the stream', () => {
  /**
   * Force the server's view of the socket over the high-water mark.
   *
   * `bufferedAmount` is a prototype getter on `ws`, and both ends of this test
   * share the module instance — so this is the real handler making its real
   * decision, with only the number it reads replaced.
   */
  function jamSocket(): () => void {
    const proto = WebSocket.prototype as unknown as object;
    const original = Object.getOwnPropertyDescriptor(proto, 'bufferedAmount');
    Object.defineProperty(proto, 'bufferedAmount', {
      configurable: true, get: () => 4 * 1024 * 1024,
    });
    return () => {
      if (original) Object.defineProperty(proto, 'bufferedAmount', original);
    };
  }

  it('sends a VP8 key frame even when the socket is over the high-water mark', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8'] }));
    await settle(300);
    const seedCount = binary.length;

    const restore = jamSocket();
    try {
      service.push({
        codec: 'vp8', data: Buffer.from([1, 2, 3]), keyframe: true,
        width: 640, height: 480, timestampUs: 1_000, ts: Date.now(),
      });
      await settle(700);   // past SOCKET_DRAIN_TIMEOUT_MS
    } finally {
      restore();
    }

    // A key frame is the only chunk that can restart the stream. Dropping it
    // buys back a few hundred bytes and costs the viewer everything.
    expect(binary.length).toBeGreaterThan(seedCount);
    expect(parseFrame(binary[seedCount]!).keyframe).toBe(true);
  });

  it('drops a delta under backpressure but asks the bridge to re-key', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws, binary } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8'] }));
    await settle(300);
    const seedCount = binary.length;

    const restore = jamSocket();
    try {
      service.push({
        codec: 'vp8', data: Buffer.from([9]), keyframe: false,
        width: 640, height: 480, timestampUs: 2_000, ts: Date.now(),
      });
      await settle(700);
    } finally {
      restore();
    }

    // Buffering seconds of stale deltas is still worse than a gap…
    expect(binary.length).toBe(seedCount);
    // …but the gap has to heal, and only the encoder can heal it.
    expect(service.keyframeRequests.count).toBeGreaterThan(0);
  });

  it('forwards a client key-frame request to the bridge', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8'] }));
    await settle(300);

    // The browser drops frames the server cannot see (a hidden tab, a decoder
    // error). Without this the client has no way back.
    ws.send(JSON.stringify({ type: 'request_keyframe' }));
    await settle(200);
    expect(service.keyframeRequests.count).toBe(1);
  });

  it('rate-limits key-frame requests from a client that asks on every frame', async () => {
    const service = fakeBrowserService({ supportsScreencast: true, codecs: ['vp8', 'jpeg'] });
    const { ws } = await connect(service);
    ws.send(JSON.stringify({ type: 'hello', accept: ['vp8'] }));
    await settle(300);

    for (let i = 0; i < 30; i += 1) ws.send(JSON.stringify({ type: 'request_keyframe' }));
    await settle(300);
    // Every answer is a full key frame, so an unbounded request channel is a
    // bandwidth amplifier pointed at the host.
    expect(service.keyframeRequests.count).toBeLessThanOrEqual(3);
    expect(service.keyframeRequests.count).toBeGreaterThan(0);
  });
});
