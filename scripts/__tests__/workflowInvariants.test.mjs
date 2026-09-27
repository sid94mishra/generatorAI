// P00 WP-0.6 — check-workflow-invariants.mjs and check-no-legacy.mjs.
// Runs under the root vitest "node" project (`pnpm test:scripts`).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, MODE, scanSource, secondArg } from '../check-workflow-invariants.mjs';
import { commentText, commentVerdict, configErrors, findLegacy, findLegacyComments } from '../check-no-legacy.mjs';

describe('no-direct-stage-status-write', () => {
  it('flags every status-writing call shape and raw SQL', () => {
    const src = [
      "await this.stageRunRepo.updateStatus(id, 'paused');",
      "await this.stageRunRepo.update(id, { status: 'running' });",
      'await stageRunRepo.update(id, {',
      '  error: e,',
      '  status,',
      '});',
      'await this.stageRunRepo.update(id, { summary: s });',
      "db.exec(`UPDATE stage_runs SET status = 'failed' WHERE id = ?`);",
      "await this.stageRunRepo.update(id, { status: 'x' }); // workflow-invariant-ok: test waiver",
      "await stageRunRepo.batchUpdateStatus(ids, 'cancelled');",
      "await this.stageRunRepo!.update(id, { status: 'queued' });",
      'await stageRunRepo.update(stage.id, patch);',
      "await this.stageRunRepo?.updateStatus(id, 'failed');",
    ].join('\n');
    expect(scanSource('x.ts', src).map((h) => `${h.line}:${h.kind}`)).toEqual([
      '1:updateStatus',
      '2:update({ status })',
      '3:update({ status })',
      '10:batchUpdateStatus',
      '11:update({ status })',
      '12:update(id, <patch variable>)',
      '13:updateStatus',
      '8:SQL UPDATE stage_runs SET status',
    ]);
  });

  it('flags status writes on every workflow table, through any receiver, Drizzle or quoted SQL', () => {
    const cases = {
      'renamed receiver (stageRuns)': "await this.stageRuns.update(id, { status: 'failed' });",
      'renamed receiver (stageRunRepository)': "await deps.stageRunRepository.update(id, { status: 'failed' });",
      'drizzle update(stageRuns).set': "await db.update(stageRuns).set({ status: 'failed' }).where(eq(stageRuns.id, id));",
      'raw SQL with a column before status': "sqlite.prepare(`UPDATE stage_runs SET error = 'x', status = ? WHERE id = ?`).run('failed', id);",
      'raw SQL, table quoted': 'sqlite.exec(`UPDATE "stage_runs" SET status = \'failed\'`);',
      'workflow_runs raw SQL': "sqlite.prepare(`UPDATE workflow_runs SET status = ? WHERE id = ?`).run('failed', id);",
      'drizzle update(workflowRuns)': "await db.update(workflowRuns).set({ status: 'failed' });",
      'workflowRunRepo.updateStatus': "await this.workflowRunRepo.updateStatus(id, 'failed');",
      'stage_attempts raw SQL': "sqlite.prepare(`UPDATE stage_attempts SET status = ? WHERE id = ?`).run('failed', id);",
    };
    const missed = Object.entries(cases)
      .filter(([, src]) => scanSource('x.ts', src).length === 0)
      .map(([name]) => name);
    expect(missed).toEqual([]);
  });

  it('does not flag writes that leave status alone', () => {
    const src = [
      "sqlite.prepare(`UPDATE stage_attempts SET repair_count = repair_count + 1 WHERE id = ? AND status = 'running'`).run(id);",
      "await db.update(workflowRuns).set({ name: 'x' }).where(eq(workflowRuns.id, id));",
      'await this.stageRuns.update(id, { summary: s });',
    ].join('\n');
    expect(scanSource('x.ts', src)).toEqual([]);
  });

  it('splits top-level arguments', () => {
    expect(secondArg("id, { a: f(1, 2), status: 'x' }")).toBe("{ a: f(1, 2), status: 'x' }");
    expect(secondArg("id, 'a,b', c")).toBe("'a,b'");
    expect(secondArg('id')).toBe('');
  });

  it('is a hard failure since the P03 cutover, with no tolerated writes', () => {
    expect(MODE).toBe('fail');
    expect(BASELINE).toBe(0);
  });
});

