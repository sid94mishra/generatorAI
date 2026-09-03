// ────────────────────────────────────────────────────────────────
// ScreencastEncoder — D5 / W15: the WebCodecs half of the browser live view.
//
// D5 chose "(b) WebCodecs over the existing socket" for the live view, and
// until now the repo had zero occurrences of it. This is that encoder.
//
// ── Why the encoder runs inside a Chromium ──────────────────────────────
//
// Node has no `VideoEncoder` (checked: `typeof globalThis.VideoEncoder` is
// `undefined` on Node 26), and this repo has no native codec dependency. The
// only frame tap CDP offers is `Page.startScreencast`, which emits JPEG or PNG
// — never raw frames — so *some* transcode is unavoidable no matter where the
// encoder lives. Chromium already ships a hardware-assisted JPEG decoder and a
// libvpx VP8 encoder behind WebCodecs, so the cheapest encoder available to us
// is a Chromium page.
//
// Measured on this stack (1280×720, 60 frames of a text page, headless):
//
//   JPEG q60 straight to the wire   144 KB/frame   (8.7 MB total)
//   VP8 via this encoder            8.5 KB/frame   (0.5 MB total)  → 17× smaller
//   in-page transcode cost          5.2 ms/frame steady state, 16 ms first frame
//   Node→page push cost             ~5 ms/frame (base64 across CDP)
//
// The 17× is the point: it is paid to *every* viewer, including relayed and
// mobile ones, while the ~10 ms/frame is paid once on the host. On a page that
// changes less than this test page did, inter-coded frames are 100–1500 bytes.
//
// ── Why a SEPARATE Chromium ─────────────────────────────────────────────
//
// The encoder page could live in the workspace's own browser, and that would
// save a process. It must not:
//   • `ServerPlaywrightHost` can run headed — the user watches that window, and
//     an "encoder" tab appearing in it is both confusing and clickable.
//   • The workspace context carries the user's imported cookies and the
//     anti-detection init script. An encoder page has no business in it.
//   • A renderer crash in the encoder would take the user's session with it.
// It is launched lazily (only when a client that can decode VP8 connects) and
// closes itself once the last stream has been gone for `IDLE_CLOSE_MS`, so a
// deployment where nobody opens the live view never pays for it at all.
//
// ── Why a fulfilled https:// URL rather than about:blank ────────────────
//
// WebCodecs is gated on a secure context. A top-level `about:blank` is not one,
// and `VideoEncoder` is simply `undefined` there — which reads exactly like
// "this Chromium build has no WebCodecs" if you do not know to look. The page
// is served by an interception handler on an unresolvable `.invalid` host, so
// it is a secure origin that makes no network request of any kind.
// ────────────────────────────────────────────────────────────────

import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import type { ILogger } from '@generatorai/shared';

/** One encoded frame handed back from the encoder page. */
export interface EncodedScreencastChunk {
  data: Buffer;
  keyframe: boolean;
  timestampUs: number;
  width: number;
  height: number;
}

export interface ScreencastEncoderStream {
  /**
   * Hand one captured JPEG (base64, exactly as CDP delivered it) to the
   * encoder. Fire-and-forget.
   *
   * Returns `false` when the frame was dropped rather than encoded — the
   * caller uses that to keep its own accounting honest. Dropping is the
   * documented behaviour under backpressure (W15: "drop when encodeQueueSize
   * > 2"), not an error.
   */
  push(jpegBase64: string, timestampUs: number): boolean;
  /**
   * Force the next encoded chunk to be a key frame.
   *
   * This is the ONLY way back from a lost frame. VP8 inter-coded frames
   * reference the frame before them, so a single chunk dropped anywhere
   * between here and the viewer's canvas makes every later chunk undecodable
   * — and libvpx in `realtime` mode has no reason of its own to ever emit a
   * second key frame. Without this the live view freezes permanently on its
   * last good frame: no exception, no log line, nothing for a reconnect to
   * fix, because the socket is perfectly healthy.
   *
   * Fire-and-forget and safe on a dead or closing stream: every caller is a
   * drop path, and a drop path must never be the thing that throws.
   */
  requestKeyframe(): void;
  /** True until `close()` or an encoder failure. */
  readonly alive: boolean;
  close(): Promise<void>;
}

