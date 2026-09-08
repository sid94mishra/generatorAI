// ────────────────────────────────────────────────────────────────
// DeviceService scope requests (mobile standalone plan S2).
//
// A phone asks for more than DEFAULT_MOBILE_SCOPES; an admin:devices holder
// answers. The rules under test are the ones that make the flow safe rather
// than merely functional: admin:* is never requestable from a non-admin
// device, one pending request per device, approval is clamped to the
// approver's own authority, and two admins answering at once produce one
// grant.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { DeviceService, PairingError, ScopeRequestError } from '../DeviceService.js';
import { MemoryDeviceScopeRequestRepository } from '../memoryStores.js';
import { DEFAULT_MOBILE_SCOPES, STANDALONE_MOBILE_SCOPES } from '../scopes.js';
import type { Principal } from '../principals.js';
import type { DeviceCredentialRecord, DeviceRecord, IDeviceRepository } from '../ports.js';

class MemoryDeviceRepository implements IDeviceRepository {
  readonly devices = new Map<string, DeviceRecord>();

  add(device: DeviceRecord): void {
    this.devices.set(device.deviceId, device);
  }
  async create(device: DeviceRecord): Promise<void> {
    this.add(device);
  }
  async findById(deviceId: string): Promise<DeviceRecord | null> {
    return this.devices.get(deviceId) ?? null;
  }
  async findByThumbprint(): Promise<DeviceRecord | null> {
    return null;
  }
  async list(): Promise<DeviceRecord[]> {
    return [...this.devices.values()];
  }
  async update(deviceId: string, patch: Partial<Omit<DeviceRecord, 'deviceId'>>): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) Object.assign(device, patch);
  }
  async revoke(deviceId: string, reason: string, at: number): Promise<void> {
    await this.update(deviceId, { revokedAt: at, revokedReason: reason });
  }
  async touch(): Promise<void> {}
  async createCredential(_c: DeviceCredentialRecord): Promise<void> {}
  async findCredentialByHash(): Promise<DeviceCredentialRecord | null> {
    return null;
  }
  async listCredentials(): Promise<DeviceCredentialRecord[]> {
    return [];
  }
  async revokeCredentials(): Promise<void> {}
  async markCredentialUsed(): Promise<void> {}
}

function device(deviceId: string, scopes: DeviceRecord['scopes']): DeviceRecord {
  return {
    deviceId,
    ownerId: 'local',
    name: `Device ${deviceId}`,
    platform: 'mobile',
    publicJwk: '{}',
    jwkThumbprint: `tp-${deviceId}`,
    scopes: [...scopes],
    createdAt: 1,
    lastSeenAt: null,
    lastSeenTransport: null,
    revokedAt: null,
    revokedReason: null,
    credentialVersion: 1,
    previousCredentialGraceUntil: null,
    connectionMode: 'auto',
    relayBinding: null,
  };
}

function devicePrincipal(d: DeviceRecord): Principal {
  return {
    type: 'paired-device',
    id: d.deviceId,
    deviceId: d.deviceId,
    displayName: d.name,
    scopes: d.scopes,
    transport: 'lan',
  };
}

const ADMIN: Principal = {
  type: 'local-desktop',
  id: 'local',
  displayName: 'Desktop',
  scopes: [...STANDALONE_MOBILE_SCOPES, 'admin:devices', 'admin:settings'],
  transport: 'loopback',
};

function fixture() {
  const devices = new MemoryDeviceRepository();
  const phone = device('phone', DEFAULT_MOBILE_SCOPES);
  devices.add(phone);
  const audit = { record: vi.fn() };
  const scopeRequests = new MemoryDeviceScopeRequestRepository();
  const service = new DeviceService({
    devices,
    pairing: {} as never,
    tokens: {} as never,
    audit: audit as never,
    scopeRequests,
  });
  return { devices, phone, audit, scopeRequests, service };
}

