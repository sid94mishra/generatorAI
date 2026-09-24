// P00 WP-0.3 — the E2E runner's expectation judge. Runs under the root
// vitest "node" project (`pnpm exec vitest run scripts`).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { judge } from '../workflow-e2e/run.mjs';

const result = {
  runStatus: 'completed',
  sessionMode: 'per-stage',
  stages: [
    { name: 'A', status: 'completed', retryCount: 0 },
    { name: 'B', status: 'skipped', retryCount: 0 },
    { name: 'C', status: 'failed', retryCount: 2 },
  ],
  messages: {
    A: [{ role: 'user', content: 'TOPIC=x rest', flags: [] }],
    C: [{ role: 'user', content: '## Completed Stage: "A"\nctx', flags: ['isContextMessage'] }],
  },
  sse: { errors: [], sessionInfo: [{ infoType: 'unresolved_variables' }] },
};

describe('workflow-e2e judge', () => {
  it('passes when every expectation holds', () => {
    expect(
      judge(result, {
        runStatus: 'completed',
        sessionMode: 'per-stage',
        stages: { A: 'completed', B: ['skipped', 'completed'], C: 'failed' },
        retryCount: { C: 2 },
        hasContext: ['C'],
        noContext: ['A'],
        contextContains: [{ stage: 'C', text: '"A"' }],
        promptStartsWith: [{ stage: 'A', text: 'TOPIC=x' }],
        sessionInfo: ['unresolved_variables'],
      }),
    ).toEqual([]);
  });

  it('reports each failed check', () => {
    const failures = judge(result, {
      runStatus: 'failed',
      stages: { B: 'completed' },
      allStages: 'completed',
      noContext: ['C'],
      sessionInfo: ['durable_turn_skipped'],
    });
    expect(failures).toEqual([
      'run status completed (expected failed)',
      'stage B skipped (expected completed)',
      'stage B skipped (expected completed)',
      'stage C failed (expected completed)',
      'stage C received a context message (expected none)',
      'no harness.session_info durable_turn_skipped on the run stream',
    ]);
  });

  it('every scenario a phase lists is defined and has a spec file', () => {
    const reg = JSON.parse(readFileSync(new URL('../workflow-e2e/scenarios.json', import.meta.url), 'utf8'));
    for (const ids of Object.values(reg.phases)) {
      for (const id of ids) {
        expect(reg.scenarios[id], id).toBeDefined();
        const spec = JSON.parse(readFileSync(new URL(`../workflow-e2e/${reg.scenarios[id].spec}`, import.meta.url), 'utf8'));
        expect(spec.tag).toBe(id);
      }
    }
  });
});
