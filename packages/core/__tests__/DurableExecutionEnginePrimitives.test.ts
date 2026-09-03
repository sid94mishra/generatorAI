// ────────────────────────────────────────────────────────────────
// DurableExecutionEngine — effect sandwich, Signal, Awakeable (W22 §3.4).
//
// Found with ZERO test coverage during the W39/W34/W22 pass: only iteration
// claiming (DurableExecutionEngineIterations.test.ts) had tests. This file
// covers the rest of the class's public surface — `withEffect`,
// `resolveSignal`/`awaitSignal`, `createAwakeable`/`resolveAwakeable`/
// `recoverAwakeables` — including the crash-recovery behavior each
// primitive's own doc comment claims (memoized replay, prior-resolved-signal
// recovery, awakeable re-arming across a fresh engine instance against the
// same DB, simulating a process restart).
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import { DurableExecutionEngine, type DurableContext } from '../src/services/DurableExecutionEngine.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

let dir: string;
let db: AppDatabase;
let engine: DurableExecutionEngine;

const ctx: DurableContext = { scope: 'stage_run', scopeId: 'stage-1' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-durable-primitives-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  engine = new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), mockLogger());
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

/** A fresh engine against the same DB — simulates a process restart. */
function restart(): DurableExecutionEngine {
  return new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), mockLogger());
}

