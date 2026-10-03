// ────────────────────────────────────────────────────────────────
// Self-service view of the calling device (mobile MG-01).
//
// `GET /api/auth/devices/me` — the device reads its OWN record (name,
// platform, current scopes, approval-key state) with only `read:status`.
// The device id comes from the authenticated principal, never from the path
// or the body, so a device can never read another device's row here. Admin
// listing of every device stays under `/auth/devices` (`admin:devices`).
//
// React-free wire type; web, desktop and mobile share it.
// ────────────────────────────────────────────────────────────────

export type SelfDevicePlatform = 'web' | 'desktop' | 'cli' | 'mobile' | 'mcp' | 'other';

export interface SelfDeviceApprovalKey {
  /** ISO timestamp of the registration. */
  createdAt: string;
  /** What unlocks the key on the device (MG-05). */
  presence: 'biometry' | 'passcode';
}

export interface SelfDeviceView {
  deviceId: string;
  name: string;
  platform: SelfDevicePlatform;
  /** The scopes this device holds now (fresher than the copy stored at pairing). */
  scopes: string[];
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; absent before the first authenticated request was recorded. */
  lastSeenAt?: string;
  connectionMode: string;
  credentialVersion: number;
  /** Absent until the device registers its biometric-gated approval key. */
  approvalKey?: SelfDeviceApprovalKey;
}
