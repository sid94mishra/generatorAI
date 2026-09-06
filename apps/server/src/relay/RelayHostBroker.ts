// ────────────────────────────────────────────────────────────────
// RelayHostBroker — the GeneratorAI server's OUTBOUND relay connector.
//
// Design constraints from the plan (§17):
//   * Outbound-only. The host dials the cell, so no inbound firewall rule
//     is ever required and operators can block all inbound traffic.
//   * Demand-driven. No paired relay device and no pending pairing ⇒ the
//     socket is closed. Nothing is kept open "just in case".
//   * Proof-of-possession. The host signs a transcript that binds the relay
//     origin, the cell's ephemeral key, the challenge nonce, the assignment
//     epoch and the previous generation — so a captured signature cannot be
//     replayed at a different relay or rolled back to an earlier epoch.
//   * Bound identity. `host_hello` carries a signature tying `relayHostId` to
//     the Ed25519 key that answers the challenge (`hostBinding.ts`), so the
//     id cannot be asserted by a key that never claimed it.
//   * Durable revocation. Revocations go through the outbox and are only
//     removed once the relay ACKs them.
//   * Routes come from `RELAY_ROUTES` in @generatorai/relay-protocol — the
//     same table `apps/relay` serves — so the two cannot silently diverge.
//
// NOT a property today: end-to-end encryption. `e2ee.ts` is not wired into
// `RelayStreamBridge` or any client, so the cell sees plain HTTP. See the
// header of `packages/relay-protocol/src/e2ee.ts`.
// ────────────────────────────────────────────────────────────────

import { WebSocket } from 'ws';
import * as crypto from 'node:crypto';
import {
  RELAY_INVITE_MAX_ATTEMPTS,
  RELAY_INVITE_TTL_MS,
  RELAY_MAX_CONTROL_MESSAGE_BYTES,
  RELAY_PROTOCOL_VERSION,
  RelayAssignmentSchema,
  canonicalRelayOrigin,
  createHostBinding,
  encodeHostProofTranscript,
  parseControlMessage,
  relayAssignmentUrl,
  relayHostSocketUrl,
  type RelayAssignment,
  type RelayControlMessage,
} from '@generatorai/relay-protocol';
import { base64url, signBytes, type ServerSigningKeyPair } from '@generatorai/auth';
import type { AuditAction as AuditActionType } from '@generatorai/auth';
import type { ILogger } from '@generatorai/shared';
import type { SecurityContext } from '../composition/security.js';
import type { RelayStreamBridge } from './RelayStreamBridge.js';

export interface RelayInviteResult {
  inviteToken: string;
  expiresAt: number;
  /** Relay block for the pairing offer, already shaped for the schema. */
  offer: {
    v: 1;
    directorUrl: string;
    cellUrl: string;
    assignmentEpoch: number;
    relayHostId: string;
    inviteToken: string;
    inviteExpiresAt: number;
    e2eeFraming: 1;
  };
}

export interface RelayHostBrokerOptions {
  security: SecurityContext;
  logger: ILogger;
  enabled: boolean;
  directorUrl: string | undefined;
  /** Ed25519 key used ONLY for relay host proofs. */
  signingKey: ServerSigningKeyPair;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  createSocket?: (url: string) => WebSocket;
}

type ConnectionState = 'idle' | 'connecting' | 'attached' | 'backoff' | 'disabled';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const DRAIN_DELAY_MS = 30_000;

