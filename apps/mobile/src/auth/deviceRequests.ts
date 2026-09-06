// ────────────────────────────────────────────────────────────────
// Request shapes for the device-administration routes.
//
// Kept as pure data so the screen cannot drift from the server again: the
// mobile revoke used to POST to `/devices/:id/revoke`, a route the server
// never registered, and the only test that would have caught it needed a
// device. The server's canonical route is `DELETE /api/auth/devices/:id`
// with an optional `{ reason }` body (see apps/server/src/routes/auth.ts,
// `revokeSchema`); `POST …/revoke` is now accepted as an alias too.
// ────────────────────────────────────────────────────────────────

export interface DeviceRequest {
  path: string;
  init: { method: 'DELETE'; headers: Record<string, string>; body: string };
}

export function revokeDeviceRequest(deviceId: string, reason = 'Revoked from mobile'): DeviceRequest {
  return {
    path: `/api/auth/devices/${encodeURIComponent(deviceId)}`,
    init: {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  };
}
