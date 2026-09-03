// ────────────────────────────────────────────────────────────────
// D5 / W15 — the client half of the live view.
//
// What is pinned here:
//   • the accept-list is PROBED, not assumed — `VideoDecoder` existing is not
//     the same as VP8 being supported, and a client that declares a codec it
//     cannot decode gets a stream it cannot render;
//   • a VP8 frame reaches `VideoDecoder.decode` with the right chunk type and
//     the timestamp from the wire header;
//   • a delta frame arriving before any key frame is DROPPED rather than fed
//     to the decoder, which errors on it;
//   • a JPEG frame on the same socket is decoded through `createImageBitmap`,
//     so the fallback and the steady state paint the same canvas.
//
// Pre-fix, the client had none of this: it wrapped every binary message in a
// Blob and set it as an `<img>` src, which cannot express a codec at all.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/providers/ThemeProvider.js', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', theme: 'dark', setTheme: () => {} }),
}));
vi.mock('@/platform/authTransport.js', () => ({
  buildAuthenticatedSocketUrl: vi.fn(async (url: string) => url),
}));
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: () => ({ close: () => {} }),
}));
vi.mock('./NativeBrowserView.js', () => ({ NativeBrowserView: () => null }));

import { BrowserPanel } from '@/components/chat/BrowserPanel.js';

const HEADER_BYTES = 16;

/** Builds one wire frame exactly as `browser-ws.ts` writes it. */
function wireFrame(opts: {
  codec: 0 | 1;
  keyframe: boolean;
  width: number;
  height: number;
  timestampUs: number;
  payload: number[];
  magic?: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + opts.payload.length);
  const view = new DataView(buf);
  view.setUint8(0, opts.magic ?? 0x47);
  view.setUint8(1, 1);
  view.setUint8(2, opts.codec);
  view.setUint8(3, opts.keyframe ? 1 : 0);
  view.setUint16(4, opts.width);
  view.setUint16(6, opts.height);
  view.setFloat64(8, opts.timestampUs);
  new Uint8Array(buf, HEADER_BYTES).set(opts.payload);
  return buf;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'blob';
  readyState = 1;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

interface DecodedChunk { type: string; timestamp: number; byteLength: number }
const decoded: DecodedChunk[] = [];
const configured: Array<{ codec: string; codedWidth?: number; codedHeight?: number }> = [];
const bitmapCalls: Blob[] = [];

class FakeVideoDecoder {
  static supported = true;
  static isConfigSupported = vi.fn(async () => ({ supported: FakeVideoDecoder.supported }));
  state = 'unconfigured';
  constructor(_init: unknown) { /* output callback unused: we assert on decode */ }
  configure(cfg: { codec: string; codedWidth?: number; codedHeight?: number }) {
    configured.push(cfg);
    this.state = 'configured';
  }
  decode(chunk: DecodedChunk) { decoded.push(chunk); }
  close() { this.state = 'closed'; }
}

class FakeEncodedVideoChunk {
  type: string; timestamp: number; byteLength: number;
  constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.byteLength = init.data.byteLength;
  }
}

const descriptor = {
  status: 'active',
  mode: 'screencast',
  ready: true,
  currentUrl: 'https://example.com',
  config: { visibility: 'visible', enabled: true },
};

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  decoded.length = 0;
  configured.length = 0;
  bitmapCalls.length = 0;
  FakeVideoDecoder.supported = true;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('VideoDecoder', FakeVideoDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    bitmapCalls.push(blob);
    return { width: 4, height: 3, close: () => undefined } as unknown as ImageBitmap;
  }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/browser/descriptor')) {
      return { ok: true, json: async () => descriptor } as unknown as Response;
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' } as unknown as Response;
  }));
  // jsdom canvases have no 2D context; the panel only needs drawImage.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel() {
  return (
    <BrowserPanel embedded workspaceId="ws-1" tabId="browser-1" open visible onClose={() => {}} />
  );
}

async function openSocket(): Promise<FakeWebSocket> {
  render(panel());
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const ws = FakeWebSocket.instances[0]!;
  ws.onopen?.();
  return ws;
}

