// ────────────────────────────────────────────────────────────────
// Which names the generated LAN certificate covers (D-110).
//
// Exactly the names another device could use to reach this server, and
// nothing the local CA's name constraints would reject:
//   * every private IPv4 address on a real or virtual adapter (a virtual one
//     costs nothing to include and saves a re-issue when it is the one used);
//   * IPv6 unique-local addresses (fc00::/7) — link-local ones need a zone id
//     no certificate can carry, and global ones are outside the constraints;
//   * `<hostname>.local`, which macOS, iOS, Windows 10+ and most Linux
//     desktops resolve over mDNS, so the address survives a DHCP change;
//   * the loopback names, so `https://localhost:<port>` also works.
// ────────────────────────────────────────────────────────────────

import type { NetworkInterfaces } from '../advertisedEndpoints.js';
import type { CertificateNames } from './certificates.js';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function isUniqueLocalIpv6(address: string): boolean {
  return /^f[cd][0-9a-f]{0,2}:/i.test(address);
}

/**
 * `<hostname>.local`, or null when the OS hostname cannot be a DNS name
 * (spaces, underscores, non-ASCII — Windows allows all three).
 */
export function mdnsHostname(hostname: string): string | null {
  const base = hostname.trim().toLowerCase().replace(/\.local\.?$/, '');
  if (!base || base.includes('.')) {
    // A dotted hostname is already a DNS name in some other zone; the first
    // label is still what mDNS advertises.
    const first = base.split('.')[0] ?? '';
    return DNS_LABEL.test(first) ? `${first}.local` : null;
  }
  return DNS_LABEL.test(base) ? `${base}.local` : null;
}

export function selectCertificateNames(input: {
  hostname: string;
  networkInterfaces: NetworkInterfaces;
}): CertificateNames {
  const ipAddresses = new Set<string>();
  for (const addresses of Object.values(input.networkInterfaces)) {
    for (const address of addresses ?? []) {
      if (address.internal) continue;
      if (address.family === 'IPv4' && isPrivateIpv4(address.address)) ipAddresses.add(address.address);
      if (address.family === 'IPv6' && isUniqueLocalIpv6(address.address)) {
        ipAddresses.add(address.address.split('%')[0]!.toLowerCase());
      }
    }
  }
  const dnsNames = ['localhost'];
  const mdns = mdnsHostname(input.hostname);
  if (mdns) dnsNames.unshift(mdns);
  return {
    dnsNames,
    // Sorted so the same machine on the same network always yields the same
    // set — the re-issue check compares sets, but stable order keeps logs readable.
    ipAddresses: [...[...ipAddresses].sort(), '127.0.0.1', '::1'],
  };
}
