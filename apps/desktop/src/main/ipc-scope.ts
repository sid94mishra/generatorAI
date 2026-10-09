// ────────────────────────────────────────────────────────────────
// Which bridge channels a REMOTE server's page may call.
//
// The main window can show another machine's GeneratorAI (remote mode, D-126).
// That page is the window's own top frame on the window's current origin, so
// the sender guard admits it — but it is not this computer's server and must
// not drive this computer. Default deny: every channel NOT listed here is
// local-only (only a page of this shell's own server may call it): local
// server status and restart, the file and directory dialogs and save-to-disk,
// reveal-in-folder (it also probes whether a path exists here), the desktop
// settings file, installing an update, minting a pairing grant, and every
// native-browser tab operation (WebContentsViews on this machine).
//
// What stays open is what any page in the window legitimately needs: window
// chrome, find in page, theme and menu state, reload / devtools, external links
// (openExternalSafely validates them), the server switcher (a remote page must
// be able to switch back; switching only reaches servers the person added, and
// adding one is a native prompt), update STATE (not install), whether the
// native browser is available (false while remote), and app info (redacted:
// no local paths or server URL).
// ────────────────────────────────────────────────────────────────

import { IPC } from '../shared/ipc';
import { BROWSER_IPC } from '../shared/browser-ipc';

export const REMOTE_ALLOWED_CHANNELS: ReadonlySet<string> = new Set([
  IPC.getAppInfo,
  IPC.findInPage,
  IPC.stopFindInPage,
  IPC.openExternal,
  IPC.windowMaximizeToggle,
  IPC.windowIsMaximized,
  IPC.setMenuState,
  IPC.setAppearance,
  IPC.reload,
  IPC.toggleDevtools,
  IPC.getServers,
  IPC.switchServer,
  IPC.addServer,
  IPC.getUpdateState,
  IPC.watchUpdates,
  BROWSER_IPC.available,
]);

export function isLocalOnlyChannel(channel: string): boolean {
  return !REMOTE_ALLOWED_CHANNELS.has(channel);
}

/** True when `frameUrl` is a page served from `localUrl`'s origin. */
export function isSameOrigin(frameUrl: string | undefined, localUrl: string | null): boolean {
  if (!frameUrl || !localUrl) return false;
  try {
    return new URL(frameUrl).origin === new URL(localUrl).origin;
  } catch {
    return false;
  }
}
