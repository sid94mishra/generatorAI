import { describe, expect, it } from 'vitest';
import { endpointTrust, isTailscaleOrigin } from '../endpointTrust.js';

describe('endpointTrust (D-125)', () => {
  it('pins the install CA only for names it can certify', () => {
    for (const origin of [
      'https://192.168.1.20:3100',
      'https://10.0.0.5:3100',
      'https://172.20.1.1:3100',
      'https://100.101.102.103:3100',
      'https://127.0.0.1:3100',
      'https://[::1]:3100',
      'https://[fd7a:115c:a1e0::1]:3100',
      'https://studio.local:3100',
      'https://localhost:3100',
    ]) {
      expect(endpointTrust(origin), origin).toBe('install-ca');
    }
  });

  it('verifies everything else with the system store — ts.net included', () => {
    for (const origin of ['https://studio.tail1234.ts.net', 'https://studio.example.com', 'https://8.8.8.8', 'https://172.32.0.1']) {
      expect(endpointTrust(origin), origin).toBe('system');
    }
  });

  it('plain http and garbage are not TLS at all', () => {
    expect(endpointTrust('http://192.168.1.20:3100')).toBe('none');
    expect(endpointTrust('nope')).toBe('none');
  });

  it('recognises Tailscale names', () => {
    expect(isTailscaleOrigin('https://Studio.tail1234.TS.NET')).toBe(true);
    expect(isTailscaleOrigin('https://ts.net.evil.example')).toBe(false);
  });
});
