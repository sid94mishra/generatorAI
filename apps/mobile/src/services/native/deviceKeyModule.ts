// ────────────────────────────────────────────────────────────────
// GeneratorAIDeviceKey — hardware-backed P-256 signing.
//
// Thin JS facade over the local Expo module in
// `apps/mobile/modules/generatorai-device-key/`. Everything is optional:
// when the module is absent (Expo Go, a web build, a dev client built
// before the module existed) every call resolves to "unsupported" and
// `MobileDeviceKeyStore` degrades to a software key rather than crashing —
// and reports that it did (`backing: 'software'`).
//
// ── Why a custom module rather than an existing library ──────────
// The requirement is a NON-EXTRACTABLE key. Libraries that hand back a
// private key in JS defeat the entire point of RFC 9449 sender-constrained
// tokens: a token thief who can read the key can mint proofs anywhere.
// Both platforms can generate a key the app can *use* but never *read*:
//
//   iOS      SecKeyCreateRandomKey with kSecAttrTokenIDSecureEnclave
//   Android  KeyPairGenerator("EC", "AndroidKeyStore"), StrongBox when present
//
// Both produce P-256 and both sign SHA256withECDSA. The native side converts
// the platform's DER (ASN.1 `SEQUENCE { r, s }`) signature into the raw
// `r || s` 64-byte form ES256 requires — see `createDpopProof` in
// packages/client-runtime/src/deviceKey.ts, which base64url-encodes the
// bytes it is given verbatim.
//
// ── Wire format ──────────────────────────────────────────────────
// Signatures and inputs cross the bridge base64-encoded: the RN bridge has
// no faithful binary type, and a JS array of 64 numbers is both slower and
// easier to corrupt than a string. The public key crosses as a JWK object
// (`{ kty: 'EC', crv: 'P-256', x, y }`, base64url coordinates) built natively
// from the uncompressed SEC1 point.
// ────────────────────────────────────────────────────────────────

import { requireOptionalNativeModule } from 'expo';
import type { PublicJwk } from '@generatorai/client-runtime';

import { base64ToBytes, bytesToBase64 } from '../lib/base64';

export type KeyBacking = 'secure-enclave' | 'strongbox' | 'keystore' | 'software';

export interface NativeKeyHandle {
  publicJwk: PublicJwk;
  backing: KeyBacking;
}

/** What the native side hands back for a key. */
interface NativeHandle {
  publicJwk: { kty: string; crv: string; x: string; y: string };
  backing: KeyBacking;
}

/**
 * Native surface — must match `GeneratorAIDeviceKeyModule.swift` / `.kt`.
 *
 * `generate` replaces any key under the alias. `sign` rejects when the alias
 * has no key (or the key was invalidated by a biometric enrolment change),
 * so the store treats a rejection as "not paired".
 */
interface DeviceKeyNativeModule {
  isSupported(): Promise<boolean>;
  generate(alias: string): Promise<NativeHandle>;
  exists(alias: string): Promise<boolean>;
  /** The public half + backing for an existing alias, or null. */
  load(alias: string): Promise<NativeHandle | null>;
  /** Where the key under `alias` lives, or null when there is none. */
  backing(alias: string): Promise<KeyBacking | null>;
  /** ECDSA-SHA256, raw `r || s`. Input and output are base64. */
  sign(alias: string, dataBase64: string): Promise<string>;
  remove(alias: string): Promise<void>;
}

const native = requireOptionalNativeModule<DeviceKeyNativeModule>('GeneratorAIDeviceKey');

/**
 * Backings the native side may report.
 *
 * `software` is legitimate from Android: an emulator's AndroidKeyStore has
 * no TEE, but the key is still non-extractable — so it is used, and labelled
 * honestly. iOS never reports it (no enclave → `isSupported()` is false and
 * the WebCrypto fallback in `stores.ts` runs instead).
 */
const KNOWN_BACKINGS: ReadonlySet<string> = new Set([
  'secure-enclave',
  'strongbox',
  'keystore',
  'software',
]);

function parseHandle(raw: NativeHandle): NativeKeyHandle {
  const jwk = raw.publicJwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Native device key returned an unexpected JWK shape');
  }
  if (!KNOWN_BACKINGS.has(raw.backing)) {
    // A native module that cannot say where the key is must not be trusted
    // to have put it anywhere special.
    throw new Error(`Native device key reported an unknown backing: ${String(raw.backing)}`);
  }
  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    backing: raw.backing,
  };
}

export const NativeDeviceKey = {
  /** True when the local module is linked into this binary at all. */
  get isLinked(): boolean {
    return native !== null;
  },

  /**
   * Whether hardware-backed keys are available.
   *
   * False on a simulator without a secure element, on Android devices with
   * no usable keystore, and whenever the native module is not linked.
   */
  async isSupported(): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.isSupported();
    } catch {
      return false;
    }
  },

  async generate(alias: string): Promise<NativeKeyHandle> {
    if (!native) throw new Error('Native device key module is not available');
    return parseHandle(await native.generate(alias));
  },

  async exists(alias: string): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.exists(alias);
    } catch {
      return false;
    }
  },

  async load(alias: string): Promise<NativeKeyHandle | null> {
    if (!native) return null;
    const raw = await native.load(alias);
    return raw ? parseHandle(raw) : null;
  },

  async backing(alias: string): Promise<KeyBacking | null> {
    if (!native) return null;
    try {
      const value = await native.backing(alias);
      return value && KNOWN_BACKINGS.has(value) ? value : null;
    } catch {
      return null;
    }
  },

  async sign(alias: string, data: Uint8Array): Promise<Uint8Array> {
    if (!native) throw new Error('Native device key module is not available');
    const signature = base64ToBytes(await native.sign(alias, bytesToBase64(data)));
    if (signature.length !== 64) {
      // DER would be 70–72 bytes; anything but raw r||s means the native
      // conversion regressed, and the server would reject every proof.
      throw new Error(`Native device key returned a ${signature.length}-byte signature; expected 64`);
    }
    return signature;
  },

  async remove(alias: string): Promise<void> {
    if (!native) return;
    await native.remove(alias);
  },
};
