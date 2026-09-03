// ────────────────────────────────────────────────────────────────
// KokoroTtsEngine — `kokoro-js` is mocked; no real model download or
// synthesis happens. Locks in: model id resolution, env var overrides,
// dtype selection, load coalescing, voice validation/fallback, voice+speed
// forwarding, and chunking of the (non-streaming) generate() output.
//
// A NOTE ON WHAT THIS SUITE USED TO ASSERT, because it is the reason a
// completely broken engine shipped looking tested:
//
// The previous version mocked `@huggingface/transformers` and asserted
// `pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX')` was
// called. Every one of those assertions passed. The call itself throws
// `Unsupported model type: style_text_to_speech_2` against the real library,
// because Kokoro's architecture is not in either of the two model maps that
// pipeline resolves against — so the suite was verifying, in detail, that we
// correctly made a call that can never work.
//
// The lesson encoded here: `loads against the real library` (below) does not
// mock. It imports `kokoro-js` for real and asserts the engine's entry point
// resolves, so no future refactor can reintroduce a "mocked green, broken in
// production" integration without this file going red.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromPretrained = vi.fn();
const mockTransformersEnv: Record<string, unknown> = {};

vi.mock('kokoro-js', () => ({
  KokoroTTS: {
    from_pretrained: (...args: unknown[]) => fromPretrained(...args),
  },
}));

vi.mock('@huggingface/transformers', () => ({
  env: mockTransformersEnv,
}));

import { KokoroTtsEngine } from '../KokoroTtsEngine.js';

/** The 28 voices the real repo ships — only the names matter here. */
const VOICES = { af_heart: {}, af_bella: {}, am_adam: {}, bm_lewis: {} };

