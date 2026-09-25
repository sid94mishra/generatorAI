// ────────────────────────────────────────────────────────────────
// The OS-level "needs attention" badge (G-05, 05-gap-matrix.md §G-05).
//
// One function, `applyAttentionBadge`, called from every platform. Each
// branch below is a CAPABILITY the platform genuinely has (or does not),
// verified against Electron's own API surface — never a guess about which
// platform the bug happened to show up on (see the cross-platform standing
// rule in .claude/CLAUDE.md):
//   - macOS:  `app.dock.setBadge(text)` — the only platform with a Dock.
//   - Linux:  `app.setBadgeCount(count)` — Electron implements this only on
//             a Unity/libunity-launcher desktop (GNOME, some KDE); on every
//             other Linux DE it is a harmless no-op, which IS the graceful
//             degradation this task calls for, not a bug to special-case.
//   - Windows: no dock/Unity launcher exists, so neither of the above
//             applies; Electron's per-window `setOverlayIcon` is the
//             platform's real equivalent, drawn as a 16×16 dot generated
//             in-process (no bundled asset) rather than a digit, since
//             precise counts would need a bundled numeral font.
// ────────────────────────────────────────────────────────────────

import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import { log } from './logger';

const OVERLAY_SIZE = 16;

/** A solid 16×16 dot, drawn as a raw RGBA buffer — no bundled asset needed. */
function overlayDotIcon(): NativeImage {
  const buffer = Buffer.alloc(OVERLAY_SIZE * OVERLAY_SIZE * 4);
  const center = OVERLAY_SIZE / 2 - 0.5;
  const radius = OVERLAY_SIZE / 2 - 1;
  for (let y = 0; y < OVERLAY_SIZE; y++) {
    for (let x = 0; x < OVERLAY_SIZE; x++) {
      const dx = x - center;
      const dy = y - center;
      const i = (y * OVERLAY_SIZE + x) * 4;
      if (dx * dx + dy * dy <= radius * radius) {
        // A fixed warm-red dot: Windows paints this over its own taskbar
        // chrome, outside any DOM the app's CSS variables could reach, so it
        // cannot follow the active theme.
        buffer[i] = 0xe0;
        buffer[i + 1] = 0x4f;
        buffer[i + 2] = 0x4f;
        buffer[i + 3] = 0xff;
      }
      // else: left at 0 — fully transparent.
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: OVERLAY_SIZE, height: OVERLAY_SIZE });
}

/** macOS: the Dock badge. `app.dock` is `undefined` on every other platform. */
function applyDockBadge(needsYou: number): void {
  app.dock?.setBadge(needsYou > 0 ? String(Math.min(needsYou, 999)) : '');
}

/**
 * Linux: the Unity/libunity launcher badge. Electron reports whether the
 * running desktop accepted it via the return value; a DE without a launcher
 * API (most of them) simply does not show anything, which needs no handling
 * here beyond not throwing.
 */
function applyLinuxBadge(needsYou: number): void {
  app.setBadgeCount?.(Math.max(0, Math.min(needsYou, 999)));
}

/** Windows: a per-window taskbar overlay icon — there is no app-level badge API. */
function applyWindowsOverlay(
  win: Pick<BrowserWindow, 'setOverlayIcon' | 'isDestroyed'> | null,
  needsYou: number,
): void {
  if (!win || win.isDestroyed()) return;
  win.setOverlayIcon(
    needsYou > 0 ? overlayDotIcon() : null,
    needsYou > 0 ? `${needsYou} item${needsYou === 1 ? '' : 's'} need your attention` : '',
  );
}

/**
 * Applies the "needs you" badge for whichever platform this is running on.
 * The only call site tray/menu code needs — `ipc.ts`'s `setMenuState`
 * handler, whenever the renderer's pushed `attention` counts change.
 *
 * `needsYou <= 0` clears the badge on every platform: a stale badge after the
 * last ask is resolved is worse than no badge.
 */
export function applyAttentionBadge(
  needsYou: number,
  deps: {
    platform?: NodeJS.Platform;
    getMainWindow?: () => Pick<BrowserWindow, 'setOverlayIcon' | 'isDestroyed'> | null;
  } = {},
): void {
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === 'darwin') {
      applyDockBadge(needsYou);
      return;
    }
    if (platform === 'linux') {
      applyLinuxBadge(needsYou);
      return;
    }
    if (platform === 'win32') {
      applyWindowsOverlay(deps.getMainWindow?.() ?? null, needsYou);
      return;
    }
    // Any other platform Electron might one day run on: no known badge API,
    // so do nothing rather than guess.
  } catch (e) {
    // A badge is a nicety; a platform quirk here must never take the tray
    // or the app down with it.
    log.warn('applyAttentionBadge failed', e);
  }
}
