import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { randomBytes, toBase64Url } from './bytes.js';
import { createHostBinding, encodeHostBindingTranscript, verifyHostBinding } from './hostBinding.js';
import { RELAY_HOST_BINDING_DOMAIN, RelayHostHelloSchema, RELAY_PROTOCOL_VERSION } from './relayProtocol.js';

function keyPair() {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: toBase64Url(pair.publicKey),
    sign: (message: Uint8Array) => nacl.sign.detached(message, pair.secretKey),
  };
}

const relayHostId = toBase64Url(randomBytes(32));

describe('host binding', () => {
  it('verifies a binding produced by the key it names', () => {
    const host = keyPair();
    const hostBinding = createHostBinding({ relayHostId, hostPublicKey: host.publicKey }, host.sign);
    expect(hostBinding).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyHostBinding({ relayHostId, hostPublicKey: host.publicKey, hostBinding })).toBe(true);
  });

  it('rejects a binding for a different relayHostId (an id cannot be borrowed)', () => {
    const host = keyPair();
    const hostBinding = createHostBinding({ relayHostId, hostPublicKey: host.publicKey }, host.sign);
    const otherId = toBase64Url(randomBytes(32));
    expect(verifyHostBinding({ relayHostId: otherId, hostPublicKey: host.publicKey, hostBinding })).toBe(false);
  });

  it('rejects a binding signed by a key other than the one claimed', () => {
    const claimed = keyPair();
    const impostor = keyPair();
    const hostBinding = createHostBinding(
      { relayHostId, hostPublicKey: claimed.publicKey },
      impostor.sign,
    );
    expect(verifyHostBinding({ relayHostId, hostPublicKey: claimed.publicKey, hostBinding })).toBe(false);
  });

  it('returns false, never throws, on malformed input', () => {
    const host = keyPair();
    expect(verifyHostBinding({ relayHostId, hostPublicKey: host.publicKey, hostBinding: 'not-a-signature' })).toBe(false);
    expect(verifyHostBinding({ relayHostId, hostPublicKey: 'short', hostBinding: 'A'.repeat(86) })).toBe(false);
    // Non-canonical base64url (padding-bit noise) must not alias to a valid key.
    const binding = createHostBinding({ relayHostId, hostPublicKey: host.publicKey }, host.sign);
    const nonCanonicalKey = host.publicKey.slice(0, 42) + (host.publicKey.endsWith('A') ? 'B' : 'A');
    expect(verifyHostBinding({ relayHostId, hostPublicKey: nonCanonicalKey, hostBinding: binding })).toBe(false);
  });

  it('is domain-separated from the host-proof transcript', () => {
    const transcript = encodeHostBindingTranscript({ relayHostId, hostPublicKey: 'x'.repeat(43) });
    const text = Buffer.from(transcript).toString('latin1');
    expect(text).toContain(RELAY_HOST_BINDING_DOMAIN);
    expect(RELAY_HOST_BINDING_DOMAIN).toContain(`v${RELAY_PROTOCOL_VERSION}`);
  });

  it('is a REQUIRED field of host_hello — a v1-style hello without it fails the schema', () => {
    const host = keyPair();
    const withoutBinding = {
      type: 'host_hello',
      v: RELAY_PROTOCOL_VERSION,
      relayHostId,
      hostPublicKey: host.publicKey,
      assignmentEpoch: 0,
      previousGeneration: 0,
      resumeIntent: false,
    };
    expect(RelayHostHelloSchema.safeParse(withoutBinding).success).toBe(false);
    expect(
      RelayHostHelloSchema.safeParse({
        ...withoutBinding,
        hostBinding: createHostBinding({ relayHostId, hostPublicKey: host.publicKey }, host.sign),
      }).success,
    ).toBe(true);
  });
});
