// ────────────────────────────────────────────────────────────────
// Mobile storage adapters for `@generatorai/client-runtime`.
//
// The runtime is platform-agnostic: it asks for a `DeviceKeyStore` and a
// `SessionStore` and supplies everything else (DPoP, refresh, pairing,
// tickets, revocation). These are the two mobile implementations.
//
// ── Threat model, and why the key is handled the way it is ───────
// The device key is what makes the access token sender-constrained
// (RFC 9449): stealing the token is useless without it. So the key must be
// the hardest thing on the device to exfiltrate.
//
// Preferred path  — a hardware-backed, NON-EXTRACTABLE P-256 key in the
//   Secure Enclave (iOS) / StrongBox or TEE (Android), reached through the
//   `expo-device-key` native module. The private key never enters JS.
//
// Fallback path   — a software key in SecureStore (Keychain / Keystore-
//   encrypted SharedPreferences). Still encrypted at rest, but extractable
//   by anything that can run in the app's process.
//
// The fallback is NOT silent. `backing` is surfaced in the Security screen
// and in the posture report, mirroring how the desktop reports an insecure
// secret backend. A degraded device the user knows about is a decision; one
// they do not know about is a lie.
// ────────────────────────────────────────────────────────────────

import * as SecureStore from './secureItemStore';
import {
  deviceKeyFromCryptoKeyPair,
  generateDeviceKeyPair,
  jwkThumbprint,
  type DeviceKey,
  type DeviceKeyStore,
  type PublicJwk,
  type SessionStore,
  type StoredSession,
} from '@generatorai/client-runtime';

import { NativeDeviceKey, type NativeKeyHandle } from '../native/deviceKeyModule';

/**
 * Where the private key actually lives. Surfaced to the user.
 *
 * `web-preview` is the `expo start --web` build: `localStorage`, readable by
 * any script on the origin. It is strictly weaker than `software` (which is
 * still OS-encrypted at rest) and exists only so the UI can be reviewed on a
 * desktop.
 */
export type KeyBacking =
  | 'secure-enclave'
  | 'strongbox'
  | 'keystore'
  | 'software'
  | 'web-preview';

const DEVICE_KEY_ALIAS = 'generatorai.device-key';
const SOFTWARE_KEY_ITEM = 'generatorai.device-key.software';
const SESSION_ITEM = 'generatorai.session';

/** The weakest backing available on this platform, used when no hardware key exists. */
const FALLBACK_BACKING: KeyBacking = SecureStore.IS_OS_PROTECTED ? 'software' : 'web-preview';

const KEYCHAIN_OPTIONS = SecureStore.KEYCHAIN_OPTIONS;

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      'WebCrypto is unavailable. Ensure react-native-quick-crypto is installed ' +
        'and `install()` runs before the auth runtime starts.',
    );
  }
  return c.subtle;
}

/**
 * Device key store, hardware-backed when the platform allows.
 *
 * `backing` is only meaningful after `load()` or `create()` has run.
 */
export class MobileDeviceKeyStore implements DeviceKeyStore {
  private backingKind: KeyBacking = FALLBACK_BACKING;

  get backing(): KeyBacking {
    return this.backingKind;
  }

  /** True when the private key is in hardware and cannot be exported. */
  get isHardwareBacked(): boolean {
    return this.backingKind !== 'software' && this.backingKind !== 'web-preview';
  }

  async load(): Promise<DeviceKey | null> {
    const native = await this.loadNative();
    if (native) return native;
    return this.loadSoftware();
  }

  async create(): Promise<DeviceKey> {
    if (await NativeDeviceKey.isSupported()) {
      try {
        const handle = await NativeDeviceKey.generate(DEVICE_KEY_ALIAS);
        this.backingKind = handle.backing;
        return this.wrapNative(handle);
      } catch {
        // Hardware generation can fail on a device whose secure element is
        // full or disabled. Degrade rather than block pairing entirely —
        // and record the degradation so the user can see it.
      }
    }
    return this.createSoftware();
  }

