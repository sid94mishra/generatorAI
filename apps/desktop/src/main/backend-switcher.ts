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
import { EventEmitter } from 'node:events';
import { loadSettings, saveSettings } from './config';
import { log } from './logger';
import { showPrompt } from './prompt-window';
import { getServerManager } from './server-manager';
import { getWindowManager } from './window-manager';
import type { KnownServer } from './server-probe';
import type { PinnedCa } from './pinnedTrust';
import { base64UrlToPairs, fetchServerInfo, inspectServerCertificate } from './pinnedTrust';
import { parseServerInput, planRemoteConnection, trustPrompt } from './remote-connect';
import {
  PinMismatchError,
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

/**
 * Fires whenever `connectionState()` changes — switched, added or forgotten a
 * server. `ipc.ts` relays this to the renderer as `IPC_EVENT.serversChanged`
 * (G-03) and rebuilds the native menu, whose Server submenu reads
 * `connectionState()` fresh on every build.
 */
const serverEvents = new EventEmitter();

export function onServersChanged(listener: () => void): () => void {
  serverEvents.on('changed', listener);
  return () => serverEvents.off('changed', listener);
}

function persist(next: ServerConnectionState): ServerConnectionState {
  saveSettings({ servers: next });
  serverEvents.emit('changed');
  return next;
}

/** Label for the embedded server, independent of whether it is active. */
function embeddedLabel(): string {
  // Board DesktopMac: "This computer" (the app name is already the switcher title).
  return 'This computer';
}

/**
 * Every server this shell knows about — the embedded one plus every saved
 * remote — for the sidebar switcher and its popover (G-03). The desktop is
 * the source of truth here (`localStorage` is per-origin, so the renderer
 * cannot hold this list itself; see `serverConnections.ts`). Unprobed:
 * `IPC.getServers` adds reachability through `probeKnownServers`.
 */
export function listServers(): KnownServer[] {
  const state = connectionState();
  const sm = getServerManager();
  return [
    {
      id: 'embedded',
      label: embeddedLabel(),
      url: sm.url ?? '',
      kind: 'embedded',
      active: state.serverMode === 'embedded',
    },
    ...state.connections.map(
      (c): KnownServer => ({
        id: c.id,
        label: c.label,
        url: c.url,
        kind: 'remote',
        active: state.serverMode === 'remote' && state.activeConnectionId === c.id,
        ...(c.serverId ? { expectedServerId: c.serverId } : {}),
      }),
    ),
  ];
}

/**
 * Switches by the id shape `listServers()`/the renderer use: `'embedded'` or
 * a connection id. Unknown remote ids are ignored (same fail-safe as
 * `activateConnection`) rather than thrown, so a stale id from a renderer
 * that has not refreshed its list yet is a no-op, not a crash.
 */
export async function switchServerById(id: string): Promise<void> {
  if (id === 'embedded') {
    await switchToEmbedded();
    return;
  }
  await switchToRemote(id);
}

/**
 * Loads `url` in the main window, creating one if the shell has none.
 *
 * Goes through `repointMainWindow` so the WindowManager's own record of the
 * app URL moves too — the navigation guard and the IPC sender guard compare
 * against it, and a stale value would make every bridge call from the new
 * backend's page fail as "not the app".
 */
function pointWindowAt(url: string, initialPath?: string): void {
  log.info('Switching backend', { url });
  getWindowManager().repointMainWindow(url, initialPath);
}

/**
 * Switches to a saved remote server.
 *
 * The embedded server is deliberately left running so switching back is
 * instant and anything already in flight locally survives.
 */
export async function switchToRemote(connectionId: string, initialPath?: string): Promise<void> {
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
  pointWindowAt(remote.url, initialPath);
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
  pinnedCa?: PinnedCa;
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
  return embeddedLabel();
}

/**
 * Asks for a server — an address or a pairing code — and switches to it.
 *
 * Electron has no native text-input dialog, so this opens a small modal window
 * of our own (`prompt-window.ts`). A mistyped address must not cost the user
 * the page they were on, so it is reported and re-asked, never escalated to
 * the shell's full-window error screen.
 *
 * Another machine's built-in HTTPS is trusted by pinning its own CA for that
 * host (G-4, D-126): the pairing code vouches for it, or the user compares the
 * fingerprint in a "Trust this server?" step. Public certificates (ts.net)
 * need nothing.
 */
export async function promptForRemoteServer(): Promise<void> {
  const win = getWindowManager().getMainWindow();
  if (!win || win.isDestroyed()) return;

  // NOT `window.prompt`: Electron does not implement it, so the old injected
  // call threw, was swallowed, and this menu item did nothing at all.
  const entered = await showPrompt({
    title: 'Connect to a server',
    message: 'Its address, or a pairing code from its Settings › Security & devices (Desktop)\n\ne.g. 192.168.0.50:3100 or https://studio.tail1234.ts.net',
    placeholder: '192.168.0.50:3100',
    confirmLabel: 'Connect',
    parent: win,
  });
  if (!entered) return;

  const warn = async (title: string, message: string, detail?: string): Promise<void> => {
    await dialog.showMessageBox(win, { type: 'warning', buttons: ['OK'], title, message, ...(detail ? { detail } : {}) });
  };

  const input = parseServerInput(entered);
  if (input.kind === 'invalid') {
    // Replacing the whole window with the error screen for a typo left the
    // user staring at a dead page with no way back to the app they were using.
    await warn(
      'That address did not work',
      input.message,
      'Use a host and port (192.168.0.50:3100), a full URL (https://studio.example), or the pairing code that server shows.',
    );
    return;
  }

  const plan = await planRemoteConnection(input, {
    inspect: (origin) => inspectServerCertificate(origin),
    serverInfo: (origin, caPem) => fetchServerInfo(origin, caPem),
    now: () => Date.now(),
  });
  if (!plan.ok) {
    await warn('Could not connect to that server', plan.message);
    return;
  }

  if (plan.trust === 'pinned' && plan.pinnedCa) {
    const text = trustPrompt(plan, base64UrlToPairs(plan.pinnedCa.sha256));
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Trust and connect', 'Cancel'],
      defaultId: plan.vouchedByOffer ? 0 : 1,
      cancelId: 1,
      title: 'Trust this server?',
      message: text.message,
      detail: text.detail,
    });
    if (response !== 0) return;
  }

  let connection: RemoteServerConnection;
  try {
    connection = addRemoteConnection({
      url: plan.url,
      ...(plan.label ? { label: plan.label } : {}),
      ...(plan.pinnedCa ? { pinnedCa: plan.pinnedCa } : {}),
    });
  } catch (err) {
    if (err instanceof PinMismatchError) {
      await warn('This server’s certificate changed', err.message);
      return;
    }
    await warn('That address did not work', err instanceof Error ? err.message : String(err));
    return;
  }
  log.info('Connecting to a remote server', { url: plan.url, trust: plan.trust });
  // The pairing screen of that server reads `?pair=` on its first load and
  // shows the consent (it strips the code from the address bar at once).
  await switchToRemote(connection.id, plan.pairCode ? `/?${new URLSearchParams({ pair: plan.pairCode }).toString()}` : undefined);
}
