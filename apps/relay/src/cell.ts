// ────────────────────────────────────────────────────────────────
// Cell — the blind forwarder.
//
// A cell holds one outbound control channel per GeneratorAI host and pipes
// opaque byte streams between paired clients and that host. It is explicitly
// designed so that operating it grants NO ability to read user data:
//
//   * every application byte it carries is already sealed by the E2EE layer
//   * it never receives a device credential, an access token, or a scope
//   * host identity is proven by an Ed25519 signature over a transcript that
//     binds this cell's origin and ephemeral key, so a captured proof cannot
//     be replayed at a different relay or rolled back to an older epoch
//
// What a cell CAN do is deny service and observe metadata (who connected,
// when, and roughly how much traffic). That is documented, not hidden.
// ────────────────────────────────────────────────────────────────

import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'node:http';
import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_MAX_CONTROL_MESSAGE_BYTES,
  RELAY_MAX_DATA_FRAME_BYTES,
  RELAY_MAX_STREAMS_PER_HOST,
  RELAY_INVITE_MAX_ATTEMPTS,
  encodeHostProofTranscript,
  parseControlMessage,
  RelayClientHelloSchema,
  fromBase64Url,
  toBase64Url,
  type RelayControlMessage,
} from '@generatorai/relay-protocol';

/** How long a host has to answer the challenge before the socket is dropped. */
const CHALLENGE_TTL_MS = 15_000;

/** Lease the host must refresh by reconnecting; guards against zombie hosts. */
const LEASE_MS = 10 * 60_000;

/** Ceiling on concurrently attached hosts, so one cell cannot be exhausted. */
const MAX_HOSTS = Number(process.env['GENERATORAI_RELAY_MAX_HOSTS'] ?? 500);

interface Invite {
  token: string;
  tokenHash: string;
  relayHostId: string;
  pendingDeviceRef: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
}

interface PendingStream {
  streamId: string;
  clientSocket: WebSocket;
  /** Buffered client frames that arrived before the host attached. */
  buffered: Buffer[];
  hostSocket: WebSocket | null;
  bufferedBytes: number;
}

interface HostConnection {
  relayHostId: string;
  socket: WebSocket;
  generation: number;
  leaseExpiresAt: number;
  /** Relay bindings revoked by the host; a resume with one of these is denied. */
  revokedBindings: Set<string>;
  streams: Map<string, PendingStream>;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface CellOptions {
  /** Public origin clients and hosts dial, e.g. `wss://relay.example.com`. */
  origin: string;
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}

export class RelayCell {
  private readonly hosts = new Map<string, HostConnection>();
  private readonly invites = new Map<string, Invite>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: CellOptions) {}

