// P00 WP-0.6 — check-workflow-invariants.mjs and check-no-legacy.mjs.
// Runs under the root vitest "node" project (`pnpm exec vitest run scripts`).

import { describe, expect, it } from 'vitest';
import { scanSource, MODE } from '../check-workflow-invariants.mjs';
import { findLegacy } from '../check-no-legacy.mjs';

describe('no-direct-stage-status-write', () => {
  it('flags updateStatus, update with a status key, and raw SQL', () => {
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
    ].join('\n');
    const hits = scanSource('x.ts', src);
    expect(hits.map((h) => `${h.line}:${h.kind}`)).toEqual([
      '1:updateStatus',
      '2:update({ status })',
      '3:update({ status })',
      '8:SQL UPDATE stage_runs SET status',
    ]);
  });

  it('is report-only in P00', () => {
    expect(MODE).toBe('report');
  });
});

describe('check-no-legacy', () => {
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
