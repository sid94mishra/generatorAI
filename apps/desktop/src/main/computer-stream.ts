// ────────────────────────────────────────────────────────────────
// computer-stream — the live video of the window the agent is driving.
//
// The server's preview is a frame per action: it updates when the agent acts
// and freezes in between, which is not what watching an agent work means. The
// desktop shell can do better on the machine it runs on: Chromium captures a
// single window as a real-time video track (ScreenCaptureKit on macOS,
// Windows Graphics Capture, X11 on Linux), with no server round trip.
//
// The renderer never picks what is captured. It names the driver's window id;
// main resolves that to exactly one capture source and arms it, and the next
// `getDisplayMedia()` from the app window receives that window and nothing
// else. Without an armed source the request is refused, so the page cannot
// reach the whole screen or another window through this path. The channel is
// local-only (ipc-scope.ts): a remote server's page must not capture this
// computer, whose windows are not that server's agent's anyway.
//
// Where the ids do not line up — Wayland, whose portal hands out its own ids —
// arming fails and the panel keeps the frame-per-action preview.
// ────────────────────────────────────────────────────────────────

import { desktopCapturer, type DesktopCapturerSource, type Session } from 'electron';

/** An armed source is for the request that follows it, not for later. */
const ARM_TTL_MS = 5_000;

let armed: { source: DesktopCapturerSource; until: number } | null = null;

/**
 * The capture source for a driver window id. Chromium names window sources
 * `window:<native id>:<n>` — the CGWindowID on macOS, the HWND on Windows and
 * the XID on X11, which are the ids the driver reports.
 */
export function sourceForWindow<T extends { id: string }>(sources: readonly T[], windowId: number): T | null {
  if (!Number.isSafeInteger(windowId) || windowId <= 0) return null;
  const prefix = `window:${windowId}:`;
  return sources.find((s) => s.id.startsWith(prefix)) ?? null;
}

/** Arms the capture of one window for the app window's next display-media request. */
export async function armWindowStream(windowId: unknown): Promise<boolean> {
  armed = null;
  if (typeof windowId !== 'number') return false;
  const sources = await desktopCapturer
    .getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    .catch(() => []);
  const source = sourceForWindow(sources, windowId);
  if (!source) return false;
  armed = { source, until: Date.now() + ARM_TTL_MS };
  return true;
}

/** Answers `getDisplayMedia()` from the app window with the armed window only, once. */
export function installWindowStreamHandler(ses: Pick<Session, 'setDisplayMediaRequestHandler'>): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const pick = armed && armed.until > Date.now() && request.videoRequested ? armed.source : null;
    armed = null;
    if (pick) callback({ video: pick });
    else callback({});
  });
}
