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

import { app } from 'electron';
import { loadSettings, saveSettings } from './config';
import { log } from './logger';
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

/** Loads `url` in the main window, creating one if the shell has none. */
function pointWindowAt(url: string): void {
  const wm = getWindowManager();
  const win = wm.getMainWindow();
  if (win && !win.isDestroyed()) {
    log.info('Switching backend', { url });
    win.loadURL(url).catch((err: unknown) => {
      log.error('Failed to load backend', err);
      wm.showError(
        `Could not load ${url}.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    });
    win.focus();
    return;
  }
  wm.createMainWindow(url);
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
 * Electron has no native text-input dialog, so the prompt is rendered inside
 * the current page. That is acceptable here and nowhere else in this module:
 * adding a server is the one action you can only take while already looking at
 * a working one.
 */
export async function promptForRemoteServer(): Promise<void> {
  const win = getWindowManager().getMainWindow();
  if (!win || win.isDestroyed()) return;

  let entered: unknown;
  try {
    entered = await win.webContents.executeJavaScript(
      `window.prompt(${JSON.stringify(
        'Address of the server to connect to\n\ne.g. 192.168.0.50:3100 or https://studio.example',
      )}, '')`,
      true,
    );
  } catch (err) {
    log.warn('Could not prompt for a server address', err);
    return;
  }
  if (typeof entered !== 'string' || !entered.trim()) return;

  let connection: RemoteServerConnection;
  try {
    connection = addRemoteConnection({ url: entered });
  } catch {
    getWindowManager().showError(
      `"${entered}" is not a valid server address.\n\n` +
        'Use a host and port (192.168.0.50:3100) or a full URL (https://studio.example).',
    );
    return;
  }
  await switchToRemote(connection.id);
}