export class RelayHostBroker {
  private socket: WebSocket | null = null;
  private assignment: RelayAssignment | null = null;
  private state: ConnectionState = 'idle';
  private generation = 0;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Data-plane bridge; null until the HTTP listener is bound. */
  private bridge: RelayStreamBridge | null = null;
  /** Reasons the connection must stay up (pending pairings + paired devices). */
  private readonly demand = new Set<string>();
  private readonly pendingRequests = new Map<
    string,
    { resolve: (msg: RelayControlMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly options: RelayHostBrokerOptions) {}

  /**
   * Supplies the data-plane bridge once the HTTP listener has a real port.
   *
   * Set late on purpose: the broker is constructed during container wiring,
   * but the loopback port is only known after `listen()`.
   */
  setStreamBridge(bridge: RelayStreamBridge): void {
    this.bridge = bridge;
  }

  isEnabled(): boolean {
    return this.options.enabled && Boolean(this.options.directorUrl);
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get relayHostId(): string {
    return this.options.security.identity.hostId;
  }

  /**
   * Starts the demand loop. Called once during container initialization; a
   * disabled relay is a no-op so callers do not need to branch.
   */
  async start(): Promise<void> {
    if (!this.isEnabled()) {
      this.state = 'disabled';
      return;
    }
    this.stopped = false;
    // Any device already bound to the relay is standing demand.
    const devices = await this.options.security.deviceRepo.list();
    for (const device of devices) {
      if (device.relayBinding && device.revokedAt == null) {
        this.demand.add(`device:${device.deviceId}`);
      }
    }
    this.outboxTimer = setInterval(() => void this.drainRevokeOutbox(), 30_000);
    this.outboxTimer.unref?.();
    if (this.demand.size > 0) this.ensureConnected();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Relay broker stopped'));
    }
    this.pendingRequests.clear();
    // A dropped control channel means every stream the cell was tracking is
    // now orphaned; leaving the loopback sockets open would leak connections.
    this.bridge?.closeAll('relay broker stopped');
    this.closeSocket(1001, 'shutting down');
    this.state = 'idle';
  }

  // ── Demand ──────────────────────────────────────────────────────

  addDemand(reason: string): void {
    this.demand.add(reason);
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.ensureConnected();
  }

  removeDemand(reason: string): void {
    this.demand.delete(reason);
    if (this.demand.size > 0 || this.drainTimer) return;
    // Linger briefly: a pairing dialog that is closed and reopened should not
    // pay for a full reconnect + host proof round trip.
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (this.demand.size === 0) this.closeSocket(1000, 'no demand');
    }, DRAIN_DELAY_MS);
    this.drainTimer.unref?.();
  }

  // ── Invites ─────────────────────────────────────────────────────

  /**
   * Mints a single-use relay invite for a pending device. Fails loudly when
   * the relay is unreachable — a pairing QR that silently omits relay material
   * would leave the user with a device that cannot connect off-LAN.
   */
  async createInvite(pendingDeviceRef = crypto.randomUUID()): Promise<RelayInviteResult> {
    if (!this.isEnabled()) throw new Error('Relay is not enabled on this server');
    this.addDemand(`pairing:${pendingDeviceRef}`);
    await this.waitUntilAttached(15_000);

    const assignment = this.assignment;
    if (!assignment) throw new Error('Relay assignment is unavailable');

    const requestId = base64url(crypto.randomBytes(16));
    const expiresAt = Date.now() + RELAY_INVITE_TTL_MS;
    const reply = await this.request({
      type: 'create_invite',
      v: RELAY_PROTOCOL_VERSION,
      requestId,
      pendingDeviceRef,
      expiresAt,
      maxAttempts: RELAY_INVITE_MAX_ATTEMPTS,
    });

    if (reply.type !== 'invite_created') {
      throw new Error(
        reply.type === 'error' ? `Relay rejected invite: ${reply.code}` : 'Unexpected relay reply',
      );
    }

    this.options.security.audit.record({
      action: 'relay.invite_created' satisfies (typeof AuditActionType)['relayInviteCreated'],
      result: 'success',
      resourceType: 'relay',
      resourceId: this.relayHostId,
    });

    return {
      inviteToken: reply.inviteToken,
      expiresAt: reply.expiresAt,
      offer: {
        v: 1,
        directorUrl: assignment.directorUrl,
        cellUrl: assignment.cellUrl,
        assignmentEpoch: assignment.assignmentEpoch,
        relayHostId: this.relayHostId,
        inviteToken: reply.inviteToken,
        inviteExpiresAt: reply.expiresAt,
        e2eeFraming: 1,
      },
    };
  }

  // ── Revocation ──────────────────────────────────────────────────

  /**
   * Delivers queued device revocations. Entries are only removed once the
   * relay ACKs them, so a revocation issued while the relay was offline is
   * still delivered after the next successful reconnect.
   */
  async drainRevokeOutbox(): Promise<void> {
    if (!this.isEnabled() || this.stopped) return;
    const pending = await this.options.security.relayOutboxRepo.listPending(20);
    if (pending.length === 0) return;

    this.addDemand('revoke-outbox');
    try {
      await this.waitUntilAttached(15_000);
      for (const entry of pending) {
        try {
          const reply = await this.request({
            type: 'revoke_device',
            v: RELAY_PROTOCOL_VERSION,
            requestId: base64url(crypto.randomBytes(16)),
            relayBinding: entry.relayBinding,
          });
          if (reply.type === 'revoke_ack') {
            await this.options.security.relayOutboxRepo.remove(entry.id);
            this.demand.delete(`device:${entry.deviceId}`);
            this.options.security.audit.record({
              action: 'relay.revoke_delivered',
              result: 'success',
              resourceType: 'device',
              resourceId: entry.deviceId,
            });
          } else {
            await this.options.security.relayOutboxRepo.markAttempt(
              entry.id,
              Date.now(),
              reply.type === 'error' ? reply.code : 'unexpected-reply',
            );
          }
        } catch (err) {
          await this.options.security.relayOutboxRepo.markAttempt(
            entry.id,
            Date.now(),
            err instanceof Error ? err.message : 'unknown',
          );
        }
      }
    } catch (err) {
      this.options.logger.warn('[Relay] Could not drain revoke outbox', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.removeDemand('revoke-outbox');
    }
  }

  // ── Connection lifecycle ────────────────────────────────────────

  private ensureConnected(): void {
    if (this.stopped || !this.isEnabled()) return;
    if (this.state === 'connecting' || this.state === 'attached') return;
    void this.connect();
  }

  private async connect(): Promise<void> {
    this.state = 'connecting';
    try {
      const assignment = await this.register();
      this.assignment = assignment;
      await this.openControlChannel(assignment);
      this.attempt = 0;
    } catch (err) {
      this.options.logger.warn('[Relay] Connection attempt failed', {
        error: err instanceof Error ? err.message : String(err),
        attempt: this.attempt,
      });
      this.scheduleReconnect();
    }
  }

  /**
   * Director assignment — returns the assigned cell for this host.
   *
   * `GET /relay/assignment?relayHostId=…`, the route the relay actually
   * serves. (This used to `POST /v1/hosts/register`, a path no relay ever
   * registered — the two processes had been built against different route
   * tables and never run together.)
   */
  private async register(): Promise<RelayAssignment> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const directorUrl = this.options.directorUrl!;
    const response = await fetchImpl(relayAssignmentUrl(directorUrl, this.relayHostId), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Relay director rejected registration (${response.status})`);
    }
    const parsed = RelayAssignmentSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Relay director returned an invalid assignment');
    if (parsed.data.relayHostId !== this.relayHostId) {
      // The director must never be able to re-point us at another identity.
      throw new Error('Relay assignment host id does not match this server');
    }
    return parsed.data;
  }

  private openControlChannel(assignment: RelayAssignment): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = relayHostSocketUrl(assignment.cellUrl);
      const socket = this.options.createSocket
        ? this.options.createSocket(wsUrl)
        : new WebSocket(wsUrl, { maxPayload: RELAY_MAX_CONTROL_MESSAGE_BYTES, handshakeTimeout: 10_000 });
      this.socket = socket;

      const settleTimer = setTimeout(() => {
        reject(new Error('Timed out waiting for the relay to attach this host'));
        socket.close(1002, 'attach timeout');
      }, 20_000);
      settleTimer.unref?.();

      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(settleTimer);
        if (err) reject(err);
        else resolve();
      };

      socket.on('open', () => {
        this.send(socket, {
          type: 'host_hello',
          v: RELAY_PROTOCOL_VERSION,
          relayHostId: this.relayHostId,
          hostPublicKey: this.hostPublicKeyBase64Url(),
          hostBinding: this.hostBinding(),
          assignmentEpoch: assignment.assignmentEpoch,
          previousGeneration: this.generation,
          resumeIntent: this.generation > 0,
        });
      });

      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const raw = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8');
        const message = parseControlMessage(raw);
        if (!message) {
          // Strict schema — anything unexpected is treated as hostile.
          this.options.logger.warn('[Relay] Dropping malformed control message');
          socket.close(1008, 'malformed control message');
          return;
        }
        this.handleControlMessage(socket, assignment, message, settle);
      });

      socket.on('error', (err: Error) => {
        settle(err);
      });

      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null;
          if (this.state === 'attached') this.state = 'idle';
        }
        settle(new Error('Relay control channel closed before attach'));
        if (!this.stopped && this.demand.size > 0) this.scheduleReconnect();
      });
    });
  }

  private handleControlMessage(
    socket: WebSocket,
    assignment: RelayAssignment,
    message: RelayControlMessage,
    settle: (err?: Error) => void,
  ): void {
    switch (message.type) {
      case 'challenge': {
        // Bind the proof to THIS relay, THIS ephemeral key and THIS epoch.
        // Both sides compare canonical http(s) origins, so a cell configured
        // as `wss://…` and an assignment saying `https://…` still agree.
        if (canonicalRelayOrigin(message.relayOrigin) !== canonicalRelayOrigin(assignment.cellUrl)) {
          settle(new Error('Relay challenge origin does not match the assigned cell'));
          socket.close(1008, 'origin mismatch');
          return;
        }
        const now = Date.now();
        if (message.expiresAt <= now || message.issuedAt > now + 60_000) {
          settle(new Error('Relay challenge is expired or issued in the future'));
          socket.close(1008, 'stale challenge');
          return;
        }
        const transcript = encodeHostProofTranscript({
          relayOrigin: message.relayOrigin,
          relayEphemeralPublicKey: message.relayEphemeralPublicKey,
          challengeId: message.challengeId,
          nonce: message.nonce,
          relayHostId: this.relayHostId,
          hostPublicKey: this.hostPublicKeyBase64Url(),
          assignmentEpoch: assignment.assignmentEpoch,
          previousGeneration: this.generation,
          resumeIntent: this.generation > 0,
          issuedAt: message.issuedAt,
          expiresAt: message.expiresAt,
        });
        const signature = signBytes(
          'EdDSA',
          this.options.signingKey.privateKey,
          Buffer.from(transcript),
        );
        this.send(socket, {
          type: 'challenge_response',
          v: RELAY_PROTOCOL_VERSION,
          challengeId: message.challengeId,
          signature: base64url(signature),
        });
        return;
      }
      case 'attached': {
        this.generation = message.generation;
        this.state = 'attached';
        this.options.logger.info('[Relay] Host attached', {
          hostId: this.relayHostId,
          generation: message.generation,
        });
        this.options.security.audit.record({
          action: 'relay.host_connected',
          result: 'success',
          resourceType: 'relay',
          resourceId: this.relayHostId,
          transport: 'relay',
        });
        settle();
        return;
      }
      case 'invite_created':
      case 'revoke_ack': {
        this.resolveRequest(message.requestId, message);
        return;
      }
      case 'error': {
        this.options.logger.warn('[Relay] Relay reported an error', {
          code: message.code,
          message: message.message,
        });
        if (message.requestId) this.resolveRequest(message.requestId, message);
        else settle(new Error(`Relay error: ${message.code}`));
        return;
      }
      case 'stream_open': {
        // Data-plane: dial back to the cell and pipe the stream into this
        // server's own loopback HTTP listener, so the remote client enters
        // through the same front door (and the same auth) as a LAN client.
        const cellUrl = this.assignment?.cellUrl;
        if (!cellUrl) return;
        this.bridge?.open({
          cellUrl,
          relayHostId: this.relayHostId,
          streamId: message.streamId,
        });
        return;
      }
      case 'stream_close': {
        this.bridge?.close(message.streamId, 'closed by relay');
        return;
      }
      default:
        return;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.demand.size === 0) {
      this.state = 'idle';
      return;
    }
    this.state = 'backoff';
    this.attempt += 1;
    // Full jitter — a fleet of hosts reconnecting after a relay restart must
    // not synchronize into a thundering herd.
    const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(this.attempt, 6), RECONNECT_MAX_MS);
    const delay = Math.floor(Math.random() * ceiling);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private closeSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.state = 'idle';
    this.bridge?.closeAll(reason);
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.close(code, reason);
      } catch {
        // Already closing.
      }
    }
  }

  // ── Request/response over the control channel ───────────────────

  private request(message: RelayControlMessage & { requestId: string }): Promise<RelayControlMessage> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.state !== 'attached') {
      return Promise.reject(new Error('Relay control channel is not attached'));
    }
    return new Promise<RelayControlMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.requestId);
        reject(new Error('Relay request timed out'));
      }, 15_000);
      timer.unref?.();
      this.pendingRequests.set(message.requestId, { resolve, reject, timer });
      this.send(socket, message);
    });
  }

  private resolveRequest(requestId: string, message: RelayControlMessage): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private send(socket: WebSocket, message: RelayControlMessage): void {
    const payload = JSON.stringify(message);
    if (payload.length > RELAY_MAX_CONTROL_MESSAGE_BYTES) {
      throw new Error('Relay control message exceeds the protocol maximum');
    }
    socket.send(payload);
  }

  private async waitUntilAttached(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.state === 'attached') return;
      if (this.stopped) throw new Error('Relay broker stopped');
      this.ensureConnected();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (this.state === 'attached') return;
    throw new Error('Timed out waiting for the relay control channel');
  }

  private hostPublicKeyBase64Url(): string {
    return this.options.signingKey.publicJwk.x!;
  }

  /** Signature tying this server's `relayHostId` to its relay signing key. */
  private hostBinding(): string {
    return createHostBinding(
      { relayHostId: this.relayHostId, hostPublicKey: this.hostPublicKeyBase64Url() },
      (message) => signBytes('EdDSA', this.options.signingKey.privateKey, Buffer.from(message)),
    );
  }
}
