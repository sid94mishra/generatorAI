// P00 WP-0.6 — check-workflow-invariants.mjs and check-no-legacy.mjs.
// Runs under the root vitest "node" project (`pnpm test:scripts`).

import { describe, expect, it } from 'vitest';
import { BASELINE, MODE, scanSource, secondArg } from '../check-workflow-invariants.mjs';
import { commentText, commentVerdict, findLegacy, findLegacyComments } from '../check-no-legacy.mjs';

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