function helloFrom(ws: FakeWebSocket): { type: string; accept: string[] } | null {
  for (const raw of ws.sent) {
    const msg = JSON.parse(raw) as { type: string; accept?: string[] };
    if (msg.type === 'hello') return msg as { type: string; accept: string[] };
  }
  return null;
}

describe('BrowserPanel — codec negotiation', () => {
  it('requests arraybuffer framing so the header can be read synchronously', async () => {
    const ws = await openSocket();
    // A Blob would put an async hop in front of every single frame just to
    // find out which decoder the payload belongs to.
    expect(ws.binaryType).toBe('arraybuffer');
  });

  it('declares vp8 first when the browser reports it supported', async () => {
    const ws = await openSocket();
    await waitFor(() => expect(helloFrom(ws)).not.toBeNull());
    expect(helloFrom(ws)!.accept).toEqual(['vp8', 'jpeg']);
  });

  it('declares JPEG only when VP8 is not actually supported', async () => {
    // The regression this guards: "VideoDecoder exists" is not "vp8 decodes".
    FakeVideoDecoder.supported = false;
    const ws = await openSocket();
    await waitFor(() => expect(helloFrom(ws)).not.toBeNull());
    expect(helloFrom(ws)!.accept).toEqual(['jpeg']);
  });

  it('declares JPEG only when there is no WebCodecs at all', async () => {
    vi.stubGlobal('VideoDecoder', undefined);
    const ws = await openSocket();
    await waitFor(() => expect(helloFrom(ws)).not.toBeNull());
    expect(helloFrom(ws)!.accept).toEqual(['jpeg']);
  });
});

