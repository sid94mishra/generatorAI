// Post-processing templates (commit message, PR title/body) read stage outputs:
// the validator checks them against the full scope, so the renderer must provide
// `stages` (U-20: a PR body of `{{stages.prepare_pr.output.body}}` came out empty).
import { describe, expect, it, vi } from 'vitest';

import { LifecycleSteps, type LifecycleStepContext } from '../engine/lifecycle/steps.js';

function harness() {
  return new LifecycleSteps(
    { cloneToDirectory: vi.fn() } as never,
    { run: vi.fn() } as never,
    { emitGlobal: vi.fn(async () => undefined) } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    { run: vi.fn() },
  );
}

const setVar = (value: string) => ({ name: 'set out', config: { type: 'set_variable', variableName: 'out', value }, failOnError: true }) as never;

describe('lifecycle templates and stage outputs', () => {
  it('renders stages.<key>.output.<field> when the stages are given', async () => {
    const ctx: LifecycleStepContext = {
      runId: 'run-1',
      variables: {},
      codebases: {},
      workDir: '/runs/run-1',
      stages: { prepare_pr: { status: 'completed', output: { body: '## Summary\n\nDone.' }, summary: null } },
    };
    await harness().execute([setVar('{{stages.prepare_pr.output.body}}')], ctx);
    expect(ctx.variables['out']).toBe('## Summary\n\nDone.');
  });
});
