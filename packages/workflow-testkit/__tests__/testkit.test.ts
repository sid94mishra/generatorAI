// Unit tests for the testkit's own building blocks.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ScriptBook, VirtualClock, classifyPrompt, defaultReply, toImportJson, type StageKey } from '../src/index.js';

const key = (stageName: string, stageRunId = stageName): StageKey => ({
  stageName,
  stageRunId,
  workflowRunId: 'r',
  conversationId: 'c',
});

describe('classifyPrompt', () => {
  it('recognises every internal turn the stage executor sends today', () => {
    expect(classifyPrompt('The following stages have already been completed in this workflow.')).toBe('context');
    expect(classifyPrompt('Provide a concise summary (max 500 words) of all the work')).toBe('summary');
    expect(classifyPrompt('Your response did not include a clear summary of your work.')).toBe('output_retry');
    expect(classifyPrompt('Your response is missing the required structured output.')).toBe('output_retry');
    expect(classifyPrompt('⚠️ **Validation Failed (Retry attempt 1)**')).toBe('validation_feedback');
    expect(classifyPrompt('⚠️ **Validation Feedback (Retry attempt 1)**')).toBe('validation_feedback');
    expect(classifyPrompt('This stage was interrupted by a restart and has resumed')).toBe('recap');
    expect(classifyPrompt('Continue from where you left off and complete your response.')).toBe('continuation');
    expect(classifyPrompt('Do X\n\n---\n**IMPORTANT: How to create files**\n...')).toBe('prompt');
    expect(classifyPrompt('Append the word REVISED.')).toBe('follow_up');
  });

  it('default work replies stay above the 50-char output-retry threshold', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (name) => {
        expect(defaultReply('prompt', name).length).toBeGreaterThanOrEqual(50);
      }),
    );
  });
});

describe('ScriptBook', () => {
  it('gives each stage run its own copy and routes turns by kind', () => {
    const book = new ScriptBook({ A: [{ text: 'work' }, { on: 'summary', text: 'sum' }], '*': [{ text: 'any' }] });
    expect(book.take(key('A', 'a1'), 'summary')?.text).toBe('sum');
    expect(book.take(key('A', 'a1'), 'context')).toBeUndefined();
    expect(book.take(key('A', 'a1'), 'prompt')?.text).toBe('work');
    expect(book.take(key('A', 'a1'), 'prompt')).toBeUndefined();
    expect(book.take(key('A', 'a2'), 'prompt')?.text).toBe('work');
    expect(book.take(key('B'), 'prompt')?.text).toBe('any');
  });

  it('consumes work turns in order for any interleaving of internal kinds', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('context', 'summary', 'output_retry', 'recap') as fc.Arbitrary<'context'>, { maxLength: 6 }), (internal) => {
        const book = new ScriptBook({ S: [{ text: '1' }, { text: '2' }] });
        for (const k of internal) expect(book.take(key('S'), k)).toBeUndefined();
        expect(book.take(key('S'), 'prompt')?.text).toBe('1');
        expect(book.take(key('S'), 'follow_up')?.text).toBe('2');
      }),
    );
  });
});

describe('VirtualClock', () => {
  it('releases sleeps in deadline order only when advanced', async () => {
    const clock = new VirtualClock(0);
    const order: number[] = [];
    void clock.sleep(30).then(() => order.push(30));
    void clock.sleep(10).then(() => order.push(10));
    await clock.advance(5);
    expect(order).toEqual([]);
    await clock.advance(30);
    expect(order).toEqual([10, 30]);
    expect(clock.now()).toBe(35);
  });

  it('an abort resolves a pending sleep early', async () => {
    const clock = new VirtualClock(0);
    const ac = new AbortController();
    const p = clock.sleep(1_000, ac.signal);
    ac.abort();
    await p;
    expect(clock.pendingCount).toBe(0);
  });
});

describe('toImportJson', () => {
  it('maps named edges to indices and applies the route schema defaults', () => {
    const doc = toImportJson({ stages: [{ name: 'A', prompt: 'a' }, { name: 'B', prompt: 'b' }], edges: [['A', 'B', 'always']] });
    expect(doc.edges).toEqual([{ fromStageIndex: 0, toStageIndex: 1, edgeType: 'always' }]);
    expect(doc.stages[0]!.prompts[0]).toEqual({ label: 'A', text: 'a' });
    expect(doc.sessionMode).toBe('auto');
    expect(() => toImportJson({ stages: [{ name: 'A' }], edges: [['A', 'Z']] })).toThrow(/unknown stage "Z"/);
  });
});
