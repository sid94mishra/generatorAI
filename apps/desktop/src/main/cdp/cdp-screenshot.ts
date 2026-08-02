// ────────────────────────────────────────────────────────────────
// Page.captureScreenshot via `webContents.debugger.sendCommand` hangs on
// Electron webview/WebContentsView guests when the view is unfocused or in
// a split-pane layout — the compositor doesn't reliably produce a frame.
// Fall back to `webContents.capturePage()` (renders regardless of OS-level
// focus) if the debugger path stalls past a timeout.
// ────────────────────────────────────────────────────────────────

import type { WebContents } from 'electron';

const SCREENSHOT_TIMEOUT_MS = 8000;
const FALLBACK_CAPTURE_TIMEOUT_MS = 1000;
const SCREENSHOT_TIMEOUT_MESSAGE =
  'Screenshot timed out — the browser tab may not be visible or the window may not have focus.';

function applyFallbackClip(
  image: Electron.NativeImage,
  params: Record<string, unknown> | undefined,
): Electron.NativeImage | null {
  if (params?.captureBeyondViewport) {
    // capturePage() can only see the currently painted viewport; if the
    // caller asked for beyond-viewport pixels we cannot honestly satisfy it.
    return null;
  }

  const clip = params?.clip;
  if (!clip || typeof clip !== 'object') return image;
  const clipRect = clip as Record<string, unknown>;

  const x = typeof clipRect.x === 'number' ? clipRect.x : Number.NaN;
  const y = typeof clipRect.y === 'number' ? clipRect.y : Number.NaN;
  const width = typeof clipRect.width === 'number' ? clipRect.width : Number.NaN;
  const height = typeof clipRect.height === 'number' ? clipRect.height : Number.NaN;
  const scale =
    typeof clipRect.scale === 'number' && Number.isFinite(clipRect.scale) && clipRect.scale > 0
      ? clipRect.scale
      : 1;

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const cropRect = {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
  const imageSize = image.getSize();
  if (
    cropRect.x < 0 ||
    cropRect.y < 0 ||
    cropRect.width <= 0 ||
    cropRect.height <= 0 ||
    cropRect.x + cropRect.width > imageSize.width ||
    cropRect.y + cropRect.height > imageSize.height
  ) {
    return null;
  }

  return image.crop(cropRect);
}

function encodeNativeImageScreenshot(
  image: Electron.NativeImage,
  params: Record<string, unknown> | undefined,
): { data: string } | null {
  if (image.isEmpty()) return null;
  const clippedImage = applyFallbackClip(image, params);
  if (!clippedImage || clippedImage.isEmpty()) return null;

  const format = params?.format === 'jpeg' ? 'jpeg' : 'png';
  const quality =
    typeof params?.quality === 'number' && Number.isFinite(params.quality)
      ? Math.max(0, Math.min(100, Math.round(params.quality)))
      : undefined;
  const buffer = format === 'jpeg' ? clippedImage.toJPEG(quality ?? 90) : clippedImage.toPNG();
  return { data: buffer.toString('base64') };
}

/**
 * Route `Page.captureScreenshot` through the CDP debugger first (renders
 * server-side in the Blink compositor, independent of OS window focus); if
 * that stalls past `SCREENSHOT_TIMEOUT_MS`, fall back to `capturePage()`.
 * Callback-based (not a Promise) so the proxy can settle a specific CDP
 * request id from either path without racing itself.
 */
export function captureScreenshot(
  webContents: WebContents,
  params: Record<string, unknown> | undefined,
  onResult: (result: unknown) => void,
  onError: (message: string) => void,
): void {
  if (webContents.isDestroyed()) {
    onError('WebContents destroyed');
    return;
  }
  const dbg = webContents.debugger;
  if (!dbg.isAttached()) {
    onError('Debugger not attached');
    return;
  }

  const screenshotParams: Record<string, unknown> = {};
  if (params?.format) screenshotParams.format = params.format;
  if (params?.quality) screenshotParams.quality = params.quality;
  if (params?.clip) screenshotParams.clip = params.clip;
  if (params?.captureBeyondViewport != null) screenshotParams.captureBeyondViewport = params.captureBeyondViewport;
  if (params?.fromSurface != null) screenshotParams.fromSurface = params.fromSurface;

  let settled = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimers = (): void => {
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  };
  const settleResult = (result: unknown): void => {
    if (settled) return;
    settled = true;
    clearTimers();
    onResult(result);
  };
  const settleError = (message: string): void => {
    if (settled) return;
    settled = true;
    clearTimers();
    onError(message);
  };

  try {
    webContents.invalidate();
  } catch {
    // Some guest teardown paths reject repaint requests — fall through to CDP.
  }

  timeoutTimer = setTimeout(() => {
    if (settled) return;
    fallbackTimer = setTimeout(() => settleError(SCREENSHOT_TIMEOUT_MESSAGE), FALLBACK_CAPTURE_TIMEOUT_MS);
    void Promise.resolve()
      .then(() => webContents.capturePage())
      .then(
        (image) => {
          if (settled) return;
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          let fallback: { data: string } | null = null;
          try {
            fallback = encodeNativeImageScreenshot(image, params);
          } catch {
            settleError(SCREENSHOT_TIMEOUT_MESSAGE);
            return;
          }
          if (fallback) settleResult(fallback);
          else settleError(SCREENSHOT_TIMEOUT_MESSAGE);
        },
        () => {
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          settleError(SCREENSHOT_TIMEOUT_MESSAGE);
        },
      );
  }, SCREENSHOT_TIMEOUT_MS);

  dbg
    .sendCommand('Page.captureScreenshot', screenshotParams)
    .then((result) => settleResult(result))
    .catch((err) => settleError((err as Error).message));
}