describe('DurableExecutionEngine.withEffect — the effect sandwich', () => {
  it('performs the effect exactly once and returns its result', async () => {
    const perform = vi.fn(async () => 'result-1');
    const result = await engine.withEffect(ctx, { operationId: 'op-1', replayPolicy: 'safe', perform });
    expect(result).toBe('result-1');
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('memoizes a settled effect — a second call with the same operationId never re-runs perform()', async () => {
    const perform = vi.fn(async () => 'only-once');
    await engine.withEffect(ctx, { operationId: 'op-2', replayPolicy: 'never', perform });
    const second = await engine.withEffect(ctx, { operationId: 'op-2', replayPolicy: 'never', perform });
    expect(second).toBe('only-once');
    expect(perform).toHaveBeenCalledTimes(1); // NOT called again
  });

  it('memoization survives a fresh engine instance against the same DB (restart)', async () => {
    const perform = vi.fn(async () => ({ output: 42 }));
    await engine.withEffect(ctx, { operationId: 'op-3', replayPolicy: 'never', perform });

    const resumed = restart();
    const performAfterRestart = vi.fn(async () => ({ output: 999 }));
    const result = await resumed.withEffect(ctx, { operationId: 'op-3', replayPolicy: 'never', perform: performAfterRestart });

    expect(result).toEqual({ output: 42 }); // the ORIGINAL result, not a re-run
    expect(performAfterRestart).not.toHaveBeenCalled();
  });

  it('replay:safe re-runs the effect when intent was committed but no settlement landed (crash between intent and perform)', async () => {
    // Simulate "died between intent and perform": write the register
    // directly without ever calling perform(), the way a real crash would
    // leave things (intent committed, no entries row).
    const registerRepo = new RegisterRepository(db);
    registerRepo.set(ctx.scope, ctx.scopeId, 'op.state/op-4', {
      state: 'intent',
      outputId: 'abc',
      intentAt: Date.now(),
    });

    const perform = vi.fn(async () => 'recovered');
    const result = await engine.withEffect(ctx, { operationId: 'op-4', replayPolicy: 'safe', perform });
    expect(result).toBe('recovered');
    expect(perform).toHaveBeenCalledTimes(1); // safe replay DOES re-run
  });

  it('replay:never returns a synthetic error instead of re-running when intent was committed but no settlement landed', async () => {
    const registerRepo = new RegisterRepository(db);
    registerRepo.set(ctx.scope, ctx.scopeId, 'op.state/op-5', {
      state: 'intent',
      outputId: 'abc',
      intentAt: Date.now(),
    });

    const perform = vi.fn(async () => 'must-not-run');
    const result = await engine.withEffect<{ __synthetic: boolean; reason: string }>(ctx, {
      operationId: 'op-5',
      replayPolicy: 'never',
      perform: perform as unknown as () => Promise<{ __synthetic: boolean; reason: string }>,
    });

    expect(perform).not.toHaveBeenCalled(); // LINT-HAZ-3: never re-run a replay:never effect
    expect(result).toMatchObject({ __synthetic: true, reason: 'missing_settlement' });

    // The synthetic result is itself durably settled — a THIRD call must
    // return the exact same synthetic payload, not attempt recovery again.
    const third = await engine.withEffect(ctx, { operationId: 'op-5', replayPolicy: 'never', perform });
    expect(third).toMatchObject({ __synthetic: true, reason: 'missing_settlement' });
    expect(perform).not.toHaveBeenCalled();
  });

  it('does not commit a settlement when the effect throws — a later call still sees the intent, not a poisoned result', async () => {
    const failing = vi.fn(async () => {
      throw new Error('transient failure');
    });
    await expect(
      engine.withEffect(ctx, { operationId: 'op-6', replayPolicy: 'safe', perform: failing }),
    ).rejects.toThrow('transient failure');

    // Retry with a succeeding perform() — safe replay picks it up cleanly.
    const succeeding = vi.fn(async () => 'succeeded-on-retry');
    const result = await engine.withEffect(ctx, { operationId: 'op-6', replayPolicy: 'safe', perform: succeeding });
    expect(result).toBe('succeeded-on-retry');
  });

  it('recovers a settled register whose settlement row was pruned — replay:safe re-runs it', async () => {
    // This shape used to be treated as `unreachable_state` and THROWN. It is
    // genuinely producible: `registers` rows outlive `entries` rows, which are
    // pruned by `deleteByScope` on teardown and by retention generally, so a
    // settled operation whose settlement has been reclaimed lands here on the
    // next replay. Throwing turned ordinary retention into a stage failure.
    const registerRepo = new RegisterRepository(db);
    registerRepo.set(ctx.scope, ctx.scopeId, 'op.state/op-7', {
      state: 'settled',
      outputId: 'abc',
      intentAt: Date.now(),
      settledAt: Date.now(),
    });

    const perform = vi.fn(async () => 'x');
    await expect(
      engine.withEffect(ctx, { operationId: 'op-7', replayPolicy: 'safe', perform }),
    ).resolves.toBe('x');
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('a settled register whose settlement row was pruned returns the synthetic error for replay:never', async () => {
    // The `never` policy must still refuse to re-run the effect — the point of
    // the policy is that the side effect may already have happened.
    const registerRepo = new RegisterRepository(db);
    registerRepo.set(ctx.scope, ctx.scopeId, 'op.state/op-7b', {
      state: 'settled',
      outputId: 'abc',
      intentAt: Date.now(),
      settledAt: Date.now(),
    });

    const perform = vi.fn(async () => 'must-not-run');
    await expect(
      engine.withEffect(ctx, { operationId: 'op-7b', replayPolicy: 'never', perform }),
    ).resolves.toMatchObject({ __synthetic: true, reason: 'missing_settlement' });
    expect(perform).not.toHaveBeenCalled();
  });

  it('still throws unreachable_state for a register state the protocol cannot produce', async () => {
    const registerRepo = new RegisterRepository(db);
    registerRepo.set(ctx.scope, ctx.scopeId, 'op.state/op-7c', {
      state: 'not-a-real-state',
      outputId: 'abc',
      intentAt: Date.now(),
    });

    await expect(
      engine.withEffect(ctx, { operationId: 'op-7c', replayPolicy: 'safe', perform: async () => 'x' }),
    ).rejects.toThrow(/unreachable_state/);
  });

  it('settles the entry and the register as ONE transaction — a failed register write leaves no orphan entry', async () => {
    // §3.4 requires the settlement to be a single atomic write. Un-transacted,
    // a failure (or a crash) between the two left a `tool_result` row with the
    // register still reading `intent`: harmless for replay:safe, but a
    // permanent lie for replay:never, which then reports `missing_settlement`
    // for an effect that demonstrably completed.
    const registerRepo = new RegisterRepository(db);
    const entryRepo = new EntryRepository(db);
    const isolated = new DurableExecutionEngine(registerRepo, entryRepo, mockLogger());

    const realSet = registerRepo.set.bind(registerRepo);
    vi.spyOn(registerRepo, 'set').mockImplementation((scope, scopeId, key, value) => {
      if ((value as { state?: string }).state === 'settled') throw new Error('disk full');
      return realSet(scope, scopeId, key, value);
    });

    await expect(
      isolated.withEffect(ctx, { operationId: 'op-9', replayPolicy: 'never', perform: async () => 'done' }),
    ).rejects.toThrow('disk full');

    expect(entryRepo.findToolResult(ctx.scope, ctx.scopeId, 'op-9')).toBeUndefined();
  });

  it('adopts a settlement that landed first rather than failing the effect it already performed', async () => {
    // Migration 42 makes (scope, scope_id, key) unique for `tool_result`, so a
    // writer that loses the race hits a constraint failure. Its effect DID
    // run; the right answer is the row that won, not an exception.
    const entryRepo = new EntryRepository(db);
    const racy = new DurableExecutionEngine(new RegisterRepository(db), entryRepo, mockLogger());

    const result = await racy.withEffect(ctx, {
      operationId: 'op-10',
      replayPolicy: 'safe',
      perform: async () => {
        // Another process settles the same operationId while we are working.
        entryRepo.create({
          scope: ctx.scope,
          scopeId: ctx.scopeId,
          kind: 'tool_result',
          key: 'op-10',
          payload: JSON.stringify('winner'),
        });
        return 'loser';
      },
    });

    expect(result).toBe('winner');
    // And exactly one settlement row exists for the operation.
    expect(entryRepo.findToolResult(ctx.scope, ctx.scopeId, 'op-10')?.payload).toBe('"winner"');
  });

  it('honours custom serialize/deserialize for memoization', async () => {
    const perform = vi.fn(async () => new Set(['a', 'b']));
    const serialize = (s: Set<string>) => JSON.stringify([...s]);
    const deserialize = (raw: string) => new Set(JSON.parse(raw) as string[]);

    await engine.withEffect(ctx, { operationId: 'op-8', replayPolicy: 'never', perform, serialize, deserialize });
    const replayed = await engine.withEffect(ctx, { operationId: 'op-8', replayPolicy: 'never', perform, serialize, deserialize });

    expect(replayed).toEqual(new Set(['a', 'b']));
    expect(perform).toHaveBeenCalledTimes(1);
  });
});

describe('DurableExecutionEngine — Signal primitive', () => {
  it('awaitSignal resolves when resolveSignal fires for the same name', async () => {
    const pending = engine.awaitSignal(ctx, 'steer', 5_000);
    engine.resolveSignal(ctx, 'steer', { direction: 'left' });
    await expect(pending).resolves.toEqual({ direction: 'left' });
  });

  it('awaitSignal times out when nothing resolves it within timeoutMs', async () => {
    await expect(engine.awaitSignal(ctx, 'never-fires', 20)).rejects.toThrow(/timed out/);
  });

  it('F2 — awaitSignal called AFTER resolveSignal returns the prior payload immediately (recovery)', async () => {
    engine.resolveSignal(ctx, 'already-happened', { value: 1 });
    // A late awaiter (e.g. after a restart re-enters the code that awaits
    // this signal) must not hang until timeout — the signal already fired.
    await expect(engine.awaitSignal(ctx, 'already-happened', 5_000)).resolves.toEqual({ value: 1 });
  });

  it('is resolvable repeatedly — each resolve is a fresh occurrence, not a one-shot', () => {
    engine.resolveSignal(ctx, 'repeatable', 1);
    engine.resolveSignal(ctx, 'repeatable', 2);
    // Both should be independently recorded; awaiting after both fired
    // returns the LAST resolved payload (findLastResolvedSignal).
    return expect(engine.awaitSignal(ctx, 'repeatable', 5_000)).resolves.toBe(2);
  });
});

describe('DurableExecutionEngine — Awakeable primitive', () => {
  it('resolveAwakeable unblocks the promise from createAwakeable', async () => {
    const { token, promise } = engine.createAwakeable(ctx, 5_000);
    const ok = engine.resolveAwakeable(token, { approved: true });
    expect(ok).toBe(true);
    await expect(promise).resolves.toEqual({ approved: true });
  });

  it('resolveAwakeable on an unknown token returns false', () => {
    expect(engine.resolveAwakeable('does-not-exist', {})).toBe(false);
  });

  it('resolveAwakeable on an already-resolved token returns false (no double-resolve)', () => {
    const { token } = engine.createAwakeable(ctx, 5_000);
    expect(engine.resolveAwakeable(token, { first: true })).toBe(true);
    expect(engine.resolveAwakeable(token, { second: true })).toBe(false);
  });

  it('createAwakeable rejects on timeout when never resolved', async () => {
    const { promise } = engine.createAwakeable(ctx, 20);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it('W22 crash recovery — recoverAwakeables() on a FRESH engine instance re-arms a pending token so a later resolve reaches it', async () => {
    // "Process 1" creates the awakeable and parks (never resolved before "crash").
    const { token } = engine.createAwakeable(ctx, 60_000);

    // "Process 2" — a fresh engine against the same DB.
    const resumed = restart();
    const recovered = resumed.recoverAwakeables(ctx, 60_000);
    expect(recovered.has(token)).toBe(true);

    // The external party resolves the token against the NEW process's engine.
    const ok = resumed.resolveAwakeable(token, { approved: true, reason: 'resumed after restart' });
    expect(ok).toBe(true);
    await expect(recovered.get(token)).resolves.toEqual({ approved: true, reason: 'resumed after restart' });
  });

  it('recoverAwakeables() returns an immediately-resolved promise for a token that was ALREADY resolved before the restart', async () => {
    const { token } = engine.createAwakeable(ctx, 60_000);
    engine.resolveAwakeable(token, { approved: false, reason: 'rejected before crash' });

    const resumed = restart();
    const recovered = resumed.recoverAwakeables(ctx, 60_000);
    await expect(recovered.get(token)).resolves.toEqual({ approved: false, reason: 'rejected before crash' });
  });

  it('recoverAwakeables() only returns awakeables for the given scope/scopeId', async () => {
    const other: DurableContext = { scope: 'stage_run', scopeId: 'stage-OTHER' };
    const { token: tokenA } = engine.createAwakeable(ctx, 60_000);
    const { token: tokenB } = engine.createAwakeable(other, 60_000);

    const recoveredForCtx = engine.recoverAwakeables(ctx, 60_000);
    expect(recoveredForCtx.has(tokenA)).toBe(true);
    expect(recoveredForCtx.has(tokenB)).toBe(false);
  });

  it('LINT-HAZ-4 — a timeoutMs beyond Node\'s 32-bit setTimeout ceiling (~24.8 days) does NOT fire early', async () => {
    // Node's setTimeout silently clamps an oversized delay to ~1ms instead
    // of erroring (verified via a TimeoutOverflowWarning), which would have
    // rejected a "30-day" gate within the same tick it was created — exactly
    // the footgun LINT-HAZ-4's own doc comment invites ("explicitly pass a
    // larger timeout") without warning it isn't safe above ~24.8 days. This
    // proves `armTimer`'s chaining actually prevents that: with the bug, this
    // promise would already be rejected by the time we check it.
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // > 2^31-1
    const { token, promise } = engine.createAwakeable(ctx, THIRTY_DAYS_MS);

    // Give any (buggy) immediate-fire timer a chance to run.
    await new Promise((r) => setTimeout(r, 30));

    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false); // still pending — did not fire early

    // Clean up: resolve it so nothing dangles past this test.
    engine.resolveAwakeable(token, { ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  // ── Retraction — the deliberate counterpart to memoisation ──────

  describe('discardOperation', () => {
    it('makes the next withEffect for the same id run live instead of replaying', async () => {
      let runs = 0;
      const perform = async () => { runs += 1; return `run-${runs}`; };

      await expect(
        engine.withEffect(ctx, { operationId: 'op-1', replayPolicy: 'never', perform }),
      ).resolves.toBe('run-1');
      // Memoised: the second call does not perform.
      await expect(
        engine.withEffect(ctx, { operationId: 'op-1', replayPolicy: 'never', perform }),
      ).resolves.toBe('run-1');
      expect(runs).toBe(1);

      engine.discardOperation(ctx, 'op-1');

      await expect(
        engine.withEffect(ctx, { operationId: 'op-1', replayPolicy: 'never', perform }),
      ).resolves.toBe('run-2');
      expect(runs).toBe(2);
    });

    it('retracts an INTENT with no settlement, so replay:never stops synthesising a skip', async () => {
      // The shape a pause leaves behind: intent committed, the effect never
      // settled. Untouched, `replay: never` answers with a synthetic result
      // for ever — which is how a resumed stage completed on a truncated turn.
      await expect(
        engine.withEffect(ctx, {
          operationId: 'op-2',
          replayPolicy: 'never',
          perform: async () => { throw new Error('interrupted'); },
        }),
      ).rejects.toThrow('interrupted');

      const synthetic = await engine.withEffect(ctx, {
        operationId: 'op-2', replayPolicy: 'never', perform: async () => 'live',
      });
      expect(synthetic).toMatchObject({ __synthetic: true, reason: 'missing_settlement' });

      engine.discardOperation(ctx, 'op-2');

      await expect(
        engine.withEffect(ctx, { operationId: 'op-2', replayPolicy: 'never', perform: async () => 'live' }),
      ).resolves.toBe('live');
    });

    it('is scoped to one operation and is a no-op for an id that was never journalled', () => {
      expect(() => engine.discardOperation(ctx, 'never-existed')).not.toThrow();
    });
  });

  describe('reopenArtifact', () => {
    it('lets a new attempt append to an artifact a previous attempt sealed', () => {
      engine.appendArtifact(ctx, 'stage-output', 'first attempt\n');
      engine.appendArtifact(ctx, 'stage-output', 'sealed\n', { last: true });

      // The seal is what silently swallowed every later append — and every
      // call site discarded the null, so successors kept reading stale text.
      expect(engine.appendArtifact(ctx, 'stage-output', 'second attempt\n')).toBeNull();
      expect(engine.getArtifact(ctx, 'stage-output')!.text).not.toContain('second attempt');

      expect(engine.reopenArtifact(ctx, 'stage-output')!.complete).toBe(false);

      expect(engine.appendArtifact(ctx, 'stage-output', 'second attempt\n')).not.toBeNull();
      const after = engine.getArtifact(ctx, 'stage-output')!;
      expect(after.text).toContain('first attempt');
      expect(after.text).toContain('second attempt');
    });

    it('returns null when there is nothing sealed to reopen', () => {
      expect(engine.reopenArtifact(ctx, 'never-opened')).toBeNull();
      engine.appendArtifact(ctx, 'open-one', 'x');
      expect(engine.reopenArtifact(ctx, 'open-one')).toBeNull();
    });
  });
});
