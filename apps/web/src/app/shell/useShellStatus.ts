// ────────────────────────────────────────────────────────────────
// useShellStatus — the live facts the sidebar, rail and title strip show:
// the active server (switcher second line, strip chip, rail tooltip), the
// connection (footer dot + label + address, rail dot) and the shortcut hints.
// Everything is real or absent: a server that has not loaded yet has no name
// line rather than an invented "This computer" (D-36).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { bindingFor, formatBinding, type RendererCommandId } from '@generatorai/shared/ui-contract';
import type { ConnectionState } from '@/stores/connectionStore.js';
import { useConnectionSummary } from '@/hooks/useConnectionSummary.js';
import { useServers } from '@/hooks/serverQueries.js';
import { commandHost, isMacOS } from '@/lib/desktop.js';

export type ShellTone = 'ok' | 'warn' | 'err';

const CONNECTION: Record<ConnectionState, { label: string; tone: ShellTone }> = {
  connected: { label: 'Connected', tone: 'ok' },
  reconnecting: { label: 'Reconnecting…', tone: 'warn' },
  disconnected: { label: 'Disconnected', tone: 'err' },
};

/** `http://127.0.0.1:3100` → `local:3100`; another host keeps its host[:port]. */
export function displayAddress(url: string): string | undefined {
  try {
    const u = new URL(url);
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (local) return u.port ? `local:${u.port}` : 'local';
    return u.host;
  } catch {
    return undefined;
  }
}

/** One chord's key chips for this host (`['Ctrl','K']`, `['⌘','K']`), or undefined when unbound/a sequence. */
export function shortcutFor(id: RendererCommandId): readonly string[] | undefined {
  const binding = bindingFor(id, commandHost);
  if (!binding) return undefined;
  const chords = formatBinding(binding, commandHost, { mac: isMacOS });
  return chords.length === 1 ? chords[0] : undefined;
}

export interface ShellStatus {
  /** The active server's name; undefined until the server list has loaded. */
  serverName?: string;
  /** Its address (`local:3100`); undefined until known. */
  address?: string;
  connection: { label: string; tone: ShellTone; state: ConnectionState };
  /** Events lost to a dropped stream (the footer notice). */
  unrecoverable: number;
  lastGapAt: number | null;
}

export function useShellStatus(): ShellStatus {
  const servers = useServers();
  const summary = useConnectionSummary();
  const active = servers.data?.find((s) => s.active);
  return useMemo(
    () => ({
      ...(active ? { serverName: active.label } : {}),
      ...(active ? withAddress(active.url) : {}),
      connection: { ...CONNECTION[summary.state], state: summary.state },
      unrecoverable: summary.unrecoverable,
      lastGapAt: summary.lastGapAt,
    }),
    [active, summary.state, summary.unrecoverable, summary.lastGapAt],
  );
}

function withAddress(url: string): { address?: string } {
  const address = displayAddress(url);
  return address ? { address } : {};
}