  async clear(): Promise<void> {
    // Clear BOTH paths. A device that fell back to software after previously
    // holding a hardware key would otherwise leave the old key behind.
    await Promise.allSettled([
      NativeDeviceKey.remove(DEVICE_KEY_ALIAS),
      SecureStore.deleteItemAsync(SOFTWARE_KEY_ITEM, KEYCHAIN_OPTIONS),
    ]);
    this.backingKind = FALLBACK_BACKING;
  }

  // ── Hardware path ─────────────────────────────────────────────

  private async loadNative(): Promise<DeviceKey | null> {
    if (!(await NativeDeviceKey.isSupported())) return null;
    try {
      const handle = await NativeDeviceKey.load(DEVICE_KEY_ALIAS);
      if (!handle) return null;
      this.backingKind = handle.backing;
      return this.wrapNative(handle);
    } catch {
      // A biometric enrolment change invalidates the key by design. Treat it
      // as "not paired" so the user is guided to re-pair rather than seeing
      // an opaque crash on every launch.
      return null;
    }
  }

  private async wrapNative(handle: NativeKeyHandle): Promise<DeviceKey> {
    const publicJwk = handle.publicJwk;
    return {
      publicJwk,
      thumbprint: await jwkThumbprint(publicJwk),
      // Signing happens inside the secure element; the private key never
      // crosses the JS bridge.
      sign: (data: Uint8Array) => NativeDeviceKey.sign(DEVICE_KEY_ALIAS, data),
    };
  }

  // ── Software fallback ─────────────────────────────────────────

  private async loadSoftware(): Promise<DeviceKey | null> {
    const raw = await SecureStore.getItemAsync(SOFTWARE_KEY_ITEM, KEYCHAIN_OPTIONS);
    if (!raw) return null;
    try {
      const jwk = JSON.parse(raw) as JsonWebKey;
      const privateKey = await subtle().importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const publicJwk: PublicJwk = {
        kty: 'EC',
        crv: 'P-256',
        x: String(jwk.x),
        y: String(jwk.y),
      };
      this.backingKind = FALLBACK_BACKING;
      return {
        publicJwk,
        thumbprint: await jwkThumbprint(publicJwk),
        async sign(data: Uint8Array): Promise<Uint8Array> {
          const sig = await subtle().sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            privateKey,
            data as unknown as ArrayBuffer,
          );
          return new Uint8Array(sig);
        },
      };
    } catch {
      // Corrupt key material: report "not paired" instead of crashing on
      // every launch with no way out.
      return null;
    }
  }

  private async createSoftware(): Promise<DeviceKey> {
    // Extractable is unavoidable here — the key must survive process exit and
    // RN cannot persist a CryptoKey handle. It goes straight into the OS
    // keystore, never a file we manage.
    const pair = await generateDeviceKeyPair(true);
    const jwk = (await subtle().exportKey('jwk', pair.privateKey)) as JsonWebKey;
    await SecureStore.setItemAsync(SOFTWARE_KEY_ITEM, JSON.stringify(jwk), KEYCHAIN_OPTIONS);
    this.backingKind = FALLBACK_BACKING;
    return deviceKeyFromCryptoKeyPair(pair);
  }
}

/**
 * Session store backed by SecureStore.
 *
 * Holds the resume secret, so it is exactly as sensitive as the device key
 * and gets the same accessibility class. Never AsyncStorage: that is
 * plaintext on disk.
 */
export class MobileSessionStore implements SessionStore {
  async load(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(SESSION_ITEM, KEYCHAIN_OPTIONS);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      // Reject a partial record rather than letting the runtime fail later
      // with a confusing error deep inside a refresh.
      if (!parsed.deviceId || !parsed.resumeSecret || !parsed.endpoint || !parsed.serverId) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async save(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_ITEM, JSON.stringify(session), KEYCHAIN_OPTIONS);
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_ITEM, KEYCHAIN_OPTIONS);
  }
}