function mockModel(overrides: { audio?: Float32Array; sampling_rate?: number; voices?: object } = {}) {
  const generate = vi.fn().mockResolvedValue({
    audio: overrides.audio ?? new Float32Array(10),
    sampling_rate: overrides.sampling_rate ?? 24_000,
  });
  fromPretrained.mockResolvedValue({ voices: overrides.voices ?? VOICES, generate });
  return generate;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function fakeLogger() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

describe('KokoroTtsEngine', () => {
  beforeEach(() => {
    fromPretrained.mockReset();
    delete process.env['KOKORO_MODEL'];
    delete process.env['KOKORO_VOICE'];
    delete process.env['KOKORO_DTYPE'];
    delete process.env['STT_CACHE_DIR'];
    for (const k of Object.keys(mockTransformersEnv)) delete mockTransformersEnv[k];
  });

  it('names itself after the Hub-verified default model id', () => {
    expect(new KokoroTtsEngine().name).toBe('kokoro:onnx-community/Kokoro-82M-v1.0-ONNX');
  });

  it("reports Kokoro's model-inherent 24kHz sample rate", () => {
    expect(new KokoroTtsEngine().sampleRate).toBe(24_000);
  });

  it('KOKORO_MODEL env override wins', () => {
    process.env['KOKORO_MODEL'] = 'onnx-community/some-other-kokoro-ONNX';
    expect(new KokoroTtsEngine().name).toBe('kokoro:onnx-community/some-other-kokoro-ONNX');
  });

  it('an explicit modelId constructor option wins over the env var', () => {
    process.env['KOKORO_MODEL'] = 'should-not-be-used';
    expect(new KokoroTtsEngine({ modelId: 'explicit-id' }).name).toBe('kokoro:explicit-id');
  });

  // ── Load ────────────────────────────────────────────────────────

  it('load() calls from_pretrained once and coalesces concurrent calls', async () => {
    mockModel();
    const engine = new KokoroTtsEngine();

    await Promise.all([engine.load(), engine.load(), engine.load()]);

    expect(fromPretrained).toHaveBeenCalledTimes(1);
  });

  it('defaults to the q8 (INT8) quantization the plan specifies, on cpu', async () => {
    mockModel();
    await new KokoroTtsEngine().load();

    expect(fromPretrained).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'cpu',
    });
  });

  it('KOKORO_DTYPE overrides the quantization', async () => {
    process.env['KOKORO_DTYPE'] = 'fp32';
    mockModel();
    await new KokoroTtsEngine().load();

    expect(fromPretrained).toHaveBeenCalledWith(expect.any(String), { dtype: 'fp32', device: 'cpu' });
  });

  it('falls back to q8 and warns on an unrecognised dtype, rather than 404ing on a nonexistent weight file', () => {
    process.env['KOKORO_DTYPE'] = 'int4';
    const logger = fakeLogger();

    new KokoroTtsEngine({ logger });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("KOKORO_DTYPE='int4'"));
  });

  it('points kokoro-js at STT_CACHE_DIR so every voice model shares one cache root', async () => {
    process.env['STT_CACHE_DIR'] = '/models/cache';
    mockModel();
    await new KokoroTtsEngine().load();

    expect(mockTransformersEnv['cacheDir']).toBe('/models/cache');
  });

  it('a failed load() is retryable — the coalescing promise is cleared', async () => {
    fromPretrained.mockRejectedValueOnce(new Error('network down'));
    const engine = new KokoroTtsEngine();

    await expect(engine.load()).rejects.toThrow('network down');
    mockModel();
    await expect(engine.load()).resolves.toBeUndefined();
    expect(fromPretrained).toHaveBeenCalledTimes(2);
  });

  // ── Voice resolution ────────────────────────────────────────────

  it('defaults voice to af_heart and speed to 1.0 when not specified', async () => {
    const generate = mockModel();
    await collect(new KokoroTtsEngine().synthesize('hello'));

    expect(generate).toHaveBeenCalledWith('hello', { voice: 'af_heart', speed: 1.0 });
  });

  it('forwards a per-call voice and speed', async () => {
    const generate = mockModel();
    await collect(new KokoroTtsEngine().synthesize('hello', { voice: 'am_adam', speed: 1.5 }));

    expect(generate).toHaveBeenCalledWith('hello', { voice: 'am_adam', speed: 1.5 });
  });

  it('KOKORO_VOICE env var sets the default voice', async () => {
    process.env['KOKORO_VOICE'] = 'bm_lewis';
    const generate = mockModel();
    await collect(new KokoroTtsEngine().synthesize('hello'));

    expect(generate).toHaveBeenCalledWith('hello', { voice: 'bm_lewis', speed: 1.0 });
  });

  it('falls back to af_heart and warns when the configured voice is not in the model', async () => {
    process.env['KOKORO_VOICE'] = 'not_a_real_voice';
    const generate = mockModel();
    const logger = fakeLogger();

    await collect(new KokoroTtsEngine({ logger }).synthesize('hello'));

    // kokoro-js THROWS on an unknown voice; TtsSessionRunner swallows
    // per-sentence errors, so without this fallback a typo would mean
    // total silence with no diagnosable cause.
    expect(generate).toHaveBeenCalledWith('hello', { voice: 'af_heart', speed: 1.0 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("voice 'not_a_real_voice' is not available"));
  });

  it('falls back for an unknown PER-CALL voice too, not just the configured default', async () => {
    const generate = mockModel();
    await collect(new KokoroTtsEngine().synthesize('hello', { voice: 'bogus' }));

    expect(generate).toHaveBeenCalledWith('hello', { voice: 'af_heart', speed: 1.0 });
  });

  it('uses the first available voice when even af_heart is absent', async () => {
    process.env['KOKORO_VOICE'] = 'nope';
    const generate = mockModel({ voices: { zz_only: {} } });
    await collect(new KokoroTtsEngine().synthesize('hello'));

    expect(generate).toHaveBeenCalledWith('hello', { voice: 'zz_only', speed: 1.0 });
  });

  // ── Synthesis output ────────────────────────────────────────────

  it('chunks the (non-streaming) generate() output into fixed-size pieces, in order', async () => {
    const fullAudio = new Float32Array(10_000).map((_, i) => i);
    mockModel({ audio: fullAudio });

    const chunks = await collect(new KokoroTtsEngine().synthesize('hello'));

    // 10_000 samples / 4_096-sample chunks = 3 chunks (4096, 4096, 1808)
    expect(chunks.map((c) => c.length)).toEqual([4_096, 4_096, 1_808]);
    const reassembled = new Float32Array(fullAudio.length);
    let offset = 0;
    for (const c of chunks) {
      reassembled.set(c, offset);
      offset += c.length;
    }
    expect(reassembled).toEqual(fullAudio);
  });

  it('yields nothing for empty/whitespace-only text, without loading or generating', async () => {
    const generate = mockModel();
    const engine = new KokoroTtsEngine();

    expect(await collect(engine.synthesize(''))).toEqual([]);
    expect(await collect(engine.synthesize('   '))).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(fromPretrained).not.toHaveBeenCalled();
  });

  it('warns exactly once if the model contradicts the sample rate advertised to clients', async () => {
    mockModel({ sampling_rate: 22_050 });
    const logger = fakeLogger();
    const engine = new KokoroTtsEngine({ logger });

    await collect(engine.synthesize('one'));
    await collect(engine.synthesize('two'));

    const rateWarnings = logger.warn.mock.calls.filter((c) => String(c[0]).includes('pitch-shifted'));
    expect(rateWarnings).toHaveLength(1);
  });

  it('dispose() clears the model so a subsequent load() re-invokes from_pretrained', async () => {
    mockModel();
    const engine = new KokoroTtsEngine();
    await engine.load();
    await engine.dispose();
    await engine.load();

    expect(fromPretrained).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Integration guard — deliberately NOT mocked. See the file header.
// ────────────────────────────────────────────────────────────────
describe('KokoroTtsEngine — real library integration', () => {
  it('kokoro-js exposes the KokoroTTS.from_pretrained entry point this engine calls', async () => {
    const real = await vi.importActual<{ KokoroTTS?: { from_pretrained?: unknown } }>('kokoro-js');
    expect(typeof real.KokoroTTS?.from_pretrained).toBe('function');
  });

  it("transformers.js still cannot load Kokoro via pipeline('text-to-speech') — the reason kokoro-js is used", async () => {
    const real = await vi.importActual<{
      pipeline: (task: string, model: string) => Promise<unknown>;
    }>('@huggingface/transformers');

    // If this ever starts RESOLVING, transformers.js has added
    // style_text_to_speech_2 to its text-to-speech model map and the
    // kokoro-js dependency could be reconsidered. Until then, this is the
    // assertion the old mocked suite should have been making.
    await expect(
      real.pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX'),
    ).rejects.toThrow(/Unsupported model type: style_text_to_speech_2/);
  }, 30_000);
});
