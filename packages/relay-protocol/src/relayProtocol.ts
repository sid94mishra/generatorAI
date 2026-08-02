// ────────────────────────────────────────────────────────────────
// Relay control protocol (v1)
//
// Roles
//   Director — authenticates hosts, assigns a cell, hands out short-lived
//              assignment metadata. Never sees application bytes.
//   Cell     — accepts the host's OUTBOUND control channel and client
//              connections, then pipes opaque byte streams between them.
//   Host     — the GeneratorAI server. Dials OUT to the cell, so no inbound
//              firewall rule is ever required.
//
// The cell is a BLIND forwarder: every application byte it carries is already
// sealed by the E2EE layer in `e2ee.ts`, whose transcript binds the transport
// kind and host identity. A malicious relay can therefore observe metadata and
// deny service, but cannot read, forge or redirect application traffic.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { concatBytes, uint32, utf8 } from './bytes.js';

export const RELAY_PROTOCOL = 'generatorai-relay';
export const RELAY_PROTOCOL_VERSION = 1;
export const RELAY_HOST_PROOF_DOMAIN = 'generatorai-relay/v1/host-proof';

/** Ceilings that keep a hostile peer from exhausting memory. */
export const RELAY_MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export const RELAY_MAX_DATA_FRAME_BYTES = 1024 * 1024;
export const RELAY_MAX_STREAMS_PER_HOST = 64;
export const RELAY_INVITE_TTL_MS = 10 * 60 * 1000;
export const RELAY_INVITE_MAX_ATTEMPTS = 5;

const Base64Url43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Base64Url = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);

// ── Director API ─────────────────────────────────────────────────

export const RelayAssignmentSchema = z
  .object({
    v: z.literal(RELAY_PROTOCOL_VERSION),
    relayHostId: Base64Url43,
    cellUrl: z.string().url().max(2048),
    directorUrl: z.string().url().max(2048),
    assignmentEpoch: z.number().int().min(0),
    /** Wall-clock expiry of this assignment; the host re-registers before it. */
    expiresAt: z.number().int(),
  })
  .strict();
export type RelayAssignment = z.infer<typeof RelayAssignmentSchema>;

// ── Host ↔ cell control channel ──────────────────────────────────

