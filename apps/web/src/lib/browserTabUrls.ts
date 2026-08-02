/**
 * Per-tab "last visited URL" memory for the integrated browser.
 *
 * The RightPane remembers *which* browser tabs exist (scoped per chat / run),
 * but a native tab's live `WebContentsView` is destroyed the moment you leave
 * the page. Without this store, returning to a chat re-creates every browser
 * tab as a blank `about:blank` page and the pages you had open are lost.
 *
 * We therefore record `{ tabId -> url }` per scope so a re-created tab can be
 * navigated straight back to where it was. Cookies / localStorage of the
 * visited site already survive independently via the tab's persistent
 * Electron partition (`persist:browser-<tabId>`), so restoring the URL is
 * enough to land back on a logged-in page.
 */

const KEY_PREFIX = 'generatorai:browserTabUrls:';

type UrlMap = Record<string, string>;

function storageKey(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

function readMap(scope: string): UrlMap {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: UrlMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(scope: string, map: UrlMap): void {
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(storageKey(scope));
    else window.localStorage.setItem(storageKey(scope), JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * True when a URL is worth remembering / restoring. Internal blank pages and
 * the agent's `about:blank#gai-<id>` discovery markers must never be stored,
 * otherwise a fresh tab would "restore" onto a marker page.
 */
export function isRestorableBrowserUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
}

/** The URL this tab was last showing, or `null` if it has no memory. */
export function readBrowserTabUrl(scope: string, tabId: string): string | null {
  const url = readMap(scope)[tabId];
  return isRestorableBrowserUrl(url) ? url : null;
}

/** Remember (or forget, when `url` is not restorable) this tab's URL. */
export function writeBrowserTabUrl(scope: string, tabId: string, url: string | null | undefined): void {
  const map = readMap(scope);
  if (isRestorableBrowserUrl(url)) {
    if (map[tabId] === url) return;
    map[tabId] = url;
  } else {
    if (!(tabId in map)) return;
    delete map[tabId];
  }
  writeMap(scope, map);
}

/** Drop a closed tab's memory so localStorage doesn't grow unbounded. */
export function clearBrowserTabUrl(scope: string, tabId: string): void {
  const map = readMap(scope);
  if (!(tabId in map)) return;
  delete map[tabId];
  writeMap(scope, map);
}
