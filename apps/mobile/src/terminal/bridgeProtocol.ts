// ────────────────────────────────────────────────────────────────
// Terminal bridge protocol.
//
// React Native owns the WebSocket; a WebView owns the xterm.js renderer.
// This module is the message contract between them, plus the batching that
// makes it viable.
//
// ── Why the socket lives in RN, not the WebView ──────────────────
// The PTY stream is authenticated with a single-use stream ticket and uses a
// watermark ACK protocol for flow control. Putting the socket in the WebView
// would mean either shipping the credential into a sandboxed browser context
// or reimplementing flow control there — both strictly worse. The WebView is
// a renderer, with no network access at all.
//
// ── Why batching is not optional ─────────────────────────────────
// A build log can emit tens of thousands of small writes per second. Each
// `postMessage` is a serialize + bridge hop; forwarding one per PTY chunk
// drops frames within a second. Coalescing on a frame boundary bounds bridge
// traffic by frame rate rather than by output rate.
// ────────────────────────────────────────────────────────────────

/** RN → WebView. */
export type ToWebView =
  | { type: 'data'; b64: string }
  | { type: 'clear' }
  | { type: 'theme'; theme: Record<string, string> }
  | { type: 'fit' }
  /** Incremental search — highlights and jumps to the first match. */
  | { type: 'search'; query: string }
  | { type: 'searchNext'; query: string }
  | { type: 'searchPrev'; query: string }
  | { type: 'clearSearch' }
  | { type: 'scrollToBottom' }
  /** Pinch-to-zoom result. The renderer refits after applying it. */
  | { type: 'fontSize'; size: number }
  | { type: 'focus' }
  | { type: 'blur' };

/** WebView → RN. */
export type FromWebView =
  | { type: 'ready' }
  | { type: 'input'; b64: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'selection'; text: string }
  | { type: 'bell' }
  /** OSC 0/2 window title from the shell (`user@host: ~/project`). */
  | { type: 'title'; title: string }
  /** The user tapped a URL the web-links addon detected. RN decides whether to open it. */
  | { type: 'link'; url: string }
  /**
   * A key a soft keyboard cannot produce (Escape, Tab, arrows, a Ctrl chord)
   * arrived at the renderer — evidence of a hardware keyboard.
   */
  | { type: 'hwkey' }
  | { type: 'searchResult'; found: boolean };

/** Largest title the bridge will carry — a shell can set anything. */
const MAX_TITLE_CHARS = 256;
/** Largest URL the bridge will carry. */
const MAX_URL_CHARS = 2048;

/**
 * Coalesces PTY output into at most one bridge message per frame.
 *
 * Deliberately time-based rather than size-based: a size threshold either
 * adds latency to a quiet prompt (waiting for the buffer to fill) or fails
 * to bound traffic under load.
 */
export class OutputBatcher {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (b64: string) => void,
    /** One 60fps frame. */
    private readonly intervalMs = 16,
  ) {}

  push(b64Chunk: string): void {
    this.pending.push(b64Chunk);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.drain(), this.intervalMs);
  }

  /** Send immediately — used before teardown so trailing output is not lost. */
  drain(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const chunks = this.pending;
    this.pending = [];
    // Chunks are concatenated as separate base64 strings joined by '|' so the
    // WebView can decode each independently. Concatenating base64 payloads
    // directly is NOT valid unless every chunk length is a multiple of 3,
    // which PTY output never guarantees.
    this.flush(chunks.join('|'));
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

/** Split a batched payload back into individual base64 chunks. */
export function splitBatch(payload: string): string[] {
  return payload.length === 0 ? [] : payload.split('|');
}

/**
 * Parse a message from the WebView.
 *
 * The WebView renders untrusted terminal output, so anything it posts back
 * is treated as untrusted input: unknown shapes are dropped rather than
 * forwarded to the PTY, where they would become keystrokes on the user's
 * machine.
 */
export function parseFromWebView(raw: string): FromWebView | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const message = value as Record<string, unknown>;
  switch (message['type']) {
    case 'ready':
    case 'bell':
    case 'hwkey':
      return { type: message['type'] as 'ready' | 'bell' | 'hwkey' };
    case 'input':
      return typeof message['b64'] === 'string' ? { type: 'input', b64: message['b64'] } : null;
    case 'resize': {
      const cols = message['cols'];
      const rows = message['rows'];
      // Bounded: a resize is forwarded to the PTY, and absurd dimensions can
      // wedge or crash the child process.
      if (!isSaneDimension(cols) || !isSaneDimension(rows)) return null;
      return { type: 'resize', cols: cols as number, rows: rows as number };
    }
    case 'selection':
      return typeof message['text'] === 'string'
        ? { type: 'selection', text: message['text'].slice(0, 100_000) }
        : null;
    case 'title':
      return typeof message['title'] === 'string'
        ? { type: 'title', title: message['title'].slice(0, MAX_TITLE_CHARS) }
        : null;
    case 'link': {
      const url = message['url'];
      // The scheme is checked again by the caller before `Linking.openURL`;
      // this only guards the shape and size.
      if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_CHARS) return null;
      return { type: 'link', url };
    }
    case 'searchResult':
      return typeof message['found'] === 'boolean'
        ? { type: 'searchResult', found: message['found'] }
        : null;
    default:
      return null;
  }
}

/**
 * Only `http:` and `https:` links leave the renderer.
 *
 * Terminal output is untrusted: a `file:`, `javascript:`, `tel:` or custom
 * app scheme printed by a program must never reach `Linking.openURL`, where
 * it would be dereferenced with the app's own identity.
 */
export function isOpenableLink(url: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(url);
}

function isSaneDimension(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000;
}