export const RelayHostHelloSchema = z
  .object({
    type: z.literal('host_hello'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    relayHostId: Base64Url43,
    /** Host's long-term Ed25519 public key (base64url, 32 bytes). */
    hostPublicKey: Base64Url43,
    assignmentEpoch: z.number().int().min(0),
    /** Previous connection generation, so the cell can retire a stale socket. */
    previousGeneration: z.number().int().min(0),
    resumeIntent: z.boolean(),
  })
  .strict();
export type RelayHostHello = z.infer<typeof RelayHostHelloSchema>;

export const RelayChallengeSchema = z
  .object({
    type: z.literal('challenge'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    challengeId: Base64Url,
    nonce: Base64Url43,
    /** Cell's ephemeral X25519 public key for this connection. */
    relayEphemeralPublicKey: Base64Url43,
    relayOrigin: z.string().url().max(2048),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type RelayChallenge = z.infer<typeof RelayChallengeSchema>;

export const RelayChallengeResponseSchema = z
  .object({
    type: z.literal('challenge_response'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    challengeId: Base64Url,
    /** Ed25519 signature over `encodeHostProofTranscript(...)`. */
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
export type RelayChallengeResponse = z.infer<typeof RelayChallengeResponseSchema>;

export const RelayAttachedSchema = z
  .object({
    type: z.literal('attached'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    generation: z.number().int().min(0),
    leaseExpiresAt: z.number().int(),
  })
  .strict();

export const RelayCreateInviteSchema = z
  .object({
    type: z.literal('create_invite'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    requestId: Base64Url,
    /** Local pending device this invite is minted for. */
    pendingDeviceRef: z.string().min(1).max(200),
    expiresAt: z.number().int(),
    maxAttempts: z.number().int().min(1).max(RELAY_INVITE_MAX_ATTEMPTS),
  })
  .strict();
export type RelayCreateInvite = z.infer<typeof RelayCreateInviteSchema>;

export const RelayInviteCreatedSchema = z
  .object({
    type: z.literal('invite_created'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    requestId: Base64Url,
    inviteToken: Base64Url43,
    expiresAt: z.number().int(),
  })
  .strict();

export const RelayRevokeDeviceSchema = z
  .object({
    type: z.literal('revoke_device'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    requestId: Base64Url,
    relayBinding: z.string().min(1).max(200),
  })
  .strict();

export const RelayRevokeAckSchema = z
  .object({
    type: z.literal('revoke_ack'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    requestId: Base64Url,
  })
  .strict();

/** Cell → host: a client attached and wants a stream. */
export const RelayStreamOpenSchema = z
  .object({
    type: z.literal('stream_open'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    streamId: Base64Url,
    /** `invite` for first contact, `resume` for an already-paired device. */
    credentialKind: z.enum(['invite', 'resume']),
    /** Opaque binding id the host stored when the device was paired. */
    relayBinding: z.string().max(200).nullable(),
  })
  .strict();

export const RelayStreamCloseSchema = z
  .object({
    type: z.literal('stream_close'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    streamId: Base64Url,
    reason: z.string().max(200).optional(),
  })
  .strict();

export const RelayErrorSchema = z
  .object({
    type: z.literal('error'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    code: z.string().max(80),
    message: z.string().max(400),
    requestId: Base64Url.optional(),
  })
  .strict();

export const RelayControlMessageSchema = z.discriminatedUnion('type', [
  RelayHostHelloSchema,
  RelayChallengeSchema,
  RelayChallengeResponseSchema,
  RelayAttachedSchema,
  RelayCreateInviteSchema,
  RelayInviteCreatedSchema,
  RelayRevokeDeviceSchema,
  RelayRevokeAckSchema,
  RelayStreamOpenSchema,
  RelayStreamCloseSchema,
  RelayErrorSchema,
]);
export type RelayControlMessage = z.infer<typeof RelayControlMessageSchema>;

// ── Client ↔ cell ────────────────────────────────────────────────

export const RelayClientHelloSchema = z
  .object({
    type: z.literal('client_hello'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    relayHostId: Base64Url43,
    credentialKind: z.enum(['invite', 'resume']),
    /** Invite token or resume credential. Never logged. */
    credential: z.string().min(16).max(512),
    /** Relay binding id, required for `resume`. */
    relayBinding: z.string().max(200).optional(),
  })
  .strict();
export type RelayClientHello = z.infer<typeof RelayClientHelloSchema>;

export const RelayClientReadySchema = z
  .object({
    type: z.literal('client_ready'),
    v: z.literal(RELAY_PROTOCOL_VERSION),
    streamId: Base64Url,
  })
  .strict();

// ── Host proof transcript ────────────────────────────────────────

export interface HostProofInput {
  relayOrigin: string;
  relayEphemeralPublicKey: string;
  challengeId: string;
  nonce: string;
  relayHostId: string;
  hostPublicKey: string;
  assignmentEpoch: number;
  previousGeneration: number;
  resumeIntent: boolean;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Length-prefixed transcript the host signs to prove possession of its private
 * key. Binding the relay origin + ephemeral key + epoch means a signature
 * captured from one relay cannot be replayed at another, nor rolled back to an
 * earlier assignment epoch.
 */
export function encodeHostProofTranscript(input: HostProofInput): Uint8Array {
  const fields: [string, Uint8Array][] = [
    ['domain', utf8(RELAY_HOST_PROOF_DOMAIN)],
    ['version', uint32(RELAY_PROTOCOL_VERSION)],
    ['relay-origin', utf8(input.relayOrigin)],
    ['relay-ephemeral-public-key', utf8(input.relayEphemeralPublicKey)],
    ['challenge-id', utf8(input.challengeId)],
    ['nonce', utf8(input.nonce)],
    ['relay-host-id', utf8(input.relayHostId)],
    ['host-public-key', utf8(input.hostPublicKey)],
    ['assignment-epoch', uint32(input.assignmentEpoch)],
    ['previous-generation', uint32(input.previousGeneration)],
    ['resume-intent', utf8(input.resumeIntent ? '1' : '0')],
    ['issued-at', utf8(String(input.issuedAt))],
    ['expires-at', utf8(String(input.expiresAt))],
  ];
  return concatBytes(
    fields.map(([name, value]) =>
      concatBytes([uint32(utf8(name).length), utf8(name), uint32(value.length), value]),
    ),
  );
}

/** Parses + validates a control message. Returns null on any deviation. */
export function parseControlMessage(raw: string): RelayControlMessage | null {
  if (raw.length > RELAY_MAX_CONTROL_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = RelayControlMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
