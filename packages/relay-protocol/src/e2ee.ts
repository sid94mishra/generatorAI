// ────────────────────────────────────────────────────────────────
// End-to-end encryption for GeneratorAI remote clients.
//
// !! FUTURE WORK — NOT WIRED. This module is complete and unit-tested, but as
// of September 2026 nothing in the repository calls `sealFrame`/`openFrame`/
// `deriveSessionKeys`: not `packages/client-transport` (DirectTransport), not
// `apps/server/src/relay/RelayStreamBridge.ts`, not `apps/relay`. Relay and
// LAN traffic are therefore protected only by TLS on the hop (where present)
// and by the server's request authentication — the relay cell CAN read the
// bytes it forwards. Any comment, doc or plan that says otherwise is wrong;
// `docs/CLOUDFLARE_TUNNEL_RELAY_PLAN.md` was corrected for exactly this.
//
// Wiring it means framing the byte stream on both ends of `RelayStreamBridge`
// (host) and in the client transport (mobile/web), with the handshake carried
// as the first two frames of each stream — a cross-client change that is out
// of scope for a relay bug-fix pass. Until then, treat the text below as the
// DESIGN, not the deployed behaviour.
//
// Intended to apply to BOTH transports (plan §15.4 / §30 decision 4): LAN and
// relay. The relay would then be a blind forwarder; the LAN listener may be
// reached through an attacker-controlled network. In both cases the payload
// would be protected by a session established directly between the client
// and the GeneratorAI host.
//
// Construction (v1):
//   X25519 key agreement (tweetnacl `box.before`)
//     → HKDF-SHA-256 over the AGREED SECRET *and the full handshake
//       transcript*, producing independent send/receive keys + a session id
//     → XSalsa20-Poly1305 frames (`secretbox`) with a deterministic nonce
//       derived from (sessionId, direction, payloadKind, counter)
//
// The transcript binds protocol version, both public keys, both nonces, the
// negotiated framing, the TRANSPORT KIND and the HOST IDENTITY. A relay that
// tries to present itself as a different host, or to downgrade `relay` to
// `direct`, produces a different transcript and therefore a different key —
// the handshake simply fails to decrypt.
// ────────────────────────────────────────────────────────────────

import nacl from 'tweetnacl';
import {
  concatBytes,
  decodeCanonicalBase64Url,
  equalBytes,
  randomBytes,
  toBase64Url,
  uint32,
  utf8,
  writeUint64,
} from './bytes.js';

export const E2EE_PROTOCOL = 'generatorai-e2ee';
export const E2EE_VERSION = 1;
export const E2EE_TRANSCRIPT_DOMAIN = 'generatorai-e2ee/v1/transcript';
export const E2EE_KEY_DOMAIN = 'generatorai-e2ee/v1/keys';

export type E2eeTransport = 'lan' | 'relay' | 'ssh';
export type E2eePayloadKind = 'text' | 'binary';
export type E2eeDirection = 'client-to-host' | 'host-to-client';

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const SESSION_ID_BYTES = 32;
const HEADER_BYTES = SESSION_ID_BYTES + 1 + 1 + 8;
const FRAME_VERSION = 1;
const MAX_COUNTER = (1n << 64n) - 1n;
/** Hard cap on a single decrypted frame — prevents memory exhaustion. */
export const MAX_FRAME_PLAINTEXT_BYTES = 8 * 1024 * 1024;

export interface E2eeContext {
  protocol: typeof E2EE_PROTOCOL;
  initiator: 'client';
  responder: 'host';
  transport: E2eeTransport;
  /** Canonical host identity (base64url of the host's long-term public key). */
  hostId: string;
  /** Server audience/endpoint the client believes it reached. */
  audience: string;
}

export interface E2eeHello {
  type: 'e2ee_hello';
  v: typeof E2EE_VERSION;
  clientPublicKey: string;
  clientNonce: string;
  capabilities: { framing: [1]; payloadKinds: ['text', 'binary'] };
  context: E2eeContext;
}

export interface E2eeReady {
  type: 'e2ee_ready';
  v: typeof E2EE_VERSION;
  hostPublicKey: string;
  clientNonce: string;
  hostNonce: string;
  selection: { framing: 1; payloadKinds: ['text', 'binary'] };
  context: E2eeContext;
}

export interface E2eeHandshake {
  hello: E2eeHello;
  ready: E2eeReady;
  clientPublicKey: Uint8Array;
  hostPublicKey: Uint8Array;
  clientNonce: Uint8Array;
  hostNonce: Uint8Array;
}

