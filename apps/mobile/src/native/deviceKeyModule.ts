// ────────────────────────────────────────────────────────────────
// expo-device-key — hardware-backed P-256 signing.
//
// Thin JS facade over the native module. Everything is optional: when the
// module is absent (Expo Go, a web build, an older dev client) every call
// resolves to "unsupported" and `MobileDeviceKeyStore` degrades to a
// software key rather than crashing.
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
// Both produce P-256 and both sign SHA256withECDSA, which is exactly what
// the server's DPoP verifier accepts (ES256).
// ────────────────────────────────────────────────────────────────

import { requireOptionalNativeModule } from 'expo';
import type { PublicJwk } from '@generatorai/client-runtime';

export type KeyBacking = 'secure-enclave' | 'strongbox' | 'keystore' | 'software';

export interface NativeKeyHandle {
  publicJwk: PublicJwk;
  backing: KeyBacking;
}

/**
 * Native surface.
 *
 * Signatures cross the bridge base64-encoded: the RN bridge has no faithful
 * binary type, and a JS array of 64 numbers is both slower and easier to
 * corrupt than a string.
 */
interface DeviceKeyNativeModule {
  isSupported(): Promise<boolean>;
  /** DER SPKI or raw JWK components, plus where the key ended up. */
  generate(alias: string): Promise<{ publicJwkJson: string; backing: KeyBacking }>;
  load(alias: string): Promise<{ publicJwkJson: string; backing: KeyBacking } | null>;
  /** ECDSA over SHA-256. Input and output are base64. */
  sign(alias: string, dataBase64: string): Promise<string>;
  remove(alias: string): Promise<void>;
}

const native = requireOptionalNativeModule<DeviceKeyNativeModule>('GeneratorAIDeviceKey');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function parseHandle(raw: { publicJwkJson: string; backing: KeyBacking }): NativeKeyHandle {
  const publicJwk = JSON.parse(raw.publicJwkJson) as PublicJwk;
  if (publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256' || !publicJwk.x || !publicJwk.y) {
    throw new Error('Native device key returned an unexpected JWK shape');
  }
  return { publicJwk, backing: raw.backing };
}

export const NativeDeviceKey = {
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

  async load(alias: string): Promise<NativeKeyHandle | null> {
    if (!native) return null;
    const raw = await native.load(alias);
    return raw ? parseHandle(raw) : null;
  },

  async sign(alias: string, data: Uint8Array): Promise<Uint8Array> {
    if (!native) throw new Error('Native device key module is not available');
    return fromBase64(await native.sign(alias, toBase64(data)));
  },

  async remove(alias: string): Promise<void> {
    if (!native) return;
    await native.remove(alias);
  },
};
