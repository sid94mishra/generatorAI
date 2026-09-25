// Post-processing steps (P01 WP-1.4): every declared step runs — there is no
// `enabled` flag that silently dropped them — and `config` is a required
// discriminated union whose `type` must match the step's.

import { describe, expect, it } from 'vitest';
import { CreateWorkflowDefinitionSchema } from '../src/config/WorkflowDefinitionSchemas.js';

const withSteps = (postProcessingSteps: unknown[]) =>
  CreateWorkflowDefinitionSchema.safeParse({ name: 'wf', orchestratorConfig: { postProcessingSteps } });

describe('orchestratorConfig.postProcessingSteps', () => {
  it('accepts a complete step and defaults failOnError/order', () => {
    const parsed = withSteps([
      { type: 'commit_and_push', name: 'commit', config: { type: 'commit_and_push', commitMessage: 'feat: x' } },
    ]);
    expect(parsed.success).toBe(true);
    const step = parsed.success ? parsed.data.orchestratorConfig?.postProcessingSteps[0] : undefined;
    expect(step).toMatchObject({ failOnError: true, order: 0 });
    expect(step).not.toHaveProperty('enabled');
  });

  it('rejects a step without a config', () => {
    expect(withSteps([{ type: 'create_pr', name: 'pr' }]).success).toBe(false);
  });

  it('rejects a config whose type disagrees with the step type', () => {
    const parsed = withSteps([
      { type: 'create_pr', name: 'pr', config: { type: 'run_script', script: 'echo hi' } },
    ]);
    expect(parsed.success).toBe(false);
  });

  it('rejects a config missing its required fields', () => {
    expect(withSteps([{ type: 'run_script', name: 's', config: { type: 'run_script' } }]).success).toBe(false);
  });
});
