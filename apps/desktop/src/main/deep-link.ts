// ────────────────────────────────────────────────────────────────
// Deep links — register the `generatorai://` custom protocol so links like
// `generatorai://chats/<id>` or `generatorai:///workflows` focus the window
// and navigate the SPA.
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { log } from './logger';

const PROTOCOL = 'generatorai';

export function registerProtocolClient(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // Dev: ensure the protocol points at this script invocation.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] ?? '')]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

/** Convert a generatorai:// URL into an in-app route path. */
function urlToRoute(url: string): string | null {
  try {
    if (!url.startsWith(`${PROTOCOL}://`)) return null;
    const rest = url.slice(`${PROTOCOL}://`.length);
    const route = '/' + rest.replace(/^\/+/, '').split('#')[0]!.split('?')[0]!;
    return route;
  } catch {
    return null;
  }
}

export function handleDeepLink(url: string): void {
  const route = urlToRoute(url);
  if (!route) return;
  log.info('Deep link', { url, route });
  getWindowManager().navigateTo(route);
}

/** Wire up macOS open-url and Windows/Linux argv-based deep links. */
export function registerDeepLinks(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

/** Extract a deep-link URL from a process argv list (Windows/Linux). */
export function findDeepLinkInArgv(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`));
}
