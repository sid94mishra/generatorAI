// ────────────────────────────────────────────────────────────────
// CascadingSttEngine — this is the safety net that makes an unverified
// ParakeetSttEngine default model id fail SAFE (falls back to Whisper)
// instead of breaking voice input outright. These tests exercise exactly
// that contract against fake engines, independent of any real model.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { CascadingSttEngine } from '../CascadingSttEngine.js';
import { STT_STREAMING_UNSUPPORTED } from '../../../domain/ports/ISpeechToTextEngine.js';
import type { ISpeechToTextEngine } from '../../../domain/ports/ISpeechToTextEngine.js';

function fakeEngine(name: string, opts: { failLoad?: boolean; text?: string } = {}): ISpeechToTextEngine {
  return {
    name,
    load: opts.failLoad ? vi.fn().mockRejectedValue(new Error(`${name} unavailable`)) : vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({ text: opts.text ?? `${name}-said-it` }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('CascadingSttEngine', () => {
  it('throws if constructed with zero candidates', () => {
    expect(() => new CascadingSttEngine([])).toThrow(/at least one candidate/);
  });

  it('reports a combined "cascading:" name before load(), and the ACTIVE candidate\'s name after', async () => {
    const primary = fakeEngine('parakeet:some-id');
    const fallback = fakeEngine('whisper:base.en');
    const cascade = new CascadingSttEngine([primary, fallback]);

    expect(cascade.name).toBe('cascading:parakeet:some-id|whisper:base.en');
    await cascade.load();
    expect(cascade.name).toBe('parakeet:some-id');
  });

  it('uses the first candidate that loads successfully, without trying the rest', async () => {
    const primary = fakeEngine('parakeet:good');
    const fallback = fakeEngine('whisper:base.en');
    const cascade = new CascadingSttEngine([primary, fallback]);

    await cascade.load();

    expect(primary.load).toHaveBeenCalledTimes(1);
    expect(fallback.load).not.toHaveBeenCalled();
  });

  it('falls back to the next candidate when the first fails to load', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    const primary = fakeEngine('parakeet:bad-id', { failLoad: true });
    const fallback = fakeEngine('whisper:base.en');
    const cascade = new CascadingSttEngine([primary, fallback], logger);

    await cascade.load();

    expect(primary.load).toHaveBeenCalledTimes(1);
    expect(fallback.load).toHaveBeenCalledTimes(1);
    expect(cascade.name).toBe('whisper:base.en');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws only if EVERY candidate fails to load', async () => {
    const a = fakeEngine('a', { failLoad: true });
    const b = fakeEngine('b', { failLoad: true });
    const cascade = new CascadingSttEngine([a, b]);

    await expect(cascade.load()).rejects.toThrow(/unavailable/);
  });

  it('transcribe() delegates to whichever candidate became active, loading lazily if needed', async () => {
    const primary = fakeEngine('parakeet:good', { text: 'parakeet result' });
    const fallback = fakeEngine('whisper:base.en', { text: 'whisper result' });
    const cascade = new CascadingSttEngine([primary, fallback]);

    const result = await cascade.transcribe(new Float32Array(10));

    expect(result.text).toBe('parakeet result');
    expect(primary.transcribe).toHaveBeenCalledTimes(1);
    expect(fallback.transcribe).not.toHaveBeenCalled();
  });

  it('coalesces concurrent load() calls into a single resolution attempt', async () => {
    const primary = fakeEngine('parakeet:good');
    const fallback = fakeEngine('whisper:base.en');
    const cascade = new CascadingSttEngine([primary, fallback]);

    await Promise.all([cascade.load(), cascade.load(), cascade.load()]);

    expect(primary.load).toHaveBeenCalledTimes(1);
  });

  it('dispose() disposes every candidate and resets so a later load() re-resolves', async () => {
    const primary = fakeEngine('parakeet:good');
    const fallback = fakeEngine('whisper:base.en');
    const cascade = new CascadingSttEngine([primary, fallback]);
    await cascade.load();

    await cascade.dispose();

    expect(primary.dispose).toHaveBeenCalledTimes(1);
    expect(fallback.dispose).toHaveBeenCalledTimes(1);
    expect(cascade.name).toBe('cascading:parakeet:good|whisper:base.en');
  });
});

describe('CascadingSttEngine — live streaming', () => {
  it('forwards createStream to whichever candidate won', async () => {
    // The regression: the wrapper did not define `createStream`, so
    // SttSessionRunner's `typeof engine.createStream === "function"` check
    // failed and a streaming engine behind `auto` was silently demoted to
    // VAD-segmented batch transcription — words arrived in blocks after the
    // speaker stopped instead of as they spoke.
    const handle = { pushAudio: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const streaming = {
      name: 'streamer',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      createStream: vi.fn().mockResolvedValue(handle),
    } as unknown as ISpeechToTextEngine;
    const broken = {
      name: 'broken',
      load: vi.fn().mockRejectedValue(new Error('nope')),
      transcribe: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as ISpeechToTextEngine;

    const cascade = new CascadingSttEngine([broken, streaming]);
    const cb = { onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    await expect(cascade.createStream(cb)).resolves.toBe(handle);
    expect(streaming.createStream).toHaveBeenCalledWith(cb, undefined);
  });

  it('reports the unsupported sentinel when the winner is a batch engine', async () => {
    // Callers use this to fall back QUIETLY, rather than warning once per
    // dictation session on every non-streaming engine.
    const batch = {
      name: 'batch',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as ISpeechToTextEngine;
    const cascade = new CascadingSttEngine([batch]);
    await expect(
      cascade.createStream({ onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn() }),
    ).rejects.toThrow(STT_STREAMING_UNSUPPORTED);
  });
});
