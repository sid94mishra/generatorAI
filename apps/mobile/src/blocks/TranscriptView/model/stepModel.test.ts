import { describe, expect, it } from 'vitest';
import type { TimelineStep } from '@generatorai/client-core';
import { errorExcerpt, stepOutcome, stepRuns, toolBlockLabel, toolBlockSummary, toolBlockTitle } from './stepModel';

const step = (id: string, kind: TimelineStep['kind'], status: TimelineStep['status'] = 'done', extra: Partial<TimelineStep> = {}): TimelineStep => ({ id, kind, verb: 'Read', target: id, status, ...extra });

describe('tool block (MB-13)', () => {
  it('titles the block in words, in the order kinds first ran', () => {
    const steps = [step('a', 'read'), step('b', 'read'), step('c', 'run'), step('d', 'read'), step('e', 'edit')];
    expect(toolBlockTitle(steps)).toBe('Read 3 files, ran 1 command, edited 1 file');
  });

  it('summarises failures, step count and time; running blocks name the step in flight', () => {
    const done = toolBlockSummary([step('a', 'read', 'done', { durationMs: 100 }), step('b', 'run', 'failed', { durationMs: 48_000 })]);
    expect(done).toMatchObject({ running: false, failed: 1 });
    expect(done.meta.startsWith('2 steps')).toBe(true);
    expect(toolBlockLabel(done)).toContain('1 failed');
    const running = toolBlockSummary([step('a', 'read'), step('b', 'read', 'running')]);
    expect(running.running).toBe(true);
    expect(running.title).toBe('Reading files… 2 so far');
    expect(running.current?.id).toBe('b');
  });

  it('splits delegations from tool steps in order (MB-17)', () => {
    const runs = stepRuns([step('a', 'read'), step('w1', 'delegate'), step('w2', 'delegate'), step('b', 'run')]);
    expect(runs.map((r) => `${r.type}:${r.steps.length}`)).toEqual(['tools:1', 'delegation:2', 'tools:1']);
  });

  it('words the outcome and trims the error excerpt (MB-16)', () => {
    expect(stepOutcome(step('a', 'run', 'failed', { errorText: '3 of 20 failed\nstack' }))).toEqual({ text: '3 of 20 failed', tone: 'err' });
    expect(stepOutcome(step('a', 'run', 'done', { meta: '50 of 50 passed' }))?.tone).toBe('ok');
    expect(stepOutcome(step('a', 'run', 'waiting'))?.tone).toBe('warn');
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    expect(errorExcerpt(long)).toMatchObject({ more: true });
    expect(errorExcerpt(long)!.lines).toHaveLength(12);
    expect(errorExcerpt('  ')).toBeNull();
  });
});
