// ────────────────────────────────────────────────────────────────
// When does a server status change mean the window must move?
//
// Only when the shell is showing the EMBEDDED server, that server has just
// become ready, and it is now at a different URL than the window is on. A
// remote backend is unaffected by the local server restarting underneath it.
// ────────────────────────────────────────────────────────────────

import type { ServerStatus } from '../shared/ipc';
import type { ServerConnectionState } from './serverConnections';

export function repointTarget(
  status: Pick<ServerStatus, 'state' | 'url'>,
  currentAppUrl: string | null,
  serverMode: ServerConnectionState['serverMode'],
): string | null {
  if (serverMode !== 'embedded') return null;
  if (status.state !== 'ready' || !status.url) return null;
  if (currentAppUrl !== null && sameOrigin(status.url, currentAppUrl)) return null;
  return status.url;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}
