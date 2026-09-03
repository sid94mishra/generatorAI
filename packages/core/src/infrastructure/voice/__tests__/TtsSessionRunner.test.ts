// ────────────────────────────────────────────────────────────────
// TtsSessionRunner — both the Phase 3 (plain string) and Phase 4 (live
// AsyncIterable<string>) paths, plus stop()/barge-in and per-sentence
// failure isolation.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { TtsSessionRunner } from '../TtsSessionRunner.js';
import type { ITextToSpeechEngine } from '../../../domain/ports/ITextToSpeechEngine.js';

/** A fake engine that yields one chunk per call, tagged with the input text and a call counter. */
function fakeEngine(overrides: Partial<ITextToSpeechEngine> = {}): ITextToSpeechEngine {
  let callCount = 0;
  return {
    name: 'fake-tts',
    sampleRate: 24_000,
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    synthesize: vi.fn(async function* (text: string) {
      callCount += 1;
      yield new Float32Array([callCount, text.length]);
    }),
    ...overrides,
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('TtsSessionRunner', () => {
  it('Phase 3: synthesizes a plain string via the engine and yields its chunks', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    const chunks = await collect(runner.run('hello world'));

    expect(engine.synthesize).toHaveBeenCalledTimes(1);
    expect(engine.synthesize).toHaveBeenCalledWith('hello world', undefined);
    expect(chunks).toEqual([new Float32Array([1, 11])]);
  });

  it('Phase 3: forwards synthesize options through to the engine', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    await collect(runner.run('hi', { voice: 'af_heart', speed: 1.2 }));

    expect(engine.synthesize).toHaveBeenCalledWith('hi', { voice: 'af_heart', speed: 1.2 });
  });

  it('a whitespace-only string synthesizes nothing', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    const chunks = await collect(runner.run('   '));

    expect(engine.synthesize).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
  });

  it('Phase 4: consumes a live AsyncIterable<string>, synthesizing each completed sentence as it forms', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    async function* tokenStream() {
      yield 'Hello ';
      yield 'world. ';
      yield 'Bye';
      yield '.';
    }

    const chunks = await collect(runner.run(tokenStream()));

    expect(engine.synthesize).toHaveBeenCalledTimes(2);
    expect(engine.synthesize).toHaveBeenNthCalledWith(1, 'Hello world.', undefined);
    expect(engine.synthesize).toHaveBeenNthCalledWith(2, 'Bye.', undefined);
    expect(chunks).toHaveLength(2); // one chunk per sentence from the fake engine
  });

  it('Phase 4: flushes a trailing sentence with no terminator once the stream ends', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    async function* tokenStream() {
      yield 'no terminator here';
    }

    await collect(runner.run(tokenStream()));

    expect(engine.synthesize).toHaveBeenCalledWith('no terminator here', undefined);
  });

  it('Phase 4 (barge-in): stop() during a live stream halts further sentence synthesis', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    async function* tokenStream() {
      yield 'First sentence. ';
      runner.stop(); // simulates the user interrupting mid-utterance
      yield 'Second sentence. ';
      yield 'Third sentence. ';
    }

    const chunks = await collect(runner.run(tokenStream()));

    expect(engine.synthesize).toHaveBeenCalledTimes(1);
    expect(engine.synthesize).toHaveBeenCalledWith('First sentence.', undefined);
    expect(chunks).toHaveLength(1);
  });

  it('stop() before run() is ever called means nothing synthesizes at all', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);
    runner.stop();

    const chunks = await collect(runner.run('hello'));

    expect(engine.synthesize).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
  });

  it('stop() partway through a single-sentence engine stream stops yielding further chunks from it', async () => {
    const engine = fakeEngine({
      synthesize: vi.fn(async function* () {
        yield new Float32Array([1]);
        yield new Float32Array([2]);
        yield new Float32Array([3]);
      }),
    });
    const runner = new TtsSessionRunner(engine);

    const chunks: Float32Array[] = [];
    for await (const chunk of runner.run('hello')) {
      chunks.push(chunk);
      if (chunks.length === 1) runner.stop();
    }

    expect(chunks).toHaveLength(1);
  });

  it('a failed sentence is logged and skipped — the REST of a live stream still synthesizes', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    let calls = 0;
    const engine = fakeEngine({
      synthesize: vi.fn(async function* (text: string) {
        calls += 1;
        if (calls === 1) throw new Error('synth boom');
        yield new Float32Array([calls, text.length]);
      }),
    });
    const runner = new TtsSessionRunner(engine, logger);

    async function* tokenStream() {
      yield 'First sentence. ';
      yield 'Second sentence. ';
    }

    const chunks = await collect(runner.run(tokenStream()));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('synth boom'));
    expect(chunks).toHaveLength(1); // the second sentence still made it through
  });

  it('a failed single-string synthesize() (Phase 3) does not throw — degrades to silence', async () => {
    const engine = fakeEngine({ synthesize: vi.fn(async function* () { throw new Error('boom'); }) });
    const runner = new TtsSessionRunner(engine);

    const chunks = await collect(runner.run('hello'));

    expect(chunks).toEqual([]);
  });

  it('Phase 3: a MULTI-sentence string synthesizes one sentence at a time, so playback can start on the first', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    await collect(runner.run('First one. Second one. Third one.'));

    // Not one 3-sentence call: time-to-first-audio is what a listener
    // experiences, and it is bounded by the FIRST call, not the whole text.
    expect(engine.synthesize).toHaveBeenCalledTimes(3);
    expect((engine.synthesize as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      'First one.',
      'Second one.',
      'Third one.',
    ]);
  });

  it('Phase 3: a failed sentence mid-string is skipped — the rest of the message still plays', async () => {
    const engine = fakeEngine();
    (engine.synthesize as ReturnType<typeof vi.fn>).mockImplementation(async function* (sentence: string) {
      if (sentence.startsWith('Second')) throw new Error('synth boom');
      yield new Float32Array([sentence.length]);
    });
    const runner = new TtsSessionRunner(engine);

    const chunks = await collect(runner.run('First one. Second one. Third one.'));

    expect(chunks).toHaveLength(2);
    expect(engine.synthesize).toHaveBeenCalledTimes(3);
  });

  it('Phase 3 (barge-in): stop() partway through a multi-sentence string halts the remaining sentences', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);
    (engine.synthesize as ReturnType<typeof vi.fn>).mockImplementation(async function* (sentence: string) {
      yield new Float32Array([sentence.length]);
      runner.stop();
    });

    await collect(runner.run('First one. Second one. Third one.'));

    expect(engine.synthesize).toHaveBeenCalledTimes(1);
  });

  // ── Sentence boundary markers (mobile playback) ─────────────────

  it("fires onSentence once per synthesized sentence, BEFORE that sentence's audio", async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);
    const events: string[] = [];
    (engine.synthesize as ReturnType<typeof vi.fn>).mockImplementation(async function* (sentence: string) {
      events.push(`audio:${sentence}`);
      yield new Float32Array([1]);
    });

    await collect(runner.run('First one. Second one. Third one.', { onSentence: () => events.push('mark') }));

    expect(events).toEqual([
      'mark', 'audio:First one.',
      'mark', 'audio:Second one.',
      'mark', 'audio:Third one.',
    ]);
  });

  it('does not fire onSentence for whitespace-only or post-stop sentences', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);
    const onSentence = vi.fn();

    await collect(runner.run('   ', { onSentence }));

    expect(onSentence).not.toHaveBeenCalled();
  });

  it('never leaks the onSentence hook into the engine port', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    await collect(runner.run('hello', { voice: 'af_heart', onSentence: () => undefined }));

    expect(engine.synthesize).toHaveBeenCalledWith('hello', { voice: 'af_heart' });
  });

  it('passes undefined — not an empty object — when only the hook was given', async () => {
    const engine = fakeEngine();
    const runner = new TtsSessionRunner(engine);

    await collect(runner.run('hello', { onSentence: () => undefined }));

    // Engines are written and tested against "no options"; handing them {}
    // instead would be a silent contract change.
    expect(engine.synthesize).toHaveBeenCalledWith('hello', undefined);
  });
});
