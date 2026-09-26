// ────────────────────────────────────────────────────────────────
// WorkflowCallbacks — per-wait callback tokens (P05 §4.3, P5-26).
//
// An event wait can be resolved by an external system (CI, a deploy
// pipeline) that holds NO user credential: it POSTs to
// `/api/workflow-callbacks/<token>`. The token is the Step Functions
// task-token pattern: `v1.<runId>.<instanceId>.<mac>`, where mac =
// HMAC-SHA256(key, run ∥ instance ∥ eventKey). It names exactly one wait
// instance and its evaluated event key, so it can deliver that one event
// to that one run and nothing else; the key is the server's own secret
// (a file in the data directory), so tokens survive restarts.
// ────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CallbackTokenParts {
  runId: string;
  instanceId: string;
}

const ID = /^[A-Za-z0-9-]{1,100}$/;

export class WorkflowCallbacks {
  constructor(
    private readonly key: Buffer,
    /** The server's public origin for absolute URLs (`https://host`); omitted gives a path. */
    private readonly origin?: string,
  ) {}

  private mac(runId: string, instanceId: string, eventKey: string): string {
    return createHmac('sha256', this.key).update(`${runId}\n${instanceId}\n${eventKey}`).digest('base64url');
  }

  /** The token of one waiting event wait. */
  token(runId: string, instanceId: string, eventKey: string): string {
    return `v1.${runId}.${instanceId}.${this.mac(runId, instanceId, eventKey)}`;
  }

  url(token: string): string {
    return `${this.origin?.replace(/\/$/, '') ?? ''}/api/workflow-callbacks/${token}`;
  }

  /** The token and URL of a wait, or null when it is not a waiting event wait. */
  forWait(runId: string, instanceId: string, eventKey: string | undefined): { url: string; token: string } | null {
    if (eventKey === undefined) return null;
    const token = this.token(runId, instanceId, eventKey);
    return { url: this.url(token), token };
  }

  /** The run and instance a token names (not yet verified: `verify` needs the wait's event key). */
  parse(token: string): CallbackTokenParts | null {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || !ID.test(parts[1]!) || !ID.test(parts[2]!)) return null;
    return { runId: parts[1]!, instanceId: parts[2]! };
  }

  /** Whether the token was minted for this wait and event key (constant time). */
  verify(token: string, eventKey: string): boolean {
    const parts = this.parse(token);
    if (!parts) return false;
    const expected = Buffer.from(this.token(parts.runId, parts.instanceId, eventKey));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
