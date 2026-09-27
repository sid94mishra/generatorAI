// ────────────────────────────────────────────────────────────────
// IdempotencyService — claim-then-finalize idempotency keys (lifted out of
// the automation routes for the invocation path, P04 WP-4.2; G4 §1.3.5).
//
// A key is claimed with a placeholder execution id first, so a concurrent
// second request sees the row and replays instead of executing too. The
// winner executes and rewrites the placeholder to the real id; a failed
// execution releases the key. With a request hash (invocations), a replay
// whose request differs is refused (`IDEMPOTENCY_KEY_REUSED`).
// A placeholder a crashed process left behind is not a 409 for the whole
// TTL (CONVINV-R7): the caller's `recover` finds what that execution
// created and the replay answers it; with nothing to find, a claim older
// than `staleAfterMs` is freed and claimed again.
// Automation triggers and webhooks keep their 5-minute window; invocations
// use 24 hours.
// ────────────────────────────────────────────────────────────────

import { ConflictError, GeneratorAIError, ValidationError, type ILogger } from '@generatorai/shared';
import type { IIdempotencyKeyStore } from '../domain/ports/IInvocationStores.js';

export const IDEMPOTENCY_MAX_KEY_LEN = 200;
/** Automation triggers and webhook retries. */
export const WEBHOOK_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
/** Workflow invocations. */
export const INVOCATION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The same key was used for a different request. */
export class IdempotencyKeyReusedError extends GeneratorAIError {
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  readonly httpStatus = 409;
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used for a different request`, 'IDEMPOTENCY_KEY_REUSED');
  }
}

export type IdempotentOutcome<T> =
  | { replayed: false; executionId: string; value: T }
  | { replayed: true; executionId: string };

/** Throws `ValidationError` for a key that is too long or not printable ASCII. */
export function assertIdempotencyKey(key: string): void {
  if (key.length > IDEMPOTENCY_MAX_KEY_LEN) throw new ValidationError(`Idempotency-Key exceeds ${IDEMPOTENCY_MAX_KEY_LEN} chars`);
  // Printable ASCII (RFC 7230 tokens) so control bytes cannot be smuggled into a scope's key space.
  if (!/^[!-~]+$/.test(key)) throw new ValidationError('Idempotency-Key must contain only printable ASCII (no control chars)');
}

export class IdempotencyService {
  constructor(
    private readonly store: IIdempotencyKeyStore,
    private readonly logger?: ILogger,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Run `execute` once per `(key, scope)` within the TTL. No key: always
   * executes. A replay answers the first execution's id without executing.
   */
  async run<T>(
    opts: {
      key: string | undefined;
      scope: string;
      ttlMs: number;
      requestHash?: string;
      /** A pending claim was hit: the id of what its execution created, if anything. */
      recover?: () => Promise<string | undefined>;
      /** A pending claim older than this, with nothing recovered, is freed and claimed again. */
      staleAfterMs?: number;
    },
    execute: () => Promise<{ executionId: string; value: T }>,
    reclaimed = false,
  ): Promise<IdempotentOutcome<T>> {
    const key = opts.key?.trim();
    if (!key) {
      const r = await execute();
      return { replayed: false, executionId: r.executionId, value: r.value };
    }
    assertIdempotencyKey(key);
    const now = new Date(this.now());
    const placeholder = `pending-${opts.scope}-${key}`.slice(0, 200);
    let claim: { executionId: string; replay: boolean; requestHash: string | null; createdAt?: Date };
    try {
      claim = await this.store.claim({
        key,
        scope: opts.scope,
        executionId: placeholder,
        createdAt: now,
        expiresAt: new Date(now.getTime() + opts.ttlMs),
        requestHash: opts.requestHash ?? null,
      });
    } catch (err) {
      // A storage blip must not block legitimate traffic: run unclaimed.
      this.logger?.warn(`[Idempotency] claim of ${opts.scope} failed; executing unclaimed: ${String(err)}`);
      const r = await execute();
      return { replayed: false, executionId: r.executionId, value: r.value };
    }
    if (claim.replay) {
      if (opts.requestHash && claim.requestHash && claim.requestHash !== opts.requestHash) throw new IdempotencyKeyReusedError(key);
      if (claim.executionId === placeholder) {
        const found = await opts.recover?.().catch(() => undefined);
        if (found) {
          await this.store.updateExecutionId(key, opts.scope, found).catch(() => undefined);
          return { replayed: true, executionId: found };
        }
        const staleBefore = opts.staleAfterMs !== undefined ? now.getTime() - opts.staleAfterMs : undefined;
        if (!reclaimed && staleBefore !== undefined && claim.createdAt && claim.createdAt.getTime() < staleBefore) {
          this.logger?.warn(`[Idempotency] ${opts.scope}/${key} was left pending since ${claim.createdAt.toISOString()}; claiming it again`);
          // Only the stale row goes: a claim another caller just re-made stays.
          await this.store.release(key, opts.scope, { createdBefore: new Date(staleBefore) });
          return this.run(opts, execute, true);
        }
        throw new ConflictError(`A request with idempotency key "${key}" is still in progress`);
      }
      return { replayed: true, executionId: claim.executionId };
    }
    let r: { executionId: string; value: T };
    try {
      r = await execute();
    } catch (err) {
      await this.store.release(key, opts.scope).catch(() => undefined);
      throw err;
    }
    await this.store.updateExecutionId(key, opts.scope, r.executionId).catch((err: unknown) => {
      this.logger?.warn(`[Idempotency] finalizing ${opts.scope}/${key} failed: ${String(err)}`);
    });
    return { replayed: false, executionId: r.executionId, value: r.value };
  }
}