export interface OpenStreamOptions {
  width: number;
  height: number;
  fps: number;
  /** Called for each encoded chunk, in encode order. */
  onChunk: (chunk: EncodedScreencastChunk) => void;
  /**
   * Called once if the encoder dies mid-stream (renderer crash, browser exit).
   * The caller is expected to fall back to sending JPEG, which is why this is a
   * callback and not a rejected promise: the stream is still running.
   */
  onFailure?: (reason: string) => void;
}

/**
 * VP8 rather than H.264: the Playwright-pinned Chromium reports
 * `avc1.42E01E` unsupported (no proprietary codecs in that build), while
 * `vp8` is supported everywhere we checked and decodes in every browser that
 * has `VideoDecoder` at all. Kept as a constant because it is also the string
 * the client must pass to `VideoDecoder.configure`.
 */
export const SCREENCAST_VP8_CODEC = 'vp8';

/**
 * Bitrate ceiling. VP8 in `realtime` latency mode treats this as a target, and
 * a mostly-static page stays two orders of magnitude under it; it only binds
 * when the whole viewport is changing (video playing, fast scroll), which is
 * exactly where we want a ceiling.
 */
const BITRATE_BPS = 2_000_000;

/**
 * How many pushed frames may be un-returned before we drop.
 *
 * W15 words this as "drop when encodeQueueSize > 2". `encodeQueueSize` is a
 * property of the in-page encoder, so the equivalent from this side of the
 * boundary is pushed-minus-returned, which also accounts for the CDP hop the
 * in-page number cannot see.
 */
const MAX_OUTSTANDING = 2;

/** Close the encoder browser once no stream has used it for this long. */
const IDLE_CLOSE_MS = 60_000;

/** A launch that failed is not retried until this has elapsed. */
const LAUNCH_RETRY_COOLDOWN_MS = 60_000;

/** Bound on the first launch + capability probe. */
const LAUNCH_TIMEOUT_MS = 20_000;

const ENCODER_ORIGIN = 'https://screencast-encoder.invalid';

/**
 * Installed once per encoder page. Written as a string, not a typed function:
 * this package has no DOM lib (it is a Node package), so `VideoEncoder` and
 * friends cannot type-check as real code — the same convention every other
 * in-page script in this codebase uses.
 *
 * One page hosts N streams keyed by id, so N live views cost one renderer.
 */
