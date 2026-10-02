// Pure ServerSwitcher rules (03 MB-20; MD-05, MD-89): what each paired server's row says. Unit-tested.
import type { ConnectionHealth } from '@generatorai/shared';

export type ProbeStatus = 'connected' | 'unpaired' | 'error' | 'offline';

export interface ServerRowState {
  /** ok = reachable / connected; warn = reconnecting; idle = offline (hollow dot). */
  tone: 'ok' | 'warn' | 'idle' | 'err';
  word: string;
  /** Trailing control. */
  trailing: 'check' | 'retry' | 'pair-again' | 'spinner' | 'none';
}

export function activeRow(health: ConnectionHealth): ServerRowState {
  if (health === 'connected') return { tone: 'ok', word: 'Connected', trailing: 'check' };
  if (health === 'reconnecting') return { tone: 'warn', word: 'Reconnecting…', trailing: 'check' };
  return { tone: 'idle', word: 'Offline', trailing: 'check' };
}

/** A paired server that is not the active one, from its last probe (undefined = probing). */
export function otherRow(probe: ProbeStatus | undefined, switching: boolean): ServerRowState {
  if (switching) return { tone: 'warn', word: 'Switching…', trailing: 'spinner' };
  if (probe === undefined) return { tone: 'idle', word: 'Checking…', trailing: 'spinner' };
  if (probe === 'connected') return { tone: 'ok', word: 'Available', trailing: 'none' };
  // A different server answers at the saved address: the credential here is not for it.
  if (probe === 'unpaired') return { tone: 'err', word: 'Pairing changed', trailing: 'pair-again' };
  return { tone: 'idle', word: 'Offline', trailing: 'retry' };
}

/** `http://127.0.0.1:3100` → `local:3100`; scheme and trailing slash dropped (the mono address). */
export function shortAddress(endpoint: string): string {
  return endpoint.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '').replace(/^(localhost|127\.0\.0\.1)(?=:)/, 'local');
}

/** A server on this computer: the host shell says so, or its address is loopback (the simulator / desktop case). */
export function isLocalServer(server: { kind: 'local' | 'remote'; endpoint: string }): boolean {
  if (server.kind === 'local') return true;
  return /^[a-z]+:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(server.endpoint);
}

/** The trigger's second line (MB-20): "This computer" for a local server, otherwise its short address. */
export function serverWhere(server: { kind: 'local' | 'remote'; endpoint: string }): string {
  return isLocalServer(server) ? 'This computer' : shortAddress(server.endpoint);
}
