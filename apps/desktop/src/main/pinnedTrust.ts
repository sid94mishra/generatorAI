// ────────────────────────────────────────────────────────────────
// The desktop app as a client of ANOTHER machine's server (G-4, D-126).
//
// A GeneratorAI server on the LAN serves a leaf issued by its own per-install
// CA (D-110). No public CA can certify a private address, so Chromium refuses
// it and the window used to show a dead page. Now the app pins that server's
// CA when the user pairs — from the pairing offer's `certificateFingerprint`
// (the QR / pasted code vouches for it) or, for a typed address, after a
// "trust this server?" step showing the fingerprint to compare — and accepts
// exactly that CA for exactly that server's host:
//
//   session.setCertificateVerifyProc → 0 (accept) only when the presented
//   leaf (a) chains to the pinned CA by signature — the CA's own DER hashing
//   to the pin — (b) is valid now, (c) is not itself a CA, and (d) names the
//   host being verified; otherwise -3 (Chromium's own verdict). A ts.net or
//   any publicly trusted server never reaches the pin (Chromium already says
//   OK), and a pin never vouches for another host: no per-hostname blanket
//   trust, no "accept anything on this address".
//
// Pure (node:crypto / node:tls only, no Electron) so it is unit-tested.
// ────────────────────────────────────────────────────────────────

import { createHash, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import * as tls from 'node:tls';

export interface PinnedCa {
  /** SHA-256 of the CA certificate's DER, base64url — the pairing offer's `certificateFingerprint` format. */
  sha256: string;
  /** The CA certificate (public), kept so the leaf's signature can be checked against it. */
  pem: string;
  trustedAt: number;
}

export interface PinnedServer {
  /** The server's canonical origin (`https://192.168.1.20:3100`). */
  url: string;
  pinnedCa?: PinnedCa;
}

/** Chromium's `setCertificateVerifyProc` verdicts. */
export const VERIFY_ACCEPT = 0;
export const VERIFY_USE_CHROMIUM = -3;

function derOf(pem: string): Buffer {
  return new X509Certificate(pem).raw;
}

export function sha256Base64Url(der: Buffer): string {
  return createHash('sha256').update(der).digest('base64url');
}

/** `B5:54:1C…` — the colon hex a browser's certificate viewer and Settings show. */
export function sha256Hex(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g)!.join(':');
}

/** base64url SHA-256 → `B5 54 1C 3C …` (all 32 bytes, in pairs) for reading aloud. */
export function base64UrlToPairs(value: string): string {
  return Buffer.from(value, 'base64url').toString('hex').toUpperCase().match(/.{2}/g)?.join(' ') ?? value;
}

/** The pin for a CA certificate in PEM. */
export function pinForCa(pem: string, now: number = Date.now()): PinnedCa {
  return { sha256: sha256Base64Url(derOf(pem)), pem: new X509Certificate(pem).toString(), trustedAt: now };
}

function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

