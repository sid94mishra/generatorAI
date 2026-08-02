// ────────────────────────────────────────────────────────────────
// SecurityAuditService — append-only, redacted record of every
// security-relevant state change and decision.
//
// Rules:
//  - No secret values and no user content ever enter `metadata`.
//  - Source addresses are hashed with a per-process salt.
//  - Events are hash-chained (`previousEventHash`) so tampering with the
//    middle of the log is detectable.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import { redactDeep } from '@generatorai/secrets';
import type {
  AuditResult,
  ISecurityAuditRepository,
  SecurityAuditEventRecord,
} from './ports.js';
import type { Principal } from './principals.js';

export const AuditAction = {
  authSuccess: 'auth.success',
  authFailure: 'auth.failure',
  authDenied: 'auth.denied',
  pairingCreated: 'pairing.created',
  pairingRotated: 'pairing.rotated',
  pairingConsumed: 'pairing.consumed',
  pairingRevoked: 'pairing.revoked',
  pairingFailed: 'pairing.failed',
  deviceCreated: 'device.created',
  deviceRenamed: 'device.renamed',
  deviceScopesChanged: 'device.scopes_changed',
  deviceCredentialRotated: 'device.credential_rotated',
  deviceRevoked: 'device.revoked',
  tokenRefreshed: 'token.refreshed',
  streamTicketIssued: 'stream.ticket_issued',
  streamTicketConsumed: 'stream.ticket_consumed',
  secretWritten: 'secret.written',
  secretDeleted: 'secret.deleted',
  secretBackendDegraded: 'secret.backend_degraded',
  harnessInstanceCreated: 'harness.instance_created',
  harnessInstanceUpdated: 'harness.instance_updated',
  harnessInstanceDeleted: 'harness.instance_deleted',
  permissionModeChanged: 'permission.mode_changed',
  terminalOpened: 'exec.terminal_opened',
  terminalClosed: 'exec.terminal_closed',
  browserOpened: 'exec.browser_opened',
  sshHostKeyTrusted: 'ssh.host_key_trusted',
  sshHostKeyChanged: 'ssh.host_key_changed',
  relayHostConnected: 'relay.host_connected',
  relayInviteCreated: 'relay.invite_created',
  relayCredentialInstalled: 'relay.credential_installed',
  relayRevokeQueued: 'relay.revoke_queued',
  relayRevokeDelivered: 'relay.revoke_delivered',
  signedLinkCreated: 'link.created',
  signedLinkConsumed: 'link.consumed',
  rateLimited: 'auth.rate_limited',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEventInput {
  action: AuditActionName | string;
  result: AuditResult;
  principal?: Principal | null;
  resourceType?: string | null;
  resourceId?: string | null;
  reasonCode?: string | null;
  requestId?: string | null;
  connectionId?: string | null;
  transport?: string | null;
  sourceAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: 'info' | 'warn' | 'critical';
}

export class SecurityAuditService {
  /** Per-process salt: correlates addresses within a run, never reversible. */
  private readonly addressSalt = crypto.randomBytes(32);
  private previousHash: string | null = null;
  /** Serializes appends so the hash chain cannot interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: ISecurityAuditRepository,
    private readonly logger?: { warn(msg: string, meta?: unknown): void },
  ) {}

  record(input: AuditEventInput): void {
    // Fire-and-forget: auditing must never block or fail a request, but the
    // ordering guarantee is preserved by the promise chain.
    this.chain = this.chain.then(
      () => this.append(input),
      () => this.append(input),
    );
  }

  async recordAndWait(input: AuditEventInput): Promise<void> {
    const run = this.chain.then(
      () => this.append(input),
      () => this.append(input),
    );
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  private async append(input: AuditEventInput): Promise<void> {
    try {
      const timestamp = Date.now();
      const metadata = input.metadata
        ? JSON.stringify(redactDeep(input.metadata))
        : null;
      const event: SecurityAuditEventRecord = {
        eventId: crypto.randomUUID(),
        timestamp,
        actorPrincipalType: input.principal?.type ?? 'anonymous',
        actorPrincipalId: input.principal?.id ?? 'anonymous',
        actorDeviceId: input.principal?.deviceId ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        result: input.result,
        reasonCode: input.reasonCode ?? null,
        requestId: input.requestId ?? null,
        connectionId: input.connectionId ?? null,
        transport: input.transport ?? input.principal?.transport ?? null,
        sourceAddressHash: input.sourceAddress ? this.hashAddress(input.sourceAddress) : null,
        metadata,
        severity: input.severity ?? (input.result === 'success' ? 'info' : 'warn'),
      };
      // Hash chain: each row commits to the previous one.
      const chainInput = `${this.previousHash ?? ''}|${event.eventId}|${event.timestamp}|${event.action}|${event.result}`;
      this.previousHash = crypto.createHash('sha256').update(chainInput).digest('base64url');
      await this.repo.append(event);
    } catch (err) {
      this.logger?.warn('[Audit] Failed to persist security audit event', {
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private hashAddress(address: string): string {
    return crypto.createHmac('sha256', this.addressSalt).update(address).digest('base64url').slice(0, 22);
  }

  list(filter?: Parameters<ISecurityAuditRepository['list']>[0]): Promise<SecurityAuditEventRecord[]> {
    return this.repo.list(filter);
  }

  /** Flushes any queued appends — called during graceful shutdown. */
  async flush(): Promise<void> {
    await this.chain.catch(() => undefined);
  }
}