const ENCODER_BOOTSTRAP = `(() => {
  const streams = new Map();
  window.__genaiEncoderReady = true;

  window.__genaiEncoderSupported = async (codec, width, height, framerate) => {
    if (typeof VideoEncoder === 'undefined' || typeof ImageDecoder === 'undefined') return false;
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec, width, height, bitrate: ${BITRATE_BPS}, framerate,
      });
      return !!(support && support.supported);
    } catch { return false; }
  };

  const toBase64 = (bytes) => {
    let bin = '';
    // Chunked: String.fromCharCode.apply throws on very large argument counts,
    // and a key frame is comfortably large enough to hit that limit.
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  };

  const configure = (state) => {
    state.encoder.configure({
      codec: state.codec,
      width: state.width,
      height: state.height,
      bitrate: ${BITRATE_BPS},
      framerate: state.framerate,
      // 'realtime' tells libvpx to favour latency over compression, and is what
      // makes a single-slot pipeline viable: a frame in is a frame out, no
      // multi-frame lookahead holding pixels the viewer is waiting for.
      latencyMode: 'realtime',
    });
    // Every (re)configure invalidates the decoder's reference frames, so the
    // next frame MUST be a key frame or the client decodes garbage.
    state.needKeyframe = true;
  };

  window.__genaiEncoderOpen = (id, codec, width, height, framerate) => {
    const state = { id, codec, width, height, framerate, needKeyframe: true, encoder: null };
    state.encoder = new VideoEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        window.__genaiEncoderChunk(
          id, toBase64(bytes), chunk.type === 'key', chunk.timestamp, state.width, state.height,
        );
      },
      error: (err) => { window.__genaiEncoderError(id, String((err && err.message) || err)); },
    });
    configure(state);
    streams.set(id, state);
  };

  window.__genaiEncoderPush = async (id, b64, timestampUs) => {
    const state = streams.get(id);
    if (!state) return;
    try {
      const bin = atob(b64);
      const jpeg = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
      const decoder = new ImageDecoder({ data: jpeg, type: 'image/jpeg' });
      const decoded = await decoder.decode();
      // Dimensions come from the DECODED image, never from the caller: the
      // capture side knows the viewport it asked for, which is not necessarily
      // the pixel size CDP delivered (device scale factor, a resize in flight).
      // Configuring the encoder for the wrong size produces a stream the client
      // decodes into a stretched or truncated frame with no error anywhere.
      if (decoded.image.displayWidth !== state.width || decoded.image.displayHeight !== state.height) {
        state.width = decoded.image.displayWidth;
        state.height = decoded.image.displayHeight;
        configure(state);
      }
      const frame = new VideoFrame(decoded.image, { timestamp: timestampUs });
      decoded.image.close();
      try {
        state.encoder.encode(frame, { keyFrame: state.needKeyframe });
        state.needKeyframe = false;
      } finally {
        frame.close();
        if (decoder.close) decoder.close();
      }
    } catch (err) {
      window.__genaiEncoderError(id, String((err && err.message) || err));
    }
  };

  // The re-key channel. Sets the same flag configure() sets, so the next
  // encode produces a key frame and the client's reference chain restarts.
  // Idempotent: asking twice before the next push costs one key frame.
  window.__genaiEncoderRequestKeyframe = (id) => {
    const state = streams.get(id);
    if (!state) return;
    state.needKeyframe = true;
  };

  window.__genaiEncoderClose = (id) => {
    const state = streams.get(id);
    if (!state) return;
    streams.delete(id);
    try { state.encoder.close(); } catch { /* already closed */ }
  };
})()`;

/**
 * Process-wide encoder. `shared()` rather than a constructor injection because
 * the thing being shared is an OS process: two instances would mean two
 * Chromiums doing the same job, and every caller that wants one wants the same
 * one. Tests construct their own with an injected launcher.
 */
export class ScreencastEncoder {
  private static sharedInstance: ScreencastEncoder | null = null;

