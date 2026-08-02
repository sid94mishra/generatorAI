// ────────────────────────────────────────────────────────────────
// Minimal JOSE — JWS sign/verify built on node:crypto.
//
// Deliberately small and strict:
//  - Only `EdDSA` (Ed25519) and `ES256` (P-256) are accepted. `none` and all
//    symmetric algorithms are rejected outright so an attacker cannot downgrade
//    a proof to an algorithm they can forge.
//  - JWK inputs are rejected if they carry private parameters.
//  - RFC 7638 thumbprints use the canonical required-member ordering.
//
// We intentionally do NOT hand-roll anything cryptographic: signing and
// verification are delegated to node:crypto; this module only does the
// compact-serialization framing and strict validation around it.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';

export type JwsAlg = 'EdDSA' | 'ES256';

export interface PublicJwk {
  kty: 'OKP' | 'EC';
  crv: 'Ed25519' | 'P-256';
  x: string;
  y?: string;
  alg?: string;
  use?: string;
  kid?: string;
  [k: string]: unknown;
}

/** Private JWK members that must never appear in a client-supplied key. */
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'] as const;

export class JoseError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'JoseError';
  }
}

export function base64url(input: Buffer | Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64url');
}

export function base64urlDecode(input: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) {
    throw new JoseError('Value is not base64url', 'INVALID_ENCODING');
  }
  return Buffer.from(input, 'base64url');
}

export function jsonBase64url(value: unknown): string {
  return base64url(Buffer.from(JSON.stringify(value), 'utf8'));
}

// ── JWK handling ─────────────────────────────────────────────────

/**
 * Validates a client-supplied public JWK and returns a node KeyObject.
 * Throws when private members are present or the curve is unsupported.
 */
export function importPublicJwk(jwk: unknown): { key: crypto.KeyObject; alg: JwsAlg; jwk: PublicJwk } {
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) {
    throw new JoseError('JWK must be a JSON object', 'INVALID_JWK');
  }
  const record = jwk as Record<string, unknown>;
  for (const member of PRIVATE_JWK_MEMBERS) {
    if (member in record) {
      throw new JoseError(`JWK must not contain the private member "${member}"`, 'PRIVATE_JWK');
    }
  }
  const kty = record['kty'];
  const crv = record['crv'];

  if (kty === 'OKP' && crv === 'Ed25519') {
    assertBase64urlLength(record['x'], 32, 'x');
    const key = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: record['x'] as string } as crypto.JsonWebKey,
      format: 'jwk',
    });
    return { key, alg: 'EdDSA', jwk: { kty: 'OKP', crv: 'Ed25519', x: record['x'] as string } };
  }

  if (kty === 'EC' && crv === 'P-256') {
    assertBase64urlLength(record['x'], 32, 'x');
    assertBase64urlLength(record['y'], 32, 'y');
    const key = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: record['x'] as string,
        y: record['y'] as string,
      } as crypto.JsonWebKey,
      format: 'jwk',
    });
    return {
      key,
      alg: 'ES256',
      jwk: { kty: 'EC', crv: 'P-256', x: record['x'] as string, y: record['y'] as string },
    };
  }

  throw new JoseError(
    'Unsupported JWK: only OKP/Ed25519 and EC/P-256 public keys are accepted',
    'UNSUPPORTED_JWK',
  );
}

function assertBase64urlLength(value: unknown, bytes: number, member: string): void {
  if (typeof value !== 'string') {
    throw new JoseError(`JWK member "${member}" must be a string`, 'INVALID_JWK');
  }
  const decoded = base64urlDecode(value);
  if (decoded.length !== bytes) {
    throw new JoseError(
      `JWK member "${member}" must decode to ${bytes} bytes (got ${decoded.length})`,
      'INVALID_JWK',
    );
  }
  // Canonicality: re-encoding must reproduce the input exactly, so two
  // different encodings of the same key cannot yield two different thumbprints.
  if (decoded.toString('base64url') !== value) {
    throw new JoseError(`JWK member "${member}" is not canonically encoded`, 'INVALID_JWK');
  }
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url). */
export function jwkThumbprint(jwk: PublicJwk): string {
  let canonical: string;
  if (jwk.kty === 'OKP') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  } else {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  }
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

