// ────────────────────────────────────────────────────────────────
// Host binding — ties a `relayHostId` to the Ed25519 key that proves it.
//
// Why this exists. The GeneratorAI server has TWO long-term keys:
//   * an X25519 identity key, from which `hostId` (= `serverId` in the pairing
//     offer, = `relayHostId` at the relay) is derived by hashing, and
//   * a separate Ed25519 signing key used ONLY for relay host proofs.
// They come from different vault secrets, so the relay cannot check that a
// `relayHostId` "belongs to" the key answering its challenge — X25519 keys
// cannot sign, and the cell never sees the identity key at all. Before this
// module the hello simply asserted `relayHostId` and the cell believed it.
//
// What the binding guarantees. The host signs
//     domain ‖ version ‖ relayHostId ‖ hostPublicKey
// with its Ed25519 key and sends the signature in `host_hello`. The cell
// verifies it against `hostPublicKey` BEFORE issuing a challenge, and pins the
// key it saw for that id for the rest of its lifetime. Together with the
// challenge/response this means:
//   * a `relayHostId` can only be registered by a party holding a signing key
//     that explicitly claimed that id (no accidental or copy-pasted ids), and
//   * once a cell has seen id X with key K, a later attach for X with any
//     other key is refused (`HOST_KEY_MISMATCH`) instead of silently
//     superseding the real host.
//
// What it does NOT guarantee, stated plainly so nobody builds on it: the cell
// still cannot prove that `relayHostId` was derived from the identity key the
// client pinned at pairing time. The first party to claim an unseen id at a
// freshly started cell wins it. End-to-end confidentiality/authenticity of
// the bytes the relay carries is a job for the E2EE layer (`e2ee.ts`), which
// is implemented but NOT wired into any transport today — see its header.
// ────────────────────────────────────────────────────────────────

import nacl from 'tweetnacl';
import { concatBytes, decodeCanonicalBase64Url, toBase64Url, uint32, utf8 } from './bytes.js';
import { RELAY_HOST_BINDING_DOMAIN, RELAY_PROTOCOL_VERSION } from './relayProtocol.js';

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

export interface HostBindingInput {
  /** The id the host wants to be reachable under (base64url, 43 chars). */
  relayHostId: string;
  /** The host's Ed25519 public key (base64url, 43 chars). */
  hostPublicKey: string;
}

/** Length-prefixed, domain-separated bytes the host signs. */
export function encodeHostBindingTranscript(input: HostBindingInput): Uint8Array {
  const fields: [string, Uint8Array][] = [
    ['domain', utf8(RELAY_HOST_BINDING_DOMAIN)],
    ['version', uint32(RELAY_PROTOCOL_VERSION)],
    ['relay-host-id', utf8(input.relayHostId)],
    ['host-public-key', utf8(input.hostPublicKey)],
  ];
  return concatBytes(
    fields.map(([name, value]) =>
      concatBytes([uint32(utf8(name).length), utf8(name), uint32(value.length), value]),
    ),
  );
}

/**
 * Produces the base64url signature carried in `host_hello.hostBinding`.
 *
 * `sign` is a callback rather than a raw secret so the server can use its
 * Node `KeyObject` (via `@generatorai/auth`'s `signBytes`) and tests can use
 * `tweetnacl` or `@noble/curves` — Ed25519 signatures are deterministic and
 * interoperable across all three.
 */
export function createHostBinding(
  input: HostBindingInput,
  sign: (message: Uint8Array) => Uint8Array,
): string {
  const signature = sign(encodeHostBindingTranscript(input));
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error('Host binding signature must be 64 bytes');
  }
  return toBase64Url(signature);
}

/**
 * Verifies a binding. Returns false — never throws — on malformed input, so a
 * hostile hello cannot turn a validation failure into an exception path.
 */
export function verifyHostBinding(
  input: HostBindingInput & { hostBinding: string },
): boolean {
  const publicKey = decodeCanonicalBase64Url(input.hostPublicKey, ED25519_PUBLIC_KEY_BYTES);
  const signature = decodeCanonicalBase64Url(input.hostBinding, ED25519_SIGNATURE_BYTES);
  if (!publicKey || !signature) return false;
  try {
    return nacl.sign.detached.verify(
      encodeHostBindingTranscript({
        relayHostId: input.relayHostId,
        hostPublicKey: input.hostPublicKey,
      }),
      signature,
      publicKey,
    );
  } catch {
    return false;
  }
}