  private browser: Browser | null = null;
  private page: Page | null = null;
  private starting: Promise<Page | null> | null = null;
  private lastLaunchFailureAt = 0;
  private streamSeq = 0;
  private readonly streams = new Map<string, { onChunk: OpenStreamOptions['onChunk']; onFailure?: (r: string) => void; outstanding: number; alive: boolean }>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly logger: ILogger,
    /** Injected for tests; production launches a real headless Chromium. */
    private readonly launch: () => Promise<Browser> = () =>
      chromium.launch({
        headless: true,
        ...(process.env['GENERATORAI_BROWSER_EXECUTABLE_PATH']
          ? { executablePath: process.env['GENERATORAI_BROWSER_EXECUTABLE_PATH'] }
          : {}),
      }),
  ) {}

  static shared(logger: ILogger): ScreencastEncoder {
    if (!ScreencastEncoder.sharedInstance) {
      ScreencastEncoder.sharedInstance = new ScreencastEncoder(logger);
    }
    return ScreencastEncoder.sharedInstance;
  }

  /** Test seam: drop the process-wide instance so a suite starts clean. */
  static resetSharedForTests(): void {
    ScreencastEncoder.sharedInstance = null;
  }

  /**
   * Test seam: the in-page bootstrap source.
   *
   * The Node half of the re-key channel is useless if the page half is
   * missing, and a fake page installs its own stubs — so this is the only way
   * a unit test can see the real script at all.
   */
  static bootstrapScriptForTests(): string {
    return ENCODER_BOOTSTRAP;
  }

  /**
   * Open one encoding stream.
   *
   * Returns `null` — never throws — when encoding is unavailable: no Chromium,
   * a build without WebCodecs, a launch that failed recently. The caller's
   * response is to send JPEG, which is a normal outcome and not an error path,
   * so it must not be signalled by an exception (P1-33 again, one layer down).
   */
  async openStream(opts: OpenStreamOptions): Promise<ScreencastEncoderStream | null> {
    if (this.disposed) return null;
    const page = await this.ensurePage(opts);
    if (!page) return null;

    const id = `s${++this.streamSeq}`;
    const record = { onChunk: opts.onChunk, onFailure: opts.onFailure, outstanding: 0, alive: true };
    this.streams.set(id, record);
    this.cancelIdleClose();

    try {
      await page.evaluate(
        ([sid, codec, w, h, fps]) =>
          (globalThis as unknown as { __genaiEncoderOpen: (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown) => void })
            .__genaiEncoderOpen(sid, codec, w, h, fps),
        [id, SCREENCAST_VP8_CODEC, opts.width, opts.height, opts.fps] as const,
      );
    } catch (err) {
      this.streams.delete(id);
      this.armIdleClose();
      this.logger.warn?.(`[ScreencastEncoder] stream open failed: ${(err as Error).message}`);
      return null;
    }

    // Arrow functions, so `this` is this encoder lexically — the stream handle
    // is a plain object handed to a caller that must not be able to rebind it.
    return {
      get alive() { return record.alive; },
      push: (jpegBase64: string, timestampUs: number): boolean => {
        if (!record.alive || this.disposed) return false;
        if (record.outstanding > MAX_OUTSTANDING) return false;
        record.outstanding += 1;
        void page
          .evaluate(
            ([sid, b64, ts]) =>
              (globalThis as unknown as { __genaiEncoderPush: (a: unknown, b: unknown, c: unknown) => Promise<void> })
                .__genaiEncoderPush(sid, b64, ts),
            [id, jpegBase64, timestampUs] as const,
          )
          .catch((err: unknown) => {
            // The push itself failing means the page is gone; the encoder can
            // no longer produce anything for this stream, so say so once.
            this.failStream(id, (err as Error).message);
          });
        return true;
      },
      requestKeyframe: (): void => {
        if (!record.alive || this.disposed) return;
        void page
          .evaluate(
            (sid) =>
              (globalThis as unknown as { __genaiEncoderRequestKeyframe: (a: unknown) => void })
                .__genaiEncoderRequestKeyframe(sid),
            id,
          )
          // Deliberately NOT `failStream`: a re-key that could not be delivered
          // is a stream that will stay frozen, but the caller is already on a
          // drop path and killing the stream from here would turn a recoverable
          // gap into a torn-down live view.
          .catch(() => undefined);
      },
      close: async (): Promise<void> => {
        if (!this.streams.delete(id)) return;
        record.alive = false;
        try {
          await page.evaluate(
            (sid) => (globalThis as unknown as { __genaiEncoderClose: (a: unknown) => void }).__genaiEncoderClose(sid),
            id,
          );
        } catch { /* page already gone */ }
        this.armIdleClose();
      },
    };
  }

  /** Close the encoder browser now. Safe to call twice. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelIdleClose();
    for (const id of [...this.streams.keys()]) this.failStream(id, 'encoder disposed');
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    this.starting = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private failStream(id: string, reason: string): void {
    const record = this.streams.get(id);
    if (!record || !record.alive) return;
    record.alive = false;
    this.streams.delete(id);
    record.onFailure?.(reason);
    this.armIdleClose();
  }

  private async ensurePage(opts: OpenStreamOptions): Promise<Page | null> {
    if (this.page && !this.page.isClosed()) return this.page;
    // A launch that just failed is not retried per connection: a machine
    // without a usable Chromium would otherwise pay a multi-second timeout on
    // every single viewer connect, which is far worse than JPEG.
    if (Date.now() - this.lastLaunchFailureAt < LAUNCH_RETRY_COOLDOWN_MS) return null;
    if (this.starting) return this.starting;

    this.starting = this.startPage(opts)
      .catch((err: unknown) => {
        this.lastLaunchFailureAt = Date.now();
        this.logger.warn?.(
          `[ScreencastEncoder] unavailable, live view will send JPEG: ${(err as Error).message}`,
        );
        return null;
      })
      .finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startPage(opts: OpenStreamOptions): Promise<Page | null> {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('encoder browser did not start within 20s')), LAUNCH_TIMEOUT_MS).unref?.(),
    );
    const page = await Promise.race([this.launchAndPrepare(opts), deadline]);
    return page;
  }

  private async launchAndPrepare(opts: OpenStreamOptions): Promise<Page | null> {
    const browser = await this.launch();
    this.browser = browser;
    browser.on('disconnected', () => {
      // Everything downstream of a dead browser is dead. Say so to each stream
      // rather than letting them push into a void and look merely stalled.
      this.page = null;
      this.browser = null;
      for (const id of [...this.streams.keys()]) this.failStream(id, 'encoder browser exited');
    });

    const page = await browser.newPage();
    await page.route(`${ENCODER_ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>screencast encoder</title>' }),
    );
    await page.goto(`${ENCODER_ORIGIN}/encoder`);

    await page.exposeFunction(
      '__genaiEncoderChunk',
      (id: string, b64: string, keyframe: boolean, timestampUs: number, width: number, height: number) => {
        const record = this.streams.get(id);
        if (!record || !record.alive) return;
        record.outstanding = Math.max(0, record.outstanding - 1);
        record.onChunk({ data: Buffer.from(b64, 'base64'), keyframe, timestampUs, width, height });
      },
    );
    await page.exposeFunction('__genaiEncoderError', (id: string, message: string) => {
      this.logger.warn?.(`[ScreencastEncoder] stream ${id} failed: ${message}`);
      this.failStream(id, message);
    });

    await page.evaluate(ENCODER_BOOTSTRAP);

    const supported = await page.evaluate(
      ([codec, w, h, fps]) =>
        (globalThis as unknown as { __genaiEncoderSupported: (a: unknown, b: unknown, c: unknown, d: unknown) => Promise<boolean> })
          .__genaiEncoderSupported(codec, w, h, fps),
      [SCREENCAST_VP8_CODEC, opts.width, opts.height, opts.fps] as const,
    );
    if (!supported) {
      this.logger.info?.('[ScreencastEncoder] Chromium reports no VP8 encoder; live view will send JPEG');
      await browser.close().catch(() => undefined);
      this.browser = null;
      // Not a launch *failure* — the browser is fine, it just cannot encode.
      // Recorded on the same cooldown so we do not relaunch it per connection.
      this.lastLaunchFailureAt = Date.now();
      return null;
    }

    this.page = page;
    this.logger.info?.('[ScreencastEncoder] WebCodecs VP8 encoder ready');
    return page;
  }

  private armIdleClose(): void {
    if (this.streams.size > 0 || this.disposed) return;
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.streams.size > 0) return;
      const browser = this.browser;
      this.browser = null;
      this.page = null;
      void browser?.close().catch(() => undefined);
    }, IDLE_CLOSE_MS);
    // An idle timer for an optional encoder must never be the reason the
    // process cannot exit.
    this.idleTimer.unref?.();
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