describe('BrowserPanel — frame decoding', () => {
  it('feeds a VP8 key frame to VideoDecoder with the wire timestamp', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 1280, height: 720, timestampUs: 33_333, payload: [1, 2, 3] }) });
    await waitFor(() => expect(decoded).toHaveLength(1));
    expect(decoded[0]!.type).toBe('key');
    expect(decoded[0]!.timestamp).toBe(33_333);
    expect(decoded[0]!.byteLength).toBe(3);
    expect(configured[0]).toMatchObject({ codec: 'vp8', codedWidth: 1280, codedHeight: 720 });
  });

  it('drops a delta frame that arrives before any key frame', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 1280, height: 720, timestampUs: 1_000, payload: [7] }) });
    await new Promise((r) => setTimeout(r, 50));
    // Handing this to the decoder is an error, and an errored decoder stops
    // producing frames entirely — a black panel until the next reconnect.
    expect(decoded).toHaveLength(0);
  });

  it('decodes deltas once a key frame has established the reference', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 1_000, payload: [1] }) });
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 2_000, payload: [2] }) });
    await waitFor(() => expect(decoded).toHaveLength(2));
    expect(decoded.map((d) => d.type)).toEqual(['key', 'delta']);
  });

  it('reconfigures the decoder when the frame size changes', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 1_000, payload: [1] }) });
    await waitFor(() => expect(configured).toHaveLength(1));
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 1280, height: 720, timestampUs: 2_000, payload: [1] }) });
    // A decoder configured for the old coded size renders a stretched frame
    // and never says anything is wrong.
    await waitFor(() => expect(configured).toHaveLength(2));
    expect(configured[1]).toMatchObject({ codedWidth: 1280, codedHeight: 720 });
  });

  it('decodes a JPEG frame on the same socket through createImageBitmap', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 0, keyframe: true, width: 0, height: 0, timestampUs: 0, payload: [0xff, 0xd8, 0xff, 0xd9] }) });
    await waitFor(() => expect(bitmapCalls).toHaveLength(1));
    // No VideoDecoder involvement: the two codecs share a canvas, not a path.
    expect(decoded).toHaveLength(0);
  });

  it('ignores a frame whose magic byte does not match rather than decoding garbage', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ magic: 0x00, codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 1, payload: [1] }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(decoded).toHaveLength(0);
    expect(bitmapCalls).toHaveLength(0);
  });

  // CORRECTED. This test used to assert that a KEY frame is dropped while the
  // document is hidden, cementing the freeze as intended behaviour: the hidden
  // drop ran before the header was even read, so the one frame that can
  // restart a VP8 stream was thrown away along with the deltas, and nothing
  // ever asked for another. The saving the drop exists for is the delta
  // stream; a key frame arrives only at open, on resize and on request, so
  // decoding it costs almost nothing and is what makes resuming possible.
  it('drops delta frames while the document is hidden, but never a key frame', async () => {
    const ws = await openSocket();
    hidden(true);
    try {
      ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 1, payload: [1] }) });
      await waitFor(() => expect(decoded).toHaveLength(1));
      expect(decoded[0]!.type).toBe('key');

      ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 2, payload: [2] }) });
      await new Promise((r) => setTimeout(r, 50));
      // The delta is the waste this drop exists to avoid.
      expect(decoded).toHaveLength(1);
    } finally {
      hidden(false);
    }
  });

  it('does not decode a JPEG frame while the document is hidden', async () => {
    const ws = await openSocket();
    hidden(true);
    try {
      ws.onmessage?.({ data: wireFrame({ codec: 0, keyframe: true, width: 0, height: 0, timestampUs: 0, payload: [0xff, 0xd8] }) });
      await new Promise((r) => setTimeout(r, 50));
      // JPEG is self-contained, so dropping one strands nothing behind it.
      expect(bitmapCalls).toHaveLength(0);
    } finally {
      hidden(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// The live view must SELF-HEAL. Every VP8 delta references the frame before
// it, so one lost chunk — a hidden tab, a congested socket, a full encoder
// backlog — makes every later chunk undecodable. Before this, none of the
// three drop paths asked for anything, so the panel froze on its last good
// frame permanently: no error, no log line, no reconnect.
// ────────────────────────────────────────────────────────────────
describe('BrowserPanel — key frame recovery', () => {
  it('asks the server for a key frame when a delta arrives with no reference', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 1, payload: [7] }) });
    await waitFor(() => expect(requestsFrom(ws)).toBe(1));
    expect(decoded).toHaveLength(0);
  });

  it('recovers after a hidden-tab drop instead of freezing on the last frame', async () => {
    const ws = await openSocket();
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 1, payload: [1] }) });
    await waitFor(() => expect(decoded).toHaveLength(1));

    hidden(true);
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 2, payload: [2] }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(decoded).toHaveLength(1);
    // Nothing is asked for while hidden — that would defeat the saving.
    expect(requestsFrom(ws)).toBe(0);

    hidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    // The reference is gone, so the panel must say so rather than wait for a
    // key frame the encoder had no reason to produce.
    await waitFor(() => expect(requestsFrom(ws)).toBe(1));

    // A delta in the meantime is still undecodable and must not be fed in.
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 3, payload: [3] }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(decoded).toHaveLength(1);

    // …and the requested key frame puts the stream back.
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: true, width: 640, height: 480, timestampUs: 4, payload: [4] }) });
    ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: 5, payload: [5] }) });
    await waitFor(() => expect(decoded).toHaveLength(3));
    expect(decoded.map((d) => d.type)).toEqual(['key', 'key', 'delta']);
  });

  it('does not spam the server with one request per undecodable frame', async () => {
    const ws = await openSocket();
    for (let i = 0; i < 12; i += 1) {
      ws.onmessage?.({ data: wireFrame({ codec: 1, keyframe: false, width: 640, height: 480, timestampUs: i, payload: [i] }) });
    }
    await waitFor(() => expect(requestsFrom(ws)).toBeGreaterThan(0));
    // A 20 fps stream with a broken reference would otherwise ask 20 times a
    // second, and every answer is a full key frame.
    expect(requestsFrom(ws)).toBe(1);
  });
});

function hidden(on: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => (on ? 'hidden' : 'visible'),
  });
}

/** How many key-frame requests the panel has sent on this socket. */
function requestsFrom(ws: FakeWebSocket): number {
  return ws.sent.filter((raw) => {
    try { return (JSON.parse(raw) as { type?: string }).type === 'request_keyframe'; }
    catch { return false; }
  }).length;
}
