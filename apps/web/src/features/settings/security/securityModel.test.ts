import { describe, expect, it } from 'vitest';
import { browserAddressFor, joinAddress, shortCertificateFingerprint } from './securityModel.js';

describe('addresses other devices open (D-110)', () => {
  it('keeps the server’s https:// endpoint when this page is served by the server', () => {
    expect(browserAddressFor('https://192.168.1.20:3100', 'http://127.0.0.1:3100')).toBe('https://192.168.1.20:3100');
    expect(joinAddress('https://192.168.1.20:3100', 'http://127.0.0.1:3100')).toBe('https://192.168.1.20:3100');
  });

  it('keeps the native lane for a mobile grant', () => {
    expect(joinAddress('http://192.168.1.20:3100', 'http://127.0.0.1:3100')).toBe('http://192.168.1.20:3100');
  });

  it('on the dev server, takes only the host from the endpoint', () => {
    expect(browserAddressFor('https://192.168.1.20:3100', 'https://localhost:5173')).toBe('https://192.168.1.20:5173');
  });

  it('keeps a Tailscale (default-port) address as it is, wherever the page is served (D-123)', () => {
    expect(joinAddress('https://studio.tail1234.ts.net', 'http://127.0.0.1:3100')).toBe('https://studio.tail1234.ts.net');
    expect(browserAddressFor('https://studio.tail1234.ts.net', 'http://localhost:5173')).toBe('https://studio.tail1234.ts.net');
  });
});

describe('shortCertificateFingerprint', () => {
  it('shows the first 8 bytes in pairs, as browsers print them', () => {
    const fp = '3F:A9:1C:07:88:2B:D4:E1:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77';
    expect(shortCertificateFingerprint(fp)).toBe('3F A9 1C 07 88 2B D4 E1 …');
    expect(shortCertificateFingerprint('ab:cd')).toBe('AB CD');
  });
});
