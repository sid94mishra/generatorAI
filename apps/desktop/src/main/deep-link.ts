// ────────────────────────────────────────────────────────────────
// Deep links — register the `generatorai://` custom protocol so links like
// `generatorai://chats/<id>?dock=changes` or `generatorai://pair?code=…` focus
// the window and navigate the SPA.
//
// Where a link arrives, per OS:
//   macOS          `open-url` — on a cold start it fires before `ready`, so the
//                  listener is registered in `main()` (before `whenReady`).
//   Windows/Linux  argv — cold start: `process.argv` once the window exists;
//                  warm start: the `second-instance` event's argv.
// Either way `WindowManager.navigateTo` holds the route until the app page has
// loaded, so a link that arrives before the window (or during its first load)
// is applied instead of lost. The route rules live in `deep-link-route.ts`.
// `generatorai://command/<id>` runs an allowlisted registry command (New chat,
// New workflow) through `WindowManager.sendCommand`, which holds it the same
// way until the app page has reported in (06 §8, P3-06).
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { log } from './logger';
import { DEEP_LINK_PROTOCOL, resolveDeepLink } from './deep-link-route';

export { findDeepLinkInArgv } from './deep-link-route';

export function registerProtocolClient(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // Dev: ensure the protocol points at this script invocation.
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1] ?? '')]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }
}

export function handleDeepLink(url: string): void {
  const target = resolveDeepLink(url);
  if (!target) return;
  if (target.kind === 'rejected-command') {
    // Only the allowlisted commands (DEEP_LINK_COMMAND_IDS) may be run by a
    // link another program handed us; the rest are dropped, not routed.
    log.warn('Deep link ignored: not a deep-link command', { command: target.command.slice(0, 64) });
    return;
  }
  const wm = getWindowManager();
  if (target.kind === 'command') {
    log.info('Deep link', { command: target.command });
    // Held by the window manager until the app page has reported in (cold
    // start, a first load, the pairing screen), like a route.
    wm.sendCommand(target.command);
  } else {
    // Never log the query: a pairing link carries a one-time code.
    log.info('Deep link', { route: target.route.split('?')[0] });
    wm.navigateTo(target.route);
  }
  // macOS keeps running with every window closed; a link then has to bring the
  // window back (it loads the app and applies the held route). Before `ready`
  // the startup path creates the window itself.
  const win = wm.getMainWindow();
  if (app.isReady() && (!win || win.isDestroyed())) wm.restoreFromTray();
}

/**
 * macOS delivers links through `open-url`. Call this before `app.whenReady()`:
 * a link that launches the app is emitted during `will-finish-launching`.
 */
export function registerDeepLinks(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}
