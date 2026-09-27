import { describe, expect, it, vi } from 'vitest';
import { DeviceService } from '../DeviceService.js';
import { ALL_SCOPES } from '../scopes.js';
import type { PairingError } from '../DeviceService.js';
import { sha256Base64Url } from '../jose.js';
import type {
  DeviceCredentialRecord,
  DeviceRecord,
  IDeviceRepository,
} from '../ports.js';

class MemoryDeviceRepository implements IDeviceRepository {
  readonly credentials: DeviceCredentialRecord[] = [];
  revokeCredentialsCalls = 0;

  constructor(readonly device: DeviceRecord) {}

  async create(): Promise<void> {}
  async findById(deviceId: string): Promise<DeviceRecord | null> {
    return deviceId === this.device.deviceId ? this.device : null;
  }
  async findByThumbprint(): Promise<DeviceRecord | null> { return null; }
  async list(): Promise<DeviceRecord[]> { return [this.device]; }
  async update(_deviceId: string, patch: Partial<Omit<DeviceRecord, 'deviceId'>>): Promise<void> {
    Object.assign(this.device, patch);
  }
  async revoke(): Promise<void> {}
  async touch(): Promise<void> {}
  async createCredential(credential: DeviceCredentialRecord): Promise<void> {
    this.credentials.push(credential);
  }
  async findCredentialByHash(secretHash: string): Promise<DeviceCredentialRecord | null> {
    return this.credentials.find((credential) => credential.secretHash === secretHash) ?? null;
  }
  async listCredentials(): Promise<DeviceCredentialRecord[]> { return [...this.credentials]; }
  async revokeCredentials(): Promise<void> { this.revokeCredentialsCalls += 1; }
  async markCredentialUsed(credentialId: string, at: number): Promise<void> {
    const credential = this.credentials.find((candidate) => candidate.credentialId === credentialId);
    if (credential) credential.lastUsedAt = at;
  }
}

function fixture() {
  const now = Date.now();
  const device: DeviceRecord = {
    deviceId: 'device-1',
    ownerId: 'owner-1',
    name: 'Phone',
    platform: 'mobile',
    publicJwk: '{}',
    jwkThumbprint: 'thumbprint-1',
    scopes: ['read:status'],
    createdAt: now,
    lastSeenAt: null,
    lastSeenTransport: null,
    revokedAt: null,
    revokedReason: null,
    credentialVersion: 1,
    previousCredentialGraceUntil: null,
    connectionMode: 'auto',
    relayBinding: null,
  };
  const devices = new MemoryDeviceRepository(device);
  const secrets = ['resume-v2', 'resume-v2-retry', 'resume-v3'];
  const tokens = {
    createOpaqueCredential: vi.fn(() => {
      const secret = secrets.shift() ?? 'resume-extra';
      return { secret, hash: sha256Base64Url(secret) };
    }),
    mintAccessToken: vi.fn((input: { sessionVersion: number }) => ({
      token: `access-v${input.sessionVersion}`,
      expiresAt: now + 60_000,
      jti: `jti-v${input.sessionVersion}`,
    })),
  };
  const service = new DeviceService({
    devices,
    pairing: {} as never,
    tokens: tokens as never,
    audit: { record: vi.fn() } as never,
  });
  return { now, device, devices, service };
}

describe('DeviceService refresh generation grace', () => {
  it('does not advance the device version when the previous credential is retried', async () => {
    const { now, device, devices, service } = fixture();
    const originalSecret = 'resume-v1';
    devices.credentials.push({
      credentialId: 'credential-v1',
      deviceId: device.deviceId,
      secretHash: sha256Base64Url(originalSecret),
      version: 1,
      createdAt: now,
      expiresAt: now + 60_000,
      lastUsedAt: null,
      revokedAt: null,
    });

    const first = await service.refreshSession({
      resumeSecret: originalSecret,
      keyThumbprint: device.jwkThumbprint,
    });
    expect(first.credentialVersion).toBe(2);
    expect(device.credentialVersion).toBe(2);

    const retry = await service.refreshSession({
      resumeSecret: originalSecret,
      keyThumbprint: device.jwkThumbprint,
    });
    expect(retry.credentialVersion).toBe(2);
    expect(device.credentialVersion).toBe(2);

    const next = await service.refreshSession({
      resumeSecret: retry.resumeSecret,
      keyThumbprint: device.jwkThumbprint,
    });
    expect(next.credentialVersion).toBe(3);
    expect(device.credentialVersion).toBe(3);

    await expect(service.refreshSession({
      resumeSecret: originalSecret,
      keyThumbprint: device.jwkThumbprint,
    })).rejects.toMatchObject<Partial<PairingError>>({ code: 'CREDENTIAL_SUPERSEDED' });
  });

  it('updates live scopes without rotating device credentials', async () => {
    const { device, devices, service } = fixture();
    const versionBefore = device.credentialVersion;
    const scopes = await service.updateDeviceScopes(
      device.deviceId,
      ['read:status', 'read:chats'],
      {
        type: 'service-account',
        id: 'admin',
        displayName: 'Admin',
        scopes: ['read:status', 'read:chats', 'admin:devices'],
        transport: 'loopback',
      },
    );

    expect(scopes).toEqual(['read:chats', 'read:status']);
    expect(device.scopes).toEqual(scopes);
    expect(device.credentialVersion).toBe(versionBefore);
    expect(devices.revokeCredentialsCalls).toBe(0);
  });
});
describe('MCP devices (CONVINV-R9)', () => {
  it('never hold administration or the terminal, whoever grants them', async () => {
    const { device, service } = fixture();
    device.platform = 'mcp';
    const admin = { type: 'local-desktop' as const, id: 'owner', displayName: 'Owner', scopes: [...ALL_SCOPES], transport: 'loopback' as const };
    await expect(service.updateDeviceScopes(device.deviceId, ['exec:agent', 'admin:settings'], admin)).rejects.toMatchObject<Partial<PairingError>>({
      code: 'SCOPE_ESCALATION',
    });
    await expect(service.updateDeviceScopes(device.deviceId, ['exec:agent', 'write:workflows'], admin)).resolves.toEqual(['exec:agent', 'write:workflows']);
  });
});
