// ────────────────────────────────────────────────────────────────
// W13 / B1 — a truncated response never executes a tool.
//
// The two shipped truncation PREDICATES (`isTruncationStopReason`,
// `isTruncationFinishReason`) are pinned by `__tests__/truncation-guard.test.ts`
// against the real providers, and are deliberately not re-tested here. This
// file covers the second half of the rule: the execution-seam latch, which the
// event-path guard cannot provide because the Claude provider's tool bodies
// run inside an in-process MCP server the SDK drives directly.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  TurnExecutionLatch,
  TruncatedTurnError,
  truncationGuidance,
} from '../../src/hardening/truncation.js';
import { ToolSemaphore } from '../../src/toolSemaphore.js';

describe('W13 / B1 — truncation execution latch', () => {
  it('lets tools run on an untruncated turn', () => {
    const latch = new TurnExecutionLatch();
    latch.beginTurn('c1');
    expect(() => latch.assertExecutable('c1', 'Write')).not.toThrow();
  });

  it('REFUSES every tool once the turn is marked truncated', () => {
    const latch = new TurnExecutionLatch();
    latch.beginTurn('c1');
    latch.markTruncated('c1', 'length');
    expect(() => latch.assertExecutable('c1', 'Write')).toThrow(TruncatedTurnError);
    expect(() => latch.assertExecutable('c1', 'Bash')).toThrow(TruncatedTurnError);
    expect(latch.refusalCount).toBe(2);
  });

  it('does not leak the latch into another conversation', () => {
    const latch = new TurnExecutionLatch();
    latch.markTruncated('c1', 'max_tokens');
    expect(() => latch.assertExecutable('c2', 'Write')).not.toThrow();
  });

  it('clears on the NEXT turn — truncation is a property of one response', () => {
    const latch = new TurnExecutionLatch();
    latch.markTruncated('c1', 'length');
    expect(latch.isTruncated('c1')).toBe(true);
    latch.beginTurn('c1');
    expect(latch.isTruncated('c1')).toBe(false);
    expect(() => latch.assertExecutable('c1', 'Write')).not.toThrow();
  });

  it('carries the stop reason on the error, for the event path to reuse', () => {
    const latch = new TurnExecutionLatch();
    latch.markTruncated('c1', 'max_tokens');
    try {
      latch.assertExecutable('c1', 'Write');
      throw new Error('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(TruncatedTurnError);
      expect((err as TruncatedTurnError).stopReason).toBe('max_tokens');
    }
  });
});

describe('W13 / B1 — model-legible re-issue guidance', () => {
  it('names the cause, states that nothing ran, and gives a next action', () => {
    const msg = truncationGuidance({ stopReason: 'length', toolCallCount: 3 });
    expect(msg).toContain('length');
    expect(msg).toMatch(/All 3 tool call\(s\) in this batch were NOT executed/);
    // The model must not have to guess whether a write half-happened.
    expect(msg).toMatch(/nothing was written, deleted, or run/);
    expect(msg).toMatch(/no partial state exists/);
    // …and it must know what to do differently, or it re-issues the same
    // oversized request and truncates again.
    expect(msg).toMatch(/fewer tool calls|smaller result/);
  });

  it('names the specific tool when one handler is refused', () => {
    const msg = truncationGuidance({ stopReason: 'length', toolName: 'Write' });
    expect(msg).toContain('"Write" was NOT executed');
  });
});

describe('W13 / B1 — the latch is wired into ToolSemaphore.runGuarded', () => {
  it('a truncated turn cannot execute a tool through the semaphore', async () => {
    const sem = new ToolSemaphore(8);
    let ran = false;
    sem.beginTurn('c1');
    sem.markTruncated('c1', 'length');

    await expect(
      sem.runGuarded('Write', async () => { ran = true; return 'wrote'; }, { conversationId: 'c1' }),
    ).rejects.toThrow(TruncatedTurnError);

    // The handler body never ran: no file was written with half-parsed args.
    expect(ran).toBe(false);
  });

  it('refuses BEFORE taking a permit, so a refusal never queues behind live work', async () => {
    const sem = new ToolSemaphore(1);
    sem.markTruncated('c1', 'length');

    // Occupy the single permit with a call that will not finish soon.
    let release!: () => void;
    const held = sem.runGuarded('Slow', () => new Promise<void>((r) => { release = r; }));

    // If the latch check happened after `acquire()`, this would block until
    // `release()` — i.e. a Stop-adjacent refusal would wait on the thing it is
    // refusing because of.
    await expect(
      sem.runGuarded('Write', async () => 'x', { conversationId: 'c1' }),
    ).rejects.toThrow(TruncatedTurnError);

    release();
    await held;
  });

  it('a truncation refusal does not count against the tool on the poison ladder', async () => {
    const sem = new ToolSemaphore(8);
    sem.markTruncated('c1', 'length');
    for (let i = 0; i < 6; i++) {
      await sem.runGuarded('Write', async () => 'x', { conversationId: 'c1' }).catch(() => undefined);
    }
    // Quarantining a healthy tool because six turns truncated would be wrong:
    // the tool never even ran.
    expect(sem.poison.statusOf('Write')).toBe('healthy');
  });

  it('beginTurn clears the latch and resets the ladder', async () => {
    const sem = new ToolSemaphore(8);
    sem.markTruncated('c1', 'length');
    for (let i = 0; i < 5; i++) sem.poison.recordFailure('Read');
    expect(sem.poison.statusOf('Read')).toBe('quarantined');

    sem.beginTurn('c1');
    expect(sem.latch.isTruncated('c1')).toBe(false);
    expect(sem.poison.statusOf('Read')).toBe('healthy');
    await expect(sem.runGuarded('Read', async () => 'ok', { conversationId: 'c1' })).resolves.toBe('ok');
  });

  it('callers that pass no conversationId still get the rest of the ladder', async () => {
    const sem = new ToolSemaphore(8);
    sem.markTruncated('c1', 'length');
    // No conversationId → the latch is not consulted (a global latch would let
    // one conversation's truncation refuse another's tools).
    await expect(sem.runGuarded('Read', async () => 'ok')).resolves.toBe('ok');
  });
});
