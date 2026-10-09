// Shared in-memory fixtures for the pairing tests (F-3, F-5).

import { vi, type Mock } from 'vitest';
import { DeviceService } from '../DeviceService.js';
import { sha256Base64Url } from '../jose.js';
import { ALL_SCOPES } from '../scopes.js';
import type { DevicePlatform, DeviceRecord, IDeviceRepository, IPairingGrantRepository, PairingGrantRecord } from '../ports.js';

export function pairingRepo(): IPairingGrantRepository & { grants: PairingGrantRecord[] } {
  const grants: PairingGrantRecord[] = [];
  return {
    grants,
    create: async (g) => {
      grants.push(g);
    },
    findByHash: async (h) => grants.find((g) => g.tokenHash === h) ?? null,
    consume: async (id, at) => {
      const g = grants.find((x) => x.grantId === id);
      if (!g || g.consumedAt != null) return false;
      g.consumedAt = at;
      return true;
    },
    incrementAttempts: async (id) => {
      const g = grants.find((x) => x.grantId === id)!;
      g.attempts += 1;
      return g.attempts;
    },
    revoke: async () => undefined,
    revokePendingFor: async () => undefined,
    listPending: async () => grants,
    deleteExpired: async () => 0,
  };
}

export function deviceRepo(): IDeviceRepository & { devices: DeviceRecord[] } {
  const devices: DeviceRecord[] = [];
  return {
    devices,
    create: async (d: DeviceRecord) => {
      devices.push(d);
    },
    findById: async (id: string) => devices.find((d) => d.deviceId === id) ?? null,
    findByThumbprint: async () => null,
    list: async () => devices,
    update: async () => undefined,
    revoke: async () => undefined,
    touch: async () => undefined,
    createCredential: async () => undefined,
    findCredentialByHash: async () => null,
    listCredentials: async () => [],
    revokeCredentials: async () => undefined,
    markCredentialUsed: async () => undefined,
  } as unknown as IDeviceRepository & { devices: DeviceRecord[] };
}

export const OWNER = { type: 'service-account' as const, id: 'owner', scopes: [...ALL_SCOPES], transport: 'loopback' as const };

export interface PairingFixture {
  service: DeviceService;
  pairing: ReturnType<typeof pairingRepo>;
  devices: ReturnType<typeof deviceRepo>;
  audit: { record: Mock };
}

export function setup(limits?: { perSource?: number; global?: number }): PairingFixture {
  const pairing = pairingRepo();
  const devices = deviceRepo();
  const audit = { record: vi.fn() };
  const service = new DeviceService({
    devices,
    pairing,
    tokens: {
      // As TokenService does: the stored hash is what preview/complete look up.
      hashOpaque: (v: string) => sha256Base64Url(v),
      createOpaqueCredential: () => ({ secret: 'resume-secret-0123456789', hash: 'h' }),
      mintAccessToken: () => ({ token: 'access', expiresAt: Date.now() + 60_000, jti: 'j' }),
    } as never,
    audit: audit as never,
    ...(limits ? { pairingThrottle: limits } : {}),
  });
  return { service, pairing, devices, audit };
}

export async function mintFindable(service: DeviceService, platform: DevicePlatform = 'mobile'): Promise<string> {
  const grant = await service.createPairingGrant({ deviceNameHint: 'Phone', platform, createdBy: OWNER });
  return grant.pairingToken;
}

