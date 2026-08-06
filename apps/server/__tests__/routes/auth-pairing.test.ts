import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { hostIdFromPublicKey } from '@generatorai/relay-protocol';
import { toBase64Url, decodePairingOffer } from '@generatorai/relay-protocol';
import { formatPairingCode, normalizePairingCode } from '@generatorai/shared';
import { createTestApp } from '../helpers/testApp.js';

/** A canonical 12-character grant, as `DeviceService` now mints. */
const SHORT_CODE = '4H7K2M9PXQ3T';

const originalAdvertisedUrl = process.env['GENERATORAI_ADVERTISED_URL'];
const originalAdvertisedUrls = process.env['GENERATORAI_ADVERTISED_URLS'];

describe('auth pairing endpoint advertisement', () => {
  beforeEach(() => {
    delete process.env['GENERATORAI_ADVERTISED_URL'];
    delete process.env['GENERATORAI_ADVERTISED_URLS'];
  });

  afterEach(() => {
    if (originalAdvertisedUrl === undefined) delete process.env['GENERATORAI_ADVERTISED_URL'];
    else process.env['GENERATORAI_ADVERTISED_URL'] = originalAdvertisedUrl;
    if (originalAdvertisedUrls === undefined) delete process.env['GENERATORAI_ADVERTISED_URLS'];
    else process.env['GENERATORAI_ADVERTISED_URLS'] = originalAdvertisedUrls;
  });

  function appWithPairingGrant() {
    const { app, container } = createTestApp();
    const publicKey = new Uint8Array(32).fill(7);
    container.security.identity.hostId = hostIdFromPublicKey(publicKey);
    container.security.identity.publicKey = publicKey;
    container.security.identity.publicKeyBase64Url = toBase64Url(publicKey);
    vi.mocked(container.security.devices.createPairingGrant).mockImplementation(async (input) => ({
      grantId: 'grant-1',
      pairingToken: SHORT_CODE,
      expiresAt: Date.now() + 5 * 60_000,
      requestedScopes: [...(input.requestedScopes ?? [])],
      deviceNameHint: input.deviceNameHint,
      platform: input.platform,
    }));
    return { app, container };
  }

  it('rejects mobile pairing when only loopback is reachable', async () => {
    const { app, container } = appWithPairingGrant();
    const response = await request(app).post('/api/auth/pair').send({
      deviceName: 'Phone',
      platform: 'mobile',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_REACHABLE_ENDPOINT');
    expect(container.security.devices.createPairingGrant).not.toHaveBeenCalled();
  });

  it('returns a decodable version 2 offer with the configured endpoint first', async () => {
    process.env['GENERATORAI_ADVERTISED_URLS'] =
      'https://host.example.test,http://192.168.1.20:3100';
    const { app } = appWithPairingGrant();
    const response = await request(app).post('/api/auth/pair').send({
      deviceName: 'Phone',
      platform: 'mobile',
    });

    expect(response.status).toBe(201);
    const decoded = decodePairingOffer(response.body.pairingCode);
    expect(decoded.ok).toBe(true);
    expect(decoded.offer?.v).toBe(2);
    expect(decoded.offer?.endpoint).toBe('https://host.example.test');
    expect(decoded.offer?.endpoints?.map((endpoint) => endpoint.origin)).toEqual([
      'https://host.example.test',
      'http://192.168.1.20:3100',
      'http://127.0.0.1:0',
    ]);
    expect(decoded.offer?.transportCapabilities).toEqual(['loopback', 'lan']);
  });

  it('returns a short typeable code alongside the QR offer', async () => {
    process.env['GENERATORAI_ADVERTISED_URLS'] = 'http://192.168.1.20:3100';
    const { app } = appWithPairingGrant();
    const response = await request(app).post('/api/auth/pair').send({
      deviceName: 'Phone',
      platform: 'mobile',
    });

    expect(response.status).toBe(201);
    // The joining device needs exactly two things, and both are top-level in
    // the response so the UI never has to decode the offer blob to show them.
    expect(response.body.joinUrl).toBe('http://192.168.1.20:3100');
    expect(response.body.shortCode).toBe(formatPairingCode(SHORT_CODE));
    expect(response.body.shortCode).toHaveLength(14); // 12 chars + 2 dashes

    // The short code and the QR offer are the SAME grant, not two credentials.
    const decoded = decodePairingOffer(response.body.pairingCode);
    expect(normalizePairingCode(response.body.shortCode)).toBe(decoded.offer?.pairingGrant);
  });

  it('rejects relay pairing while the client transport is unavailable', async () => {
    process.env['GENERATORAI_ADVERTISED_URL'] = 'http://192.168.1.20:3100';
    const { app, container } = appWithPairingGrant();
    const response = await request(app).post('/api/auth/pair').send({
      deviceName: 'Phone',
      platform: 'mobile',
      includeRelay: true,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RELAY_CLIENT_UNAVAILABLE');
    expect(container.security.devices.createPairingGrant).not.toHaveBeenCalled();
  });
});