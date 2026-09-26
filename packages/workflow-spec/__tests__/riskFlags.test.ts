// Final review AGENT R6: risk flags cover every command-bearing field and
// workflow tool grants.

import { describe, expect, it } from 'vitest';
import { riskFlags, validateWorkflow } from '../src/index.js';
import { agent, graph } from './fixtures.js';

describe('risk flags', () => {
  it('runs_repo_code covers every command-bearing field, and workflow tool grants are flagged', () => {
    const hook = { id: 'h', name: 'h', phase: 'pre_run', type: 'script', config: { type: 'script', command: 'node', args: ['h.js'] } };
    const r = validateWorkflow(graph([agent('a', { hooks: [hook], session: { agentOverrides: { tools: { workflows: true } } } })]));
    expect(r.valid).toBe(true);
    expect(riskFlags(r.graph!)).toEqual(expect.arrayContaining(['runs_repo_code', 'uses_workflow_tools']));
    const plain = validateWorkflow(graph([agent('a')]));
    expect(riskFlags(plain.graph!)).not.toContain('runs_repo_code');
    expect(riskFlags(plain.graph!)).not.toContain('uses_workflow_tools');
  });
});