describe('DeviceService.requestScopes', () => {
  it('records only the scopes the device does not already hold, at warn severity', async () => {
    const { phone, service, audit } = fixture();
    const request = await service.requestScopes({
      principal: devicePrincipal(phone),
      scopes: ['exec:terminal', 'read:chats', 'write:files'],
      reason: 'need the terminal',
    });
    expect(request.status).toBe('pending');
    expect(request.requestedScopes).toEqual(['exec:terminal', 'write:files']);
    expect(request.reason).toBe('need the terminal');
    const audited = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'device.scope_requested',
    )?.[0] as { severity: string; metadata: { scopes: string[] } };
    expect(audited.severity).toBe('warn');
    expect(audited.metadata.scopes).toEqual(['exec:terminal', 'write:files']);
  });

  it('rejects unknown scopes and a request for nothing new', async () => {
    const { phone, service } = fixture();
    await expect(
      service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:root'] }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SCOPE' });
    await expect(
      service.requestScopes({ principal: devicePrincipal(phone), scopes: ['read:chats'] }),
    ).rejects.toMatchObject({ code: 'SCOPES_ALREADY_HELD' });
  });

  it('refuses admin:* from a non-admin device, but not from one that is already admin', async () => {
    const { devices, phone, service } = fixture();
    await expect(
      service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal', 'admin:devices'] }),
    ).rejects.toMatchObject({ code: 'SCOPE_NOT_REQUESTABLE' });

    const adminPhone = device('admin-phone', [...DEFAULT_MOBILE_SCOPES, 'admin:devices']);
    devices.add(adminPhone);
    const request = await service.requestScopes({
      principal: devicePrincipal(adminPhone),
      scopes: ['admin:settings'],
    });
    expect(request.requestedScopes).toEqual(['admin:settings']);
  });

  it('allows one pending request per device and returns the open one on conflict', async () => {
    const { phone, service } = fixture();
    const first = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] });
    const err = await service
      .requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:browser'] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScopeRequestError);
    expect((err as ScopeRequestError).code).toBe('REQUEST_PENDING');
    expect((err as ScopeRequestError).existing?.requestId).toBe(first.requestId);
  });

  it('refuses a revoked device', async () => {
    const { devices, phone, service } = fixture();
    await devices.revoke(phone.deviceId, 'lost', Date.now());
    await expect(
      service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] }),
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
  });

  it('answers UNAVAILABLE when no store is wired', async () => {
    const { devices, phone } = fixture();
    const service = new DeviceService({
      devices,
      pairing: {} as never,
      tokens: {} as never,
      audit: { record: vi.fn() } as never,
    });
    await expect(
      service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('DeviceService.approveScopeRequest / denyScopeRequest / cancelScopeRequest', () => {
  it('approves a subset, updates the device, and audits the high-risk grant as critical', async () => {
    const { phone, service, audit, scopeRequests } = fixture();
    const request = await service.requestScopes({
      principal: devicePrincipal(phone),
      scopes: ['exec:terminal', 'exec:browser', 'write:files'],
    });

    const result = await service.approveScopeRequest({
      requestId: request.requestId,
      principal: ADMIN,
      scopes: ['exec:terminal', 'write:files'],
    });
    expect(result.request.status).toBe('approved');
    expect(result.request.grantedScopes).toEqual(['exec:terminal', 'write:files']);
    expect(result.request.resolvedBy).toBe('local-desktop:local');
    expect(phone.scopes).toContain('exec:terminal');
    expect(phone.scopes).toContain('write:files');
    expect(phone.scopes).not.toContain('exec:browser');
    expect(result.deviceScopes).toEqual(phone.scopes);
    expect(await scopeRequests.findPendingByDevice(phone.deviceId)).toBeNull();

    const actions = audit.record.mock.calls.map((c) => c[0] as { action: string; severity?: string; metadata?: unknown });
    const critical = actions.find(
      (a) => a.action === 'device.scopes_changed' && a.severity === 'critical',
    );
    expect(critical?.metadata).toMatchObject({ highRiskGranted: ['exec:terminal'] });
    expect(actions.some((a) => a.action === 'device.scope_request_resolved')).toBe(true);
  });

  it('defaults to granting everything requested', async () => {
    const { phone, service } = fixture();
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['write:files'] });
    const result = await service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN });
    expect(result.request.grantedScopes).toEqual(['write:files']);
    expect(phone.scopes).toContain('write:files');
  });

  it('rejects a grant outside the request, and an empty grant', async () => {
    const { phone, service } = fixture();
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['write:files'] });
    await expect(
      service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN, scopes: ['exec:terminal'] }),
    ).rejects.toMatchObject({ code: 'NOT_IN_REQUEST' });
    await expect(
      service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN, scopes: [] }),
    ).rejects.toMatchObject({ code: 'NOT_IN_REQUEST' });
    expect((await service.getScopeRequest(request.requestId))?.status).toBe('pending');
  });

  it('cannot grant beyond the approver, and leaves the request pending when it refuses', async () => {
    const { phone, service } = fixture();
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] });
    const weakAdmin: Principal = {
      ...ADMIN,
      scopes: [...DEFAULT_MOBILE_SCOPES, 'admin:devices'],
    };
    const err = await service
      .approveScopeRequest({ requestId: request.requestId, principal: weakAdmin })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PairingError);
    expect((err as PairingError).code).toBe('SCOPE_ESCALATION');
    expect((await service.getScopeRequest(request.requestId))?.status).toBe('pending');
    expect(phone.scopes).not.toContain('exec:terminal');
  });

  it('lets exactly one of two concurrent approvals win', async () => {
    const { phone, service } = fixture();
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] });
    const outcomes = await Promise.allSettled([
      service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN }),
      service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as ScopeRequestError).code).toBe('NOT_PENDING');
  });

  it('denies with a note and leaves the device untouched', async () => {
    const { phone, service } = fixture();
    const before = [...phone.scopes];
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] });
    const denied = await service.denyScopeRequest({ requestId: request.requestId, principal: ADMIN, note: 'not on this network' });
    expect(denied.status).toBe('denied');
    expect(denied.resolutionNote).toBe('not on this network');
    expect(denied.grantedScopes).toBeNull();
    expect(phone.scopes).toEqual(before);
    await expect(
      service.approveScopeRequest({ requestId: request.requestId, principal: ADMIN }),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' });
  });

  it('lets the requesting device cancel its own pending request, and nobody else', async () => {
    const { devices, phone, service } = fixture();
    const other = device('other', DEFAULT_MOBILE_SCOPES);
    devices.add(other);
    const request = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:terminal'] });

    await expect(
      service.cancelScopeRequest(request.requestId, devicePrincipal(other)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const cancelled = await service.cancelScopeRequest(request.requestId, devicePrincipal(phone));
    expect(cancelled.status).toBe('cancelled');
    await expect(
      service.cancelScopeRequest(request.requestId, devicePrincipal(phone)),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' });

    // Cancelling frees the one-pending slot.
    const again = await service.requestScopes({ principal: devicePrincipal(phone), scopes: ['exec:browser'] });
    expect(again.status).toBe('pending');
    const mine = await service.listScopeRequestsForDevice(phone.deviceId);
    expect(mine.map((r) => r.status)).toEqual(['pending', 'cancelled']);
  });

  it('404s an unknown request id', async () => {
    const { service } = fixture();
    await expect(
      service.approveScopeRequest({ requestId: 'nope', principal: ADMIN }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.denyScopeRequest({ requestId: 'nope', principal: ADMIN }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
