// ────────────────────────────────────────────────────────────────
// ParakeetSttEngine — same mocked-pipeline test pattern as
// WhisperSttEngine.test.ts. Notably does NOT test "real" transcription
// accuracy (impossible without network access / real model files — see the
// engine's file header) — this locks in the wiring: model id resolution,
// env var overrides, load coalescing, normalization, and (unlike Whisper)
// that no language/task options are ever forwarded to the pipeline call.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineFactory = vi.fn();
const mockEnv: Record<string, unknown> = {};

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineFactory(...args),
  env: mockEnv,
}));

import { ParakeetSttEngine } from '../ParakeetSttEngine.js';

describe('ParakeetSttEngine', () => {
  beforeEach(() => {
    pipelineFactory.mockReset();
    delete process.env['PARAKEET_MODEL'];
    delete process.env['STT_MODEL'];
    delete process.env['PARAKEET_DTYPE'];
    delete process.env['STT_DTYPE'];
  });

  it('names itself after the Hub-verified default model id', () => {
    const engine = new ParakeetSttEngine();
    expect(engine.name).toBe('parakeet:onnx-community/parakeet-ctc-0.6b-ONNX');
  });

  it('PARAKEET_MODEL env override takes priority over the shared STT_MODEL', () => {
    process.env['PARAKEET_MODEL'] = 'onnx-community/parakeet-tdt-0.6b-v3-ONNX';
    process.env['STT_MODEL'] = 'Xenova/whisper-base.en'; // must NOT win
    const engine = new ParakeetSttEngine();
    expect(engine.name).toBe('parakeet:onnx-community/parakeet-tdt-0.6b-v3-ONNX');
  });

  it('falls back to STT_MODEL when PARAKEET_MODEL is unset (shared engine-selection env var)', () => {
    process.env['STT_MODEL'] = 'onnx-community/some-other-parakeet-ONNX';
    const engine = new ParakeetSttEngine();
    expect(engine.name).toBe('parakeet:onnx-community/some-other-parakeet-ONNX');
  });

  it('an explicit modelId constructor option wins over both env vars', () => {
    process.env['PARAKEET_MODEL'] = 'should-not-be-used';
    const engine = new ParakeetSttEngine({ modelId: 'explicit-id' });
    expect(engine.name).toBe('parakeet:explicit-id');
  });

  it('load() calls the ASR pipeline factory once and coalesces concurrent calls', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'hi' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new ParakeetSttEngine();

    await Promise.all([engine.load(), engine.load(), engine.load()]);

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineFactory).toHaveBeenCalledWith('automatic-speech-recognition', 'onnx-community/parakeet-ctc-0.6b-ONNX', { dtype: 'q8' });
  });

  it('never forwards language/task options to the pipeline call (ParakeetForCTC takes none)', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'hello world' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new ParakeetSttEngine();

    await engine.transcribe(new Float32Array(10), { language: 'fr' });

    expect(pipe).toHaveBeenCalledTimes(1);
    expect(pipe).toHaveBeenCalledWith(expect.any(Float32Array));
    const [, secondArg] = pipe.mock.calls[0] as [Float32Array, unknown?];
    expect(secondArg).toBeUndefined();
  });

  it('normalizes whitespace and never sets isEndOfUtterance (endpointing is EnergyVad\'s job, not this engine\'s)', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: '  hello   world  ' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new ParakeetSttEngine();

    const result = await engine.transcribe(new Float32Array(10));

    expect(result.text).toBe('hello world');
    expect(result.isEndOfUtterance).toBeUndefined();
  });

  it('joins array-style pipeline output', async () => {
    const pipe = vi.fn().mockResolvedValue([{ text: 'part one' }, { text: 'part two' }]);
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new ParakeetSttEngine();

    const result = await engine.transcribe(new Float32Array(10));

    expect(result.text).toBe('part one part two');
  });

  it('dispose() clears the pipeline so a subsequent load() re-invokes the factory', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'x' });
    pipelineFactory.mockResolvedValue(pipe);
    const engine = new ParakeetSttEngine();
    await engine.load();
    await engine.dispose();
    await engine.load();

    expect(pipelineFactory).toHaveBeenCalledTimes(2);
  });

  // ── dtype (Part D disk budget) ──────────────────────────────────

  it("defaults to q8 — at fp32 this checkpoint is 2.4GB, 4x Part D's whole budget", async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'x' });
    pipelineFactory.mockResolvedValue(pipe);

    await new ParakeetSttEngine().load();

    expect(pipelineFactory).toHaveBeenCalledWith(expect.any(String), expect.any(String), { dtype: 'q8' });
  });

  it('PARAKEET_DTYPE overrides the quantization, and beats the shared STT_DTYPE', async () => {
    process.env['STT_DTYPE'] = 'fp16';
    process.env['PARAKEET_DTYPE'] = 'fp32';
    const pipe = vi.fn().mockResolvedValue({ text: 'x' });
    pipelineFactory.mockResolvedValue(pipe);

    await new ParakeetSttEngine().load();

    expect(pipelineFactory).toHaveBeenCalledWith(expect.any(String), expect.any(String), { dtype: 'fp32' });
  });

  it('falls back to STT_DTYPE when PARAKEET_DTYPE is unset', async () => {
    process.env['STT_DTYPE'] = 'q4';
    const pipe = vi.fn().mockResolvedValue({ text: 'x' });
    pipelineFactory.mockResolvedValue(pipe);

    await new ParakeetSttEngine().load();

    expect(pipelineFactory).toHaveBeenCalledWith(expect.any(String), expect.any(String), { dtype: 'q4' });
  });

  it('falls back to q8 and warns on an unrecognised dtype, rather than 404ing on a nonexistent weight file', () => {
    process.env['PARAKEET_DTYPE'] = 'int4';
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);

    new ParakeetSttEngine({ logger });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("dtype='int4'"));
  });

  // ── Empty-transcript recovery (upstream decoder artifact) ───────

  /** Speech-like audio: loud enough to pass the silence check. */
  const loud = (n = 16_000) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i += 1) a[i] = Math.sin(i / 8) * 0.3;
    return a;
  };

  it('retries ONCE with padded audio when the first decode comes back empty', async () => {
    const pipe = vi.fn()
      .mockResolvedValueOnce({ text: '   ' })
      .mockResolvedValueOnce({ text: 'recovered on the second pass' });
    pipelineFactory.mockResolvedValue(pipe);

    const result = await new ParakeetSttEngine().transcribe(loud());

    expect(pipe).toHaveBeenCalledTimes(2);
    // Same audio re-run would be pointless — the artifact is deterministic
    // for a given input; only the LENGTH change clears it.
    const firstLen = (pipe.mock.calls[0]![0] as Float32Array).length;
    const secondLen = (pipe.mock.calls[1]![0] as Float32Array).length;
    expect(secondLen).toBe(firstLen + 16_000 * 0.2);
    expect(result.text).toBe('recovered on the second pass');
  });

  it('does NOT retry when the first decode already produced text', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: 'heard it first time' });
    pipelineFactory.mockResolvedValue(pipe);

    const result = await new ParakeetSttEngine().transcribe(loud());

    expect(pipe).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('heard it first time');
  });

  it('does NOT retry on genuinely silent audio — an empty transcript is the correct answer there', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: '' });
    pipelineFactory.mockResolvedValue(pipe);

    const result = await new ParakeetSttEngine().transcribe(new Float32Array(16_000));

    expect(pipe).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('');
  });

  it('gives up after one retry and warns, rather than looping', async () => {
    const pipe = vi.fn().mockResolvedValue({ text: '' });
    pipelineFactory.mockResolvedValue(pipe);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);

    const result = await new ParakeetSttEngine({ logger }).transcribe(loud());

    expect(pipe).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty transcript'));
  });

  it('recovery works through the worker pool too, not just in-process', async () => {
    const runAsr = vi.fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: 'recovered off-thread' });
    const pool = { loadAsr: vi.fn().mockResolvedValue(undefined), runAsr } as never;

    const result = await new ParakeetSttEngine({ workerPool: pool }).transcribe(loud());

    expect(runAsr).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('recovered off-thread');
  });
});
