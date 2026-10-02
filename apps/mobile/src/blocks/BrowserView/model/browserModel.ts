// MB-28 BrowserView model (MD-37, MD-114), pure: map a tap on the scaled, letterboxed stream frame to page
// coordinates (the server's `input` route takes page space), the address bar's text as a URL, the device presets,
// the stream events this tab reacts to, and which error state a failure is (MPaneBrowserStates).

export interface Size {
  width: number;
  height: number;
}

/**
 * A tap at (x, y) in a `contain`-fitted frame view → the page point under it, or null when the tap fell on the
 * letterbox. `view` is the frame view's size, `page` the browser viewport the frame shows.
 */
export function framePointToPage(tap: { x: number; y: number }, view: Size, page: Size): { x: number; y: number } | null {
  if (view.width <= 0 || view.height <= 0 || page.width <= 0 || page.height <= 0) return null;
  const scale = Math.min(view.width / page.width, view.height / page.height);
  const offsetX = (view.width - page.width * scale) / 2;
  const offsetY = (view.height - page.height * scale) / 2;
  const x = (tap.x - offsetX) / scale;
  const y = (tap.y - offsetY) / scale;
  if (x < 0 || y < 0 || x > page.width || y > page.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** The address bar's text as something navigable ('' when empty); a bare host gets https. */
export function addressToUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
}

/** "localhost:5173/checkout" split into the host (dimmed) and the path, as the URL pill draws it. */
export function urlParts(url: string): { host: string; path: string } {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^#]*)/i.exec(url);
  if (!m) return { host: url, path: '' };
  return { host: m[1]!, path: m[2] === '/' ? '' : (m[2] ?? '') };
}

export interface DevicePreset {
  id: string;
  label: string;
  size: Size | null;
}

/** "Responsive" leaves the viewport as the host set it; the others resize it (`POST …/browser/resize`). */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'responsive', label: 'Responsive', size: null },
  { id: 'phone', label: 'Phone · 390 × 844', size: { width: 390, height: 844 } },
  { id: 'tablet', label: 'Tablet · 820 × 1180', size: { width: 820, height: 1180 } },
  { id: 'desktop', label: 'Desktop · 1280 × 800', size: { width: 1280, height: 800 } },
];

/** Events after which the descriptor is read again at once (web `browserEvents`). */
export const DESCRIPTOR_EVENTS: ReadonlySet<string> = new Set(['browser.session_created', 'browser.session_stopped', 'browser.session_updated', 'browser.navigation', 'browser.error']);

export interface BrowserSelection {
  artifactId: string;
  url: string;
  cssSelector: string;
  xpath: string;
}

/** A `browser.selection` event's element (the inspector's pick), or null. */
export function selectionFrom(event: { kind: string; data?: Record<string, unknown> }): BrowserSelection | null {
  if (event.kind !== 'browser.selection') return null;
  const d = event.data ?? {};
  const artifactId = typeof d['artifactId'] === 'string' ? d['artifactId'] : null;
  if (!artifactId) return null;
  const str = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '');
  return { artifactId, url: str('url'), cssSelector: str('cssSelector'), xpath: str('xpath') };
}

export type BrowserFailure = { kind: 'poolFull'; detail: string } | { kind: 'loadFailed'; detail: string; host: string | null } | { kind: 'other'; detail: string };

/** Which MPaneBrowserStates card a failure is. */
export function classifyFailure(message: string, url: string): BrowserFailure {
  if (/max(imum)? concurrent|capacity|429|session limit|too many/i.test(message)) return { kind: 'poolFull', detail: message };
  if (/net::ERR_|ECONNREFUSED|timeout|did not load|navigation failed|ENOTFOUND/i.test(message)) return { kind: 'loadFailed', detail: message, host: url ? urlParts(url).host : null };
  return { kind: 'other', detail: message };
}

/** The comment text a "Send to chat" puts in the draft. */
export function commentForChat(sel: BrowserSelection, text: string): string {
  return [text.trim(), '', `Element: ${sel.cssSelector || sel.xpath}`, sel.url ? `Page: ${sel.url}` : null].filter((l) => l !== null).join('\n');
}
