export interface DeviceRecord {
  deviceId: string;
  /** Wire field is `name` (`toPublicDevice` in routes/auth.ts); `deviceName` is derived below. */
  name?: string;
  deviceName: string;
  platform: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  scopes: string[];
}

export interface PostureWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface Posture {
  server: { hostId: string; loopbackOnly: boolean; production: boolean };
  authentication: { required: boolean; dpopRequired: boolean; legacyApiKeyActive: boolean };
  secretStore: { kind: string; secure: boolean; reason?: string };
  relay: { enabled: boolean; state: string };
  warnings: PostureWarning[];
}

