// ────────────────────────────────────────────────────────────────
// VoiceEngineFactory — construction by id, and the descriptor table.
//
// The point of the factory is that swapping models is configuration, so the
// tests that matter are: every declared id constructs, an unknown id is
// caught at composition time rather than on a user's first click, and the
// cascade is assembled with the right candidates in the right order.
//
// The model libraries are mocked — these tests must never download weights.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue({ text: '' })),
  env: {},
}));
vi.mock('kokoro-js', () => ({
  KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue({ voices: {}, generate: vi.fn() }) },
}));

import {
  ALL_STT_ENGINE_IDS,
  STT_ENGINES,
  createSttEngine,
  createTtsEngine,
  resolveSttEngineId,
  sttEngineDescriptor,
  type SttEngineId,
} from '../VoiceEngineFactory.js';

function fakeLogger() {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => l) };
  return l;
}

describe('VoiceEngineFactory — STT construction', () => {
  beforeEach(() => {
    for (const k of ['PARAKEET_MODEL', 'STT_MODEL', 'MOONSHINE_MODEL', 'STT_DTYPE']) delete process.env[k];
  });

  it.each(['parakeet', 'moonshine', 'whisper', 'disabled', 'auto'] as SttEngineId[])(
    'constructs "%s" and returns something implementing the port',
    (id) => {
      const engine = createSttEngine(id);
      expect(typeof engine.name).toBe('string');
      expect(typeof engine.load).toBe('function');
      expect(typeof engine.transcribe).toBe('function');
      expect(typeof engine.dispose).toBe('function');
    },
  );

  it('names each concrete engine after the model it will load', () => {
    expect(createSttEngine('parakeet').name).toContain('parakeet-ctc-0.6b');
    expect(createSttEngine('moonshine').name).toContain('moonshine-base');
    expect(createSttEngine('whisper').name).toContain('whisper-base.en');
  });

  it('"auto" builds a cascade that tries the preferred engine BEFORE whisper', () => {
    // The cascade reports its candidates in order until one wins, which is
    // what makes the fallback order observable without loading anything.
    expect(createSttEngine('auto').name).toBe(
      'cascading:moonshine:onnx-community/moonshine-base-ONNX|whisper:Xenova/whisper-base.en',
    );
  });

  it('does NOT default to an engine that cannot punctuate', () => {
    // The regression this pins: `auto` used to prefer parakeet, which emits
    // no capitals and no punctuation at all, so dictated text arrived as one
    // long lowercase run — and it dropped whole sentences besides (1 of 3
    // reference sentences came back empty; see VoiceEngineFactory.ts's
    // head-to-head). A default dictation engine must be a cased one.
    const preferredId = STT_ENGINES.find((e) =>
      createSttEngine('auto').name.includes(e.modelId),
    )?.id;
    expect(preferredId).toBeDefined();
    expect(sttEngineDescriptor(preferredId!)?.casedOutput).toBe(true);
  });

  it('"auto" honours a different preferred engine', () => {
    expect(createSttEngine('auto', { preferred: 'parakeet' }).name).toBe(
      'cascading:parakeet:onnx-community/parakeet-ctc-0.6b-ONNX|whisper:Xenova/whisper-base.en',
    );
  });

  it('"auto" with whisper preferred does not stack whisper twice', () => {
    // A [whisper, whisper] cascade would just double the load attempt on
    // failure for no benefit.
    expect(createSttEngine('auto', { preferred: 'whisper' }).name).toBe('whisper:Xenova/whisper-base.en');
  });

  it('an unknown id throws at construction, not later at first use', () => {
    expect(() => createSttEngine('gpt-voice' as SttEngineId)).toThrow(/Unknown STT engine/);
  });

  it('threads logger and worker pool through to the engine it builds', async () => {
    const pool = { loadAsr: vi.fn().mockResolvedValue(undefined), runAsr: vi.fn() } as never;
    const engine = createSttEngine('parakeet', { workerPool: pool });
    await engine.load();
    // Reaching the pool at all proves the option was not dropped on the way.
    expect((pool as unknown as { loadAsr: ReturnType<typeof vi.fn> }).loadAsr).toHaveBeenCalled();
  });
});

describe('VoiceEngineFactory — TTS construction', () => {
  it('builds Kokoro for "kokoro"', () => {
    const engine = createTtsEngine('kokoro');
    expect(engine?.name).toContain('Kokoro');
    expect(engine?.sampleRate).toBe(24_000);
  });

  it('returns undefined for "disabled" so VoiceService treats speak() as unavailable', () => {
    expect(createTtsEngine('disabled')).toBeUndefined();
  });

  it('an unknown id throws', () => {
    expect(() => createTtsEngine('elevenlabs' as 'kokoro')).toThrow(/Unknown TTS engine/);
  });
});

describe('VoiceEngineFactory — id resolution from config', () => {
  it('defaults to auto when unset', () => {
    expect(resolveSttEngineId(undefined)).toBe('auto');
  });

  it('accepts every documented id', () => {
    for (const id of ALL_STT_ENGINE_IDS) expect(resolveSttEngineId(id)).toBe(id);
  });

  it('warns and falls back rather than throwing on a typo', () => {
    // A mistyped engine name must not stop the server booting with voice on
    // its default — this is config, read at startup, often by hand.
    const logger = fakeLogger();
    expect(resolveSttEngineId('parakeetttt', logger)).toBe('auto');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('parakeetttt'));
  });
});

describe('VoiceEngineFactory — descriptor table', () => {
  it('describes every constructible concrete engine', () => {
    const concrete = ALL_STT_ENGINE_IDS.filter((id) => id !== 'auto' && id !== 'disabled');
    expect(STT_ENGINES.map((e) => e.id).sort()).toEqual([...concrete].sort());
  });

  it('every descriptor carries the facts a chooser actually needs', () => {
    for (const d of STT_ENGINES) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.modelId).toMatch(/\//);
      expect(d.approxDownloadMB).toBeGreaterThan(0);
      expect(d.measuredAvgMs).toBeGreaterThan(0);
      expect(typeof d.casedOutput).toBe('boolean');
      expect(d.notes.length).toBeGreaterThan(20);
    }
  });

  it('records that Parakeet emits no capitals or punctuation, and the others do', () => {
    // Load-bearing, not trivia: nothing downstream can add casing back, so a
    // UI offering this choice has to be able to say so.
    expect(sttEngineDescriptor('parakeet')?.casedOutput).toBe(false);
    expect(sttEngineDescriptor('moonshine')?.casedOutput).toBe(true);
    expect(sttEngineDescriptor('whisper')?.casedOutput).toBe(true);
  });

  it('a descriptor model id matches what the engine actually loads', () => {
    for (const d of STT_ENGINES) {
      expect(createSttEngine(d.id).name).toContain(d.modelId);
    }
  });
});
