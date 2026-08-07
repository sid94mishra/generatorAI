// The local admin channel is the ONLY way back in after every admin device is
// lost, and it is also the one route that can mint full-scope pairing material
// without an existing credential. Both properties have to stay true: it must
// work from the machine, and it must be unreachable from anywhere else.

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { hostIdFromPublicKey, toBase64Url } from '@generatorai/relay-protocol';
import { createTestApp } from '../helpers/testApp.js';

const LOCAL_TOKEN = 'local-admin-token-for-tests';

function appWithLocalAdmin(token: string | null) {
  const { app, container } = createTestApp();
  (container as { localAdminToken: string | null }).localAdminToken = token;

  // The offer this route builds is schema-validated, so the identity has to be
  // a real fingerprint rather than the helper's placeholder.
  const publicKey = new Uint8Array(32).fill(5);
  container.security.identity.hostId = hostIdFromPublicKey(publicKey);
  container.security.identity.publicKey = publicKey;
  container.security.identity.publicKeyBase64Url = toBase64Url(publicKey);

  vi.mocked(container.security.devices.createPairingGrant).mockImplementation(async (input) => ({
    grantId: 'grant-recovery',
    pairingToken: '4H7K2M9PXQ3T',
    expiresAt: Date.now() + 5 * 60_000,
    requestedScopes: [...(input.requestedScopes ?? [])],
    deviceNameHint: input.deviceNameHint,
    platform: input.platform,
  }));
  return { app, container };
}

describe('local admin recovery channel', () => {
  it('mints a typeable pairing code for a caller holding the on-disk token', async () => {
    const { app, container } = appWithLocalAdmin(LOCAL_TOKEN);
    const response = await request(app)
      .post('/internal/desktop/pairing')
      .set('authorization', `Bearer ${LOCAL_TOKEN}`)
      .send({ deviceName: 'Recovered device' });

    expect(response.status).toBe(201);
    expect(response.body.shortCode).toBe('4H7K-2M9P-XQ3T');
    // Recovery has to restore administration, or the user is still locked out
    // of the very screen that manages devices.
    const granted = vi.mocked(container.security.devices.createPairingGrant).mock.calls[0]![0]
      .requestedScopes;
    expect(granted).toContain('admin:devices');
  });

  it('rejects a wrong token', async () => {
    const { app, container } = appWithLocalAdmin(LOCAL_TOKEN);
    const response = await request(app)
      .post('/internal/desktop/pairing')
      .set('authorization', 'Bearer not-the-token')
      .send({});

    expect(response.status).toBe(401);
    expect(container.security.devices.createPairingGrant).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    const { app } = appWithLocalAdmin(LOCAL_TOKEN);
    expect((await request(app).post('/internal/desktop/pairing').send({})).status).toBe(401);
  });

  it('stays closed when no local token exists', async () => {
    // Unauthenticated-loopback mode writes no token. The channel must not fall
    // open just because there is nothing configured to compare against.
    const { app } = appWithLocalAdmin(null);
    const response = await request(app)
      .post('/internal/desktop/pairing')
      .set('authorization', 'Bearer anything')
      .send({});

    expect(response.status).toBe(401);
  });

  it('does not distinguish a wrong token from a disabled channel', async () => {
    // A probe must not be able to learn whether recovery is available here.
    const disabled = await request(appWithLocalAdmin(null).app)
      .post('/internal/desktop/pairing')
      .set('authorization', 'Bearer guess')
      .send({});
    const wrong = await request(appWithLocalAdmin(LOCAL_TOKEN).app)
      .post('/internal/desktop/pairing')
      .set('authorization', 'Bearer guess')
      .send({});

    expect(disabled.status).toBe(wrong.status);
    expect(disabled.body).toEqual(wrong.body);
  });
});
