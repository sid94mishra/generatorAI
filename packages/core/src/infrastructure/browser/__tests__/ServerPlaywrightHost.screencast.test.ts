// ────────────────────────────────────────────────────────────────
// W15 — the screencast pipeline: declared capability (P1-33), ONE pending slot
// with latest-wins, and ack timing (P1-34).
//
// These drive the REAL `ServerPlaywrightHost.screencast()` generator with a
// stubbed CDP session, because the behaviour under test is entirely about when
// `Page.screencastFrameAck` is sent — which is what decides whether Chromium
// keeps capturing frames a slow consumer will never see.
//
// Pre-fix behaviour these fail against:
//   • a three-deep drop-OLDEST queue per subscriber, so two stale frames were
//     retained and the newest was the one dropped under load;
//   • an ack sent the instant a frame arrived, so capture ran flat out
//     regardless of the consumer.
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ServerPlaywrightHost } from '../ServerPlaywrightHost.js';
import type { BrowserHandle, ScreencastFrame } from '../../../domain/ports/IBrowserBridge.js';
import type { ILogger } from '@generatorai/shared';
import type { ScreencastEncoder } from '../ScreencastEncoder.js';

const logger: ILogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
} as unknown as ILogger;

const HANDLE: BrowserHandle = {
  workspaceId: 'ws-1',
  cdpEndpoint: 'http://127.0.0.1:9333',
  targetId: 't1',
  mode: 'screencast',
  hostRef: 'ctx1',
};

/** A minimal 1×1 baseline JPEG, so `readJpegSize` has something real to parse. */
const TINY_JPEG_BASE64 = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x04, 0x00, 0x06, 0x03]),
  Buffer.from([0xff, 0xd9]),
]).toString('base64');

interface Harness {
  host: ServerPlaywrightHost;
  cdp: EventEmitter & { send: ReturnType<typeof vi.fn> };
  acks: number[];
  emitFrame: (sessionId: number, base64?: string) => void;
  dispose: () => void;
}

function harness(opts?: { encoder?: ScreencastEncoder }): Harness {
  const acks: number[] = [];
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string, params?: { sessionId?: number }) => {
      if (method === 'Page.screencastFrameAck' && typeof params?.sessionId === 'number') {
        acks.push(params.sessionId);
      }
      return undefined;
    }),
  });

  const host = new ServerPlaywrightHost(logger, {
    ...(opts?.encoder ? { screencastEncoder: opts.encoder } : {}),
  });
  const entry = {
    handle: HANDLE,
    cdp,
    page: { viewportSize: () => ({ width: 1280, height: 720 }) },
    screencastActive: false,
    screencastSubscribers: new Set(),
    disposed: false,
    deferredResults: new Map(),
    refMap: new Map(),
    refFrames: new Map(),
  };
  (host as unknown as { entries: Map<string, unknown> }).entries.set(HANDLE.workspaceId, entry);

  return {
    host,
    cdp,
    acks,
    emitFrame: (sessionId, base64 = TINY_JPEG_BASE64) => {
      cdp.emit('Page.screencastFrame', {
        data: base64,
        sessionId,
        metadata: { timestamp: Date.now() / 1000 },
      });
    },
    dispose: () => { entry.disposed = true; },
  };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ServerPlaywrightHost — declared screencast capability (P1-33)', () => {
  it('declares screencast support and its codecs without touching a handle', () => {
    const caps = new ServerPlaywrightHost(logger).screencastCapabilities();
    expect(caps.supportsScreencast).toBe(true);
    // VP8 first: the better stream when the client can decode it.
    expect(caps.codecs).toEqual(['vp8', 'jpeg']);
  });

  it('is synchronous and total — no session, no handle, no throw', () => {
    // The whole point of the capability is to let a caller decide NOT to call
    // `screencast()`. If asking could throw, it would be no better than the
    // try/catch it replaced.
    expect(() => new ServerPlaywrightHost(logger).screencastCapabilities()).not.toThrow();
  });
});