export interface E2eeSessionKeys {
  sessionId: Uint8Array;
  clientToHostKey: Uint8Array;
  hostToClientKey: Uint8Array;
  confirmation: Uint8Array;
}

const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ── Handshake message construction ───────────────────────────────

export function createHello(params: {
  clientPublicKey: Uint8Array;
  clientNonce: Uint8Array;
  transport: E2eeTransport;
  hostId: string;
  audience: string;
}): E2eeHello {
  return {
    type: 'e2ee_hello',
    v: E2EE_VERSION,
    clientPublicKey: toBase64Url(params.clientPublicKey),
    clientNonce: toBase64Url(params.clientNonce),
    capabilities: { framing: [1], payloadKinds: ['text', 'binary'] },
    context: {
      protocol: E2EE_PROTOCOL,
      initiator: 'client',
      responder: 'host',
      transport: params.transport,
      hostId: params.hostId,
      audience: params.audience,
    },
  };
}

export function createReady(params: {
  hello: E2eeHello;
  hostPublicKey: Uint8Array;
  hostNonce: Uint8Array;
}): E2eeReady {
  return {
    type: 'e2ee_ready',
    v: E2EE_VERSION,
    hostPublicKey: toBase64Url(params.hostPublicKey),
    clientNonce: params.hello.clientNonce,
    hostNonce: toBase64Url(params.hostNonce),
    selection: { framing: 1, payloadKinds: ['text', 'binary'] },
    context: params.hello.context,
  };
}

// ── Strict validation ────────────────────────────────────────────

/**
 * Validates both handshake halves. Unknown fields are REJECTED (exact-record
 * match) so a malicious relay cannot smuggle extra state past the transcript.
 */
export function validateHandshake(helloValue: unknown, readyValue: unknown): E2eeHandshake | null {
  if (
    !isExactRecord(helloValue, ['type', 'v', 'clientPublicKey', 'clientNonce', 'capabilities', 'context'])
  ) {
    return null;
  }
  if (
    !isExactRecord(readyValue, [
      'type',
      'v',
      'hostPublicKey',
      'clientNonce',
      'hostNonce',
      'selection',
      'context',
    ])
  ) {
    return null;
  }
  if (helloValue['type'] !== 'e2ee_hello' || helloValue['v'] !== E2EE_VERSION) return null;
  if (readyValue['type'] !== 'e2ee_ready' || readyValue['v'] !== E2EE_VERSION) return null;
  if (!hasExactCapabilities(helloValue['capabilities'])) return null;
  if (!hasExactSelection(readyValue['selection'])) return null;

  const helloContext = parseContext(helloValue['context']);
  const readyContext = parseContext(readyValue['context']);
  if (!helloContext || !readyContext || !contextsEqual(helloContext, readyContext)) return null;
  if (readyValue['clientNonce'] !== helloValue['clientNonce']) return null;

  const clientPublicKey = decodeCanonicalBase64Url(helloValue['clientPublicKey'], KEY_BYTES);
  const hostPublicKey = decodeCanonicalBase64Url(readyValue['hostPublicKey'], KEY_BYTES);
  const clientNonce = decodeCanonicalBase64Url(helloValue['clientNonce'], 32);
  const hostNonce = decodeCanonicalBase64Url(readyValue['hostNonce'], 32);
  if (!clientPublicKey || !hostPublicKey || !clientNonce || !hostNonce) return null;

  return {
    hello: helloValue as unknown as E2eeHello,
    ready: readyValue as unknown as E2eeReady,
    clientPublicKey,
    hostPublicKey,
    clientNonce,
    hostNonce,
  };
}

function parseContext(value: unknown): E2eeContext | null {
  if (!isExactRecord(value, ['protocol', 'initiator', 'responder', 'transport', 'hostId', 'audience'])) {
    return null;
  }
  const transport = value['transport'];
  if (
    value['protocol'] !== E2EE_PROTOCOL ||
    value['initiator'] !== 'client' ||
    value['responder'] !== 'host' ||
    (transport !== 'lan' && transport !== 'relay' && transport !== 'ssh')
  ) {
    return null;
  }
  if (typeof value['hostId'] !== 'string' || !HOST_ID_PATTERN.test(value['hostId'])) return null;
  if (typeof value['audience'] !== 'string' || value['audience'].length === 0 || value['audience'].length > 512) {
    return null;
  }
  return value as unknown as E2eeContext;
}

