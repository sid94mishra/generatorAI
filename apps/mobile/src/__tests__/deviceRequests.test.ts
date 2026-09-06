import { describe, expect, it } from 'vitest';
import { revokeDeviceRequest } from '../auth/deviceRequests';

describe('revokeDeviceRequest', () => {
  it('targets the server’s canonical DELETE /api/auth/devices/:id route', () => {
    // The previous shape — POST /devices/:id/revoke — was never registered
    // on the server and 404'd on the one action meant for emergencies.
    const req = revokeDeviceRequest('dev-123');
    expect(req.path).toBe('/api/auth/devices/dev-123');
    expect(req.init.method).toBe('DELETE');
    expect(req.path.endsWith('/revoke')).toBe(false);
  });

  it('carries the reason in a JSON body matching the server’s revokeSchema', () => {
    const req = revokeDeviceRequest('dev-1', 'lost phone');
    expect(req.init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req.init.body)).toEqual({ reason: 'lost phone' });
    expect(JSON.parse(revokeDeviceRequest('dev-1').init.body)).toEqual({ reason: 'Revoked from mobile' });
  });

  it('escapes the device id', () => {
    expect(revokeDeviceRequest('a/b?c').path).toBe('/api/auth/devices/a%2Fb%3Fc');
  });
});
