// ────────────────────────────────────────────────────────────────
// CodebaseLogService (G-16) — ring buffer + job tracking, pure/in-memory.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { CodebaseLogService } from '../CodebaseLogService.js';

describe('CodebaseLogService', () => {
  it('answers no job and no lines for a codebase nothing has run against', () => {
    const svc = new CodebaseLogService();
    expect(svc.getLogs('cb-unknown')).toEqual({ lines: [] });
  });

  it('starts a job in "running" and appends lines to it', () => {
    const svc = new CodebaseLogService();
    const job = svc.startJob('cb1', 'fetch');
    expect(job.kind).toBe('fetch');
    expect(job.status).toBe('running');
    expect(job.endedAt).toBeUndefined();

    svc.appendLine('cb1', 'stdout', 'Fetching origin');
    svc.appendLine('cb1', 'stderr', 'remote: Counting objects: 3, done.');

    const logs = svc.getLogs('cb1');
    expect(logs.lines.map((l) => l.text)).toEqual(['Fetching origin', 'remote: Counting objects: 3, done.']);
    expect(logs.lines[0]!.stream).toBe('stdout');
    expect(logs.lines[1]!.stream).toBe('stderr');
    expect(logs.job?.id).toBe(job.id);
    expect(logs.job?.status).toBe('running');
  });

  it('finishing a job records the outcome and end time', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'clone');
    svc.finishJob('cb1', 'succeeded');
    expect(svc.getLogs('cb1').job).toMatchObject({ status: 'succeeded' });
    expect(svc.getLogs('cb1').job?.endedAt).toBeDefined();
  });

  it('finishing with an error records it', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'fetch');
    svc.finishJob('cb1', 'failed', 'authentication failed');
    expect(svc.getLogs('cb1').job).toMatchObject({ status: 'failed', error: 'authentication failed' });
  });

  it('finishJob is a no-op when no job was ever started (e.g. a fresh boot)', () => {
    const svc = new CodebaseLogService();
    expect(() => svc.finishJob('cb-never-started', 'succeeded')).not.toThrow();
    expect(svc.getLogs('cb-never-started').job).toBeUndefined();
  });

  it('a later job REPLACES the previous one, not appends to it', () => {
    const svc = new CodebaseLogService();
    const first = svc.startJob('cb1', 'clone');
    svc.finishJob('cb1', 'succeeded');
    const second = svc.startJob('cb1', 'fetch');
    expect(svc.getLogs('cb1').job?.id).toBe(second.id);
    expect(svc.getLogs('cb1').job?.id).not.toBe(first.id);
    expect(svc.getLogs('cb1').job?.status).toBe('running');
  });

  it('keeps only the last 500 lines (ring buffer)', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'fetch');
    for (let i = 0; i < 520; i++) svc.appendLine('cb1', 'stdout', `line ${i}`);
    const logs = svc.getLogs('cb1', 1000); // ask for more than the cap
    expect(logs.lines).toHaveLength(500);
    expect(logs.lines[0]!.text).toBe('line 20'); // oldest 20 dropped
    expect(logs.lines[499]!.text).toBe('line 519');
  });

  it('`limit` returns only the most recent N lines', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'fetch');
    for (let i = 0; i < 10; i++) svc.appendLine('cb1', 'stdout', `line ${i}`);
    const logs = svc.getLogs('cb1', 3);
    expect(logs.lines.map((l) => l.text)).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it('a blank line is dropped, not stored', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'fetch');
    svc.appendLine('cb1', 'stdout', '');
    expect(svc.getLogs('cb1').lines).toHaveLength(0);
  });

  it('codebases are isolated from each other', () => {
    const svc = new CodebaseLogService();
    svc.startJob('cb1', 'clone');
    svc.startJob('cb2', 'fetch');
    svc.appendLine('cb1', 'stdout', 'cb1 line');
    svc.appendLine('cb2', 'stdout', 'cb2 line');
    expect(svc.getLogs('cb1').lines.map((l) => l.text)).toEqual(['cb1 line']);
    expect(svc.getLogs('cb2').lines.map((l) => l.text)).toEqual(['cb2 line']);
    expect(svc.getLogs('cb1').job?.kind).toBe('clone');
    expect(svc.getLogs('cb2').job?.kind).toBe('fetch');
  });
});
