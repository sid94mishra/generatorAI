import { describe, expect, it } from 'vitest';

import {
  HttpParseError,
  concat,
  decodeChunked,
  headerPairs,
  parseResponseHead,
  serializeRequest,
  splitUrl,
} from '../httpCodec.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('serializeRequest', () => {
  it('emits a well-formed request line and default headers', () => {
    const out = dec(
      serializeRequest({ method: 'get', target: '/api/chats', headers: [] }, '127.0.0.1:3100'),
    );
    expect(out).toBe(
      'GET /api/chats HTTP/1.1\r\n' +
        'Host: 127.0.0.1:3100\r\n' +
        'Connection: close\r\n' +
        'Accept-Encoding: identity\r\n\r\n',
    );
  });

  it('never overrides a caller-supplied Host', () => {
    // The DPoP `htu` claim is derived from the same origin. If we silently
    // rewrote Host the proof would mismatch and surface as an opaque 401.
    const out = dec(
      serializeRequest(
        { method: 'GET', target: '/x', headers: [['Host', 'example.test:80']] },
        'ignored:1',
      ),
    );
    expect(out).toContain('Host: example.test:80');
    expect(out).not.toContain('Host: ignored:1');
  });

  it('appends the body and its Content-Length', () => {
    const body = enc('{"a":1}');
    const out = dec(
      serializeRequest(
        { method: 'POST', target: '/api/chats', headers: [['Content-Type', 'application/json']], body },
        'h:1',
      ),
    );
    expect(out).toContain('Content-Length: 7');
    expect(out.endsWith('\r\n\r\n{"a":1}')).toBe(true);
  });

  it('sends Content-Length: 0 for a bodyless POST', () => {
    // Without this the server blocks waiting for a body that never arrives.
    const out = dec(serializeRequest({ method: 'POST', target: '/api/x', headers: [] }, 'h:1'));
    expect(out).toContain('Content-Length: 0');
  });

  it('does not invent a Content-Length for GET', () => {
    const out = dec(serializeRequest({ method: 'GET', target: '/api/x', headers: [] }, 'h:1'));
    expect(out).not.toContain('Content-Length');
  });

  it('counts BYTES, not characters, for multi-byte bodies', () => {
    // A length in characters truncates the body and the server hangs.
    const body = enc('{"s":"héllo → ✓"}');
    const out = dec(serializeRequest({ method: 'POST', target: '/x', headers: [], body }, 'h:1'));
    expect(out).toContain(`Content-Length: ${body.byteLength}`);
    expect(body.byteLength).toBeGreaterThan('{"s":"héllo → ✓"}'.length);
  });
});

