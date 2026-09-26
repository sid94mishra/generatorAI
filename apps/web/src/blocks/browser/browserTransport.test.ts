// Pure pieces of the browser transport: stream events, screencast framing,
// descriptor cadence, reconnect backoff, native view bounds, the Share title.
import { describe, expect, it } from 'vitest';

import { parseBrowserStreamMessage, selectionAttachment } from './browserEvents.js';
import { CODEC_JPEG, CODEC_VP8, FRAME_HEADER_BYTES, parseScreencastFrame } from './screencastFrame.js';
import { isTransientDescriptor } from './useBrowserDescriptor.js';
import { MAX_STREAM_RECONNECTS, reconnectDelayMs } from './useBrowserLiveStream.js';
import { shareToggleTitle } from './useBrowserNavigation.js';
import { snapViewBounds } from './useNativeBrowserView.js';

const sel = { workspaceId: 'ws-1', artifactId: 'art-9', url: 'https://example.com/', cssSelector: '#a', xpath: '/a' };

describe('parseBrowserStreamMessage', () => {
  it('reads a selection from the mux wire shape ({kind, payload})', () => {
    const msg = parseBrowserStreamMessage(JSON.stringify({ kind: 'browser.selection', payload: sel }));
    expect(msg).toEqual({
      refreshDescriptor: false,
      selection: { url: 'https://example.com/', cssSelector: '#a', xpath: '/a', artifactId: 'art-9' },
    });
  });

  it('also reads the AgentEvent shape ({kind, data})', () => {
    expect(parseBrowserStreamMessage(JSON.stringify({ kind: 'browser.selection', data: sel }))?.selection?.artifactId).toBe('art-9');
  });

  it('needs an artifact id, and defaults the missing strings', () => {
    expect(parseBrowserStreamMessage(JSON.stringify({ kind: 'browser.selection', payload: {} }))?.selection).toBeNull();
    expect(parseBrowserStreamMessage(JSON.stringify({ kind: 'browser.selection', payload: { artifactId: 'a' } }))?.selection)
      .toEqual({ url: '', cssSelector: '', xpath: '', artifactId: 'a' });
  });

  it('asks for a descriptor refresh on session and navigation events only', () => {
    for (const kind of ['browser.session_created', 'browser.session_stopped', 'browser.session_updated', 'browser.navigation', 'browser.error']) {
      expect(parseBrowserStreamMessage(JSON.stringify({ kind, payload: { workspaceId: 'ws-1' } }))?.refreshDescriptor).toBe(true);
    }
    for (const kind of ['browser.selection', 'browser.snapshot', 'browser.action_started', undefined]) {
      expect(parseBrowserStreamMessage(JSON.stringify({ kind, payload: null }))?.refreshDescriptor).toBe(false);
    }
  });

  it('returns null for non-JSON and survives a JSON null', () => {
    expect(parseBrowserStreamMessage('not json')).toBeNull();
    expect(parseBrowserStreamMessage('null')).toEqual({ refreshDescriptor: false, selection: null });
  });
});

describe('selectionAttachment', () => {
  it('is element-<ts>.json carrying the summary', async () => {
    const file = selectionAttachment({ url: 'u', cssSelector: 'c', xpath: 'x', artifactId: 'a' }, 42);
    expect(file.name).toBe('element-42.json');
    expect(file.type).toBe('application/json');
    expect(JSON.parse(await file.text())).toEqual({ url: 'u', cssSelector: 'c', xpath: 'x', artifactId: 'a' });
  });
});

function frame({ magic = 0x47, version = 1, codec = CODEC_VP8, key = true, width = 1280, height = 800, ts = 12.5, payload = [1, 2, 3] } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER_BYTES + payload.length);
  const v = new DataView(buf);
  v.setUint8(0, magic); v.setUint8(1, version); v.setUint8(2, codec); v.setUint8(3, key ? 1 : 0);
  v.setUint16(4, width); v.setUint16(6, height); v.setFloat64(8, ts);
  new Uint8Array(buf, FRAME_HEADER_BYTES).set(payload);
  return buf;
}

describe('parseScreencastFrame', () => {
  it('reads the 16-byte header and the payload', () => {
    const f = parseScreencastFrame(frame());
    expect(f).toMatchObject({ codec: CODEC_VP8, keyframe: true, width: 1280, height: 800, timestamp: 12.5 });
    expect(Array.from(f!.payload)).toEqual([1, 2, 3]);
    expect(parseScreencastFrame(frame({ codec: CODEC_JPEG, key: false }))).toMatchObject({ codec: CODEC_JPEG, keyframe: false });
  });

  it('drops short frames and foreign framing', () => {
    expect(parseScreencastFrame(new ArrayBuffer(FRAME_HEADER_BYTES))).toBeNull();
    expect(parseScreencastFrame(frame({ magic: 0x48 }))).toBeNull();
    expect(parseScreencastFrame(frame({ version: 2 }))).toBeNull();
  });
});

describe('descriptor cadence', () => {
  it('is transient while starting, stopping or active-but-not-ready', () => {
    expect(isTransientDescriptor({ status: 'starting', mode: 'off', ready: false })).toBe(true);
    expect(isTransientDescriptor({ status: 'stopping', mode: 'screencast', ready: true })).toBe(true);
    expect(isTransientDescriptor({ status: 'active', mode: 'screencast', ready: false })).toBe(true);
    expect(isTransientDescriptor({ status: 'active', mode: 'screencast', ready: true })).toBe(false);
    expect(isTransientDescriptor({ status: 'off', mode: 'off', ready: false })).toBe(false);
  });
});

describe('screencast reconnect backoff', () => {
  it('grows by 250 ms per attempt, capped at 2 s, for six attempts', () => {
    expect(MAX_STREAM_RECONNECTS).toBe(6);
    expect([1, 2, 3, 4, 5, 6].map(reconnectDelayMs)).toEqual([250, 500, 750, 1000, 1250, 1500]);
    expect(reconnectDelayMs(20)).toBe(2000);
  });
});

describe('snapViewBounds', () => {
  it('snaps to physical pixels and floors to integers', () => {
    expect(snapViewBounds({ left: 10.3, top: 20.6, width: 300.4, height: 200.9 }, 2)).toEqual({ x: 10, y: 20, width: 300, height: 201 });
    expect(snapViewBounds({ left: -5, top: -1, width: 100, height: 100 }, 1)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('is null for a container under 4 px on either side', () => {
    expect(snapViewBounds({ left: 0, top: 0, width: 3, height: 500 }, 1)).toBeNull();
    expect(snapViewBounds({ left: 0, top: 0, width: 500, height: 3 }, 1)).toBeNull();
  });
});

describe('shareToggleTitle', () => {
  it('says why the toggle is locked while the agent streams', () => {
    expect(shareToggleTitle(true, false)).toBe('Cannot re-attach while agent is streaming');
    expect(shareToggleTitle(true, true)).toBe('Cannot detach while agent is streaming');
    expect(shareToggleTitle(false, true)).toBe('Sharing with Agent — click to stop sharing');
    expect(shareToggleTitle(false, false)).toBe('Share with Agent');
  });
});
