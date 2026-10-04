import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import { planInvocation } from '../planInvocation.js';
import type { ValidatedInvocation } from '../validateInvocation.js';

// The "Feature delivery" shape from the desktop end-to-end build: loop(implement → test) → review (agent-bound)
// → approve (approval wait) → merge, with a workflow default model.
const graph = {
  workflow: { name: 'Feature delivery', session: { model: 'sonnet' }, lifecycle: { preprocessingSteps: [], codebaseAliases: [], postProcessing: { steps: [] } } },
  stages: [
    { key: 'loop_1', name: 'Loop 1', kind: 'loop' },
    { key: 'implement', name: 'Implement', kind: 'agent', parentKey: 'loop_1', session: {} },
    { key: 'test', name: 'Test', kind: 'check', parentKey: 'loop_1', check: { command: 'npm', args: ['test'] } },
    { key: 'review', name: 'Review', kind: 'agent', session: { agentRef: 'global:reviewer' } },
    { key: 'approve', name: 'Approve', kind: 'wait', wait: { type: 'approval' } },
    { key: 'merge', name: 'Merge', kind: 'agent', session: {} },
  ],
  edges: [
    { from: 'implement', to: 'test' },
    { from: 'loop_1', to: 'review' },
    { from: 'review', to: 'approve' },
    { from: 'approve', to: 'merge' },
  ],
} as unknown as WorkflowGraph;

const validated = {
  variables: {}, codebases: [], codebaseSource: 'request', stageOverrides: [], runOverrides: {},
  effectivePermissionMode: 'acceptEdits', lineage: { depth: 0 }, uploads: [], warnings: [],
} as unknown as ValidatedInvocation;

describe('planInvocation', () => {
  const plan = planInvocation({ workflowDefinitionId: 'w', definitionVersionId: 'v', graph }, validated);
  const byKey = Object.fromEntries(plan.stages.map((s) => [s.key, s]));

  it('lays out top-level stages; a body stage takes its container layer', () => {
    expect([byKey.loop_1!.layer, byKey.review!.layer, byKey.approve!.layer, byKey.merge!.layer]).toEqual([0, 1, 2, 3]);
    expect(byKey.implement!.layer).toBe(0);
    expect(byKey.test!.layer).toBe(0);
  });

  it('gives models to agent stages only, and never claims the workflow default for an agent-bound stage', () => {
    expect(byKey.implement!.model).toBe('sonnet');
    expect(byKey.merge!.model).toBe('sonnet');
    expect(byKey.review!.model).toBeUndefined();
    expect(byKey.review!.agentRef).toBe('global:reviewer');
    expect(byKey.test!.model).toBeUndefined();
    expect(byKey.approve!.model).toBeUndefined();
  });

  it('lists an approval wait as an approval', () => {
    expect(byKey.approve!.approvalRequired).toBe(true);
    expect(byKey.merge!.approvalRequired).toBe(false);
  });
});
