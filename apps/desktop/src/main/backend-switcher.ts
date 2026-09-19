// ────────────────────────────────────────────────────────────────
// Switching the shell between backends at runtime.
// ────────────────────────────────────────────────────────────────
//
// Switching is `loadURL`, not a state swap, and that is the point: changing
// origin makes the browser discard every store, cache and open stream from the
// previous server. There is no path by which one server's data can survive
// into another's UI, because the platform enforces it.
//
// Lives in the main process because the control has to outlive the page — a
// switcher rendered by server A disappears with A, and if A is unreachable the
// page never renders at all.

import { app, dialog } from 'electron';
import { loadSettings, saveSettings } from './config';
import { log } from './logger';
import { showPrompt } from './prompt-window';
import { getServerManager } from './server-manager';
import { getWindowManager } from './window-manager';
import {
  activateConnection,
  activateEmbedded,
  activeConnection,
  addConnection,
  removeConnection,
  resolveTarget,
  type RemoteServerConnection,
  type ServerConnectionState,
} from './serverConnections';

export function connectionState(): ServerConnectionState {
  return loadSettings().servers;
}

function persist(next: ServerConnectionState): ServerConnectionState {
  saveSettings({ servers: next });
  return next;
}

/**
 * Loads `url` in the main window, creating one if the shell has none.
 *
 * Goes through `repointMainWindow` so the WindowManager's own record of the
 * app URL moves too — the navigation guard and the IPC sender guard compare
 * against it, and a stale value would make every bridge call from the new
 * backend's page fail as "not the app".
 */
function pointWindowAt(url: string): void {
  log.info('Switching backend', { url });
  getWindowManager().repointMainWindow(url);
}

/**
 * Switches to a saved remote server.
 *
 * The embedded server is deliberately left running so switching back is
 * instant and anything already in flight locally survives.
 */
export async function switchToRemote(connectionId: string): Promise<void> {
  const next = activateConnection(connectionState(), connectionId);
  const remote = activeConnection(next);
  if (!remote) {
    log.warn('Ignoring switch to unknown connection', { connectionId });
    return;
  }
  persist(next);

  // Start it if it is not already up, so "switch back" never waits on a boot.
  const sm = getServerManager();
  if (!sm.url) {
    void sm.start().catch((err: unknown) => log.warn('Embedded server start failed', err));
  }
  pointWindowAt(remote.url);
}

/** Switches back to this machine's own server, starting it if needed. */
export async function switchToEmbedded(): Promise<void> {
  persist(activateEmbedded(connectionState()));

  const sm = getServerManager();
  if (!sm.url) {
    try {
      await sm.start();
    } catch (err) {
      getWindowManager().showError(
        `The local server failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
  const target = resolveTarget(connectionState(), sm.url);
  if (target) pointWindowAt(target.url);
}

export function addRemoteConnection(input: {
  url: string;
  label?: string;
}): RemoteServerConnection {
  const { state, connection } = addConnection(connectionState(), input);
  persist(state);
  return connection;
}

export function forgetRemoteConnection(connectionId: string): void {
  const wasActive = connectionState().activeConnectionId === connectionId;
  persist(removeConnection(connectionState(), connectionId));
  // Removing the server you are looking at has to take you somewhere real.
  if (wasActive) void switchToEmbedded();
}

/** Label for the currently loaded backend, for menus and the tray. */
export function currentBackendLabel(): string {
  const remote = activeConnection(connectionState());
  if (remote) return remote.label;
  return `This computer (${app.getName()})`;
}

/**
 * Asks for a server address and switches to it.
 *
 * Electron has no native text-input dialog, so this opens a small modal window
 * of our own (`prompt-window.ts`). A mistyped address must not cost the user
 * the page they were on, so it is reported and re-asked, never escalated to
 * the shell's full-window error screen.
 */
export async function promptForRemoteServer(): Promise<void> {
  const win = getWindowManager().getMainWindow();
  if (!win || win.isDestroyed()) return;

  // NOT `window.prompt`: Electron does not implement it, so the old injected
  // call threw, was swallowed, and this menu item did nothing at all.
  const entered = await showPrompt({
    title: 'Connect to a server',
    message: 'Address of the server to connect to\n\ne.g. 192.168.0.50:3100 or https://studio.example',
    placeholder: '192.168.0.50:3100',
    confirmLabel: 'Connect',
    parent: win,
  });
  if (!entered) return;

  let connection: RemoteServerConnection;
  try {
    connection = addRemoteConnection({ url: entered });
  } catch {
    // Replacing the whole window with the error screen for a typo left the
    // user staring at a dead page with no way back to the app they were using.
    await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['OK'],
      title: 'That address did not work',
      message: `"${entered}" is not a valid server address.`,
      detail: 'Use a host and port (192.168.0.50:3100) or a full URL (https://studio.example).',
    });
    return;
  }
  await switchToRemote(connection.id);
}
