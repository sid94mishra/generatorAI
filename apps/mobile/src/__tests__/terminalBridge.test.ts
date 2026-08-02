import { describe, expect, it, vi } from 'vitest';

import {
  OutputBatcher,
  parseFromWebView,
  splitBatch,
} from '../terminal/bridgeProtocol';

describe('OutputBatcher', () => {
  it('coalesces bursts into a single bridge message', () => {
    // A build log emits tens of thousands of writes per second. One
    // postMessage each drops frames within a second.
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new OutputBatcher(flush, 16);

    for (let i = 0; i < 500; i += 1) batcher.push(`chunk${i}`);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(splitBatch(flush.mock.calls[0]![0] as string)).toHaveLength(500);
    vi.useRealTimers();
  });

  it('starts a new window after flushing', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new OutputBatcher(flush, 16);

    batcher.push('a');
    vi.advanceTimersByTime(16);
    batcher.push('b');
    vi.advanceTimersByTime(16);

    expect(flush).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not fire for an empty buffer', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    new OutputBatcher(flush, 16);
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('drains synchronously so trailing output is not lost on teardown', () => {
    const flush = vi.fn();
    const batcher = new OutputBatcher(flush, 16);
    batcher.push('last output');
    batcher.drain();
    expect(flush).toHaveBeenCalledWith('last output');
  });

  it('keeps chunks individually decodable', () => {
    // Concatenating base64 payloads is only valid when every chunk length is
    // a multiple of 3, which PTY output never guarantees. A delimiter is
    // what stops the terminal rendering garbage under load.
    const flush = vi.fn();
    const batcher = new OutputBatcher(flush, 16);
    batcher.push('aGVsbG8=');
    batcher.push('d29ybGQ=');
    batcher.drain();
    expect(splitBatch(flush.mock.calls[0]![0] as string)).toEqual(['aGVsbG8=', 'd29ybGQ=']);
  });

  it('cancels pending work on dispose', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new OutputBatcher(flush, 16);
    batcher.push('a');
    batcher.dispose();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
    expect(batcher.pendingCount).toBe(0);
    vi.useRealTimers();
  });
});

describe('splitBatch', () => {
  it('returns nothing for an empty payload', () => {
    expect(splitBatch('')).toEqual([]);
  });
});

describe('parseFromWebView — accepts valid messages', () => {
  it('parses each known message type', () => {
    expect(parseFromWebView('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseFromWebView('{"type":"bell"}')).toEqual({ type: 'bell' });
    expect(parseFromWebView('{"type":"input","b64":"YQ=="}')).toEqual({
      type: 'input',
      b64: 'YQ==',
    });
    expect(parseFromWebView('{"type":"resize","cols":80,"rows":24}')).toEqual({
      type: 'resize',
      cols: 80,
      rows: 24,
    });
    expect(parseFromWebView('{"type":"selection","text":"hi"}')).toEqual({
      type: 'selection',
      text: 'hi',
    });
  });
});

describe('parseFromWebView — rejects untrusted input', () => {
  it('drops malformed JSON rather than throwing', () => {
    // The WebView renders untrusted terminal output; whatever it posts back
    // is untrusted input.
    for (const raw of ['', 'not json', '{', 'null', '[]', '"string"', '42']) {
      expect(parseFromWebView(raw), raw).toBeNull();
    }
  });

  it('drops an unknown message type', () => {
    expect(parseFromWebView('{"type":"eval","code":"process.exit()"}')).toBeNull();
    expect(parseFromWebView('{"nope":1}')).toBeNull();
  });

  it('drops input with a non-string payload', () => {
    // This value is forwarded to the PTY, where it becomes keystrokes on the
    // user's machine.
    expect(parseFromWebView('{"type":"input","b64":123}')).toBeNull();
    expect(parseFromWebView('{"type":"input"}')).toBeNull();
  });

  it('rejects absurd resize dimensions', () => {
    // A resize is forwarded to the PTY and can wedge or crash the child.
    for (const dims of [
      '{"type":"resize","cols":0,"rows":24}',
      '{"type":"resize","cols":-1,"rows":24}',
      '{"type":"resize","cols":99999,"rows":24}',
      '{"type":"resize","cols":80.5,"rows":24}',
      '{"type":"resize","cols":"80","rows":24}',
      '{"type":"resize","cols":80}',
    ]) {
      expect(parseFromWebView(dims), dims).toBeNull();
    }
  });

  it('bounds a selection so a huge scrollback cannot exhaust memory', () => {
    const huge = JSON.stringify({ type: 'selection', text: 'x'.repeat(500_000) });
    const parsed = parseFromWebView(huge);
    expect(parsed).not.toBeNull();
    expect((parsed as { text: string }).text.length).toBe(100_000);
  });
});
