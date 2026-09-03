// ────────────────────────────────────────────────────────────────
// EntryRepository — durable artifact channel (X-25 / W23)
//
// Before this pass `entries.kind='artifact'` had ZERO writers and ZERO
// readers: the table was created by migration 37, documented as the home for
// stage results, and then never used — every stage result went through the
// chat message stream instead. These tests pin the append/lastChunk contract
// the plan specified, against real in-memory SQLite through the real
// repository.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, EntryRepository } from '../src/index.js';

describe('EntryRepository — artifacts (X-25)', () => {
  let db: ReturnType<typeof createDB>;
  let repo: EntryRepository;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    repo = new EntryRepository(db);
  });

  it('creates the artifact on first append and returns it', () => {
    const rec = repo.appendArtifact({
      scope: 'stage_run',
      scopeId: 'sr-1',
      artifactId: 'result',
      chunk: 'hello',
      meta: { stageName: 'Build' },
    });

    expect(rec).not.toBeNull();
    expect(rec!.text).toBe('hello');
    expect(rec!.lastChunk).toBe('hello');
    expect(rec!.chunkCount).toBe(1);
    expect(rec!.complete).toBe(false);
    expect(rec!.meta).toEqual({ stageName: 'Build' });
  });

  it('appends chunks in order without losing earlier text', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'one ' });
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'two ' });
    const third = repo.appendArtifact({
      scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'three',
    });

    expect(third!.text).toBe('one two three');
    expect(third!.chunkCount).toBe(3);
    expect(repo.getArtifact('stage_run', 'sr-1', 'a')!.text).toBe('one two three');
  });

  it('lastChunk returns only the most recent chunk', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'first' });
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'second' });

    expect(repo.lastChunk('stage_run', 'sr-1', 'a')).toBe('second');
  });

  it('seals the artifact on last:true and refuses further appends', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'body' });
    const sealed = repo.appendArtifact({
      scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: '!', last: true,
    });

    expect(sealed!.complete).toBe(true);
    expect(sealed!.text).toBe('body!');

    // The lastChunk contract: a sealed artifact takes no further chunks, and
    // the caller is told so rather than getting a silent no-op.
    const rejected = repo.appendArtifact({
      scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'late',
    });
    expect(rejected).toBeNull();
    expect(repo.getArtifact('stage_run', 'sr-1', 'a')!.text).toBe('body!');
  });

  it('reuses the row for the same artifactId — a retry does not fork a copy (W23)', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'stable', chunk: 'x' });
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'stable', chunk: 'y' });

    const all = repo.listArtifacts('stage_run', 'sr-1');
    expect(all).toHaveLength(1);
    expect(all[0]!.artifactId).toBe('stable');
    expect(all[0]!.text).toBe('xy');
  });

  it('keeps artifacts of different scopes independent', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'A' });
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-2', artifactId: 'a', chunk: 'B' });

    expect(repo.getArtifact('stage_run', 'sr-1', 'a')!.text).toBe('A');
    expect(repo.getArtifact('stage_run', 'sr-2', 'a')!.text).toBe('B');
  });

  it('preserves the creation meta when a later append supplies a different one', () => {
    repo.appendArtifact({
      scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: '1', meta: { v: 1 },
    });
    const second = repo.appendArtifact({
      scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: '2', meta: { v: 2 },
    });

    expect(second!.meta).toEqual({ v: 1 });
  });

  it('returns undefined for an artifact that was never opened', () => {
    expect(repo.getArtifact('stage_run', 'sr-1', 'nope')).toBeUndefined();
    expect(repo.lastChunk('stage_run', 'sr-1', 'nope')).toBeUndefined();
    expect(repo.listArtifacts('stage_run', 'sr-1')).toEqual([]);
  });

  it('does not treat an artifact as a tool_result or an iteration slot', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'x' });

    // The artifact sets `key` to the artifactId for scope+key lookups; that
    // must not make it visible to the effect-sandwich or iteration queries,
    // which are the other two users of `key`.
    expect(repo.findToolResult('stage_run', 'sr-1', 'a')).toBeUndefined();
    expect(repo.findStageResultByKey('stage_run', 'sr-1', 'a')).toBeUndefined();
    expect(repo.countPendingIterations('stage_run', 'sr-1')).toBe(0);
  });

  it('deleteByScope reclaims artifacts (§3.4 retention)', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'x' });
    repo.deleteByScope('stage_run', 'sr-1');
    expect(repo.listArtifacts('stage_run', 'sr-1')).toEqual([]);
  });

  it('deleteJournalByScope drops the step journal and keeps the artifact', () => {
    repo.appendArtifact({ scope: 'stage_run', scopeId: 'sr-1', artifactId: 'a', chunk: 'result' });
    repo.create({ scope: 'stage_run', scopeId: 'sr-1', kind: 'tool_result', key: 'op-1', payload: '"x"' });
    repo.create({ scope: 'stage_run', scopeId: 'sr-1', kind: 'signal', key: 'sig', payload: null });

    repo.deleteJournalByScope('stage_run', 'sr-1');

    // The journal is what grows without bound (one row per turn, per stage,
    // forever); the artifact is the durable result and is read afterwards.
    expect(repo.listByScope('stage_run', 'sr-1').map((e) => e.kind)).toEqual(['artifact']);
    expect(repo.getArtifact('stage_run', 'sr-1', 'a')!.text).toBe('result');
  });
});

describe('migration 43 — usage_ledger is dropped, deliberately', () => {
  it('leaves no usage_ledger table behind on a migrated database', () => {
    const db = createDB(':memory:');
    migrateDB(db);
    const client = (db as unknown as { session: { client: import('better-sqlite3').Database } })
      .session.client;

    // Migration 38 created it as part of the W47 trio and the tracker counted
    // it as W24 delivered; it never gained a writer or a reader. Keeping dead
    // schema that a status document cites as evidence is the exact failure the
    // V2 audit exists to catch — see migration 43's comment for why dropping
    // beat inventing a partial writer.
    const row = client
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_ledger'`)
      .get();
    expect(row).toBeUndefined();
  });
});