describe('check-no-legacy: banned identifiers', () => {
  const files = { 'packages/core/src/a.ts': 'const x = new LegacyThing();\nok();', 'apps/web/src/b.ts': 'LegacyThing()' };
  const read = (f) => files[f];

  it('finds nothing when no pattern is banned', () => {
    expect(findLegacy([], Object.keys(files), read)).toEqual([]);
  });

  it('reports every line matching a banned pattern, honouring path prefixes', () => {
    const hits = findLegacy(
      [{ phase: '01', pattern: '\\bLegacyThing\\b', paths: ['packages/'], reason: 'deleted in P01' }],
      Object.keys(files),
      read,
    );
    expect(hits).toEqual([
      { file: 'packages/core/src/a.ts', line: 1, phase: '01', pattern: '\\bLegacyThing\\b', text: 'const x = new LegacyThing();' },
    ]);
  });

  it('checks the docs only against the entries marked docs', () => {
    const docs = { '.github/docs/x.md': 'POST /api/old-route and LegacyThing' };
    const banned = [
      { phase: '01', pattern: '\\bLegacyThing\\b', reason: 'code only' },
      { phase: '01', pattern: 'old-route', docs: true, reason: 'a deleted route' },
    ];
    expect(findLegacy(banned, Object.keys(docs), (f) => docs[f]).map((h) => h.pattern)).toEqual(['old-route']);
  });

  it('rejects a config pattern with a control character (a JSON "\\b" is U+0008)', () => {
    expect(configErrors({ banned: [{ phase: '01', pattern: '\bfoo\b' }] })).toHaveLength(1);
    expect(configErrors({ banned: [{ phase: '01', pattern: '\\bfoo\\b' }], comments: { paths: ['^packages/'] } })).toEqual([]);
  });

  it('the shipped config is valid', () => {
    const config = JSON.parse(readFileSync(new URL('../no-legacy.json', import.meta.url), 'utf8'));
    expect(configErrors(config)).toEqual([]);
  });
});

describe('check-no-legacy: legacy comments in the workflow module', () => {
  it('reads only the comment part of a line', () => {
    expect(commentText("const legacy = 1; // keep for backward compat")).toBe('// keep for backward compat');
    expect(commentText(' * @deprecated use x')).toBe('* @deprecated use x');
    expect(commentText("fetch('http://legacy.example')")).toBe('');
  });

  it('matches the four phrases inside comments of in-scope files only', () => {
    const files = {
      'packages/core/src/services/WorkflowRunService.ts': [
        '// legacy path, remove in P03',
        'const legacyVar = 1;',
        '/** @deprecated */',
        '  * fallback for old clients',
        'x(); // Backward-compat shim',
      ].join('\n'),
      'packages/core/src/services/ChatManagementService.ts': '// legacy but out of scope',
    };
    const hits = findLegacyComments(Object.keys(files), ['^packages/core/src/services/Workflow'], (f) => files[f]);
    expect(hits.map((h) => h.line)).toEqual([1, 3, 4, 5]);
  });

  it('is report-only with a growth ratchet until the phase reaches failFromPhase', () => {
    expect(commentVerdict({ phase: '00', failFromPhase: null, baseline: 64 }, 64)).toEqual({ mode: 'report', fail: false });
    expect(commentVerdict({ phase: '00', failFromPhase: null, baseline: 64 }, 65)).toEqual({ mode: 'report', fail: true });
    expect(commentVerdict({ phase: '03', failFromPhase: '03', baseline: 0 }, 1)).toEqual({ mode: 'fail', fail: true });
    expect(commentVerdict({ phase: '03', failFromPhase: '03', baseline: 0 }, 0)).toEqual({ mode: 'fail', fail: false });
  });
});
