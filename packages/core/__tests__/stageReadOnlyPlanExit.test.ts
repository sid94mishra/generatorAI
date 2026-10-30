// E-6 — a read-only workflow stage (permission mode `plan`) must not be offered ExitPlanMode: the call failed or
// opened a review nobody asked for, and the stage's output became the model's reply to it instead of its answer.
import { describe, expect, it } from 'vitest';

import { stageSessionSpec } from '../src/services/engine/StageExecutor.js';

type Graph = Parameters<typeof stageSessionSpec>[0];
type Stage = Parameters<typeof stageSessionSpec>[1];

const graph = (session: Record<string, unknown> = {}) => ({ workflow: { session } }) as unknown as Graph;
const stage = (session?: Record<string, unknown>) => ({ key: 's', session }) as unknown as Stage;
const run = {};

describe('stageSessionSpec — read-only stages', () => {
  it('removes ExitPlanMode from a plan-mode stage', () => {
    const { merged } = stageSessionSpec(graph(), stage({ permissionMode: 'plan' }), run);
    expect(merged.tools?.excluded).toContain('ExitPlanMode');
  });

  it('applies to a stage that inherits plan mode from the workflow, keeping its own exclusions', () => {
    const { merged } = stageSessionSpec(graph({ permissionMode: 'plan' }), stage({ tools: { excluded: ['WebFetch'] } }), run);
    expect(merged.tools?.excluded).toEqual(['WebFetch', 'ExitPlanMode']);
  });

  it('keeps ExitPlanMode for a stage that asks for a plan review (agent mode plan)', () => {
    const { merged } = stageSessionSpec(graph(), stage({ permissionMode: 'plan', defaultAgentMode: 'plan' }), run);
    expect(merged.tools?.excluded ?? []).not.toContain('ExitPlanMode');
  });

  it('leaves writer stages alone', () => {
    const { merged } = stageSessionSpec(graph(), stage({ permissionMode: 'acceptEdits' }), run);
    expect(merged.tools?.excluded ?? []).not.toContain('ExitPlanMode');
  });
});