describe('parseResponseHead', () => {
  it('returns null until the header block is complete', () => {
    // A short read is the normal case on a stream, not an error.
    expect(parseResponseHead(enc('HTTP/1.1 200 OK\r\nContent-Len'))).toBeNull();
  });

  it('parses status, reason and headers', () => {
    const head = parseResponseHead(
      enc('HTTP/1.1 201 Created\r\nContent-Length: 3\r\nX-Trace: abc\r\n\r\nbody'),
    );
    expect(head).toMatchObject({ status: 201, statusText: 'Created', framing: 'length', contentLength: 3 });
    expect(head!.headers.get('x-trace')).toBe('abc');
    expect(head!.headEnd).toBe(enc('HTTP/1.1 201 Created\r\nContent-Length: 3\r\nX-Trace: abc\r\n\r\n').byteLength);
  });

  it('accepts a status line with no reason phrase', () => {
    expect(parseResponseHead(enc('HTTP/1.1 200\r\nContent-Length: 0\r\n\r\n'))).toMatchObject({
      status: 200,
      statusText: '',
    });
  });

  it('preserves repeated headers instead of collapsing them', () => {
    const head = parseResponseHead(
      enc('HTTP/1.1 200 OK\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nContent-Length: 0\r\n\r\n'),
    );
    expect(head!.headers.getSetCookie?.() ?? []).toHaveLength(2);
  });

  it('unfolds obs-fold continuation lines', () => {
    const head = parseResponseHead(
      enc('HTTP/1.1 200 OK\r\nX-Long: first\r\n  second\r\nContent-Length: 0\r\n\r\n'),
    );
    expect(head!.headers.get('x-long')).toBe('first second');
  });

  it('detects chunked framing', () => {
    expect(
      parseResponseHead(enc('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n')),
    ).toMatchObject({ framing: 'chunked' });
  });

  it('falls back to EOF framing with neither length nor chunking', () => {
    expect(parseResponseHead(enc('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n'))).toMatchObject({
      framing: 'eof',
    });
  });

  it.each([
    [204, 'No Content'],
    [304, 'Not Modified'],
    [100, 'Continue'],
  ])('forces no body for %i regardless of headers', (status, text) => {
    // A 204 that claims Content-Length: 5 would otherwise make us wait
    // forever for bytes the server will never send.
    const head = parseResponseHead(enc(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 5\r\n\r\n`));
    expect(head!.framing).toBe('none');
  });

  it('rejects a malformed status line', () => {
    expect(() => parseResponseHead(enc('NOT-HTTP 200 OK\r\n\r\n'))).toThrow(HttpParseError);
  });

  it('rejects a header with no colon', () => {
    expect(() => parseResponseHead(enc('HTTP/1.1 200 OK\r\ngarbage\r\n\r\n'))).toThrow(HttpParseError);
  });

  it('rejects a negative or non-numeric Content-Length', () => {
    expect(() => parseResponseHead(enc('HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n'))).toThrow();
    expect(() => parseResponseHead(enc('HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\n'))).toThrow();
  });

  it('refuses an oversized header block rather than buffering forever', () => {
    const huge = 'HTTP/1.1 200 OK\r\nX: ' + 'a'.repeat(70_000);
    expect(() => parseResponseHead(enc(huge))).toThrow(/maximum size/);
  });
});

describe('decodeChunked', () => {
  it('decodes a complete body with trailing CRLF terminator', () => {
    const r = decodeChunked(enc('5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n'));
    expect(dec(r.data)).toBe('hello world');
    expect(r.complete).toBe(true);
  });

  it('decodes incrementally and reports what it consumed', () => {
    // This is the SSE path: bytes arrive continuously and must be forwarded
    // as they decode, never held until the (never-arriving) terminal chunk.
    const first = decodeChunked(enc('5\r\nhello\r\n3\r\n wo'));
    expect(dec(first.data)).toBe('hello');
    expect(first.complete).toBe(false);
    // Only the complete chunk was consumed; the partial tail is retained.
    expect(first.consumed).toBe(enc('5\r\nhello\r\n').byteLength);

    const rest = decodeChunked(enc('3\r\n wo\r\n0\r\n\r\n'));
    expect(dec(rest.data)).toBe(' wo');
    expect(rest.complete).toBe(true);
  });

  it('does not consume a chunk whose trailing CRLF has not arrived', () => {
    // Consuming early would swallow the CRLF and desynchronise every
    // subsequent chunk — a corruption that only shows up under packet split.
    const r = decodeChunked(enc('5\r\nhello'));
    expect(r.data.byteLength).toBe(0);
    expect(r.consumed).toBe(0);
  });

  it('ignores chunk extensions', () => {
    const r = decodeChunked(enc('5;name=value\r\nhello\r\n0\r\n\r\n'));
    expect(dec(r.data)).toBe('hello');
    expect(r.complete).toBe(true);
  });

  it('accepts uppercase hex sizes', () => {
    const r = decodeChunked(enc('A\r\n0123456789\r\n0\r\n\r\n'));
    expect(dec(r.data)).toBe('0123456789');
  });

  it('consumes trailers after the terminal chunk', () => {
    const raw = '5\r\nhello\r\n0\r\nX-Checksum: deadbeef\r\n\r\n';
    const r = decodeChunked(enc(raw));
    expect(dec(r.data)).toBe('hello');
    expect(r.complete).toBe(true);
    expect(r.consumed).toBe(enc(raw).byteLength);
  });

  it('handles an empty body', () => {
    const r = decodeChunked(enc('0\r\n\r\n'));
    expect(r.data.byteLength).toBe(0);
    expect(r.complete).toBe(true);
  });

  it('rejects a malformed size line', () => {
    expect(() => decodeChunked(enc('zz\r\nhello\r\n'))).toThrow(HttpParseError);
  });

  it('preserves binary payloads byte-for-byte', () => {
    // Chunk boundaries must not corrupt bytes that look like CRLF.
    const payload = new Uint8Array([0, 13, 10, 255, 13, 10, 42]);
    const head = enc(`${payload.byteLength.toString(16)}\r\n`);
    const tail = enc('\r\n0\r\n\r\n');
    const r = decodeChunked(concat([head, payload, tail]));
    expect([...r.data]).toEqual([...payload]);
    expect(r.complete).toBe(true);
  });
});

describe('helpers', () => {
  it('splits a URL into origin-form target and authority', () => {
    expect(splitUrl('http://192.168.1.10:3100/api/chats?limit=20')).toEqual({
      target: '/api/chats?limit=20',
      host: '192.168.1.10:3100',
    });
  });

  it('produces "/" for a bare origin', () => {
    expect(splitUrl('http://h:1').target).toBe('/');
  });

  it('normalizes every HeadersInit shape', () => {
    expect(headerPairs(undefined)).toEqual([]);
    expect(headerPairs({ A: '1' })).toEqual([['A', '1']]);
    expect(headerPairs([['A', '1']])).toEqual([['A', '1']]);
    // Headers lowercases names; that is fine, HTTP names are case-insensitive.
    expect(headerPairs(new Headers({ A: '1' }))).toEqual([['a', '1']]);
  });
});

describe('round trip', () => {
  it('parses a response produced from a serialized request cycle', () => {
    const body = JSON.stringify({ chats: [{ id: 'c1' }] });
    const raw =
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${enc(body).byteLength}\r\n\r\n` +
      body;
    const buf = enc(raw);
    const head = parseResponseHead(buf)!;
    expect(head.status).toBe(200);
    const payload = buf.subarray(head.headEnd, head.headEnd + head.contentLength);
    expect(JSON.parse(dec(payload))).toEqual({ chats: [{ id: 'c1' }] });
  });
});
