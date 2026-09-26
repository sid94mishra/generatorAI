// ────────────────────────────────────────────────────────────────
// Browser input mapping (03-component-inventory-domain.md §6.2).
//
// Pure functions: address-bar URLs → what the browser loads, and DOM
// mouse/keyboard/scroll events on the letterboxed live view → the screencast
// input protocol (`mouse.click`, `mouse.move`, `mouse.wheel`, `key.type`,
// `key.press`) in page pixels. No DOM access; the hooks pass rects in.
// ────────────────────────────────────────────────────────────────

// ── URLs ─────────────────────────────────────────────────────

const HAS_HTTP_SCHEME = /^https?:\/\//i;

/**
 * What an address-bar entry loads: an explicit `http://` / `https://` scheme
 * is kept in any letter case, anything else gets `https://`. `raw` is the
 * trimmed, non-empty entry.
 */
export function normaliseBrowserUrl(raw: string): string {
  return HAS_HTTP_SCHEME.test(raw) ? raw : `https://${raw}`;
}

/**
 * Internal/blank URLs that must never surface in the URL bar. The native
 * browser host loads `about:blank#gai-<workspaceId>` as a discovery marker
 * so the server can find the WebContentsView — it's a handshake detail,
 * not something the user should ever see or edit.
 */
export function isInternalBrowserUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith('about:blank') || url.includes('#gai-');
}

/** The URL a read-only address pill may show: undefined for internal URLs. */
export function displayBrowserUrl(url: string | null | undefined): string | undefined {
  return isInternalBrowserUrl(url) ? undefined : url ?? undefined;
}

// ── Geometry ─────────────────────────────────────────────────

export interface PagePoint { x: number; y: number }
export interface ViewBox { left: number; top: number; width: number; height: number }
export interface FrameSize { width: number; height: number }
/** A rectangle in CSS px, relative to the live view's top-left corner. */
export interface ViewRect { x: number; y: number; w: number; h: number }

/**
 * The live `<canvas>` draws the page `object-contain`: scaled to fit the box
 * and centred, so there are bars on two sides. This is where the page lands.
 */
function letterbox(box: FrameSize, frame: FrameSize): { displayedW: number; displayedH: number; offX: number; offY: number } {
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const displayedW = frame.width * scale;
  const displayedH = frame.height * scale;
  return { displayedW, displayedH, offX: (box.width - displayedW) / 2, offY: (box.height - displayedH) / 2 };
}

/**
 * Viewport client coordinates → page pixels, or null when the point is on
 * the letterbox bars (or the frame has no size yet).
 */
export function clientToPagePoint(
  client: { clientX: number; clientY: number },
  box: ViewBox,
  frame: FrameSize,
): PagePoint | null {
  if (!frame.width || !frame.height) return null;
  const { displayedW, displayedH, offX, offY } = letterbox(box, frame);
  const cssX = client.clientX - box.left - offX;
  const cssY = client.clientY - box.top - offY;
  if (cssX < 0 || cssY < 0 || cssX > displayedW || cssY > displayedH) return null;
  return {
    x: Math.round((cssX / displayedW) * frame.width),
    y: Math.round((cssY / displayedH) * frame.height),
  };
}

/** A drag rectangle on the live view → a page-pixel clip (fractional pixels kept). */
export function viewRectToPageClip(rect: ViewRect, box: FrameSize, frame: FrameSize): { x: number; y: number; width: number; height: number } {
  const { displayedW, displayedH, offX, offY } = letterbox(box, frame);
  return {
    x: ((rect.x - offX) / displayedW) * frame.width,
    y: ((rect.y - offY) / displayedH) * frame.height,
    width: (rect.w / displayedW) * frame.width,
    height: (rect.h / displayedH) * frame.height,
  };
}

/** The normalised rectangle between a drag's start point and the pointer. */
export function dragRect(start: { x: number; y: number }, x: number, y: number): ViewRect {
  return {
    x: Math.min(start.x, x),
    y: Math.min(start.y, y),
    w: Math.abs(x - start.x),
    h: Math.abs(y - start.y),
  };
}