describe('ServerPlaywrightHost.screencast — one pending slot, latest wins (P1-34)', () => {
  it('yields the NEWEST frame when frames outrun the consumer, not the oldest', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    const first = iterator.next();
    await tick();

    // Three frames land before the consumer takes any. The first is taken by
    // the pending `next()`; the remaining two contend for the single slot.
    h.emitFrame(1, TINY_JPEG_BASE64);
    await (await first).value;
    await tick();

    const pending = iterator.next();
    h.emitFrame(2, jpegWithSize(100, 50));
    h.emitFrame(3, jpegWithSize(300, 200));
    const got = (await pending).value as ScreencastFrame;

    // The old three-deep drop-oldest queue would have delivered frame 2 here.
    expect(got.width).toBe(300);
    expect(got.height).toBe(200);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('acks a DISCARDED frame immediately, so capture is never stalled by a drop', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    h.emitFrame(1);
    await tick();

    // Nothing is consuming now. Frame 2 fills the slot; frame 3 evicts it.
    h.emitFrame(2);
    await tick();
    h.emitFrame(3);
    await tick();

    // Frame 2 was superseded and must have been acked on the spot — it is no
    // longer anybody's turn to wait for it.
    expect(h.acks).toContain(2);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('does NOT ack a frame still sitting in the slot — an un-acked frame is what throttles capture', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    h.emitFrame(1);          // consumed by the pending next()
    await tick();
    h.acks.length = 0;

    h.emitFrame(7);          // nobody is consuming: this one waits
    await tick(50);

    // The pre-fix code acked on arrival, so Chromium captured and JPEG-encoded
    // flat out no matter how far behind the viewer was.
    expect(h.acks).not.toContain(7);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('acks a stuck frame after the watchdog so one wedged consumer cannot stall capture forever', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    h.emitFrame(1);
    await tick();
    h.acks.length = 0;

    h.emitFrame(9);
    await tick(1_200);       // past SCREENCAST_ACK_TIMEOUT_MS
    expect(h.acks).toContain(9);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('acks whatever is left in the slot when the consumer goes away', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    h.emitFrame(1);
    await tick();
    h.acks.length = 0;
    h.emitFrame(42);
    await tick();

    abort.abort();
    await iterator.return?.(undefined);
    await tick();
    expect(h.acks).toContain(42);
  });

  it('stops the CDP screencast once the last subscriber unsubscribes', async () => {
    const h = harness();
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    expect(h.cdp.send).toHaveBeenCalledWith('Page.startScreencast', expect.anything());
    abort.abort();
    await iterator.return?.(undefined);
    await tick();
    expect(h.cdp.send).toHaveBeenCalledWith('Page.stopScreencast');
  });
});

describe('ServerPlaywrightHost.screencast — codec negotiation', () => {
  it('never asks the encoder for a stream when the client only accepts JPEG', async () => {
    const openStream = vi.fn();
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();
    expect(openStream).not.toHaveBeenCalled();
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('yields VP8-coded frames when the client accepts VP8 and the encoder opens', async () => {
    let emit: ((chunk: { data: Buffer; keyframe: boolean; timestampUs: number; width: number; height: number }) => void) | null = null;
    const push = vi.fn(() => true);
    const openStream = vi.fn(async (opts: { onChunk: (c: never) => void }) => {
      emit = opts.onChunk as never;
      return { push, alive: true, close: async () => undefined };
    });
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();

    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['vp8', 'jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await tick();
    expect(openStream).toHaveBeenCalledTimes(1);

    h.emitFrame(1);
    await tick();
    // The captured JPEG went to the encoder as base64 — the gateway never
    // decoded the pixel bytes at all on this path.
    expect(push).toHaveBeenCalledWith(TINY_JPEG_BASE64, expect.any(Number));

    emit!({ data: Buffer.from([1, 2, 3]), keyframe: true, timestampUs: 1000, width: 1280, height: 720 });
    const frame = (await pending).value as ScreencastFrame;
    expect(frame.codec).toBe('vp8');
    expect(frame.keyframe).toBe(true);
    expect(frame.width).toBe(1280);
    expect(Array.from(frame.data)).toEqual([1, 2, 3]);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('falls back to JPEG frames — not an exception — when the encoder is unavailable', async () => {
    // `openStream` resolving to null is the declared "cannot encode" answer.
    const openStream = vi.fn(async () => null);
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['vp8', 'jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await tick();
    h.emitFrame(1);
    const frame = (await pending).value as ScreencastFrame;
    expect(frame.codec).toBe('jpeg');
    expect(frame.keyframe).toBe(true);
    abort.abort();
    await iterator.return?.(undefined);
  });

  it('reverts to JPEG mid-stream when the encoder dies, without ending the stream', async () => {
    let fail: ((reason: string) => void) | null = null;
    const openStream = vi.fn(async (opts: { onFailure?: (r: string) => void }) => {
      fail = opts.onFailure ?? null;
      return { push: vi.fn(() => true), alive: true, close: async () => undefined };
    });
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, { fps: 20, quality: 60, codecs: ['vp8', 'jpeg'], signal: abort.signal })[Symbol.asyncIterator]();
    // One outstanding `next()` throughout: an async generator serves queued
    // `next()` calls in order, so a second one would wait for a second frame.
    const pending = iterator.next();
    await tick();

    fail!('renderer crashed');
    await tick();
    h.emitFrame(5);
    const frame = (await pending).value as ScreencastFrame;
    // The client is told by the frame itself, not by an out-of-band signal.
    expect(frame.codec).toBe('jpeg');
    abort.abort();
    await iterator.return?.(undefined);
  });
});

// ────────────────────────────────────────────────────────────────
// Key frame recovery. VP8 deltas reference the frame before them, so ANY
// dropped chunk makes every later chunk undecodable. The encoder only emitted
// a key frame at open and on reconfigure, and the outbound backlog dropped
// with a bare `shift()` — so losing one key frame froze the live view for the
// rest of the session with no error, no log line and no way back.
// ────────────────────────────────────────────────────────────────
describe('ServerPlaywrightHost.screencast — key frame recovery', () => {
  interface Vp8Harness {
    h: Harness;
    abort: AbortController;
    iterator: AsyncIterator<ScreencastFrame>;
    emit: (chunk: { data: Buffer; keyframe: boolean; timestampUs: number; width: number; height: number }) => void;
    requestKeyframe: ReturnType<typeof vi.fn>;
  }

  async function vp8Harness(opts?: {
    onRequestKeyframe?: (request: () => void) => void;
  }): Promise<Vp8Harness> {
    let emit: ((c: never) => void) | null = null;
    const requestKeyframe = vi.fn();
    const openStream = vi.fn(async (o: { onChunk: (c: never) => void }) => {
      emit = o.onChunk;
      return { push: vi.fn(() => true), requestKeyframe, alive: true, close: async () => undefined };
    });
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, {
      fps: 20, quality: 60, codecs: ['vp8'], signal: abort.signal,
      ...(opts?.onRequestKeyframe ? { onRequestKeyframe: opts.onRequestKeyframe } : {}),
    })[Symbol.asyncIterator]();
    return { h, abort, iterator, emit: (c) => emit!(c as never), requestKeyframe };
  }

  const chunk = (keyframe: boolean, ts: number) => ({
    data: Buffer.from([ts & 0xff]), keyframe, timestampUs: ts, width: 1280, height: 720,
  });

  it('never evicts the key frame from a full backlog, and re-keys after a drop', async () => {
    const v = await vp8Harness();
    // One `next()` starts the generator and takes the first chunk; after that
    // nobody consumes, so the outbound backlog fills and starts dropping.
    const first = v.iterator.next();
    await tick();
    v.emit(chunk(false, 1));
    await first;
    await tick();

    // The reference frame, then enough deltas to overflow the backlog twice.
    v.emit(chunk(true, 2));
    for (let ts = 3; ts <= 10; ts += 1) v.emit(chunk(false, ts));
    await tick();

    const delivered: ScreencastFrame[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await v.iterator.next();
      if (r.done) break;
      delivered.push(r.value);
    }

    // Pre-fix: `encoded.shift()` evicted the OLDEST entry, which is the key
    // frame. Everything the client then received was undecodable, forever.
    expect(delivered.some((f) => f.keyframe)).toBe(true);
    // And because deltas WERE lost, the reference chain is broken anyway — the
    // stream has to ask for a fresh key frame or the gap never heals.
    expect(v.requestKeyframe).toHaveBeenCalled();

    v.abort.abort();
    await v.iterator.return?.(undefined);
  });

  it('gives the socket a way to ask for a key frame, so a client that lost the reference recovers', async () => {
    let request: (() => void) | null = null;
    const v = await vp8Harness({ onRequestKeyframe: (fn) => { request = fn; } });
    void v.iterator.next();
    await tick();

    // The socket writer and the browser both drop frames the encoder cannot
    // see. Without this channel neither can ever get the stream back.
    expect(typeof request).toBe('function');
    request!();
    expect(v.requestKeyframe).toHaveBeenCalledTimes(1);

    v.abort.abort();
    await v.iterator.return?.(undefined);
  });

  it('survives a key-frame request made after the encoder died', async () => {
    let fail: ((reason: string) => void) | null = null;
    let request: (() => void) | null = null;
    const openStream = vi.fn(async (o: { onFailure?: (r: string) => void }) => {
      fail = o.onFailure ?? null;
      return { push: vi.fn(() => true), requestKeyframe: vi.fn(), alive: true, close: async () => undefined };
    });
    const h = harness({ encoder: { openStream } as unknown as ScreencastEncoder });
    const abort = new AbortController();
    const iterator = h.host.screencast(HANDLE, {
      fps: 20, quality: 60, codecs: ['vp8'], signal: abort.signal,
      onRequestKeyframe: (fn) => { request = fn; },
    })[Symbol.asyncIterator]();
    void iterator.next();
    await tick();

    fail!('renderer crashed');
    // The stream is now JPEG-only; a stale request from the socket must not
    // throw into a websocket message handler.
    expect(() => request!()).not.toThrow();

    abort.abort();
    await iterator.return?.(undefined);
  });
});

/** A structurally valid JPEG whose SOF declares the given dimensions. */
function jpegWithSize(width: number, height: number): string {
  const sof = Buffer.alloc(10);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]).toString('base64');
}