function hostOf(url: string): string | null {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** True when `leafPem` is a currently valid server certificate for `hostname`, signed by `pin`'s CA. */
export function leafMatchesPin(leafPem: string, hostname: string, pin: PinnedCa, now: number = Date.now()): boolean {
  try {
    const ca = new X509Certificate(pin.pem);
    // The stored CA must still be the one pinned (a tampered settings file
    // cannot swap in another CA under the same fingerprint).
    if (sha256Base64Url(ca.raw) !== pin.sha256) return false;
    if (!ca.ca) return false;
    const leaf = new X509Certificate(leafPem);
    if (leaf.ca) return false;
    if (!leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) return false;
    const notBefore = Date.parse(leaf.validFrom);
    const notAfter = Date.parse(leaf.validTo);
    if (!(notBefore <= now && now <= notAfter)) return false;
    const host = bareHost(hostname);
    return isIP(host) !== 0 ? leaf.checkIP(host) !== undefined : leaf.checkHost(host) !== undefined;
  } catch {
    return false;
  }
}

export interface VerifyRequest {
  hostname: string;
  /** Chromium's own result, `net::OK` when the system store already trusts it. */
  verificationResult: string;
  /** The presented leaf, PEM (`Electron.Certificate.data`). */
  certificatePem: string;
}

/**
 * The verdict for one TLS verification in the app's session. Chromium's OK
 * is kept (-3 → it accepts); otherwise accept only a leaf that matches the pin
 * of a saved server whose host is the one being verified.
 */
export function verifyWithPins(request: VerifyRequest, servers: readonly PinnedServer[], now: number = Date.now()): number {
  if (request.verificationResult === 'net::OK') return VERIFY_USE_CHROMIUM;
  const host = bareHost(request.hostname);
  for (const server of servers) {
    if (!server.pinnedCa || hostOf(server.url) !== host) continue;
    if (leafMatchesPin(request.certificatePem, host, server.pinnedCa, now)) return VERIFY_ACCEPT;
  }
  return VERIFY_USE_CHROMIUM;
}

// ── Looking at a server before trusting it ─────────────────────────

export interface InspectedCertificate {
  /** The system (Node) trust store accepts it for this host — a ts.net or other public certificate. */
  systemTrusted: boolean;
  leafPem: string;
  /** Colon hex SHA-256 of the leaf: what that server's Settings › HTTPS certificate shows. */
  leafSha256Hex: string;
  /** The CA in the presented chain that signed the leaf, when there is one. */
  caPem: string | null;
  /** base64url SHA-256 of that CA — compared with the offer's `certificateFingerprint`. */
  caSha256: string | null;
}

function toPem(der: Buffer): string {
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Opens one TLS connection to `origin` WITHOUT trusting it, and reports what
 * it presented. Nothing is sent over it; the caller decides trust from the
 * result (the offer's fingerprint, or the user comparing it).
 */
export function inspectServerCertificate(origin: string, timeoutMs = 6_000): Promise<InspectedCertificate> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      reject(new Error(`Not a valid address: ${origin}`));
      return;
    }
    const host = bareHost(url.hostname);
    const port = Number(url.port || 443);
    const socket = tls.connect({
      host,
      port,
      ...(isIP(host) === 0 ? { servername: host } : {}),
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
    const fail = (err: Error): void => {
      socket.destroy();
      reject(err);
    };
    socket.once('timeout', () => fail(new Error(`${origin} did not answer within ${Math.round(timeoutMs / 1000)} s.`)));
    socket.once('error', (err) => fail(new Error(`${origin} could not be reached over HTTPS: ${err.message}`)));
    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate(true);
        if (!peer?.raw) throw new Error('The server presented no certificate.');
        const leafPem = toPem(peer.raw);
        const leaf = new X509Certificate(peer.raw);
        let caPem: string | null = null;
        // Walk the presented chain for the certificate that signed the leaf.
        let cursor = peer.issuerCertificate;
        for (let depth = 0; cursor?.raw && depth < 5; depth += 1) {
          const candidate = new X509Certificate(cursor.raw);
          if (candidate.ca && leaf.checkIssued(candidate) && leaf.verify(candidate.publicKey)) {
            caPem = toPem(cursor.raw);
            break;
          }
          if (cursor.issuerCertificate === cursor) break;
          cursor = cursor.issuerCertificate;
        }
        resolve({
          systemTrusted: socket.authorized === true,
          leafPem,
          leafSha256Hex: sha256Hex(peer.raw),
          caPem,
          caSha256: caPem ? sha256Base64Url(derOf(caPem)) : null,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        socket.end();
      }
    });
  });
}

/**
 * GET `<origin>/api/auth/server-info` over TLS, trusting exactly `caPem` —
 * checked with the same rule as the verify proc (`leafMatchesPin`), not
 * OpenSSL's chain builder, which rejects the D-110 CA's name-constraint
 * encoding — or the system store when `caPem` is null.
 */
export function fetchServerInfo(origin: string, caPem: string | null, timeoutMs = 6_000): Promise<{ serverId?: string; serverName?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/auth/server-info', origin);
    const host = bareHost(url.hostname);
    const pin = caPem ? pinForCa(caPem) : null;
    const socket = tls.connect({
      host,
      port: Number(url.port || 443),
      ...(isIP(host) === 0 ? { servername: host } : {}),
      ...(pin ? { rejectUnauthorized: false } : {}),
      timeout: timeoutMs,
    });
    let raw = '';
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timed out'));
    });
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      if (pin) {
        const peer = socket.getPeerCertificate();
        if (!peer?.raw || !leafMatchesPin(toPem(peer.raw), host, pin)) {
          socket.destroy();
          reject(new Error('the certificate is not from the pinned certificate authority'));
          return;
        }
      }
      socket.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
      if (raw.length > 256 * 1024) socket.destroy(new Error('response too large'));
    });
    socket.once('end', () => {
      const [head = '', ...rest] = raw.split('\r\n\r\n');
      if (!/^HTTP\/1\.[01] 200/.test(head)) {
        reject(new Error(head.split('\r\n')[0] || 'no response'));
        return;
      }
      let body = rest.join('\r\n\r\n');
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        let out = '';
        let index = 0;
        while (index < body.length) {
          const lineEnd = body.indexOf('\r\n', index);
          const size = Number.parseInt(body.slice(index, lineEnd), 16);
          if (!size) break;
          out += body.slice(lineEnd + 2, lineEnd + 2 + size);
          index = lineEnd + 2 + size + 2;
        }
        body = out;
      }
      try {
        resolve(JSON.parse(body) as { serverId?: string; serverName?: string });
      } catch {
        reject(new Error('server-info was not JSON'));
      }
    });
  });
}