// ── Compact JWS ──────────────────────────────────────────────────

export interface DecodedJws {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

/** Splits + JSON-parses a compact JWS WITHOUT verifying it. */
export function decodeJws(token: string): DecodedJws {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JoseError('Compact JWS must have exactly three parts', 'MALFORMED');
  }
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(base64urlDecode(h).toString('utf8'));
    payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  } catch {
    throw new JoseError('JWS header/payload is not valid JSON', 'MALFORMED');
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new JoseError('JWS header must be an object', 'MALFORMED');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new JoseError('JWS payload must be an object', 'MALFORMED');
  }
  return {
    header: header as Record<string, unknown>,
    payload: payload as Record<string, unknown>,
    signingInput: `${h}.${p}`,
    signature: base64urlDecode(s),
  };
}

export function signJws(params: {
  alg: JwsAlg;
  privateKey: crypto.KeyObject;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}): string {
  const header = { ...params.header, alg: params.alg };
  const signingInput = `${jsonBase64url(header)}.${jsonBase64url(params.payload)}`;
  const signature = signBytes(params.alg, params.privateKey, Buffer.from(signingInput, 'utf8'));
  return `${signingInput}.${signature.toString('base64url')}`;
}

export function signBytes(alg: JwsAlg, privateKey: crypto.KeyObject, data: Buffer): Buffer {
  if (alg === 'EdDSA') return crypto.sign(null, data, privateKey);
  return crypto.sign('sha256', data, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
}

export function verifyBytes(
  alg: JwsAlg,
  publicKey: crypto.KeyObject,
  data: Buffer,
  signature: Buffer,
): boolean {
  try {
    if (alg === 'EdDSA') return crypto.verify(null, data, publicKey, signature);
    // ES256 signatures are fixed 64-byte R||S; reject anything else before
    // handing it to OpenSSL so a DER-encoded signature cannot sneak through.
    if (signature.length !== 64) return false;
    return crypto.verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

/** Verifies a compact JWS against a known public key. Returns the payload. */
export function verifyJws(params: {
  token: string;
  publicKey: crypto.KeyObject;
  alg: JwsAlg;
}): Record<string, unknown> {
  const decoded = decodeJws(params.token);
  if (decoded.header['alg'] !== params.alg) {
    throw new JoseError('Unexpected JWS algorithm', 'ALG_MISMATCH');
  }
  const ok = verifyBytes(
    params.alg,
    params.publicKey,
    Buffer.from(decoded.signingInput, 'utf8'),
    decoded.signature,
  );
  if (!ok) throw new JoseError('JWS signature verification failed', 'BAD_SIGNATURE');
  return decoded.payload;
}

// ── Server signing keypair ───────────────────────────────────────

export interface ServerSigningKeyPair {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicJwk: PublicJwk;
  thumbprint: string;
}

/** Generates an Ed25519 keypair for signing access tokens / signed links. */
export function generateServerSigningKeyPair(): { seed: Buffer; pair: ServerSigningKeyPair } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }) as crypto.JsonWebKey & { d?: string };
  const seed = Buffer.from(String(jwk.d), 'base64url');
  return { seed, pair: keyPairFromEd25519Seed(seed) };
}

/** Rebuilds an Ed25519 keypair from its 32-byte seed (as stored in the vault). */
export function keyPairFromEd25519Seed(seed: Buffer): ServerSigningKeyPair {
  if (seed.length !== 32) throw new JoseError('Ed25519 seed must be 32 bytes', 'INVALID_KEY');
  // PKCS#8 prefix for an Ed25519 private key with a 32-byte seed.
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  const privateKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  const raw = publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey;
  const publicJwk: PublicJwk = { kty: 'OKP', crv: 'Ed25519', x: String(raw.x) };
  return { privateKey, publicKey, publicJwk, thumbprint: jwkThumbprint(publicJwk) };
}

/** Timing-safe string comparison for tokens/secrets of arbitrary length. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the "wrong length" path is not obviously faster.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** SHA-256, base64url — the canonical way this codebase hashes opaque tokens. */
export function sha256Base64Url(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

/** Cryptographically random, URL-safe opaque token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
