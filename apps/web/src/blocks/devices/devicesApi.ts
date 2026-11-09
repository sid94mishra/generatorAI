// ────────────────────────────────────────────────────────────────
// Devices REST transport (docs/devices §5). Every
// `/api/workspaces/:id/devices/*` call the Devices tab makes, in one place:
// plain same-origin `fetch`, like the Browser panel's `browserApi.ts`.
// ────────────────────────────────────────────────────────────────

import type { DeviceInfo, DeviceInputEvent, DeviceSnapshot, DevicesOverview } from '@generatorai/shared';

export interface DevicesListing extends DevicesOverview {
  /** The device this chat has open (the agent's default target). */
  open: string | null;
}

const base = (workspaceId: string): string => `/api/workspaces/${encodeURIComponent(workspaceId)}/devices`;

/** The server's error message, else the status. */
async function failure(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return new Error(body.error.message);
  } catch {
    // not JSON
  }
  return new Error(`Request failed (${res.status})`);
}

async function post<T>(workspaceId: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base(workspaceId)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export async function fetchDevices(workspaceId: string, fresh = false): Promise<DevicesListing> {
  const res = await fetch(`${base(workspaceId)}${fresh ? '?fresh=1' : ''}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as DevicesListing;
}

export function startDevice(workspaceId: string, device: string): Promise<{ device: DeviceInfo }> {
  return post(workspaceId, '/start', { device });
}

export function stopDevice(workspaceId: string, device: string): Promise<{ ok: true }> {
  return post(workspaceId, '/stop', { device });
}

export function setDeviceAccess(workspaceId: string, device: string, allowed: boolean): Promise<{ agentAccess: boolean }> {
  return post(workspaceId, '/access', { device, allowed });
}

/** A hardware key, text or rotate without the live socket. */
export function sendDeviceInput(
  workspaceId: string,
  device: string,
  event: Exclude<DeviceInputEvent, { type: 'touch' } | { type: 'scroll' }>,
): Promise<{ ok: true }> {
  return post(workspaceId, '/input', { device, event });
}

export async function fetchDeviceSnapshot(workspaceId: string, device: string): Promise<DeviceSnapshot> {
  const res = await fetch(`${base(workspaceId)}/snapshot?device=${encodeURIComponent(device)}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as DeviceSnapshot;
}

export async function fetchDeviceScreenshot(workspaceId: string, device: string): Promise<Blob> {
  const res = await fetch(`${base(workspaceId)}/screenshot?device=${encodeURIComponent(device)}`);
  if (!res.ok) throw await failure(res);
  return res.blob();
}

/** The live view socket path (the ticket is added by `buildAuthenticatedSocketUrl`). */
export function deviceStreamPath(workspaceId: string, device: string): string {
  return `${base(workspaceId)}/stream?device=${encodeURIComponent(device)}`;
}