/** Capture drags smaller than this (CSS px) on either axis are stray clicks. */
export const MIN_CAPTURE_EDGE = 8;

export function isCaptureRectUsable(rect: ViewRect | null): rect is ViewRect {
  return !!rect && rect.w >= MIN_CAPTURE_EDGE && rect.h >= MIN_CAPTURE_EDGE;
}

// ── Input protocol ───────────────────────────────────────────

export type BrowserMouseButton = 'left' | 'middle' | 'right';
export type BrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export type BrowserInputEvent =
  | { type: 'mouse.click'; x: number; y: number; button: BrowserMouseButton; clickCount: number }
  | { type: 'mouse.move'; x: number; y: number }
  | { type: 'mouse.wheel'; x?: number; y?: number; deltaX: number; deltaY: number }
  | { type: 'key.type'; text: string }
  | { type: 'key.press'; key: string; modifiers: BrowserKeyModifier[] };

/** Mouse moves are sent at most this often (ms). */
export const MOUSE_MOVE_THROTTLE_MS = 100;

export function mouseButtonName(button: number): BrowserMouseButton {
  return button === 2 ? 'right' : button === 1 ? 'middle' : 'left';
}

/** `detail` is the DOM click count; 0 (synthetic clicks) counts as 1. */
export function clickInput(p: PagePoint, button: number, detail: number): BrowserInputEvent {
  return { type: 'mouse.click', x: p.x, y: p.y, button: mouseButtonName(button), clickCount: detail || 1 };
}

export function moveInput(p: PagePoint): BrowserInputEvent {
  return { type: 'mouse.move', x: p.x, y: p.y };
}

/** A wheel over the letterbox bars still scrolls, just without a position. */
export function wheelInput(p: PagePoint | null, deltaX: number, deltaY: number): BrowserInputEvent {
  return { type: 'mouse.wheel', x: p?.x, y: p?.y, deltaX, deltaY };
}

/** Keys the live view leaves to the host (reload, devtools). */
const HOST_KEYS = new Set(['F5', 'F12']);

/**
 * A key press → `key.type` for a bare printable character, `key.press` with
 * modifiers otherwise; null for the keys the host keeps (F5, F12), which the
 * caller must not `preventDefault`.
 */
export function keyInput(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): BrowserInputEvent | null {
  if (HOST_KEYS.has(e.key)) return null;
  const modifiers: BrowserKeyModifier[] = [];
  if (e.altKey) modifiers.push('Alt');
  if (e.ctrlKey) modifiers.push('Control');
  if (e.metaKey) modifiers.push('Meta');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.key.length === 1 && modifiers.length === 0) return { type: 'key.type', text: e.key };
  return { type: 'key.press', key: e.key, modifiers };
}

// ── Overlay scrollbar ────────────────────────────────────────

export interface ScrollMetrics { scrollY: number; scrollHeight: number; clientHeight: number }

/**
 * Thumb position and size (percent of the track), or null when the page does
 * not overflow (by more than 4 px) and no scrollbar is drawn.
 */
export function scrollbarThumb(s: ScrollMetrics): { topPct: number; heightPct: number } | null {
  if (!(s.scrollHeight > s.clientHeight + 4)) return null;
  const trackRatio = s.clientHeight / s.scrollHeight;
  const scrollRatio = s.scrollY / (s.scrollHeight - s.clientHeight);
  const heightPct = Math.max(4, trackRatio * 100);
  const topPct = Math.min(100 - heightPct, scrollRatio * (100 - heightPct));
  return { topPct, heightPct };
}

/**
 * The page scrollY a thumb drag asks for: the pointer's travel `dy` over a
 * track `trackHeight` tall, scaled to the page, clamped to the scroll range.
 * Null when there is nothing to scroll.
 */
export function scrollDragTarget(s: ScrollMetrics, startScrollY: number, dy: number, trackHeight: number): number | null {
  const range = s.scrollHeight - s.clientHeight;
  if (range <= 0) return null;
  const ratio = dy / trackHeight;
  return Math.max(0, Math.min(range, startScrollY + ratio * s.scrollHeight));
}
