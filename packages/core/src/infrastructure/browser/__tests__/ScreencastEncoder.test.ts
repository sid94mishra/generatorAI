// ────────────────────────────────────────────────────────────────
// D5 / W15 — the WebCodecs encoder's Node-side contract.
//
// The transcode itself is Chromium's, and is covered by
// `ScreencastEncoder.live.test.ts` against a real browser. What is OURS — and
// what breaks silently if it regresses — is everything around it:
//
//   • "cannot encode" is a RETURNED null, never a throw (P1-33, one layer
//     down: the caller's response is to send JPEG, which is a normal outcome);
//   • the backpressure rule (drop above `MAX_OUTSTANDING` un-returned frames);
//   • a dead encoder tells its streams once, rather than swallowing pushes.
//
// The fake page runs the real `page.evaluate(fn, arg)` callbacks in Node with
// the in-page entry points installed on `globalThis` — which is what they
// reference — so the argument plumbing is exercised rather than mocked away.
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { ScreencastEncoder, type EncodedScreencastChunk } from '../ScreencastEncoder.js';
import type { ILogger } from '@generatorai/shared';

const logger: ILogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
} as unknown as ILogger;

type InPage = Record<string, (...args: never[]) => unknown>;

interface FakeBrowser {
  browser: Browser;
  /** Handlers the encoder registered through `page.exposeFunction`. */
  exposed: Record<string, (...args: never[]) => void>;
  /** In-page functions the bootstrap would have installed. */
  page: InPage;
  /** Stream ids the encoder asked the page to re-key. */
  keyframeRequests: string[];
  closed: boolean;
  emitDisconnect: () => void;
}

/**
 * @param supported what the in-page `__genaiEncoderSupported` probe answers.
 */
function fakeBrowser(opts?: { supported?: boolean }): FakeBrowser {
  const exposed: Record<string, (...args: never[]) => void> = {};
  const inPage: InPage = {};
  const emitter = new EventEmitter();
  let pageClosed = false;
  const state = { closed: false };
  const keyframeRequests: string[] = [];

  const page = {
    isClosed: () => pageClosed,
    route: async () => undefined,
    goto: async () => undefined,
    exposeFunction: async (name: string, fn: (...args: never[]) => void) => { exposed[name] = fn; },
    evaluate: async (fnOrScript: unknown, arg?: unknown) => {
      if (typeof fnOrScript === 'string') {
        // The bootstrap. Install the in-page surface the real script installs,
        // minus the codecs, so the argument plumbing below is real.
        inPage['__genaiEncoderSupported'] = async () => opts?.supported ?? true;
        inPage['__genaiEncoderOpen'] = () => undefined;
        inPage['__genaiEncoderPush'] = async () => undefined;
        inPage['__genaiEncoderClose'] = () => undefined;
        inPage['__genaiEncoderRequestKeyframe'] = ((id: string) => {
          keyframeRequests.push(id);
        }) as unknown as (...args: never[]) => unknown;
        Object.assign(globalThis as unknown as InPage, inPage);
        return undefined;
      }
      return (fnOrScript as (a: unknown) => unknown)(arg);
    },
  };

  const browser = Object.assign(emitter, {
    newPage: async () => page,
    close: async () => { state.closed = true; pageClosed = true; },
  }) as unknown as Browser;

  return {
    browser,
    exposed,
    page: inPage,
    keyframeRequests,
    get closed() { return state.closed; },
    emitDisconnect: () => { pageClosed = true; emitter.emit('disconnected'); },
  } as FakeBrowser;
}

afterEach(() => {
  for (const key of [
    '__genaiEncoderSupported', '__genaiEncoderOpen', '__genaiEncoderPush',
    '__genaiEncoderClose', '__genaiEncoderRequestKeyframe',
  ]) {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  }
  ScreencastEncoder.resetSharedForTests();
});

const openOpts = (onChunk: (c: EncodedScreencastChunk) => void, onFailure?: (r: string) => void) => ({
  width: 1280, height: 720, fps: 20, onChunk, ...(onFailure ? { onFailure } : {}),
});