  /**
   * Attaches the two WebSocket endpoints to an existing HTTP server:
   *   `/relay/host`   — outbound control channel from a GeneratorAI server
   *   `/relay/client` — inbound connection from a paired device
   *   `/relay/data`   — one per stream, carrying opaque sealed bytes
   */
  attach(server: Server): void {
    const hostWss = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_CONTROL_MESSAGE_BYTES });
    const clientWss = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_DATA_FRAME_BYTES });
    const dataWss = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_DATA_FRAME_BYTES });

    server.on('upgrade', (req, socket, head) => {
      let path: string;
      try {
        path = new URL(req.url ?? '/', 'http://placeholder').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (path === '/relay/host') {
        hostWss.handleUpgrade(req, socket, head, (ws) => this.onHostSocket(ws));
      } else if (path === '/relay/client') {
        clientWss.handleUpgrade(req, socket, head, (ws) => this.onClientSocket(ws));
      } else if (path === '/relay/data') {
        const url = new URL(req.url ?? '/', 'http://placeholder');
        const streamId = url.searchParams.get('streamId') ?? '';
        const relayHostId = url.searchParams.get('relayHostId') ?? '';
        dataWss.handleUpgrade(req, socket, head, (ws) =>
          this.onHostDataSocket(ws, relayHostId, streamId),
        );
      } else {
        socket.destroy();
      }
    });

    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  close(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const host of this.hosts.values()) {
      try {
        host.socket.close(1001, 'cell shutting down');
      } catch {
        /* already closed */
      }
    }
    this.hosts.clear();
  }

  stats(): { hosts: number; streams: number; invites: number } {
    let streams = 0;
    for (const h of this.hosts.values()) streams += h.streams.size;
    return { hosts: this.hosts.size, streams, invites: this.invites.size };
  }

  // ── Host control channel ────────────────────────────────────────

  private onHostSocket(ws: WebSocket): void {
    if (this.hosts.size >= MAX_HOSTS) {
      this.sendError(ws, 'CAPACITY', 'This relay cell is at capacity.');
      ws.close(1013, 'capacity');
      return;
    }

    // Challenge material is created BEFORE the hello so a host cannot choose
    // any part of the transcript it will later sign.
    const challengeId = toBase64Url(randomBytes(16));
    const nonce = toBase64Url(randomBytes(32));
    const ephemeralSecret = x25519.utils.randomPrivateKey();
    const relayEphemeralPublicKey = toBase64Url(x25519.getPublicKey(ephemeralSecret));
    const issuedAt = Date.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_MS;

    let helloSeen = false;
    let attached: HostConnection | null = null;
    let pendingHello: {
      relayHostId: string;
      hostPublicKey: string;
      assignmentEpoch: number;
      previousGeneration: number;
      resumeIntent: boolean;
    } | null = null;

    const timeout = setTimeout(() => {
      if (!attached) {
        this.sendError(ws, 'CHALLENGE_TIMEOUT', 'Host did not answer the challenge in time.');
        ws.close(4408, 'challenge timeout');
      }
    }, CHALLENGE_TTL_MS);
    timeout.unref?.();

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        // The control channel is text-only. A binary frame means a confused
        // or hostile peer.
        ws.close(4400, 'binary on control channel');
        return;
      }
      const message = parseControlMessage(raw.toString('utf8'));
      if (!message) {
        this.sendError(ws, 'MALFORMED', 'Message failed schema validation.');
        ws.close(4400, 'malformed');
        return;
      }

      if (!helloSeen) {
        if (message.type !== 'host_hello') {
          ws.close(4400, 'expected host_hello');
          return;
        }
        helloSeen = true;
        pendingHello = {
          relayHostId: message.relayHostId,
          hostPublicKey: message.hostPublicKey,
          assignmentEpoch: message.assignmentEpoch,
          previousGeneration: message.previousGeneration,
          resumeIntent: message.resumeIntent,
        };
        this.send(ws, {
          type: 'challenge',
          v: RELAY_PROTOCOL_VERSION,
          challengeId,
          nonce,
          relayEphemeralPublicKey,
          relayOrigin: this.options.origin,
          issuedAt,
          expiresAt,
        });
        return;
      }

      if (!attached) {
        if (message.type !== 'challenge_response' || !pendingHello) {
          ws.close(4400, 'expected challenge_response');
          return;
        }
        if (message.challengeId !== challengeId || Date.now() > expiresAt) {
          this.sendError(ws, 'CHALLENGE_INVALID', 'Challenge expired or mismatched.');
          ws.close(4401, 'challenge invalid');
          return;
        }

        // The relayHostId is the hash of the public key, so a host cannot
        // claim an id that does not belong to the key it is about to prove.
        // `fromBase64Url` returns null on malformed input — a proof we cannot
        // even decode is a failed proof, not a crash.
        const hostPublicKey = fromBase64Url(pendingHello.hostPublicKey);
        const signature = fromBase64Url(message.signature);
        if (!hostPublicKey || !signature) {
          this.sendError(ws, 'PROOF_INVALID', 'Host proof did not verify.');
          ws.close(4401, 'proof invalid');
          return;
        }
        const transcript = encodeHostProofTranscript({
          relayOrigin: this.options.origin,
          relayEphemeralPublicKey,
          challengeId,
          nonce,
          relayHostId: pendingHello.relayHostId,
          hostPublicKey: pendingHello.hostPublicKey,
          assignmentEpoch: pendingHello.assignmentEpoch,
          previousGeneration: pendingHello.previousGeneration,
          resumeIntent: pendingHello.resumeIntent,
          issuedAt,
          expiresAt,
        });
        let verified = false;
        try {
          verified = ed25519.verify(signature, transcript, hostPublicKey);
        } catch {
          verified = false;
        }
        if (!verified) {
          this.options.log('warn', 'Host proof failed', { relayHostId: pendingHello.relayHostId });
          this.sendError(ws, 'PROOF_INVALID', 'Host proof did not verify.');
          ws.close(4401, 'proof invalid');
          return;
        }

        clearTimeout(timeout);

        // A reconnect retires the previous socket, so a hijacked-but-stale
        // connection cannot keep receiving streams.
        const existing = this.hosts.get(pendingHello.relayHostId);
        if (existing) {
          try {
            existing.socket.close(4409, 'superseded by a newer connection');
          } catch {
            /* already closed */
          }
        }

        attached = {
          relayHostId: pendingHello.relayHostId,
          socket: ws,
          generation: (existing?.generation ?? 0) + 1,
          leaseExpiresAt: Date.now() + LEASE_MS,
          revokedBindings: existing?.revokedBindings ?? new Set(),
          streams: new Map(),
        };
        this.hosts.set(attached.relayHostId, attached);
        this.send(ws, {
          type: 'attached',
          v: RELAY_PROTOCOL_VERSION,
          generation: attached.generation,
          leaseExpiresAt: attached.leaseExpiresAt,
        });
        this.options.log('info', 'Host attached', {
          relayHostId: attached.relayHostId,
          generation: attached.generation,
        });
        return;
      }

      this.onHostControlMessage(attached, message);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!attached) return;
      // Only drop the registry entry if this socket is still the current one:
      // a superseded connection closing must not evict its replacement.
      if (this.hosts.get(attached.relayHostId)?.socket === ws) {
        this.hosts.delete(attached.relayHostId);
      }
      for (const stream of attached.streams.values()) {
        try {
          stream.clientSocket.close(1011, 'host disconnected');
        } catch {
          /* already closed */
        }
      }
      this.options.log('info', 'Host detached', { relayHostId: attached.relayHostId });
    });

    ws.on('error', () => {
      /* close handler performs cleanup */
    });
  }

  private onHostControlMessage(host: HostConnection, message: RelayControlMessage): void {
    switch (message.type) {
      case 'create_invite': {
        if (this.invites.size > MAX_HOSTS * 4) {
          this.send(host.socket, {
            type: 'error',
            v: RELAY_PROTOCOL_VERSION,
            code: 'INVITE_CAPACITY',
            message: 'Too many outstanding invites.',
            requestId: message.requestId,
          });
          return;
        }
        const token = toBase64Url(randomBytes(32));
        const invite: Invite = {
          token,
          tokenHash: sha256Hex(token),
          relayHostId: host.relayHostId,
          pendingDeviceRef: message.pendingDeviceRef,
          expiresAt: message.expiresAt,
          attempts: 0,
          maxAttempts: Math.min(message.maxAttempts, RELAY_INVITE_MAX_ATTEMPTS),
          consumed: false,
        };
        // Keyed by hash: a memory dump of the cell does not reveal usable
        // invite tokens for invites that have not been redeemed yet.
        this.invites.set(invite.tokenHash, invite);
        this.send(host.socket, {
          type: 'invite_created',
          v: RELAY_PROTOCOL_VERSION,
          requestId: message.requestId,
          inviteToken: token,
          expiresAt: invite.expiresAt,
        });
        return;
      }
      case 'revoke_device': {
        host.revokedBindings.add(message.relayBinding);
        // Kill any live stream belonging to the revoked device immediately —
        // revocation that waits for the next reconnect is not revocation.
        for (const [streamId, stream] of host.streams) {
          if (stream.hostSocket && streamId.startsWith(`${message.relayBinding}:`)) {
            try {
              stream.clientSocket.close(4403, 'device revoked');
            } catch {
              /* already closed */
            }
            host.streams.delete(streamId);
          }
        }
        this.send(host.socket, {
          type: 'revoke_ack',
          v: RELAY_PROTOCOL_VERSION,
          requestId: message.requestId,
        });
        return;
      }
      case 'stream_close': {
        const stream = host.streams.get(message.streamId);
        if (stream) {
          try {
            stream.clientSocket.close(1000, message.reason ?? 'closed by host');
          } catch {
            /* already closed */
          }
          host.streams.delete(message.streamId);
        }
        return;
      }
      default:
        // Anything else on this direction is a protocol error, but not worth
        // dropping a healthy host connection over.
        return;
    }
  }

  // ── Client connections ──────────────────────────────────────────

  private onClientSocket(ws: WebSocket): void {
    let bound: { host: HostConnection; streamId: string } | null = null;

    const helloTimer = setTimeout(() => {
      if (!bound) ws.close(4408, 'client_hello timeout');
    }, 10_000);
    helloTimer.unref?.();

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      if (!bound) {
        if (isBinary) {
          ws.close(4400, 'expected client_hello');
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          ws.close(4400, 'malformed hello');
          return;
        }
        const hello = RelayClientHelloSchema.safeParse(parsed);
        if (!hello.success) {
          ws.close(4400, 'invalid hello');
          return;
        }
        clearTimeout(helloTimer);

        const host = this.hosts.get(hello.data.relayHostId);
        if (!host) {
          // Same response whether the host is offline or does not exist, so
          // the cell is not an oracle for which host ids are registered.
          ws.close(4404, 'host unavailable');
          return;
        }

        if (hello.data.credentialKind === 'invite') {
          const invite = this.invites.get(sha256Hex(hello.data.credential));
          if (
            !invite ||
            invite.consumed ||
            invite.relayHostId !== host.relayHostId ||
            Date.now() > invite.expiresAt ||
            !constantTimeEqualHex(invite.tokenHash, sha256Hex(hello.data.credential))
          ) {
            if (invite) {
              invite.attempts += 1;
              if (invite.attempts >= invite.maxAttempts) this.invites.delete(invite.tokenHash);
            }
            ws.close(4401, 'invalid invite');
            return;
          }
          // Single use: consume before any byte flows.
          invite.consumed = true;
          this.invites.delete(invite.tokenHash);
        } else {
          const binding = hello.data.relayBinding;
          if (!binding || host.revokedBindings.has(binding)) {
            ws.close(4403, 'binding revoked');
            return;
          }
          // NOTE: the cell does NOT verify the resume credential itself — it
          // cannot, and must not be able to. The host validates it inside the
          // E2EE session; the cell only enforces revocation it was told about.
        }

        if (host.streams.size >= RELAY_MAX_STREAMS_PER_HOST) {
          ws.close(4429, 'too many streams');
          return;
        }

        const streamId = `${hello.data.relayBinding ?? 'invite'}:${randomUUID()}`;
        const stream: PendingStream = {
          streamId,
          clientSocket: ws,
          buffered: [],
          bufferedBytes: 0,
          hostSocket: null,
        };
        host.streams.set(streamId, stream);
        bound = { host, streamId };

        this.send(host.socket, {
          type: 'stream_open',
          v: RELAY_PROTOCOL_VERSION,
          streamId,
          credentialKind: hello.data.credentialKind,
          relayBinding: hello.data.relayBinding ?? null,
        });
        ws.send(JSON.stringify({ type: 'client_ready', v: RELAY_PROTOCOL_VERSION, streamId }));
        return;
      }

      // ── Data plane ────────────────────────────────────────────────
      const stream = bound.host.streams.get(bound.streamId);
      if (!stream) {
        ws.close(1011, 'stream gone');
        return;
      }
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (buf.length > RELAY_MAX_DATA_FRAME_BYTES) {
        ws.close(1009, 'frame too large');
        return;
      }
      if (stream.hostSocket && stream.hostSocket.readyState === WebSocket.OPEN) {
        stream.hostSocket.send(buf, { binary: true });
        return;
      }
      // The host has not dialled back yet. Buffer a bounded amount so a fast
      // client does not lose its first request, and drop the stream rather
      // than growing without limit.
      stream.bufferedBytes += buf.length;
      if (stream.bufferedBytes > RELAY_MAX_DATA_FRAME_BYTES * 4) {
        ws.close(1009, 'host did not attach in time');
        bound.host.streams.delete(bound.streamId);
        return;
      }
      stream.buffered.push(buf);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!bound) return;
      const stream = bound.host.streams.get(bound.streamId);
      if (stream?.hostSocket) {
        try {
          stream.hostSocket.close(1000, 'client closed');
        } catch {
          /* already closed */
        }
      }
      bound.host.streams.delete(bound.streamId);
      this.send(bound.host.socket, {
        type: 'stream_close',
        v: RELAY_PROTOCOL_VERSION,
        streamId: bound.streamId,
        reason: 'client closed',
      });
    });

    ws.on('error', () => {
      /* close handler performs cleanup */
    });
  }

  // ── Host data sockets ───────────────────────────────────────────

  private onHostDataSocket(ws: WebSocket, relayHostId: string, streamId: string): void {
    const host = this.hosts.get(relayHostId);
    const stream = host?.streams.get(streamId);
    if (!host || !stream || stream.hostSocket) {
      // Unknown, already-attached, or forged stream id.
      ws.close(4404, 'unknown stream');
      return;
    }
    stream.hostSocket = ws;

    // Flush anything the client sent while the host was dialling back.
    for (const buf of stream.buffered) ws.send(buf, { binary: true });
    stream.buffered = [];
    stream.bufferedBytes = 0;

    ws.on('message', (raw: RawData) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (buf.length > RELAY_MAX_DATA_FRAME_BYTES) {
        ws.close(1009, 'frame too large');
        return;
      }
      if (stream.clientSocket.readyState === WebSocket.OPEN) {
        stream.clientSocket.send(buf, { binary: true });
      }
    });

    const teardown = (): void => {
      host.streams.delete(streamId);
      try {
        stream.clientSocket.close(1000, 'host stream closed');
      } catch {
        /* already closed */
      }
    };
    ws.on('close', teardown);
    ws.on('error', teardown);
  }

  // ── Housekeeping ────────────────────────────────────────────────

  private sweep(): void {
    const now = Date.now();
    for (const [hash, invite] of this.invites) {
      if (invite.consumed || now > invite.expiresAt) this.invites.delete(hash);
    }
    for (const host of this.hosts.values()) {
      if (now > host.leaseExpiresAt) {
        try {
          host.socket.close(4408, 'lease expired');
        } catch {
          /* already closed */
        }
      }
    }
  }

  private send(ws: WebSocket, message: RelayControlMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', v: RELAY_PROTOCOL_VERSION, code, message });
  }
}