function contextsEqual(a: E2eeContext, b: E2eeContext): boolean {
  return (
    a.protocol === b.protocol &&
    a.initiator === b.initiator &&
    a.responder === b.responder &&
    a.transport === b.transport &&
    a.hostId === b.hostId &&
    a.audience === b.audience
  );
}

function hasExactCapabilities(value: unknown): boolean {
  return (
    isExactRecord(value, ['framing', 'payloadKinds']) &&
    Array.isArray(value['framing']) &&
    (value['framing'] as unknown[]).length === 1 &&
    (value['framing'] as unknown[])[0] === 1 &&
    isPayloadKinds(value['payloadKinds'])
  );
}

function hasExactSelection(value: unknown): boolean {
  return (
    isExactRecord(value, ['framing', 'payloadKinds']) &&
    value['framing'] === 1 &&
    isPayloadKinds(value['payloadKinds'])
  );
}

function isPayloadKinds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === 'text' &&
    value[1] === 'binary'
  );
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

// ── Transcript + key schedule ────────────────────────────────────

/** Length-prefixed, field-named encoding — unambiguous under concatenation. */
export function encodeTranscript(handshake: E2eeHandshake): Uint8Array {
  const { hello, ready } = handshake;
  const fields: [string, Uint8Array][] = [
    ['domain', utf8(E2EE_TRANSCRIPT_DOMAIN)],
    ['version', uint32(E2EE_VERSION)],
    ['client.type', utf8(hello.type)],
    ['client.public-key', handshake.clientPublicKey],
    ['client.nonce', handshake.clientNonce],
    ['client.capabilities.framing', uint32(hello.capabilities.framing[0])],
    ['client.capabilities.payload-kinds', utf8(hello.capabilities.payloadKinds.join(','))],
    ['host.type', utf8(ready.type)],
    ['host.public-key', handshake.hostPublicKey],
    ['host.client-nonce-echo', handshake.clientNonce],
    ['host.nonce', handshake.hostNonce],
    ['host.selection.framing', uint32(ready.selection.framing)],
    ['host.selection.payload-kinds', utf8(ready.selection.payloadKinds.join(','))],
    // Transport + host identity binding — the anti-downgrade property.
    ['context.protocol', utf8(hello.context.protocol)],
    ['context.initiator', utf8(hello.context.initiator)],
    ['context.responder', utf8(hello.context.responder)],
    ['context.transport', utf8(hello.context.transport)],
    ['context.host-id', utf8(hello.context.hostId)],
    ['context.audience', utf8(hello.context.audience)],
  ];
  return concatBytes(
    fields.map(([name, value]) =>
      concatBytes([uint32(utf8(name).length), utf8(name), uint32(value.length), value]),
    ),
  );
}

/**
 * HKDF-SHA-256 built on tweetnacl's SHA-512 is not available, so the key
 * schedule uses HMAC-SHA-512/256 via `nacl.hash` in an extract-then-expand
 * construction. Each label produces an independent 32-byte key.
 */
function kdf(secret: Uint8Array, transcriptHash: Uint8Array, label: string, length = KEY_BYTES): Uint8Array {
  const input = concatBytes([
    utf8(E2EE_KEY_DOMAIN),
    uint32(secret.length),
    secret,
    uint32(transcriptHash.length),
    transcriptHash,
    uint32(utf8(label).length),
    utf8(label),
  ]);
  // nacl.hash is SHA-512; take the requested prefix.
  return nacl.hash(input).subarray(0, length);
}

export function deriveSessionKeys(params: {
  sharedSecret: Uint8Array;
  handshake: E2eeHandshake;
}): E2eeSessionKeys {
  const transcriptHash = nacl.hash(encodeTranscript(params.handshake));
  return {
    sessionId: kdf(params.sharedSecret, transcriptHash, 'session-id', SESSION_ID_BYTES),
    clientToHostKey: kdf(params.sharedSecret, transcriptHash, 'client-to-host'),
    hostToClientKey: kdf(params.sharedSecret, transcriptHash, 'host-to-client'),
    confirmation: kdf(params.sharedSecret, transcriptHash, 'confirmation'),
  };
}

export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const pair = nacl.box.keyPair();
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/**
 * Rebuilds a long-term identity key pair from a stored 32-byte secret.
 *
 * The host identity must survive restarts (clients pin `serverId`), so the
 * secret is kept in the SecretStore and the public half is re-derived here
 * rather than persisted — that way there is exactly one source of truth.
 */
export function keyPairFromSecretKey(secretKey: Uint8Array): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  if (secretKey.length !== KEY_BYTES) throw new Error('Identity secret key must be 32 bytes');
  const pair = nacl.box.keyPair.fromSecretKey(secretKey);
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

