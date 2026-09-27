// P00 WP-0.3 — the E2E runner's expectation judge. Runs under the root
// vitest "node" project (`pnpm test:scripts`; `turbo test` runs it).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { judge } from '../workflow-e2e/run.mjs';

const result = {
  runStatus: 'completed',
  stages: [
    { name: 'A', status: 'completed', attempts: 1, output: { exitCode: 0, passed: true, stdoutTail: 'v26.0.0' } },
    { name: 'B', status: 'skipped', attempts: 0 },
    { name: 'C', status: 'failed', attempts: 2 },
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
        stages: { A: 'completed', B: ['skipped', 'completed'], C: 'failed' },
        attempts: { C: 2 },
        outputContains: [{ stage: 'A', text: '"passed":true' }],
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

  it('every scenario a phase lists is defined and has a spec file holding a valid v2 graph', async () => {
    const { validateWorkflow } = await import('../../packages/workflow-spec/src/index.ts');
    const reg = JSON.parse(readFileSync(new URL('../workflow-e2e/scenarios.json', import.meta.url), 'utf8'));
    expect(reg.phases.smoke?.length).toBeGreaterThan(0);
    for (const ids of Object.values(reg.phases)) {
      for (const id of ids) {
        expect(reg.scenarios[id], id).toBeDefined();
        const spec = JSON.parse(readFileSync(new URL(`../workflow-e2e/${reg.scenarios[id].spec}`, import.meta.url), 'utf8'));
        expect(spec.tag).toBe(id);
        const errors = validateWorkflow(spec.graph).issues.filter((i) => i.severity === 'error');
        expect(errors, `${id}: ${JSON.stringify(errors)}`).toEqual([]);
      }
    }
  });
});

describe('workflow-e2e server ownership (P00 review R17)', () => {
  const tsx = new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const ours = { cmd: `"node.exe" ${tsx} --import ./src/instrumentation.ts src/index.ts`, created: '2026-09-24T10:00:00.0000000Z' };

  it('accepts this worktree’s server with a matching creation time and no listener check', async () => {
    const { verifyOwnServer } = await import('../workflow-e2e/server.mjs');
    expect(verifyOwnServer({ pid: process.pid, created: ours.created }, ours, [])).toEqual({ ok: true });
  });

  it('refuses another checkout’s server (e.g. the developer :3100 one)', async () => {
    const { verifyOwnServer } = await import('../workflow-e2e/server.mjs');
    const other = { cmd: 'node C:/Users/dev/GeneratorAI/node_modules/tsx/dist/cli.mjs --import ./src/instrumentation.ts src/index.ts', created: ours.created };
    expect(verifyOwnServer({ pid: 1, created: ours.created }, other, []).ok).toBe(false);
  });

  it('refuses a recycled pid', async () => {
    const { verifyOwnServer } = await import('../workflow-e2e/server.mjs');
    const r = verifyOwnServer({ pid: 1, created: '2026-09-24T09:00:00.0000000Z' }, ours, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reused/);
  });

  it('refuses when another process owns the port', async () => {
    const { verifyOwnServer } = await import('../workflow-e2e/server.mjs');
    const r = verifyOwnServer({ pid: process.pid, created: ours.created, port: 3111 }, ours, [999_999]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/owned by another process/);
  });
});
