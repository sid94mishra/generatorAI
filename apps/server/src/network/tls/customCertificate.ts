// ────────────────────────────────────────────────────────────────
// Bring-your-own certificate (D-113).
//
// An admin who already has a certificate devices trust — `tailscale cert`,
// mkcert, a company CA — can load it in Settings › Security & devices and the
// server serves it instead of the generated one. Validation happens BEFORE
// anything is stored, so a mistake is an error message in the dialog rather
// than a server that comes back with a certificate no device accepts:
//
//   * the PEM parses, and the bundle contains a certificate matching the key
//     (that one is moved to the front: TLS sends the leaf first);
//   * the key is an unencrypted PEM private key — the server restarts
//     unattended, so there is nobody to type a passphrase;
//   * it is a server certificate, not a CA, and is valid right now;
//   * it covers at least one name this computer answers to — a LAN address,
//     `<hostname>.local`, an advertised URL's host, or a DNS name whose first
//     label is this computer's hostname (how `tailscale cert` names a
//     machine: `<host>.<tailnet>.ts.net`). A certificate for another machine
//     fails here with the names it does cover, so the admin can see why.
// ────────────────────────────────────────────────────────────────

import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';
import { describeCertificate, splitPemCertificates, type CertificateNames, type CertificateSummary } from './certificates.js';

export type CustomCertificateErrorCode =
  | 'INVALID_CERTIFICATE'
  | 'INVALID_KEY'
  | 'ENCRYPTED_KEY'
  | 'KEY_MISMATCH'
  | 'CA_CERTIFICATE'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'NAME_MISMATCH';

export class CustomCertificateError extends Error {
  constructor(
    message: string,
    readonly code: CustomCertificateErrorCode,
  ) {
    super(message);
    this.name = 'CustomCertificateError';
  }
}

export interface ValidatedCustomCertificate {
  /** Leaf first, then whatever intermediates the bundle carried. */
  chainPem: string;
  keyPem: string;
  summary: CertificateSummary;
  /** The names of this computer the certificate covers. */
  coveredNames: string[];
  /**
   * DNS names from the certificate that are not one of the LAN names but do
   * name this computer (`<host>.<tailnet>.ts.net`). Advertised as endpoints so
   * a pairing QR offers them.
   */
  extraHostnames: string[];
}

export const MAX_CERTIFICATE_PEM_BYTES = 64 * 1024;
export const MAX_KEY_PEM_BYTES = 16 * 1024;

function loadKey(keyPem: string): KeyObject {
  try {
    return createPrivateKey({ key: keyPem, format: 'pem' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/passphrase|encrypted/i.test(message) || /ENCRYPTED/.test(keyPem)) {
      throw new CustomCertificateError(
        'The private key is protected by a passphrase. Export it without one (for example `openssl pkey -in key.pem -out plain.pem`).',
        'ENCRYPTED_KEY',
      );
    }
    throw new CustomCertificateError('The private key is not a PEM private key.', 'INVALID_KEY');
  }
}

export function validateCustomCertificate(input: {
  certPem: string;
  keyPem: string;
  /** The names the generated certificate would cover (LAN addresses, `<host>.local`, loopback). */
  lanNames: CertificateNames;
  /** Hosts of operator-configured advertised URLs. */
  advertisedHosts: readonly string[];
  hostname: string;
  now?: number;
  /**
   * False when re-loading a certificate the admin already installed: an
   * IP-only certificate whose address moved is still theirs to replace, and
   * silently swapping it for the generated one would be a surprise.
   */
  requireNameMatch?: boolean;
}): ValidatedCustomCertificate {
  const now = input.now ?? Date.now();
  const pems = splitPemCertificates(input.certPem);
  if (pems.length === 0) {
    throw new CustomCertificateError('No PEM certificate was found. Paste the contents of the .crt/.pem file.', 'INVALID_CERTIFICATE');
  }
  let certs: { pem: string; cert: X509Certificate }[];
  try {
    certs = pems.map((pem) => ({ pem, cert: new X509Certificate(pem) }));
  } catch {
    throw new CustomCertificateError('The certificate could not be parsed.', 'INVALID_CERTIFICATE');
  }

  const key = loadKey(input.keyPem);
  const leafIndex = certs.findIndex(({ cert }) => cert.checkPrivateKey(key));
  if (leafIndex < 0) {
    throw new CustomCertificateError('The private key does not belong to this certificate.', 'KEY_MISMATCH');
  }
  const leaf = certs[leafIndex]!;
  if (leaf.cert.ca) {
    throw new CustomCertificateError('This is a CA certificate. Load the server certificate it issued instead.', 'CA_CERTIFICATE');
  }

  const summary = describeCertificate(leaf.pem);
  if (summary.notAfter <= now) {
    throw new CustomCertificateError(`The certificate expired on ${new Date(summary.notAfter).toISOString().slice(0, 10)}.`, 'EXPIRED');
  }
  if (summary.notBefore > now) {
    throw new CustomCertificateError(
      `The certificate is not valid until ${new Date(summary.notBefore).toISOString().slice(0, 10)}.`,
      'NOT_YET_VALID',
    );
  }

  const candidates = [...new Set([...input.lanNames.dnsNames, ...input.lanNames.ipAddresses, ...input.advertisedHosts])];
  const coveredNames = candidates.filter((name) =>
    isIP(name) ? leaf.cert.checkIP(name) !== undefined : leaf.cert.checkHost(name) !== undefined,
  );
  const hostLabel = input.hostname.trim().toLowerCase().split('.')[0] ?? '';
  const extraHostnames = summary.dnsNames.filter(
    (name) => !name.startsWith('*.') && !candidates.includes(name) && name.split('.')[0] === hostLabel && name.includes('.'),
  );
  if (input.requireNameMatch !== false && coveredNames.length === 0 && extraHostnames.length === 0) {
    const has = [...summary.dnsNames, ...summary.ipAddresses].join(', ') || 'no names';
    throw new CustomCertificateError(
      `This certificate is for ${has}, none of which is this computer. Expected one of: ${candidates.join(', ')}. ` +
        'If devices reach it by another name, set GENERATORAI_ADVERTISED_URL to that address.',
      'NAME_MISMATCH',
    );
  }

  const ordered = [leaf, ...certs.filter((_, index) => index !== leafIndex)];
  return {
    chainPem: ordered.map(({ pem }) => pem.trim()).join('\n') + '\n',
    keyPem: input.keyPem.trim() + '\n',
    summary,
    coveredNames: [...coveredNames, ...extraHostnames],
    extraHostnames,
  };
}
