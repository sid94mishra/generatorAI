// ────────────────────────────────────────────────────────────────
// Terminal REST transport (03-component-inventory-domain.md §6.7).
//
// Every `/api/workspaces/:id/terminals*` call the terminal dock panel makes.
// Plain same-origin `fetch` (cookie auth), exactly as the panel always did;
// `blocks/terminal/useTerminalSession` owns the lifecycle and React state.
// ────────────────────────────────────────────────────────────────

import type { TerminalSessionDescriptor } from '@generatorai/shared';

const base = (workspaceId: string): string => `/api/workspaces/${workspaceId}/terminals`;

/**
 * A sentence a person can act on, from a failed terminal request.
 *
 * A device without `exec:terminal` — the DEFAULT for a paired browser, since
 * `DEFAULT_DEVICE_SCOPES` withholds it deliberately — is the most common way
 * to see this error, so it names the grant instead of pasting the raw body.
 */
export async function terminalErrorMessage(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return 'This device isn’t allowed to open a terminal. Grant it in Settings → Security → Devices on a device that is already connected.';
  }
  const body = await res.text().catch(() => '');
  let detail = '';
  try {
    detail = (JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? '';
  } catch {
    // Not the JSON envelope — fall back to a short slice of whatever came back.
    detail = body.slice(0, 140);
  }
  return detail ? `Could not open a terminal: ${detail}` : `Could not open a terminal (${res.status}).`;
}

export async function createTerminalSession(
  workspaceId: string,
  cols: number,
  rows: number,
): Promise<TerminalSessionDescriptor> {
  const res = await fetch(base(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) throw new Error(await terminalErrorMessage(res));
  return (await res.json()) as TerminalSessionDescriptor;
}

/** The live descriptor, or null when the session is gone (404) or unreadable. */
export async function describeTerminalSession(
  workspaceId: string,
  sid: string,
): Promise<TerminalSessionDescriptor | null> {
  const res = await fetch(`${base(workspaceId)}/${sid}`);
  if (!res.ok) return null;
  return (await res.json()) as TerminalSessionDescriptor;
}

export async function fetchTerminalScrollback(workspaceId: string, sid: string): Promise<Uint8Array> {
  const res = await fetch(`${base(workspaceId)}/${sid}/scrollback`);
  if (!res.ok) return new Uint8Array();
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * `keepalive` lets the DELETE finish even when the tab closes or the panel
 * unmounts before the response arrives; otherwise the PTY waits for the idle
 * reaper (~30 min).
 */
export async function killTerminalSession(workspaceId: string, sid: string): Promise<void> {
  await fetch(`${base(workspaceId)}/${sid}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
}

/** The WebSocket path the ticket is minted for (`buildAuthenticatedSocketUrl`). */
export const terminalStreamPath = (workspaceId: string, sid: string): string =>
  `${base(workspaceId)}/${sid}/stream`;
