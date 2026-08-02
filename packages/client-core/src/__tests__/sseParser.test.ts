import { describe, expect, it } from 'vitest';

import { SseParser, parseSseJson } from '../stream/sseParser.js';

describe('SseParser', () => {
  it('parses a simple record', () => {
    const p = new SseParser();
    expect(p.push('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('defaults the event name to "message"', () => {
    expect(new SseParser().push('data: x\n\n')[0]!.event).toBe('message');
  });

  it('honours an explicit event name', () => {
    expect(new SseParser().push('event: harness.token\ndata: x\n\n')[0]).toMatchObject({
      event: 'harness.token',
      data: 'x',
    });
  });

  it('joins repeated data lines with newlines', () => {
    expect(new SseParser().push('data: a\ndata: b\n\n')[0]!.data).toBe('a\nb');
  });

  it('reassembles a record split across chunk boundaries', () => {
    // Chunk boundaries have no relationship to record boundaries. A naive
    // per-chunk split silently drops any record that straddles two reads —
    // invisible locally, constant over a relay.
    const p = new SseParser();
    expect(p.push('data: hel')).toEqual([]);
    expect(p.push('lo\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('handles several records arriving in one chunk', () => {
    const out = new SseParser().push('data: a\n\ndata: b\n\ndata: c\n\n');
    expect(out.map((m) => m.data)).toEqual(['a', 'b', 'c']);
  });

  it('ignores comment keep-alives', () => {
    // The server sends these to hold the connection open. Delivering them
    // as events would inject blank frames into the transcript.
    const p = new SseParser();
    expect(p.push(': keep-alive\n\n')).toEqual([]);
    expect(p.push(':\n\ndata: real\n\n')).toEqual([{ event: 'message', data: 'real' }]);
  });

  it('strips exactly one leading space after the colon', () => {
    // `data:  x` means a value of " x", not "x".
    expect(new SseParser().push('data:  x\n\n')[0]!.data).toBe(' x');
    expect(new SseParser().push('data:x\n\n')[0]!.data).toBe('x');
  });

  it.each([
    ['CRLF', 'data: x\r\n\r\n'],
    ['bare CR', 'data: x\r\r'],
    ['LF', 'data: x\n\n'],
  ])('accepts %s line endings', (_label, raw) => {
    expect(new SseParser().push(raw)).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('tracks the last event id for resume', () => {
    const p = new SseParser();
    p.push('id: 42\ndata: x\n\n');
    expect(p.lastEventId).toBe('42');
    expect(p.push('id: 43\ndata: y\n\n')[0]).toMatchObject({ id: '43' });
  });

  it('keeps the resume cursor across a reset', () => {
    // reset() runs on reconnect. Forgetting the id would replay the whole
    // stream from the beginning.
    const p = new SseParser();
    p.push('id: 99\ndata: x\n\n');
    p.reset();
    expect(p.lastEventId).toBe('99');
  });

  it('discards a partial record on reset', () => {
    const p = new SseParser();
    p.push('data: half');
    p.reset();
    expect(p.push('\n\n')).toEqual([]);
  });

  it('ignores an id containing NUL rather than corrupting resume', () => {
    const p = new SseParser();
    p.push('id: bad\0id\ndata: x\n\n');
    expect(p.lastEventId).toBeUndefined();
  });

  it('captures a retry hint', () => {
    const p = new SseParser();
    expect(p.push('retry: 5000\ndata: x\n\n')[0]).toMatchObject({ retry: 5000 });
    expect(p.retryHint).toBe(5000);
  });

  it('ignores a non-numeric retry', () => {
    const p = new SseParser();
    p.push('retry: soon\ndata: x\n\n');
    expect(p.retryHint).toBeUndefined();
  });

  it('treats a field with no colon as an empty value', () => {
    const p = new SseParser();
    expect(p.push('data\n\n')[0]!.data).toBe('');
  });

  it('does not emit a record that carried no data', () => {
    // An `event:` with no `data:` is a no-op dispatch, not an empty message.
    expect(new SseParser().push('event: ping\n\n')).toEqual([]);
  });

  it('ignores unknown fields', () => {
    expect(new SseParser().push('foo: bar\ndata: x\n\n')[0]!.data).toBe('x');
  });

  it('does not leak the event name into the next record', () => {
    const out = new SseParser().push('event: a\ndata: 1\n\ndata: 2\n\n');
    expect(out.map((m) => m.event)).toEqual(['a', 'message']);
  });

  it('preserves data containing colons and JSON', () => {
    const payload = '{"kind":"harness.token","data":{"text":"a: b"}}';
    expect(new SseParser().push(`data: ${payload}\n\n`)[0]!.data).toBe(payload);
  });

  it('handles a byte-at-a-time stream', () => {
    // The pathological case: every character in its own chunk.
    const p = new SseParser();
    const raw = 'event: harness.token\ndata: {"text":"hi"}\n\n';
    const out = [...raw].flatMap((ch) => p.push(ch));
    expect(out).toEqual([{ event: 'harness.token', data: '{"text":"hi"}' }]);
  });
});

describe('parseSseJson', () => {
  it('parses a JSON payload', () => {
    expect(parseSseJson({ event: 'm', data: '{"a":1}' })).toEqual({ a: 1 });
  });

  it('returns null for a malformed payload instead of throwing', () => {
    // One bad frame must not kill the stream; the next may be fine.
    expect(parseSseJson({ event: 'm', data: 'not json' })).toBeNull();
  });
});
