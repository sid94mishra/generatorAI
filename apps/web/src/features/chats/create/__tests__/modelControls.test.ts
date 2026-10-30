import { describe, expect, it } from 'vitest';
import { reasoningEffortLabel } from '@generatorai/shared/ui-contract';
import { agentRuntimeSelection } from '../modelControls.js';

describe('agentRuntimeSelection', () => {
  it('carries the agent model and effort into the create flow', () => {
    expect(agentRuntimeSelection({ runtime: { model: 'opus', reasoningEffort: 'high' } })).toEqual({ model: 'opus', reasoningEffort: 'high' });
  });
  it('leaves the defaults alone when the agent inherits', () => {
    expect(agentRuntimeSelection({ runtime: {} })).toEqual({});
    expect(agentRuntimeSelection(undefined)).toEqual({});
  });
});

describe('reasoningEffortLabel', () => {
  it('names every level the same way on every surface', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffortLabel)).toEqual([
      'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultra',
    ]);
  });
});
