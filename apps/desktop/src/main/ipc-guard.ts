// ────────────────────────────────────────────────────────────────
// Sender validation for every IPC handler.
//
// The main process has exactly one trusted renderer: the main window's top
// frame, which runs the GeneratorAI SPA served by our own server. Everything
// else that can send IPC — the native browser tabs (`WebContentsView`s in
// `browser-host.ts`, which load arbitrary sites the agent navigates to), an
// iframe inside the SPA, a popup — must be refused, because the preload
// bridge is the only path from web content to dialogs, the settings file, the
// pairing-grant mint and the shell.
//
// `guardedHandle` is the one place that check lives. Registering a handler
// any other way in `ipc.ts` is a review error.
//
// The main window can also show ANOTHER machine's server (remote mode, D-126).
// That page passes the checks above — it is the main window's own top frame on
// the window's current origin — but it is not this computer's server, so it
// must not drive this computer: local-only channels (every channel not in
// `ipc-scope.ts`'s remote allowlist — local server control, file system,
// settings, update install, pairing, the native browser host) additionally
// require the sending frame to be this shell's own server (`isLocalOrigin`).
// ────────────────────────────────────────────────────────────────

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { isAppOrigin } from './navigation-guard';

export class UntrustedIpcSenderError extends Error {
  constructor(channel: string, reason: string) {
    super(`IPC '${channel}' refused: ${reason}`);
    this.name = 'UntrustedIpcSenderError';
  }
}

/** The subset of an IPC event the guard needs — a real event satisfies it. */
export interface GuardableEvent {
  sender: Pick<WebContents, 'id'> & { mainFrame?: unknown; isDestroyed?: () => boolean };
  senderFrame?: { url?: string } | null;
}

export interface IpcGuardDeps {
  /** The one renderer allowed to call in. Null before the window exists. */
  getMainWindow: () => BrowserWindow | null;
  /** The URL the main window is meant to be showing (origin comparison). */
  getAppUrl: () => string | null;
  /** Resolves the window owning a webContents — `BrowserWindow.fromWebContents`. */
  fromWebContents?: (wc: WebContents) => BrowserWindow | null;
  log: { warn: (message: string, meta?: unknown) => void };
  /**
   * Whether a frame URL is a page of THIS computer's server (not a remote one
   * shown in the window). Required by `localOnly` channels; absent ⇒ every
   * `localOnly` call is refused (fail closed).
   */
  isLocalOrigin?: (frameUrl: string | undefined) => boolean;
  /** Channels that are local-only by default (`ipc-scope.ts`); an explicit `options.localOnly` wins. */
  isLocalOnlyChannel?: (channel: string) => boolean;
}

export interface GuardOptions {
  /** Only a page served by this computer's own server may call (see the header). */
  localOnly?: boolean;
}

/**
 * Returns the reason a sender is NOT trusted, or null when it is.
 *
 * Checks, in order: a main window exists; the sender is that window's own
 * webContents (not a child view or another window); the sending frame is the
 * top frame; and the frame's URL is on the app origin. The origin check is
 * skipped when the frame URL is unavailable — Electron omits it in some
 * lifecycle moments — but never when it is present and wrong.
 */
export function rejectionReason(event: GuardableEvent, deps: IpcGuardDeps, options: GuardOptions = {}): string | null {
  const main = deps.getMainWindow();
  if (!main || main.isDestroyed()) return 'no main window';
  if (event.sender.isDestroyed?.()) return 'sender destroyed';
  if (event.sender.id !== main.webContents.id) return `sender webContents ${event.sender.id} is not the main window`;
  const owner = deps.fromWebContents?.(event.sender as WebContents);
  if (deps.fromWebContents && owner !== main) return 'sender is not owned by the main window';
  const frame = event.senderFrame;
  if (frame && event.sender.mainFrame !== undefined && frame !== event.sender.mainFrame) {
    return 'sender is a sub-frame';
  }
  const frameUrl = frame?.url;
  if (frameUrl) {
    const appUrl = deps.getAppUrl();
    // The error screen is a local page (gai-local://) we load ourselves; it has no bridge
    // calls, so refusing it is harmless and keeps the rule simple.
    if (!isAppOrigin(frameUrl, appUrl)) return `frame origin ${safeOrigin(frameUrl)} is not the app`;
  }
  if (options.localOnly && !deps.isLocalOrigin?.(frameUrl)) {
    return `frame origin ${frameUrl ? safeOrigin(frameUrl) : '<unknown>'} is not this computer's server`;
  }
  return null;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '<unparseable>';
  }
}

// Same parameter shape Electron's own `ipcMain.handle` declares.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuardedHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export interface IpcGuard {
  /** `ipcMain.handle` with the sender check in front of `handler`. */
  guardedHandle: (channel: string, handler: GuardedHandler, options?: GuardOptions) => void;
  /** Throws `UntrustedIpcSenderError` (and logs) when `event` is not trusted. */
  assertTrusted: (channel: string, event: GuardableEvent, options?: GuardOptions) => void;
  /** Channels registered through this guard — lets a test prove coverage. */
  channels: () => readonly string[];
  /** The subset registered `localOnly`. */
  localOnlyChannels: () => readonly string[];
  /** Whether a sender is a page of this computer's own server (for handlers that redact). */
  isLocalSender: (event: GuardableEvent) => boolean;
}

export function createIpcGuard(
  deps: IpcGuardDeps,
  register: (channel: string, listener: GuardedHandler) => void = (channel, listener) =>
    ipcMain.handle(channel, listener),
): IpcGuard {
  const registered: string[] = [];
  const localOnly: string[] = [];
  const assertTrusted = (channel: string, event: GuardableEvent, options: GuardOptions = {}): void => {
    const reason = rejectionReason(event, deps, options);
    if (reason === null) return;
    deps.log.warn('[ipc] refused call from untrusted sender', { channel, reason });
    throw new UntrustedIpcSenderError(channel, reason);
  };
  return {
    assertTrusted,
    channels: () => registered,
    localOnlyChannels: () => localOnly,
    isLocalSender: (event) => deps.isLocalOrigin?.(event.senderFrame?.url) === true,
    guardedHandle(channel, handler, options = {}) {
      registered.push(channel);
      const scoped: GuardOptions = { localOnly: options.localOnly ?? deps.isLocalOnlyChannel?.(channel) ?? false };
      if (scoped.localOnly) localOnly.push(channel);
      register(channel, (event, ...args) => {
        assertTrusted(channel, event, scoped);
        return handler(event, ...args);
      });
    },
  };
}

/** Production wiring: real `BrowserWindow.fromWebContents`. */
export function defaultFromWebContents(wc: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(wc);
}
