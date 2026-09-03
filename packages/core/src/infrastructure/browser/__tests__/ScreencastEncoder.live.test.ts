// ────────────────────────────────────────────────────────────────
// D5 / W15 — the WebCodecs transcode, against a REAL Chromium.
//
// The unit test covers the Node-side contract with the page stubbed. This one
// covers the half that lives inside Chromium and cannot be faked without
// faking the very thing under test: does `ENCODER_BOOTSTRAP` actually decode a
// JPEG and produce VP8 chunks, in a secure context, in a headless build?
//
// OPT-IN, because it launches a browser:
//
//   GENERATORAI_LIVE_BROWSER_TESTS=1 pnpm --filter @generatorai/core test
//
// and, on a machine whose Playwright-pinned build is broken, point
// `GENERATORAI_BROWSER_EXECUTABLE_PATH` at a working `chrome.exe` — the
// encoder honours it exactly as `ServerPlaywrightHost` does.
//
// It is not in the default suite for the same reason the plan keeps benchmarks
// out of CI: a shared runner makes the measurement meaningless and the launch
// flaky, and a flaky gate teaches people to ignore it.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { ScreencastEncoder, type EncodedScreencastChunk } from '../ScreencastEncoder.js';
import type { ILogger } from '@generatorai/shared';

const LIVE = process.env['GENERATORAI_LIVE_BROWSER_TESTS'] === '1';

const logger: ILogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
} as unknown as ILogger;

/** Captures real CDP screencast frames off a real page. */
async function captureFrames(count: number): Promise<string[]> {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env['GENERATORAI_BROWSER_EXECUTABLE_PATH']
      ? { executablePath: process.env['GENERATORAI_BROWSER_EXECUTABLE_PATH'] }
      : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(
      '<body style="margin:0;font:16px system-ui;padding:32px">' +
        Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i}: ${'lorem ipsum dolor sit amet. '.repeat(4)}</p>`).join('') +
        '<div id=b style="position:fixed;top:0;left:0;width:60px;height:24px;background:#e33"></div></body>',
    );
    const cdp = await page.context().newCDPSession(page);
    const frames: string[] = [];
    cdp.on('Page.screencastFrame', (p: { data: string; sessionId: number }) => {
      frames.push(p.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
    for (let i = 0; i < count && frames.length < count; i++) {
      // A string expression, not a typed function: this package has no DOM
      // lib, which is the same reason every other in-page script here is one.
      await page.evaluate(
        `(() => { const el = document.getElementById('b');` +
          ` if (el) el.style.transform = 'translate(${i * 8}px, ${i * 3}px)'; })()`,
      );
      await new Promise((r) => setTimeout(r, 35));
    }
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    return frames;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

describe.skipIf(!LIVE)('ScreencastEncoder (live Chromium)', () => {
  it('transcodes real CDP screencast JPEGs into VP8 chunks that are dramatically smaller', async () => {
    const frames = await captureFrames(40);
    expect(frames.length).toBeGreaterThan(5);

    ScreencastEncoder.resetSharedForTests();
    const encoder = new ScreencastEncoder(logger);
    const chunks: EncodedScreencastChunk[] = [];
    const stream = await encoder.openStream({
      width: 1280, height: 720, fps: 20,
      onChunk: (c) => chunks.push(c),
    });
    // If this is null the build has no VP8 encoder — which is a real answer,
    // but not one this test can assert against, so say so rather than pass.
    expect(stream, 'Chromium reported no VP8 encoder').not.toBeNull();

    let pushed = 0;
    for (let i = 0; i < frames.length; i++) {
      // Respect the encoder's own backpressure rather than fighting it: the
      // drop rule is part of the contract, not an obstacle to the test.
      while (!stream!.push(frames[i]!, i * 50_000)) {
        await new Promise((r) => setTimeout(r, 10));
      }
      pushed += 1;
      await new Promise((r) => setTimeout(r, 15));
    }
    const deadline = Date.now() + 10_000;
    while (chunks.length < pushed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(chunks.length).toBeGreaterThan(5);
    // Exactly one key frame at the head; everything after it is inter-coded,
    // which is where the whole size win comes from.
    expect(chunks[0]!.keyframe).toBe(true);
    expect(chunks[0]!.width).toBe(1280);
    expect(chunks[0]!.height).toBe(720);

    const jpegBytes = frames.slice(0, chunks.length).reduce((sum, f) => sum + Math.floor(f.length * 3 / 4), 0);
    const vp8Bytes = chunks.reduce((sum, c) => sum + c.data.length, 0);
    // Measured on the reference machine: 17× over 60 frames of a text page.
    // The floor here is deliberately far below that — the assertion is "the
    // encoded stream is categorically smaller", not a benchmark that shared
    // hardware would turn into a flaky gate.
    expect(vp8Bytes).toBeLessThan(jpegBytes / 3);

    await stream!.close();
    await encoder.dispose();
  }, 120_000);

  it('reports failure to its stream when the encoder browser is killed', async () => {
    ScreencastEncoder.resetSharedForTests();
    const encoder = new ScreencastEncoder(logger);
    const failures: string[] = [];
    const stream = await encoder.openStream({
      width: 640, height: 480, fps: 10,
      onChunk: () => undefined,
      onFailure: (r) => failures.push(r),
    });
    expect(stream, 'Chromium reported no VP8 encoder').not.toBeNull();

    await encoder.dispose();
    expect(failures.length).toBeGreaterThan(0);
    expect(stream!.alive).toBe(false);
  }, 60_000);
});