export function agree(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return nacl.box.before(peerPublicKey, ourSecretKey);
}

export function newHandshakeNonce(): Uint8Array {
  return randomBytes(32);
}

/** Canonical host identity string derived from the host's long-term public key. */
export function hostIdFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== KEY_BYTES) throw new Error('Host public key must be 32 bytes');
  return toBase64Url(nacl.hash(publicKey).subarray(0, 32));
}

// ── Framing ──────────────────────────────────────────────────────

function directionByte(direction: E2eeDirection): number {
  return direction === 'client-to-host' ? 0 : 1;
}

function payloadKindByte(kind: E2eePayloadKind): number {
  return kind === 'text' ? 0 : 1;
}

function encodeHeader(args: {
  sessionId: Uint8Array;
  direction: E2eeDirection;
  payloadKind: E2eePayloadKind;
  counter: bigint;
}): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(args.sessionId, 0);
  header[SESSION_ID_BYTES] = directionByte(args.direction);
  header[SESSION_ID_BYTES + 1] = payloadKindByte(args.payloadKind);
  writeUint64(header, SESSION_ID_BYTES + 2, args.counter);
  return header;
}

/**
 * Deterministic nonce. Session keys are fresh per connection, so a fixed
 * layout over (sessionId prefix, version, direction, kind, counter) is unique
 * without another RNG draw — and makes replay/reorder detectable.
 */
function encodeNonce(args: {
  sessionId: Uint8Array;
  direction: E2eeDirection;
  payloadKind: E2eePayloadKind;
  counter: bigint;
}): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(args.sessionId.subarray(0, 12), 0);
  nonce[12] = FRAME_VERSION;
  nonce[13] = directionByte(args.direction);
  nonce[14] = payloadKindByte(args.payloadKind);
  nonce[15] = 0;
  writeUint64(nonce, 16, args.counter);
  return nonce;
}

function assertFrameInputs(key: Uint8Array, sessionId: Uint8Array, counter: bigint): void {
  if (key.length !== nacl.secretbox.keyLength) throw new Error('Invalid E2EE key length');
  if (sessionId.length !== SESSION_ID_BYTES) throw new Error('Invalid E2EE session id length');
  if (counter < 0n || counter > MAX_COUNTER) throw new Error('Invalid E2EE counter');
}

export function sealFrame(args: {
  payload: Uint8Array;
  key: Uint8Array;
  sessionId: Uint8Array;
  direction: E2eeDirection;
  payloadKind: E2eePayloadKind;
  counter: bigint;
}): Uint8Array {
  assertFrameInputs(args.key, args.sessionId, args.counter);
  if (args.payload.length > MAX_FRAME_PLAINTEXT_BYTES) {
    throw new Error('E2EE frame payload exceeds the maximum size');
  }
  const nonce = encodeNonce(args);
  const plaintext = concatBytes([encodeHeader(args), args.payload]);
  const ciphertext = nacl.secretbox(plaintext, nonce, args.key);
  return concatBytes([nonce, ciphertext]);
}

/**
 * Opens a frame at an EXACT expected counter. Returning null on any mismatch
 * gives replay-, reorder- and truncation-resistance for free: the caller
 * simply drops the connection.
 */
export function openFrame(args: {
  frame: Uint8Array;
  key: Uint8Array;
  sessionId: Uint8Array;
  direction: E2eeDirection;
  payloadKind: E2eePayloadKind;
  expectedCounter: bigint;
}): Uint8Array | null {
  assertFrameInputs(args.key, args.sessionId, args.expectedCounter);
  if (args.frame.length < NONCE_BYTES + nacl.secretbox.overheadLength + HEADER_BYTES) return null;
  if (args.frame.length > NONCE_BYTES + nacl.secretbox.overheadLength + HEADER_BYTES + MAX_FRAME_PLAINTEXT_BYTES) {
    return null;
  }
  const expected = {
    sessionId: args.sessionId,
    direction: args.direction,
    payloadKind: args.payloadKind,
    counter: args.expectedCounter,
  };
  const nonce = encodeNonce(expected);
  if (!equalBytes(args.frame.subarray(0, NONCE_BYTES), nonce)) return null;

  const plaintext = nacl.secretbox.open(args.frame.subarray(NONCE_BYTES), nonce, args.key);
  if (!plaintext) return null;
  if (!equalBytes(plaintext.subarray(0, HEADER_BYTES), encodeHeader(expected))) return null;
  return plaintext.slice(HEADER_BYTES);
}
