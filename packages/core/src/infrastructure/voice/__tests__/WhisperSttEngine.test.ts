// ────────────────────────────────────────────────────────────────
// WhisperSttEngine — moved from apps/server/src/stt/ in the Phase 0
// voice-module seam work with zero intended behavior change. This test
// exists precisely to prove that: the English-only option-stripping guard,
// load coalescing, and normalization must still hold post-move, now against
// the promoted `ISpeechToTextEngine` domain port.
//
// `@huggingface/transformers` is mocked — a real load would try to
// download the model from Hugging Face, which is neither fast nor
// available in an offline/sandboxed test run.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineFactory = vi.fn();
const mockEnv: Record<string, unknown> = {};

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineFactory(...args),
  env: mockEnv,
}));

// Import after the mock is registered (vitest hoists vi.mock calls anyway,
// but this keeps intent obvious).
import { WhisperSttEngine } from '../WhisperSttEngine.js';

describe('WhisperSttEngine', () => {
  beforeEach(() => {
    pipelineFactory.mockReset();
    delete process.env['STT_MODEL'];
    delete process.env['STT_CACHE_DIR'];
  });

  it('defaults to whisper-base.en and names itself accordingly', () => {
    const engine = new WhisperSttEngine();
    expect(engine.name).toBe('whisper:Xenova/whisper-base.en');
  });

  it('load() calls the ASR pipeline factory once and coalesces concurrent calls', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'hi' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine();

    await Promise.all([engine.load(), engine.load(), engine.load()]);

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineFactory).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-base.en');
  });

  it('does NOT forward language/task options to an English-only model (would throw upstream)', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'hello world' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine(); // base.en → English-only

    await engine.transcribe(new Float32Array(10), { language: 'fr' });

    expect(pipe).toHaveBeenCalledTimes(1);
    const [, runOpts] = pipe.mock.calls[0] as [Float32Array, Record<string, unknown>];
    expect(runOpts).not.toHaveProperty('language');
    expect(runOpts).not.toHaveProperty('task');
    expect(runOpts).toMatchObject({ chunk_length_s: 30, stride_length_s: 5 });
  });

  it('DOES forward language/task options to a multilingual model', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'bonjour' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine({ modelId: 'Xenova/whisper-small' });

    await engine.transcribe(new Float32Array(10), { language: 'fr' });

    const [, runOpts] = pipe.mock.calls[0] as [Float32Array, Record<string, unknown>];
    expect(runOpts).toMatchObject({ language: 'fr', task: 'transcribe' });
  });

  it('normalizes whitespace in the transcript and never sets isEndOfUtterance (no endpointer of its own)', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: '  hello   world  ' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine();

    const result = await engine.transcribe(new Float32Array(10));

    expect(result.text).toBe('hello world');
    expect(result.isEndOfUtterance).toBeUndefined();
  });

  it('joins array-style pipeline output (chunked long-form transcription)', async () => {
    const pipe = vi.fn().mockResolvedValue([{ text: 'part one' }, { text: 'part two' }]);
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine();

    const result = await engine.transcribe(new Float32Array(10));

    expect(result.text).toBe('part one part two');
  });

  it('dispose() clears the pipeline so a subsequent load() re-invokes the factory', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'x' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new WhisperSttEngine();
    await engine.load();
    await engine.dispose();
    await engine.load();

    expect(pipelineFactory).toHaveBeenCalledTimes(2);
  });

  it('honors STT_MODEL env override', () => {
    process.env['STT_MODEL'] = 'Xenova/whisper-tiny';
    const engine = new WhisperSttEngine();
    expect(engine.name).toBe('whisper:Xenova/whisper-tiny');
  });
});