describe('ScreencastEncoder — availability is an answer, not an exception', () => {
  it('returns null (and does not throw) when the browser will not launch', async () => {
    const encoder = new ScreencastEncoder(logger, async () => { throw new Error('no chromium here'); });
    await expect(encoder.openStream(openOpts(() => undefined))).resolves.toBeNull();
  });

  it('returns null when Chromium reports no VP8 encoder, and closes the browser it launched', async () => {
    const fake = fakeBrowser({ supported: false });
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    await expect(encoder.openStream(openOpts(() => undefined))).resolves.toBeNull();
    // A browser we cannot use must not be left running for the process
    // lifetime — that is a whole Chromium leaked per boot.
    expect(fake.closed).toBe(true);
  });

  it('does not relaunch on every connection after a failed launch', async () => {
    const launch = vi.fn(async () => { throw new Error('nope'); });
    const encoder = new ScreencastEncoder(logger, launch);
    await encoder.openStream(openOpts(() => undefined));
    await encoder.openStream(openOpts(() => undefined));
    await encoder.openStream(openOpts(() => undefined));
    // Otherwise every viewer connect pays a multi-second launch timeout,
    // which is far worse than simply sending JPEG.
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('launches exactly once for concurrent openStream calls', async () => {
    const fake = fakeBrowser();
    const launch = vi.fn(async () => fake.browser);
    const encoder = new ScreencastEncoder(logger, launch);
    const [a, b] = await Promise.all([
      encoder.openStream(openOpts(() => undefined)),
      encoder.openStream(openOpts(() => undefined)),
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await encoder.dispose();
  });
});

describe('ScreencastEncoder — frame flow and backpressure', () => {
  it('delivers encoded chunks to the stream that pushed them', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const chunks: EncodedScreencastChunk[] = [];
    const stream = await encoder.openStream(openOpts((c) => chunks.push(c)));
    expect(stream).not.toBeNull();

    expect(stream!.push('AAAA', 1000)).toBe(true);
    // The encoder page reports the chunk through the exposed binding.
    fake.exposed['__genaiEncoderChunk']!(
      's1' as never, Buffer.from([9, 9]).toString('base64') as never,
      true as never, 1000 as never, 1280 as never, 720 as never,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.keyframe).toBe(true);
    expect(chunks[0]!.timestampUs).toBe(1000);
    expect(Array.from(chunks[0]!.data)).toEqual([9, 9]);
    await encoder.dispose();
  });

  it('drops a frame once more than MAX_OUTSTANDING are un-returned', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const stream = await encoder.openStream(openOpts(() => undefined));

    // W15: "drop when encodeQueueSize > 2". Nothing comes back, so the
    // outstanding count only grows.
    expect(stream!.push('a', 1)).toBe(true);
    expect(stream!.push('b', 2)).toBe(true);
    expect(stream!.push('c', 3)).toBe(true);
    expect(stream!.push('d', 4)).toBe(false);
    await encoder.dispose();
  });

  it('accepts frames again once chunks come back', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const stream = await encoder.openStream(openOpts(() => undefined));
    stream!.push('a', 1); stream!.push('b', 2); stream!.push('c', 3);
    expect(stream!.push('d', 4)).toBe(false);

    fake.exposed['__genaiEncoderChunk']!(
      's1' as never, '' as never, false as never, 1 as never, 1280 as never, 720 as never,
    );
    expect(stream!.push('e', 5)).toBe(true);
    await encoder.dispose();
  });
});

describe('ScreencastEncoder — key frame recovery', () => {
  // Without this the VP8 path has no way back from a lost frame. Every delta
  // references the one before it, so a single dropped chunk anywhere between
  // the encoder and the canvas makes EVERY later frame undecodable, and the
  // encoder only ever emitted a key frame at open and on reconfigure. The
  // symptom is a live view frozen forever with no error and no log line.
  it('asks the encoder page to re-key, naming the stream that asked', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const a = await encoder.openStream(openOpts(() => undefined));
    const b = await encoder.openStream(openOpts(() => undefined));

    a!.requestKeyframe();
    await Promise.resolve();
    expect(fake.keyframeRequests).toEqual(['s1']);

    b!.requestKeyframe();
    await Promise.resolve();
    expect(fake.keyframeRequests).toEqual(['s1', 's2']);
    await encoder.dispose();
  });

  it('is a no-op on a dead stream rather than a throw into the caller', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const stream = await encoder.openStream(openOpts(() => undefined));
    fake.exposed['__genaiEncoderError']!('s1' as never, 'gone' as never);

    // The socket writer calls this from a drop path; it must never be the
    // thing that takes the stream down.
    expect(() => stream!.requestKeyframe()).not.toThrow();
    await Promise.resolve();
    expect(fake.keyframeRequests).toEqual([]);
    await encoder.dispose();
  });

  it('installs the re-key entry point in the page bootstrap', () => {
    // The Node half is useless if the in-page half is missing: the fake above
    // installs its own, so this is the one thing it cannot prove.
    const bootstrap = ScreencastEncoder.bootstrapScriptForTests();
    expect(bootstrap).toContain('__genaiEncoderRequestKeyframe');
    // …and it must actually arm the flag `push` reads, not just exist.
    expect(/__genaiEncoderRequestKeyframe[\s\S]{0,200}needKeyframe = true/.test(bootstrap)).toBe(true);
  });
});

describe('ScreencastEncoder — failure is reported, not swallowed', () => {
  it('tells the stream once when the encoder page reports an error', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const failures: string[] = [];
    const stream = await encoder.openStream(openOpts(() => undefined, (r) => failures.push(r)));

    fake.exposed['__genaiEncoderError']!('s1' as never, 'encoder blew up' as never);
    expect(failures).toEqual(['encoder blew up']);
    expect(stream!.alive).toBe(false);
    // A dead stream must refuse work rather than looking merely slow.
    expect(stream!.push('a', 1)).toBe(false);

    fake.exposed['__genaiEncoderError']!('s1' as never, 'again' as never);
    expect(failures).toEqual(['encoder blew up']);
    await encoder.dispose();
  });

  it('tells every stream when the encoder browser exits', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    const failures: string[] = [];
    const a = await encoder.openStream(openOpts(() => undefined, (r) => failures.push(`a:${r}`)));
    const b = await encoder.openStream(openOpts(() => undefined, (r) => failures.push(`b:${r}`)));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    fake.emitDisconnect();
    expect(failures).toHaveLength(2);
    expect(failures.every((f) => f.includes('exited'))).toBe(true);
    await encoder.dispose();
  });

  it('refuses to open a stream after dispose', async () => {
    const fake = fakeBrowser();
    const encoder = new ScreencastEncoder(logger, async () => fake.browser);
    await encoder.dispose();
    await expect(encoder.openStream(openOpts(() => undefined))).resolves.toBeNull();
  });
});
