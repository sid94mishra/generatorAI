// ────────────────────────────────────────────────────────────────
// The shell's own local pages (splash, error, prompt) over a custom scheme.
//
// The packaged app ships with the `GrantFileProtocolExtraPrivileges` fuse off
// (D-128). Without it Chromium's plain file:// loader serves these pages, and
// that loader cannot read inside `app.asar`, so every one of them failed with
// ERR_FILE_NOT_FOUND (no splash, and a blank window instead of the error
// screen when the server could not start). Electron's guidance is to serve
// local files from a custom protocol instead of file:// — which is this.
//
// The handler serves an allow-list only: the three pages and their two fonts.
// Anything else, including `..` and encoded traversal, is a 404. Files are
// read with the main process's `fs`, which is asar-aware.
// ────────────────────────────────────────────────────────────────

import { protocol } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const LOCAL_PAGES_SCHEME = 'gai-local';
const HOST = 'pages';
const RESOURCES = path.join(__dirname, '..', '..', 'resources');

/** The pages' own scripts and styles are inline; nothing may load from anywhere else. */
const PAGE_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src ${LOCAL_PAGES_SCHEME}:; img-src data:; base-uri 'none'; form-action 'none'`;

const ALLOWED: Readonly<Record<string, string>> = {
  'splash.html': 'text/html; charset=utf-8',
  'error.html': 'text/html; charset=utf-8',
  'prompt.html': 'text/html; charset=utf-8',
  'fonts/instrument-sans-latin-wght-normal.woff2': 'font/woff2',
  'fonts/jetbrains-mono-latin-wght-normal.woff2': 'font/woff2',
};

/** The URL of one of the shell's local pages, with an optional query. */
export function localPageUrl(page: 'splash.html' | 'error.html' | 'prompt.html', search?: URLSearchParams | string): string {
  const query = search === undefined ? '' : `?${search.toString().replace(/^\?/, '')}`;
  return `${LOCAL_PAGES_SCHEME}://${HOST}/${page}${query === '?' ? '' : query}`;
}

/** Whether a URL is one of the shell's local pages. */
export function isLocalPageUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith(`${LOCAL_PAGES_SCHEME}://${HOST}/`);
}

/** The allow-listed resource a request names, or null. Pure; exported for tests. */
export function resolveLocalPage(requestUrl: string): { file: string; contentType: string } | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${LOCAL_PAGES_SCHEME}:` || url.hostname !== HOST) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const contentType = ALLOWED[rel];
  return contentType ? { file: rel, contentType } : null;
}

/** Must run before `app` is ready. */
export function registerLocalPagesScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: LOCAL_PAGES_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** Serves the allow-list on the default session. Call once the app is ready. */
export function handleLocalPages(): void {
  protocol.handle(LOCAL_PAGES_SCHEME, async (request) => {
    const hit = resolveLocalPage(request.url);
    if (!hit) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.readFile(path.join(RESOURCES, ...hit.file.split('/')));
      const headers: Record<string, string> = { 'content-type': hit.contentType };
      if (hit.contentType.startsWith('text/html')) headers['content-security-policy'] = PAGE_CSP;
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
