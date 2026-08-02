// ────────────────────────────────────────────────────────────────
// Device key + DPoP proof generation (client side).
//
// The device key is the root of a client's identity: it is what makes an
// access token *sender-constrained* (RFC 9449), so a stolen token is useless
// without it. Two rules follow from that:
//
//   1. The key must be non-extractable wherever the platform allows it
//      (WebCrypto `extractable: false`, Secure Enclave, Android Keystore).
//      An XSS that can read a token still cannot exfiltrate the key.
//   2. Only the PUBLIC half is ever serialized.
//
// ES256 (P-256) is used rather than Ed25519 because WebCrypto support for
// Ed25519 is still uneven across browsers and React Native, while P-256 is
// universally available. The server accepts both.
// ────────────────────────────────────────────────────────────────

export interface PublicJwk {
  kty: string;
  crv: string;
  x: string;
  y?: string;
}

/** A device signing key. `sign` is the only capability callers get. */
export interface DeviceKey {
  publicJwk: PublicJwk;
  /** RFC 7638 thumbprint of `publicJwk`. */
  thumbprint: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Platform storage for the device key. Web/Electron store a non-extractable
 * `CryptoKeyPair` in IndexedDB; the CLI stores a PKCS#8 blob in the OS vault;
 * mobile uses the platform keystore.
 */
export interface DeviceKeyStore {
  load(): Promise<DeviceKey | null>;
  create(): Promise<DeviceKey>;
  clear(): Promise<void>;
}

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto is unavailable; cannot create a device key');
  }
  return c.subtle;
};

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = typeof btoa === 'function' ? btoa(binary) : bufferToBase64(bytes);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bufferToBase64(bytes: Uint8Array): string {
  // Node fallback — avoids a hard dependency on `Buffer` typings in the
  // browser build while still working in the CLI.
  const B = (globalThis as { Buffer?: { from(a: Uint8Array): { toString(e: string): string } } })
    .Buffer;
  if (!B) throw new Error('No base64 encoder available in this runtime');
  return B.from(bytes).toString('base64');
}

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  // Explicit ArrayBuffer copy: TS 5.7 narrows `Uint8Array` to
  // `Uint8Array<ArrayBufferLike>`, which WebCrypto's `BufferSource` rejects
  // because it could be a SharedArrayBuffer.
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  out.set(encoded);
  return out as Uint8Array<ArrayBuffer>;
}

export function base64urlJson(value: unknown): string {
  return base64url(utf8(JSON.stringify(value)));
}

/** RFC 7638 thumbprint. Member order is fixed by the spec — do not reorder. */
export async function jwkThumbprint(jwk: PublicJwk): Promise<string> {
  const canonical =
    jwk.kty === 'OKP'
      ? JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })
      : JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await subtle().digest('SHA-256', utf8(canonical));
  return base64url(new Uint8Array(digest));
}
/** Wraps a WebCrypto P-256 key pair as a `DeviceKey`. */
export async function deviceKeyFromCryptoKeyPair(pair: CryptoKeyPair): Promise<DeviceKey> {
  const raw = (await subtle().exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const publicJwk: PublicJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: String(raw.x),
    y: String(raw.y),
  };
  return {
    publicJwk,
    thumbprint: await jwkThumbprint(publicJwk),
    async sign(data: Uint8Array): Promise<Uint8Array> {
      const signature = await subtle().sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        data as unknown as ArrayBuffer,
      );
      // WebCrypto already returns the raw r||s form ES256 requires.
      return new Uint8Array(signature);
    },
  };
}

/** Generates a NON-EXTRACTABLE P-256 key pair. */
export async function generateDeviceKeyPair(extractable = false): Promise<CryptoKeyPair> {
  return (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

export interface DpopProofParams {
  key: DeviceKey;
  method: string;
  /** Full request URL. Query and fragment are stripped for `htu`. */
  url: string;
  /** Present for protected-resource requests; produces the `ath` claim. */
  accessToken?: string | undefined;
  /** Server-supplied nonce, echoed back when the server demands one. */
  nonce?: string | undefined;
}

/**
 * Builds a compact-JWS DPoP proof.
 *
 * `htu` MUST be the canonical URL without query/fragment, and `ath` MUST be
 * the SHA-256 of the access token — otherwise the server rejects the proof.
 */
export async function createDpopProof(params: DpopProofParams): Promise<string> {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: params.key.publicJwk,
  };
  const payload: Record<string, unknown> = {
    jti: randomJti(),
    htm: params.method.toUpperCase(),
    htu: canonicalHtu(params.url),
    iat: Math.floor(Date.now() / 1000),
  };
  if (params.accessToken) {
    payload['ath'] = await sha256Base64Url(params.accessToken);
  }
  if (params.nonce) payload['nonce'] = params.nonce;

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = await params.key.sign(utf8(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

export function canonicalHtu(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString();
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', utf8(value));
  return base64url(new Uint8Array(digest));
}

function randomJti(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new Error('No CSPRNG available in this runtime');
  c.getRandomValues(bytes);
  return base64url(bytes);
}
